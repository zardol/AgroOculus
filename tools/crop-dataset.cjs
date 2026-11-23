const fs = require("node:fs");
const path = require("node:path");
const {frame} = require("../dist/lab-camera.js");
const dir = process.argv[2];
if (!dir) throw new Error("Usage: node crop-dataset.cjs <training-directory>");
for (const [split,count] of [["train",320],["val",96]]) {
  for (const kind of ["images","labels"]) fs.mkdirSync(path.join(dir,kind,split),{recursive:true});
  for (let i=0;i<count;i++) {
    const seed = (split==="val" ? 40000 : 18000) + i*631;
    const station=i%4===2, ndvi = i%4===0 || station ? .65 : .20+.305*((i*53)%101)/100;
    const light = .60+.40*((i*37)%103)/102;
    const f=frame(seed,ndvi,light,128,0,station), name=String(i).padStart(4,"0");
    const b=station ? f.infrastructure : f.label;
    fs.writeFileSync(path.join(dir,"images",split,name+".ppm"),Buffer.concat([Buffer.from("P6\n128 128\n255\n"),Buffer.from(f.pixels)]));
    fs.writeFileSync(path.join(dir,"labels",split,name+".txt"),b ? `${station?1:0} ${b.x+b.w/2} ${b.y+b.h/2} ${b.w} ${b.h}\n` : "");
  }
}
