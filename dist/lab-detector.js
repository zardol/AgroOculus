"use strict";
// Inference for the fused single-scale crop model exported by tools/train-crops.py.
const CropDetector = (() => {
  const model = typeof CropYoloWeights !== "undefined" ? CropYoloWeights : require("./lab-yolo.js");
  const sigmoid = x => 1/(1+Math.exp(-x));
  const decoded = new WeakMap();

  function kernel(spec) {
    if (decoded.has(spec)) return decoded.get(spec);
    const binary = atob(spec.w);
    const values = new Float32Array(binary.length/2);
    for (let i=0;i<values.length;i++) {
      const bits = binary.charCodeAt(i*2) | binary.charCodeAt(i*2+1)<<8;
      const mantissa = bits & 1023, exponent = bits>>10 & 31;
      const magnitude = exponent===0 ? 2**-14*mantissa/1024 : 2**(exponent-15)*(1+mantissa/1024);
      values[i] = bits>>15 ? -magnitude : magnitude;
    }
    decoded.set(spec,values);
    return values;
  }

  function conv(input, spec, activate=true) {
    const [channels,depth,k] = spec.shape, stride=spec.stride, pad=k>>1;
    const size=Math.ceil(input.size/stride), sourceArea=input.size**2, area=size**2;
    const output=new Float32Array(area*channels), w=kernel(spec);
    for (let c=0;c<channels;c++) {
      const offset=c*area;
      output.fill(spec.b[c],offset,offset+area);
      for (let d=0;d<depth;d++) for (let j=0;j<k;j++) for (let i=0;i<k;i++) {
        const weight=w[((c*depth+d)*k+j)*k+i];
        const minX=Math.max(0,Math.ceil((pad-i)/stride));
        const maxX=Math.min(size,Math.ceil((input.size+pad-i)/stride));
        const minY=Math.max(0,Math.ceil((pad-j)/stride));
        const maxY=Math.min(size,Math.ceil((input.size+pad-j)/stride));
        for(let y=minY;y<maxY;y++) {
          const base=d*sourceArea+(y*stride+j-pad)*input.size+i-pad;
          const row=offset+y*size;
          for(let x=minX;x<maxX;x++) output[row+x]+=input.data[base+x*stride]*weight;
        }
      }
      if(activate) for(let i=offset;i<offset+area;i++) output[i]*=sigmoid(output[i]);
    }
    return {size,data:output};
  }

  function c2f(input, layer) {
    const first=conv(input,layer.cv1), half=first.data.length/2;
    const parts=[first.data.subarray(0,half),first.data.subarray(half)];
    for(const [a,b] of layer.residuals) {
      const prior=parts.at(-1);
      const next=conv(conv({size:first.size,data:prior},a),b).data;
      for(let i=0;i<next.length;i++) next[i]+=prior[i];
      parts.push(next);
    }
    const data=new Float32Array(half*parts.length);
    parts.forEach((p,i)=>data.set(p,i*half));
    return conv({data,size:first.size},layer.cv2);
  }

  function prepare(frame) {
    const size=model.size, area=size*size, step=frame.size/size;
    if (!Number.isInteger(step) || step<1) throw new RangeError("Размер кадра несовместим с детектором.");
    const data=new Float32Array(area*3);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) for(let ch=0;ch<3;ch++) {
      let sum=0;
      for(let j=0;j<step;j++) for(let i=0;i<step;i++)
        sum+=frame.pixels[((y*step+j)*frame.size+x*step+i)*3+ch];
      data[ch*area+y*size+x]=Math.round(sum/(step*step))/255;
    }
    return {data,size};
  }

  function overlap(a,b) {
    const width=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
    const height=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    return width*height/(a.w*a.h+b.w*b.h-width*height);
  }

  function detect(frame) {
    let x=prepare(frame);
    for(const layer of model.backbone) x=layer.type==="conv" ? conv(x,layer.cv) : c2f(x,layer);
    const branch=layers=>conv(conv(conv(x,layers[0]),layers[1]),layers[2],false).data;
    const classes=branch(model.cls), regression=branch(model.box), bins=model.regMax;
    const area=x.size*x.size, proposals=[];
    for(let i=0;i<area;i++) {
      let classId=0;
      for(let label=1;label<classes.length/area;label++) {
        if(classes[label*area+i]>classes[classId*area+i]) classId=label;
      }
      const confidence=sigmoid(classes[classId*area+i]);
      if(confidence<.25) continue;
      const sides=[];
      for(let side=0;side<4;side++) {
        const offset=side*bins;
        let max=-Infinity;
        for(let j=0;j<bins;j++) max=Math.max(max,regression[(offset+j)*area+i]);
        let norm=0,sum=0;
        for(let j=0;j<bins;j++) {
          const exp=Math.exp(regression[(offset+j)*area+i]-max);
          sum+=j*exp; norm+=exp;
        }
        sides.push(sum/norm);
      }
      const ax=i%x.size+.5, ay=Math.floor(i/x.size)+.5;
      const left=Math.max(0,(ax-sides[0])/x.size), top=Math.max(0,(ay-sides[1])/x.size);
      const right=Math.min(1,(ax+sides[2])/x.size), bottom=Math.min(1,(ay+sides[3])/x.size);
      proposals.push({x:left,y:top,w:right-left,h:bottom-top,confidence,classId,label:model.labels[classId]});
    }
    proposals.sort((a,b)=>b.confidence-a.confidence);
    const selected=[];
    for(const box of proposals) if (!selected.some(b=>b.classId===box.classId && overlap(box,b)>.45)) selected.push(box);
    return selected;
  }
  return {detect,metrics:model.metrics};
})();
if (typeof module !== "undefined" && module.exports) module.exports = CropDetector;
