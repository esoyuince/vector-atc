import test from 'node:test';import assert from 'node:assert/strict';
import {callTypeSafe} from '../server/typesafe.mjs';
const request={model:'jev-1.13.0',state:{},questions:{q:{type:'choice',instructions:'fixture',criteria:{yes:null,no:null}}}};
for(const [status,code] of [[429,'provider-rate-limit'],[529,'provider-overloaded'],[500,'provider-http-failure']])test('provider HTTP '+status+' is typed without retaining secret error bodies',async()=>{
 await assert.rejects(callTypeSafe(request,'fixture-secret',{fetchImpl:async()=>new Response('fixture-secret',{status})}),e=>e.code===code&&e.status===status&&!e.message.includes('fixture-secret'));
});
for(const [body,code] of [['{','provider-invalid-json'],['{}','provider-contract-failure']])test('provider '+code+' is separate from network failure',async()=>{
 await assert.rejects(callTypeSafe(request,'fixture-secret',{fetchImpl:async()=>new Response(body)}),e=>e.code===code);
});
test('timeout, cancellation and transport errors remain distinct',async()=>{
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>{throw new DOMException('fixture','TimeoutError');}}),e=>e.code==='provider-timeout');
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>{throw Error('fixture-secret');}}),e=>e.code==='provider-network-failure'&&!e.message.includes('fixture-secret'));
 const controller=new AbortController();controller.abort();await assert.rejects(callTypeSafe(request,'x',{signal:controller.signal,fetchImpl:async()=>{throw Error('aborted');}}),e=>e.code==='provider-aborted');
});
test('empty, broken and oversized streams have explicit failure categories',async()=>{
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>new Response(null)}),e=>e.code==='provider-empty-response');
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>new Response(new ReadableStream({start(c){c.error(Error('fixture-secret'));}}))}),e=>e.code==='provider-stream-failure'&&!e.message.includes('fixture-secret'));
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>new Response('x'.repeat(1000001))}),e=>e.code==='provider-response-too-large');
});
