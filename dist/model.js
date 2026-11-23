"use strict";
const Field = (() => {
  const origin = {lat:45.05, lon:64.98};
  const days = [3,6,9,12,15,18];
  const cells = Array.from({length:24}, (_,i) => ({
    id:"ABCD"[Math.floor(i/6)] + (i%6+1), i,
    x:50+100*(i%6), y:350-100*Math.floor(i/6)
  }));
  const radius = 6371008.8, rad = Math.PI/180;
  function toGPS(x,y) {
    return {lat:origin.lat+y/radius/rad, lon:origin.lon+x/(radius*Math.cos(origin.lat*rad))/rad};
  }
  function toLocal(lat,lon) {
    return {x:(lon-origin.lon)*rad*radius*Math.cos(origin.lat*rad), y:(lat-origin.lat)*rad*radius};
  }
  const raw=[];
  for (const c of cells) {
    for (const [t,day] of days.entries()) {
      const d=Math.exp(-((c.x-445)**2/26000+(c.y-146)**2/15500));
      const ndvi=.62+.105*Math.sin(c.i*1.7)+.012*t-.52*d*(.45+.11*t)+.013*Math.cos(t*2+c.i);
      const total=.74+.07*Math.cos(c.i*.52+t*.3);
      raw.push({id:c.id,day,red:Math.round(10000*total*(1-ndvi)/2),nir:Math.round(10000*total*(1+ndvi)/2),...toGPS(c.x,c.y)});
    }
  }
  raw.push({...raw[7]}, {...raw[9],day:19,red:0,nir:0}, {...raw[13],day:19,red:-20});
  function prepare(rows) {
    const seen=new Set(), valid=[], rejected=[];
    for(const row of rows) {
      const key=row.id+"/"+row.day;
      let reason="";
      if (![row.nir,row.red].every(v=>Number.isFinite(v)&&v>=0&&v<=10000)) reason="Канал вне диапазона";
      else if(row.nir+row.red===0) reason="Нулевой сигнал";
      else if(seen.has(key)) reason="Дублирующая запись";
      if(reason){rejected.push({...row,reason});continue;}
      seen.add(key);
      valid.push({...row,red:row.red/10000,nir:row.nir/10000,ndvi:(row.nir-row.red)/(row.nir+row.red)});
    }
    return {valid,rejected};
  }
  const data=prepare(raw);
  const series=id=>data.valid.filter(r=>r.id===id);
  const last=id=>series(id).at(-1);
  function fit(points) {
    const mean=key=>points.reduce((s,r)=>s+r[key],0)/points.length;
    const x=mean("day"),y=mean("ndvi");
    const slope=points.reduce((s,r)=>s+(r.day-x)*(r.ndvi-y),0)/points.reduce((s,r)=>s+(r.day-x)**2,0);
    return day=>y+slope*(day-x);
  }
  function forecast(id) {
    const records=series(id), test=records.at(-1), predicted=fit(records.slice(0,-1))(test.day);
    return {predicted,actual:test.ndvi,error:Math.abs(predicted-test.ndvi),next:fit(records)(21)};
  }
  function clusters(threshold) {
    const pending=new Set(cells.filter(c=>last(c.id).ndvi<threshold).map(c=>c.i)), groups=[];
    while(pending.size) {
      const seed=pending.values().next().value, group=[cells[seed]];pending.delete(seed);
      for(const c of group) for(const n of cells) {
        if(pending.has(n.i) && Math.abs(n.x-c.x)+Math.abs(n.y-c.y)===100){pending.delete(n.i);group.push(n);}
      }
      groups.push(group);
    }
    return groups;
  }
  function decision(id,threshold) {
    const r=series(id), low=r.at(-1).ndvi<threshold;
    const falling=r.at(-1).ndvi<r.at(-2).ndvi;
    const group=clusters(threshold).find(g=>g.some(c=>c.id===id));
    return {low,falling,area:group?.length??0,repeat:low&&(falling||group.length>1)};
  }
  function route(kind,custom) {
    if(kind==="custom")return custom;
    if(kind==="rows") {
      const pts=[];
      for(const y of [350,250,150,50]) {
        const pair=[{x:50,y},{x:550,y}];
        pts.push(...(pts.length%4===0?pair:pair.reverse()));
      }
      return pts;
    }
    return Array.from({length:97},(_,i)=>{
      const a=i*Math.PI/48;
      return {x:300+Math.cos(a)*(kind==="circle"?145:235), y:200+(kind==="circle"?Math.sin(a):Math.sin(2*a))*145};
    });
  }
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const length=pts=>pts.slice(1).reduce((s,p,i)=>s+distance(p,pts[i]),0);
  function at(pts,offset) {
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],d=distance(a,b);
      if(d>0&&offset<=d)return {x:a.x+(b.x-a.x)*offset/d,y:a.y+(b.y-a.y)*offset/d};
      offset-=d;
    }
    return pts.at(-1);
  }
  const restricted={left:8,right:92,bottom:369,top:397};
  function crossesStation(a,b) {
    let lo=0,hi=1;
    for(const [key,min,max] of [["x",restricted.left,restricted.right],["y",restricted.bottom,restricted.top]]){
      const delta=b[key]-a[key];
      if(delta===0){if(a[key]<min||a[key]>max)return false;continue;}
      const v1=(min-a[key])/delta,v2=(max-a[key])/delta;
      lo=Math.max(lo,Math.min(v1,v2));hi=Math.min(hi,Math.max(v1,v2));
    }
    return lo<=hi;
  }
  function covered(pts,travel) {
    const ids=new Set();
    if(travel<=0)return ids;
    const record=p=>{
      const col=Math.min(5,Math.max(0,Math.floor(p.x/100)));
      const row=Math.min(3,Math.max(0,Math.floor((400-p.y)/100)));
      ids.add(cells[row*6+col].id);
    };
    record(pts[0]);
    for(let i=1;i<pts.length&&travel>0;i++){
      const a=pts[i-1],b=pts[i],d=distance(a,b);
      if(!d)continue;
      const section=Math.min(d,travel),n=Math.ceil(section/5);
      for(let k=1;k<=n;k++){
        const t=k/n*section/d;
        record({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
      }
      travel-=section;
    }
    return ids;
  }
  function speedStep(v,target,dt){return v+(target-v)*(1-Math.exp(-.8*dt));}
  return {origin,days,cells,raw,data,series,last,fit,forecast,clusters,decision,route,length,at,toLocal,toGPS,speedStep,restricted,crossesStation,covered};
})();
if (typeof module !== "undefined" && module.exports) module.exports = Field;
