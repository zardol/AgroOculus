const {test}=require("node:test");
const assert=require("node:assert/strict");
const lab=require("../dist/field-lab.js");
const camera=require("../dist/lab-camera.js");
const detector=require("../dist/lab-detector.js");
const weights=require("../dist/lab-weights.js");

test("JavaScript reproduces a PyTorch CNN–LSTM prediction on a held-out series",()=>{
  assert.ok(Math.abs(lab.predict(weights.reference.bands)-weights.reference.expected)<1e-5);
  assert.ok(weights.metrics.mae<weights.metrics.persistenceMae);
});

test("exported YOLOv8 matches Ultralytics validation frame 0001 using RGB pixels alone",()=>{
  const frame=camera.frame(40631,.20+.305*.53,.60+.40*37/102);
  const boxes=detector.detect({size:frame.size,pixels:frame.pixels});
  assert.equal(boxes.length,1);
  const box=boxes[0];
  const reference=require("../dist/lab-yolo.js").reference["1"][0];
  // Independent prediction from Python on the OpenCV-resized validation image.
  assert.equal(reference.classId,0);
  assert.equal(box.label,"crop_stress");
  assert.ok(box.confidence>.5);
  const actual=[box.x,box.y,box.x+box.w,box.y+box.h,box.confidence];
  const expected=[...reference.xyxy,reference.confidence];
  actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.002));
  const healthy=camera.frame(40631,.68,.60+.40*37/102);
  assert.deepEqual(detector.detect({size:healthy.size,pixels:healthy.pixels}),[]);
});

test("YOLO identifies the synthetic pump house and associates its frame with the designated map zone",()=>{
  const station=lab.station();
  assert.equal(station.boxes.length,1);
  const b=station.boxes[0];
  assert.equal(b.label,"pump_house");
  assert.ok(b.confidence>.5);
  assert.deepEqual(station.mapRect,require("../dist/model.js").restricted);
  const expected=camera.frame(563443,.69,.94,128,0,true).infrastructure;
  for(const k of ["x","y","w","h"]) assert.ok(Math.abs(b[k]-expected[k])<.095);
  const onlyCrops=camera.frame(563443,.69,.94);
  assert.equal(detector.detect(onlyCrops).length,0);
});

test("cloud changes exposure of both spectral bands while dry stress changes NDVI",()=>{
  const cell="C5", clear=lab.observe(cell), cloud=lab.observe(cell,{cell,kind:"cloud",intensity:3});
  const dry=lab.observe(cell,{cell,kind:"dry",intensity:3});
  assert.ok(cloud.red<clear.red && cloud.nir<clear.nir);
  assert.ok(Math.abs(cloud.ndvi-clear.ndvi)<1e-8);
  assert.ok(dry.ndvi<clear.ndvi && dry.forecast<clear.forecast);
  assert.ok(dry.filtered>dry.ndvi && dry.filtered<clear.prior);
  assert.equal(dry.repeat,true);
  const other=lab.observe("A1",{cell,kind:"dry",intensity:3});
  assert.equal(other.ndvi,other.baseline);
  assert.equal(lab.observe(cell,null,0,.20).repeat,false);
});

test("lost frames have no fabricated measurements; confirming exposure is a fresh sample",()=>{
  const scenario={cell:"C5",kind:"dropout",intensity:2};
  const first=lab.observe("C5",scenario), recovered=lab.observe("C5",scenario,1);
  const again=lab.observe("C5",scenario,2);
  assert.equal(first.available,false);
  assert.equal(first.ndvi,null);
  assert.equal(first.forecast,null);
  assert.deepEqual(first.boxes,[]);
  assert.equal(first.repeat,true);
  assert.ok(recovered.available && again.available);
  assert.notEqual(recovered.red,again.red);
  assert.notDeepEqual(recovered.frame.pixels,again.frame.pixels);
  assert.ok(Math.abs(recovered.boxes[0].x-again.boxes[0].x)<.08);
});

test("packaged OpenCV comparison contains real salt-and-pepper input and de-noised RGB output",()=>{
  const calibration=require("../dist/lab-calibration.js");
  const input=Buffer.from(calibration.before,"base64"), output=Buffer.from(calibration.after,"base64");
  assert.equal(input.length,calibration.metrics.size**2*3);
  assert.equal(output.length,input.length);
  let impulses=0, remaining=0;
  for(let i=0;i<input.length;i+=3) {
    if(input[i]===0 || input[i]===255) impulses++;
    if(output[i]===0 || output[i]===255) remaining++;
  }
  assert.equal(impulses,calibration.metrics.noisePixels);
  assert.ok(remaining<impulses/10);
  assert.ok(calibration.metrics.maeAfter<calibration.metrics.maeBefore/3);
});
