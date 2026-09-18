import test from 'node:test';import assert from 'node:assert/strict';import {armStudy,studyArmUrl} from '../scripts/lib/study-operator.mjs';
test('study arm operator client requires HTTPS/loopback and never exposes its token',async()=>{
 const token='operator-secret-fixture-0123456789abcdef',seen=[];
 const fetchImpl=async(url,options)=>{seen.push({url:String(url),options});return new Response(JSON.stringify({runId:'paper-r001',status:'running',armed:true,armedAt:123}),{status:200,headers:{'content-type':'application/json'}});};
 const result=await armStudy('https://study.example/',token,{fetchImpl});assert.deepEqual(result,{runId:'paper-r001',status:'running',armed:true,armedAt:123});assert.equal(seen.length,1);assert.equal(seen[0].url,'https://study.example/api/study/arm');assert.equal(seen[0].options.headers.Authorization,'Bearer '+token);assert.ok(!JSON.stringify(result).includes(token));
 assert.throws(()=>studyArmUrl('http://study.example'),/HTTPS/);assert.doesNotThrow(()=>studyArmUrl('http://127.0.0.1:8787'));await assert.rejects(armStudy('https://study.example','short',{fetchImpl}),/at least 32/);
});
test('study arm operator client fails closed on HTTP and contract errors',async()=>{
 const token='operator-secret-fixture-0123456789abcdef';
 await assert.rejects(armStudy('https://study.example',token,{fetchImpl:async()=>new Response('Forbidden',{status:403})}),/HTTP 403/);
 await assert.rejects(armStudy('https://study.example',token,{fetchImpl:async()=>new Response('{}',{status:200})}),/invalid contract/);
});
