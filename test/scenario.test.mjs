import assert from "node:assert/strict";
import test from "node:test";
import {createSite} from "../server/site.mjs";
import Field from "../dist/model.js";

const origin = "https://field.example";
const headers = {Origin:origin,"Content-Type":"application/json","X-Mezha-Scenario":"1"};
const env = {QWEN_API_KEY:"test-only"};
const input = {stage:4,cell:"C5",previous:"clear"};
const scene = {kind:"cloud",intensity:2,cell:"C5",note:"На посевы легла тень облака."};

function request(data = input, options = {}) {
  return new Request(origin+"/api/scenario",{method:"POST",headers,body:JSON.stringify(data),...options});
}
function modelResponse(data) {
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(data)}}]});
}

test("Each scene is a new structured response from Qwen for this sector and stage",async()=>{
  let calls = 0;
  const site = createSite(Field,()=>null,async(url,options)=>{
    calls++;
    const payload = JSON.parse(options.body), context = JSON.parse(payload.messages[1].content);
    assert.deepEqual(payload.response_format,{type:"json_object"});
    assert.equal(context.сектор,"C5");
    assert.equal(context.этап,"Поиск признаков стресса");
    assert.equal(context.предыдущее_событие,"clear");
    return modelResponse(scene);
  });
  for(let i=0;i<2;i++){
    const res = await site.fetch(request(),env);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),scene);
  }
  assert.equal(calls,2);
});

test("Unexpected or unbounded input and missing credentials never reach Qwen",async()=>{
  const site = createSite(Field,()=>null,()=>assert.fail("unexpected upstream call"));
  const cases = [
    [request({...input,stage:8}),400],[request({...input,cell:["C5"]}),400],
    [request({...input,previous:"other"}),400],[request({...input,free:"extra"}),400],
    [request(input,{body:"["}),400],[request(input,{body:"x".repeat(257)}),413],
    [request(input,{headers:{...headers,Origin:"https://other.example"}}),403],
    [request(input,{headers:{...headers,"Content-Type":"text/plain"}}),415],
    [request(input,{headers:{...headers,"X-Mezha-Scenario":"0"}}),403],
    [new Request(origin+"/api/scenario"),405],[request(),503,{}]
  ];
  for(const [req,status,config=env] of cases)
    assert.equal((await site.fetch(req,config)).status,status);
});

test("An invalid or failed provider response never becomes a simulated event",async()=>{
  const outcomes = [
    modelResponse({...scene,cell:"B2"}),modelResponse({...scene,kind:"other"}),
    modelResponse({...scene,intensity:0}),modelResponse({...scene,note:"English only."}),
    modelResponse({...scene,note:"<b>Тень</b>"}),modelResponse({...scene,extra:true}),
    new Response(env.QWEN_API_KEY,{status:429}),modelResponse(scene)
  ];
  const site = createSite(Field,()=>null,async()=>outcomes.shift());
  for(const expected of [502,502,502,502,502,502,429,200]){
    const response = await site.fetch(request(),env);
    assert.equal(response.status,expected);
    const data=await response.json();
    if(expected!==200) assert.deepEqual(Object.keys(data),["error"]);
    assert.ok(!JSON.stringify(data).includes(env.QWEN_API_KEY));
  }
});

test("A second generation while Qwen is busy can be retried after the first finishes",async()=>{
  let enter, release;
  const started = new Promise(resolve=>{enter=resolve;});
  const gate = new Promise(resolve=>{release=resolve;});
  const site = createSite(Field,()=>null,async()=>{
    enter();
    await gate;
    return modelResponse(scene);
  });
  const first = site.fetch(request(),env);
  await started;
  assert.equal((await site.fetch(request(),env)).status,429);
  release();
  assert.equal((await first).status,200);
  assert.equal((await site.fetch(request(),env)).status,200);
});

test("A scenario report uses the recovered camera frame and a threshold-specific decision",async()=>{
  const {default:lab} = await import("../dist/field-lab.js");
  let calls = 0;
  const captured = [];
  const scene = {kind:"dropout",cell:"C5",intensity:2};
  const site = createSite(Field,()=>null,async(url,options)=>{
    calls++;
    captured.push(JSON.parse(JSON.parse(options.body).messages[1].content));
    return Response.json({choices:[{finish_reason:"stop",message:{content:"Сектор проверен."}}]});
  },lab);
  const report = (attempt,threshold=45) => site.fetch(new Request(
    origin+"/api/report/C5/"+threshold+"/dropout/2/C5/"+attempt,
    {method:"POST",headers:{Origin:origin,"X-Mezha-Report":"1"}}
  ),env);
  assert.equal((await report(0)).status,409);
  assert.equal(calls,0);
  for(const threshold of [45,20]){
    const response = await report(1,threshold);
    assert.equal(response.status,200);
    const {facts} = await response.json();
    const observation = lab.observe("C5",scene,1,threshold/100);
    assert.equal(facts.NDVI,Number(observation.ndvi.toFixed(3)));
    assert.equal(facts.прогноз_следующей_даты,Number(observation.forecast.toFixed(3)));
    assert.equal(facts.основание,observation.reason);
    assert.equal(facts.номер_попытки,2);
    assert.deepEqual(facts,captured.at(-1));
  }
  assert.equal(calls,2);
  assert.equal((await report(1,20)).status,200);
  assert.equal(calls,2);
});
