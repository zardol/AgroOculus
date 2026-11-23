"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const f=require("../dist/model.js");
test("Cleaning preserves 24 complete time series and rejects three independent defects",()=>{
  assert.equal(f.raw.length,147);assert.equal(f.data.valid.length,144);
  assert.equal(new Set(f.data.rejected.map(r=>r.reason)).size,3);
  for(const c of f.cells){
    const series=f.series(c.id);assert.equal(series.length,6);
    for(const r of series)assert.ok(Math.abs(r.ndvi-(r.nir-r.red)/(r.nir+r.red))<1e-12);
  }
});
test("All preset routes avoid the station, cover finite distances, and finish at the last point",()=>{
  for(const kind of ["rows","circle","eight"]){
    const path=f.route(kind,[]);assert.ok(f.length(path)>0);
    assert.ok(path.slice(1).every((p,i)=>!f.crossesStation(path[i],p)));
    assert.ok(Math.hypot(f.at(path,1e6).x-path.at(-1).x,f.at(path,1e6).y-path.at(-1).y)<1e-9);
  }
  const rows=f.route("rows");assert.equal(f.length(rows),2300);
  assert.equal(f.covered(rows,2300).size,24);assert.equal(f.covered(rows,0).size,0);
  assert.ok(f.crossesStation({x:50,y:350},{x:50,y:399}));
  assert.ok(f.crossesStation({x:0,y:380},{x:100,y:380}));
});
test("Coordinate conversion round-trips every sector",()=>{
  for(const c of f.cells){const p=f.toGPS(c.x,c.y),q=f.toLocal(p.lat,p.lon);assert.ok(Math.hypot(q.x-c.x,q.y-c.y)<1e-6);}
});
test("Forecast holdout is independent of the held-out observation",()=>{
  const r=f.last("C5"),original=r.ndvi,before=f.forecast("C5");
  try{r.ndvi=.8;const after=f.forecast("C5");assert.equal(after.predicted,before.predicted);assert.notEqual(after.next,before.next);}
  finally{r.ndvi=original;}
  const mae=f.cells.reduce((s,c)=>s+f.forecast(c.id).error,0)/24;assert.ok(mae>.009&&mae<.010);
});
test("A threshold change reaches clustering and decision, including equality",()=>{
  const ndvi=f.last("C5").ndvi;assert.equal(f.decision("C5",ndvi).low,false);
  assert.equal(f.decision("C5",.45).repeat,true);assert.equal(f.decision("C5",.20).repeat,false);
  const groups=f.clusters(.45);assert.equal(groups.flat().length,f.cells.filter(c=>f.last(c.id).ndvi<.45).length);
});
test("Speed converges without overshoot and allows slowing a running model",()=>{
 assert.ok(f.speedStep(0,8,1)>0&&f.speedStep(0,8,1)<8);assert.ok(f.speedStep(12,3,1)<12&&f.speedStep(12,3,1)>3);
});
