import http from "node:http";
import {readFileSync,existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {createSite} from "./site.mjs";
import {loadAssets} from "./assets.mjs";
import Field from "../dist/model.js";
import FieldLab from "../dist/field-lab.js";
const assets=loadAssets(),site=createSite(Field,path=>assets.get(path),fetch,FieldLab);
const argument=process.argv[2];
const desktopFile=join(homedir(),"Desktop","апи.txt");
const keyFile=argument==="--desktop" ? (!process.env.QWEN_API_KEY && existsSync(desktopFile) ? desktopFile : undefined) : argument;
const key=keyFile ? readFileSync(keyFile,"utf8").trim() : process.env.QWEN_API_KEY?.trim();
const port=Number(process.env.PORT || 8137);
const origin="http://127.0.0.1:"+port;
const server=http.createServer(async (req,res)=>{
  try{
    if(req.headers.host!=="127.0.0.1:"+port && req.headers.host!=="localhost:"+port){res.writeHead(403).end();return;}
    const options={method:req.method,headers:req.headers};
    if(req.headers["transfer-encoding"] || Number(req.headers["content-length"]||0)>0){
      if(req.method!=="POST" || req.url!=="/api/scenario"){res.writeHead(400).end();return;}
      let size=0;
      const chunks=[];
      for await(const chunk of req.iterator({destroyOnReturn:false})){
        size+=chunk.byteLength;
        if(size>256){
          req.resume();
          res.writeHead(413,{"Content-Type":"application/json; charset=utf-8"}).end(JSON.stringify({error:"Превышен размер параметров события."}));
          return;
        }
        chunks.push(chunk);
      }
      options.body=Buffer.concat(chunks,size);
    }
    const request=new Request("http://"+req.headers.host+req.url,options);
    const reply=await site.fetch(request,{QWEN_API_KEY:key});
    res.writeHead(reply.status,Object.fromEntries(reply.headers));
    res.end(Buffer.from(await reply.arrayBuffer()));
  }catch{res.writeHead(500).end("Ошибка локального сервера.");}
});
server.on("error",e=>{console.error(e.code==="EADDRINUSE"?"Порт занят. Закройте прежний сервер или задайте другой PORT.":"Сервер не запустился.");process.exitCode=1;});
server.listen(port,"127.0.0.1",()=>console.log("AgroOculus · "+origin+(key?" · Qwen подключён к серверу":" · ключ Qwen не задан")));
