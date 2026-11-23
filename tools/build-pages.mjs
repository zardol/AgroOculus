import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadAssets } from "../server/assets.mjs";

if (!process.argv[2]) throw new Error("Укажите новую папку для статического сайта.");
const destination = resolve(process.argv[2]);
const assets = loadAssets();
mkdirSync(destination);
for (const [url, asset] of assets) {
  const path = join(destination, url.slice(1));
  mkdirSync(dirname(path), { recursive: true });
  let body = asset.body;
  if (url === "/index.html") {
    const html = body.toString("utf8");
    if (!/<html\b/.test(html)) throw new Error("Не найден корневой элемент страницы.");
    body = html.replace(/<html\b/, '<html data-hosting="static"');
  }
  writeFileSync(path, body);
}
console.log(`Статическая версия AgroOculus собрана в ${destination} (${assets.size} файлов).`);
