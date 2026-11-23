import {readFileSync} from "node:fs";
const types={html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8",woff2:"font/woff2",txt:"text/plain; charset=utf-8"};
const names=[
  "index.html","flight-algorithm.html","app.js","session.js","model.js","map.js","style.css","survey-map.js","instruments.js","methods.js","charts.js","formulas.js",
  "lab-camera.js","lab-yolo.js","lab-detector.js","lab-weights.js","lab-calibration.js","field-lab.js","camera-feed.js",
  "fonts/fonts.css","fonts/inter-cyrillic.woff2","fonts/inter-latin.woff2",
  "fonts/stix-cyrillic.woff2","fonts/stix-latin.woff2","fonts/inter-LICENSE.txt","fonts/stix-LICENSE.txt"
];
export function loadAssets() {
  return new Map(names.map(name=>["/"+name,{type:types[name.split(".").at(-1)],body:readFileSync(new URL("../dist/"+name,import.meta.url))}]));
}
