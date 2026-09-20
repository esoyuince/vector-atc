import test from 'node:test';import assert from 'node:assert/strict';
import {operatorStopUrl,requestOperatorStop} from '../src/operator-stop-client.mjs';
const token='operator-client-test-token-0123456789abcdef',target={runId:'run-a',experimentId:123};
const valid={ok:true,stopped:true,durable:true,id:'stop-id',...target,stoppedAt:456,reason:'operator-stop',journalStatus:'recorded'};
test('stop client sends one identity-bound authenticated request and refuses redirect following',async()=>{
 const calls=[];const reply=await requestOperatorStop('https://example.test',token,target,{fetchImpl:async(url,init)=>{calls.push({url:String(url),init});return Response.json(valid);}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://example.test/api/operator/stop');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers.Authorization,'Bearer '+token);
 assert.deepEqual(JSON.parse(calls[0].init.body),target);assert.equal(reply.durable,true);assert.ok(!JSON.stringify(reply).includes(token));
 for(const url of ['http://example.test','ftp://127.0.0.1','https://user:pass@example.test'])assert.throws(()=>operatorStopUrl(url));
 for(const url of ['http://127.0.0.1:8787','http://localhost','http://[::1]'])assert.doesNotThrow(()=>operatorStopUrl(url));
});
test('stop client never turns an HTTP error, timeout or wrong-target receipt into confirmation',async()=>{
 for(const status of [403,409,503])await assert.rejects(requestOperatorStop('https://example.test',token,target,{fetchImpl:async()=>new Response(token,{status})}),e=>e.message==='stop-http-'+status&&!e.message.includes(token));
 for(const body of [{...valid,durable:false},{...valid,runId:'other'},{...valid,experimentId:456},{...valid,id:token},{}])await assert.rejects(requestOperatorStop('https://example.test',token,target,{fetchImpl:async()=>Response.json(body)}),/invalid-receipt/);
 let attempts=0;await assert.rejects(requestOperatorStop('https://example.test',token,target,{fetchImpl:async()=>{attempts++;throw Error(token);}}),/outcome-unknown/);assert.equal(attempts,1);
 await assert.rejects(requestOperatorStop('https://example.test','short',target),/token/);
 await assert.rejects(requestOperatorStop('https://example.test',token,{runId:'bad id',experimentId:123}),/target/);
});
