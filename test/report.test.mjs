import test from "node:test";
import assert from "node:assert/strict";
import {createSite,reportFacts} from "../server/site.mjs";
import Field from "../dist/model.js";
const base="https://field.example";
function request(path="C5/45",overrides={}) {
  return new Request(base+"/api/report/"+path,{method:"POST",headers:{Origin:base,"X-Mezha-Report":"1"},...overrides});
}
const env={QWEN_API_KEY:"test-only"};
test("The Qwen request uses server facts and keeps the credential off the client",async()=>{
  let calls=0;
  const site=createSite(Field,()=>null,async(url,options)=>{
    calls++;assert.equal(options.redirect,"manual");assert.equal(new URL(url).hostname,"dashscope-intl.aliyuncs.com");assert.equal(options.headers.Authorization,"Bearer test-only");
    const payload=JSON.parse(options.body),facts=JSON.parse(payload.messages[1].content);
    assert.equal(payload.model,"qwen-flash");assert.equal(facts.NDVI,.262);assert.equal(facts.решение,"назначить повторную съёмку");assert.match(facts.основание,/снизился/);assert.ok(!("секторов_в_связной_зоне" in facts));
    return Response.json({choices:[{finish_reason:"stop",message:{content:"Проверить сектор C5."}}]});
  });
  const [one,two]=await Promise.all([site.fetch(request(),env),site.fetch(request(),env)]);
  const text=await one.text();assert.equal(JSON.parse(text).facts.порог,.45);assert.ok(!text.includes(env.QWEN_API_KEY));assert.equal(two.status,200);
  assert.equal((await site.fetch(request("C5/45",{body:""}),env)).status,200);assert.equal(calls,1);
  assert.equal(reportFacts(Field,"C5",.2).решение,"продолжить плановое наблюдение");
});
test("Invalid parameters, missing credentials and cross-origin requests never reach Qwen",async()=>{
  const site=createSite(Field,()=>null,()=>assert.fail("unexpected external request"));
  const cases=[
    [request("C9/45"),env,400],[request("C5/99"),env,400],[request("C5/45?x=y"),env,400],
    [request("C5/45",{body:"hello"}),env,400],[request(),{},503],
    [request("C5/45",{headers:{"X-Mezha-Report":"1",Origin:"https://wrong.example"}}),env,403],
    [request("C5/45",{headers:{}}),env,403],[request("C5/45",{method:"GET"}),env,405]
  ];
  for(const [req,config,status] of cases) assert.equal((await site.fetch(req,config)).status,status);
});
test("Provider errors and unfinished reports remain retryable and do not expose upstream details",async()=>{
  const outcomes=[new Response("test-only",{status:401}),new Response(null,{status:429}),Response.json({choices:[{finish_reason:"length",message:{content:"partial"}}]}),Response.json({choices:[{finish_reason:"stop",message:{content:"Готово."}}]})];
  const site=createSite(Field,()=>null,async()=>outcomes.shift());
  for(const expected of [502,429,502,200]) {
    const res=await site.fetch(request(),env);assert.equal(res.status,expected);assert.ok(!(await res.text()).includes("test-only"));
  }
});
