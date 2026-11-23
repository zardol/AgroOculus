"use strict";
const FieldLab = (() => {
  const database = typeof Field !== "undefined" ? Field : require("./model.js");
  const camera = typeof CropCamera !== "undefined" ? CropCamera : require("./lab-camera.js");
  const detector = typeof CropDetector !== "undefined" ? CropDetector : require("./lab-detector.js");
  const weights = typeof SpectralWeights !== "undefined" ? SpectralWeights : require("./lab-weights.js");
  const calibration = typeof CameraCalibration !== "undefined" ? CameraCalibration : require("./lab-calibration.js");
  const clip = (v, lo, hi) => Math.min(hi,Math.max(lo,v));
  const sigmoid = x => 1/(1+Math.exp(-x));
  const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
  const exposures = new Map();
  const snapshots = new WeakMap();
  const images = new WeakMap();
  const liveBuffers = new WeakMap();
  const calibrationFrames = new Map();
  let stationFrame;

  function predict(bands) {
    const conv = weights["conv.weight"], convBias=weights["conv.bias"];
    const wi=weights["lstm.weight_ih_l0"], wh=weights["lstm.weight_hh_l0"];
    const bi=weights["lstm.bias_ih_l0"], bh=weights["lstm.bias_hh_l0"];
    let h=Array(8).fill(0), memory=Array(8).fill(0);
    for(let t=1;t<bands.length;t++) {
      const features=conv.map((kernel,index)=>{
        let sum=convBias[index];
        for(let c=0;c<2;c++) for(let k=0;k<2;k++)
          sum+=kernel[c][k]*(bands[t-1+k][c]-.4)*4;
        return Math.tanh(sum);
      });
      const gates=wi.map((row,i)=>dot(row,features)+dot(wh[i],h)+bi[i]+bh[i]);
      memory=memory.map((m,i)=>sigmoid(gates[8+i])*m+sigmoid(gates[i])*Math.tanh(gates[16+i]));
      h=memory.map((m,i)=>sigmoid(gates[24+i])*Math.tanh(m));
    }
    return clip(dot(weights["out.weight"][0],h)+weights["out.bias"][0],-1,1);
  }

  // EKF update with nonlinear observation h(NDVI) = NIR/Red. Clouds raise measurement variance.
  function correct(prior,red,nir,uncertainty) {
    prior=clip(prior,-.95,.95);
    const expected=(1+prior)/(1-prior), jacobian=2/(1-prior)**2;
    const variance=.025**2, gain=variance*jacobian/(jacobian**2*variance+uncertainty**2);
    return clip(prior+gain*(nir/red-expected),-.98,.98);
  }

  function readSensor(cell,scenario,attempt) {
    const history=database.series(cell);
    if(history.length!==6) throw new RangeError("Сектор отсутствует в учебном наборе.");
    const current=history.at(-1), seed=2039+database.cells.find(c=>c.id===cell).i*3593;
    const kind=scenario?.cell===cell ? scenario.kind : "clear";
    const intensity=kind==="clear" ? 0 : scenario.intensity;
    if (!["clear","cloud","dry","dropout"].includes(kind)
      || !Number.isInteger(intensity) || intensity<0 || intensity>3
      || !Number.isInteger(attempt) || attempt<0 || attempt>2) throw new RangeError("Неизвестные условия съёмки.");
    const key=[cell,kind,intensity,attempt].join("/");
    if(exposures.has(key)) return exposures.get(key);
    const base={cell,kind,intensity,attempt,baseline:current.ndvi,prior:history.at(-2).ndvi};
    let result;
    if(kind==="dropout" && attempt===0) {
      result={...base,available:false,red:null,nir:null,ndvi:null,filtered:null,forecast:null,boxes:[],frame:null};
    } else {
      const light=(kind==="cloud" ? 1-intensity*.13 : 1)*(1+.012*Math.sin(attempt*2.3));
      const jitter=attempt ? .0025*Math.sin(seed+attempt*11) : 0;
      const red=clip(current.red*light+(kind==="dry" ? .012*intensity : 0)+jitter,.01,.98);
      const nir=clip(current.nir*light-(kind==="dry" ? .026*intensity : 0)-jitter*.8,.01,.98);
      const ndvi=(nir-red)/(nir+red);
      const {pixels,size}=camera.frame(seed,ndvi,light,128,attempt);
      const frame={pixels,size};
      result={...base,available:true,red,nir,ndvi,light,frame};
    }
    if(exposures.size>=48) exposures.delete(exposures.keys().next().value);
    exposures.set(key,result);
    return result;
  }

  function detectCrop(frame) {
    return detector.detect(frame).filter(box=>box.label==="crop_stress");
  }

  function capture(cell,scenario,attempt) {
    const exposure=readSensor(cell,scenario,attempt);
    if(!exposure.available) return exposure;
    if(snapshots.has(exposure)) return snapshots.get(exposure);
    const {red,nir,light,kind,intensity,frame}=exposure;
    const sequence=database.series(cell).slice(0,-1).map(r=>[r.red,r.nir]);
    const filtered=correct(predict(sequence),red,nir,kind==="cloud" ? .12+.08*intensity : .045);
    const total=(red+nir)/light;
    const forecast=predict([...sequence.slice(1),[total*(1-filtered)/2,total*(1+filtered)/2]]);
    const observed={...exposure,filtered,forecast,boxes:detectCrop(frame)};
    snapshots.set(exposure,observed);
    return observed;
  }

  function observe(cell,scenario=null,attempt=0,threshold=.45) {
    if(!Number.isFinite(threshold) || threshold<0 || threshold>1) throw new RangeError("Порог NDVI должен быть от 0 до 1.");
    const r=capture(cell,scenario,attempt);
    if(!r.available) return {...r,repeat:true,reason:"Кадр отсутствует. Запрошена повторная экспозиция."};
    const falling=r.ndvi<r.prior;
    const repeat=r.ndvi<threshold && (falling || r.boxes.length>0 || r.filtered<threshold);
    let reason="NDVI выше или равен порогу. Продолжаем плановое обследование.";
    if(repeat) {
      if(r.boxes.length) reason="NDVI ниже порога. Детектор выделил участок изменённой окраски. Требуется контрольный кадр.";
      else if(falling) reason="NDVI ниже порога и снизился с предыдущей даты. Требуется контрольный кадр.";
      else reason="Измеренный и отфильтрованный NDVI ниже порога. Требуется контрольный кадр.";
    } else if(r.ndvi<threshold) reason="NDVI ниже порога. Динамика и кадр пока не подтверждают ухудшение.";
    return {...r,repeat,reason};
  }

  function draw(canvas, observation, {boxes=true,live=false}={}) {
    const ctx=canvas.getContext("2d");
    const width=canvas.width,height=canvas.height;
    if(!observation.available) {
      ctx.fillStyle="#101d22"; ctx.fillRect(0,0,width,height);
      for(let y=3;y<height;y+=5){ctx.fillStyle="#15272c";ctx.fillRect(0,y,width,1);}
      ctx.fillStyle="#b5c5c6";ctx.textAlign="center";
      ctx.font=Math.max(12,Math.round(width*.035))+"px monospace";
      ctx.fillText("Кадр потерян",width/2,height/2);ctx.textAlign="start";
      return;
    }
    const frame=observation.frame;
    let surface=live ? liveBuffers.get(canvas) : images.get(frame);
    const needsUpload=live || !surface;
    if(!surface || surface.buffer.width!==frame.size) {
      const buffer=document.createElement("canvas");buffer.width=buffer.height=frame.size;
      const local=buffer.getContext("2d");
      surface={buffer,local,rgba:local.createImageData(frame.size,frame.size)};
      if(live) liveBuffers.set(canvas,surface); else images.set(frame,surface);
    }
    if(needsUpload) {
      const {local,rgba}=surface;
      for(let p=0,i=0;p<rgba.data.length;p+=4,i+=3){
        rgba.data[p]=frame.pixels[i];rgba.data[p+1]=frame.pixels[i+1];
        rgba.data[p+2]=frame.pixels[i+2];rgba.data[p+3]=255;
      }
      local.putImageData(rgba,0,0);
    }
    ctx.imageSmoothingEnabled=true;ctx.drawImage(surface.buffer,0,0,width,height);
    if(boxes) for(const b of observation.boxes) {
      const x=b.x*width,y=b.y*height,w=b.w*width,h=b.h*height;
      ctx.strokeStyle="#ffcf72";ctx.lineWidth=Math.max(1.5,width/250);ctx.strokeRect(x,y,w,h);
      const label=(b.label==="pump_house" ? "Насосная " : "Стресс ")+Math.round(b.confidence*100)+"%";
      const font=Math.max(11,Math.round(width*.033));ctx.font=font+"px monospace";
      const boxY=Math.max(0,y-font-5);ctx.fillStyle="#20201a";ctx.fillRect(x,boxY,ctx.measureText(label).width+8,font+5);
      ctx.fillStyle="#ffdc87";ctx.fillText(label,x+4,boxY+font);
    }
  }

  function station() {
    if(!stationFrame) {
      const {pixels,size}=camera.frame(563443,.69,.94,128,0,true);
      const frame={pixels,size};
      stationFrame={available:true,frame,boxes:detector.detect(frame),mapRect:{...database.restricted}};
    }
    return stationFrame;
  }

  function drawCalibration(canvas,side) {
    if(side!=="before" && side!=="after") throw new RangeError("Выберите исходный или отфильтрованный кадр.");
    if(!calibrationFrames.has(side)) {
      const pixels=Uint8ClampedArray.from(atob(calibration[side]),c=>c.charCodeAt(0));
      calibrationFrames.set(side,{size:calibration.metrics.size,pixels});
    }
    draw(canvas,{available:true,frame:calibrationFrames.get(side),boxes:[]});
  }
  return {capture,observe,readSensor,detectCrop,draw,predict,station,drawCalibration,calibration:calibration.metrics,
          metrics:{detector:detector.metrics,sequence:weights.metrics}};
})();
if(typeof module!=="undefined" && module.exports) module.exports=FieldLab;
