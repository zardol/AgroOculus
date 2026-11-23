import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {loadAssets} from "./assets.mjs";
const assets=Object.fromEntries([...loadAssets()].map(([path,asset])=>[
  path,[asset.type,asset.body.toString(asset.type.startsWith("text/") ? "utf8" : "base64")]
]));
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
// The browser and the report worker use the same exported weights. Keep a single
// copy of each weight file in the worker and parse its JSON assignment at startup.
function declareWeights(path,binding) {
  const source=assets[path][1];
  const prefix="const "+binding+" = ";
  const end=source.search(/;\r?\nif \(typeof module/);
  if (!source.startsWith(prefix) || end < 0) throw new Error("Неверный формат весов: "+path);
  JSON.parse(source.slice(prefix.length,end));
  return "const "+binding+" = JSON.parse(embeddedAssets["+JSON.stringify(path)+"][1].slice("+prefix.length+","+end+"));";
}
const code=[
  "const embeddedAssets = "+JSON.stringify(assets)+";",
  read("../dist/model.js"), read("../dist/lab-camera.js"), declareWeights("/lab-yolo.js","CropYoloWeights"),
  read("../dist/lab-detector.js"), declareWeights("/lab-weights.js","SpectralWeights"),
  read("../dist/lab-calibration.js"), read("../dist/field-lab.js"),
  read("./site.mjs"),
  "export default createSite(Field, path => {",
  "  if (!Object.hasOwn(embeddedAssets,path)) return null;",
  "  const [type,data]=embeddedAssets[path];",
  "  return {type,body:type.startsWith('text/') ? data : Uint8Array.from(atob(data),ch=>ch.charCodeAt(0))};",
  "}, fetch, FieldLab);"
].join("\n");
const target=new URL("../dist/server/",import.meta.url);
mkdirSync(target,{recursive:true});writeFileSync(new URL("index.js",target),code);
console.log("Сервер собран. Включены "+Object.keys(assets).length+" открытых файлов приложения.");
