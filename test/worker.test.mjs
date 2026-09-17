import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// Only the Cloudflare host base class is stubbed. Tests import the actual controller/HTTP handler.
registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};
 return next(specifier,context);
}});
const {AirportSimulation,default:worker}=await import('../server/worker.mjs');
function response(request){
 return {model:'jev-1.13.0',answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
  const c=id.startsWith('runway_')?'wait':id.endsWith('_route')?Object.keys(q.criteria)[0]:id.endsWith('_altitude')?'6000':id.endsWith('_speed')?'220':'1500';
  return [id,{type:'choice',choice:c,confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===c?1:0]))}];
 })),usage:{input_tokens:1000,output_tokens:100}};
}
async function harness(t,stored=new Map(),overrides={}){
 let now=Date.UTC(2026,8,17,12),alarm=null,ready;const calls=[];
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{calls.push(JSON.parse(opts.body));return Response.json(response(calls.at(-1)));});
 const storage={get:async k=>structuredClone(stored.get(k)),put:async(k,v)=>{for(const [name,value] of Object.entries(typeof k==='string'?{[k]:v}:k))stored.set(name,structuredClone(value));},getAlarm:async()=>alarm,setAlarm:async n=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}};
 const ctx={storage,blockConcurrencyWhile:fn=>{ready=fn();return ready;}};
 const controller=new AirportSimulation(ctx,{TYPESAFE_API_KEY:'fixture-only',AI_DAILY_TOKEN_LIMIT:'1000000',AI_HOURLY_REQUEST_LIMIT:'720',...overrides});await ready;
 return {controller,calls,stored,advance:ms=>{now+=ms;},alarm:()=>alarm};
}

test('critical prediction preempts regular timer only for involved aircraft and honors budget',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();
 const [a,b]=c.record.sim.flights.slice(50,52);
 for(const f of c.record.sim.flights)f.phase='taxi_out';
 for(const [i,f] of [a,b].entries()){
  f.phase='arrival';f.altitude=6000;f.speed=220;f.verticalRate=0;f.x=i?1:-1;f.y=20;f.heading=i?270:90;
  f.command={route:i?'VECTOR_W':'VECTOR_E',altitude:6000,speed:220,rate:1000,navigation:{kind:'VECTOR',points:[[i?-30:30,20]],index:0}};
 }
 const scheduledAt=c.record.ai.nextAt;h.advance(2000);await c.alarm();
 assert.equal(c.record.ai.nextAt,scheduledAt,'emergency does not postpone scheduled fleet deadline');
 assert.equal(c.record.frameRemaining,58);
 assert.equal(c.record.ai.last.trigger.reason,'predicted-conflict');assert.equal(c.record.ai.last.aircraft,2);
 assert.ok(c.record.sim.elapsed<60);assert.ok(h.calls.length>10);
 const count=h.calls.length;h.advance(2000);await c.alarm();assert.equal(h.calls.length,count,'cooldown avoids request on each tick');
 c.record.ai.lastConflictAt=-100;c.env.AI_DAILY_TOKEN_LIMIT='10000';
 c.record.sim.alerts=[{a:a.id,b:b.id,critical:true,seconds:1}];c.record.sim.lastWall=Date.now()+2000;
 h.advance(2000);await c.alarm();assert.equal(c.record.ai.mode,'budget-limit');assert.equal(h.calls.length,count);
});

test('pilot migration archives original state once and preserves budget, elapsed and replay',async t=>{
 const initial=await harness(t),old=structuredClone(initial.controller.record);delete old.sim.physicsEpoch;old.sim.elapsed=123;old.budget.tokens=456;
 const stored=new Map([['airport-ltfm-v1',old],['total-visits',15]]);
 const h=await harness(t,stored);
 assert.deepEqual(stored.get('airport-before-pilot-v1'),old);assert.equal(h.controller.record.budget.tokens,456);assert.equal(h.controller.record.sim.elapsed,123);assert.equal(h.controller.totalVisits,15);
 assert.equal(h.controller.record.sim.physicsEpoch.elapsed,123);assert.equal(h.calls.length,0);
});
test('read-only state/report and old cron cannot start an empty simulator',async t=>{
 const h=await harness(t);await h.controller.snapshot();await h.controller.report();await worker.scheduled();
 assert.equal(h.alarm(),null);assert.equal(h.calls.length,0);
 await h.controller.alarm();assert.equal(h.controller.record.sim.elapsed,0);assert.equal(h.alarm(),null);assert.equal(h.calls.length,0);
});

test('visit counter counts active sessions once, persists and ignores read-only polling',async t=>{
 const h=await harness(t),c=h.controller;assert.equal((await c.snapshot()).totalVisits,0);
 await c.heartbeat('viewer-a',1,false);assert.equal(c.totalVisits,0);
 await c.heartbeat('viewer-a',2,true);await c.heartbeat('viewer-a',3,true);await c.snapshot();await c.report();
 assert.equal(c.totalVisits,1);await c.heartbeat('viewer-b',1,true);assert.equal(c.totalVisits,2);
 await c.heartbeat('viewer-a',4,false);await c.heartbeat('viewer-a',5,true);assert.equal(c.totalVisits,2);
 assert.equal(h.stored.get('total-visits'),2);assert.equal(h.calls.length,0);
});
test('two viewer leases, sequenced leave, last viewer stop, and reload preserve budget without phantom time',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer-a',1,true);await c.heartbeat('viewer-b',1,true);await c.alarm();
 assert.equal(h.calls.length,10);assert.equal(c.record.ai.last.aircraft,100);assert.equal(c.record.ai.last.questions,403);assert.equal(c.record.ai.last.applied,100);
 const covered=h.calls.flatMap(r=>Object.keys(r.questions));assert.equal(new Set(covered).size,403);
 h.advance(2000);await c.alarm();assert.equal(c.record.sim.elapsed,2);
 await c.heartbeat('viewer-a',3,false);await c.heartbeat('viewer-a',2,true);assert.equal(c.viewers(),1);
 await c.heartbeat('viewer-b',2,false);await c.alarm();const elapsed=c.record.sim.elapsed,callsBeforeAbsence=h.calls.length;assert.equal(h.alarm(),null);
 h.advance(3600000);await c.alarm();assert.equal(c.record.sim.elapsed,elapsed);assert.equal(h.calls.length,callsBeforeAbsence);
 await c.heartbeat('viewer-a',4,true);await c.alarm();assert.equal(c.record.sim.elapsed,elapsed);assert.ok(h.calls.length>callsBeforeAbsence);
});
test('lost disconnect expires in 20s; no API call or simulation catches up during absence',async t=>{
 const h=await harness(t),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();
 h.advance(21000);await c.alarm();assert.equal(c.viewers(),0);assert.equal(h.alarm(),null);assert.equal(c.record.sim.elapsed,0);assert.equal(h.calls.length,10);
 h.advance(86400000);await c.snapshot();assert.equal(h.calls.length,10);assert.equal(h.alarm(),null);
});

for(const disconnect of ['explicit','expired'])test(disconnect+' last viewer disconnect during provider calls aborts without applying commands',async t=>{
 const h=await harness(t),c=h.controller;let started=0,aborted=0,notify;
 const allStarted=new Promise(resolve=>{notify=resolve;});
 t.mock.method(globalThis,'fetch',async(_url,opts)=>new Promise((_resolve,reject)=>{
  opts.signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true});
  if(++started===10)notify();
 }));
 await c.heartbeat('viewer',1,true);const pending=c.alarm();await allStarted;
 if(disconnect==='explicit')await c.heartbeat('viewer',2,false);else{h.advance(21000);await c.alarm();}
 await pending;
 assert.equal(aborted,10);assert.equal(c.record.ai.mode,'idle');assert.equal(c.record.sim.stats.aiApplied,0);assert.equal(c.record.sim.elapsed,0);assert.equal(h.alarm(),null);
 assert.ok(c.record.budget.tokens>0,'unknown upstream charge remains reserved');
});
test('failure pauses instead of local ATC; partial batch usage settles and unknown charge stays reserved',async t=>{
 const h=await harness(t),c=h.controller;let index=0;
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{index++;if(index===2)return new Response('private provider detail',{status:429});return Response.json(response(JSON.parse(opts.body)));});
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.ai.mode,'backoff');assert.equal(c.record.frameRemaining,0);assert.equal(c.record.sim.stats.aiApplied,0);
 assert.ok(c.record.budget.tokens>9000);assert.equal(c.record.budget.actualTokens,9000);
 h.advance(5000);await c.alarm();assert.equal(c.record.sim.elapsed,0);assert.equal(index,10);
});
test('budget refuses an entire fleet frame before any outbound request; disabled AI also freezes',async t=>{
 const h=await harness(t,new Map(),{AI_DAILY_TOKEN_LIMIT:'10000'}),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();assert.equal(c.record.ai.mode,'budget-limit');assert.equal(h.calls.length,0);
 h.advance(4000);await c.alarm();assert.equal(c.record.sim.elapsed,0);
 await c.heartbeat('viewer',2,false);await c.alarm();await c.heartbeat('viewer',3,true);h.advance(2000);await c.alarm();assert.equal(c.record.ai.mode,'budget-limit');
 c.env.AI_ENABLED='false';await c.alarm();assert.equal(c.record.sim.elapsed,0);
});
test('migration retains prior billed budget and starts new dataset, leaving historical record intact',async t=>{
 const day='2026-09-17',stored=new Map([['airport-v2',{budget:{day,hour:497124,tokens:321,actualTokens:321,requests:1,totalCalls:20},ai:{nextAt:9999999999999}}]]);
 const h=await harness(t,stored);assert.equal(h.controller.record.budget.tokens,321);assert.equal(h.controller.record.budget.totalCalls,20);assert.equal(h.controller.record.ai.totalCalls,0);
 assert.ok(stored.has('airport-v2'));assert.equal(h.controller.record.ai.nextAt,0);
});

test('30-day grant cap preserves spent tokens and resumes a frame blocked by the old cap',async t=>{
 const h=await harness(t,new Map(),{AI_DAILY_TOKEN_LIMIT:'10000'}),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();assert.equal(c.record.ai.budgetReason,'daily');
 assert.equal(c.record.ai.nextAt,Date.UTC(2026,8,18));
 c.record.budget.tokens=9000;c.record.budget.actualTokens=9000;
 c.record.ai.mode='awaiting';delete c.record.ai.budgetLimit; // Legacy pause before cap metadata existed.
 delete c.env.AI_DAILY_TOKEN_LIMIT;
 assert.equal(c.limits().dailyTokens,3800000);assert.ok(c.limits().dailyTokens/1000000*.042*30<5);
 h.advance(2000);await c.alarm();assert.equal(c.record.ai.mode,'active');assert.equal(h.calls.length,10);
 assert.equal(c.record.budget.actualTokens,19000);assert.equal(c.record.budget.tokens,19000);
});
test('presence HTTP rejects foreign origin, malformed and oversized bodies; state cannot mutate aircraft',async()=>{
 const limit={limit:async()=>({success:true})},env={PRESENCE_LIMITER:limit};
 let r=await worker.fetch(new Request('https://atc.alaz.tr/api/presence',{method:'POST',headers:{Origin:'https://foreign.example'},body:'{}'}),env);assert.equal(r.status,403);
 for(const body of ['{}','x'.repeat(300),JSON.stringify({id:'x',sequence:1,active:true})]){
  r=await worker.fetch(new Request('https://atc.alaz.tr/api/presence',{method:'POST',headers:{Origin:'https://atc.alaz.tr'},body}),env);assert.equal(r.status,400);
 }
 r=await worker.fetch(new Request('https://atc.alaz.tr/api/state',{method:'POST'}),env);assert.equal(r.status,405);
});


test('budget replay stays bounded, survives reload and reads never call AI or advance experiment',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();
 c.env.AI_DAILY_TOKEN_LIMIT='10000';c.record.ai.lastConflictAt=1e9; // Replay cadence test isolates archive from separately tested emergency control.
 for(let i=1;i<=30;i++){h.advance(2000);await c.heartbeat('viewer',i+1,true);await c.alarm();}
 assert.ok(c.replay.meta.frameCount>=10);
 assert.ok(Buffer.byteLength(JSON.stringify(await c.replayData()))<128*1024);
 c.env.AI_DAILY_TOKEN_LIMIT='10000';h.advance(2000);await c.alarm();
 assert.equal(c.record.ai.mode,'budget-limit');
 const before=JSON.stringify(await c.report()),calls=h.calls.length;
 const replay=await c.replayData();assert.ok(replay.frames.at(-1).at>replay.frames[0].at);
 await c.snapshot();await c.report();h.advance(2000);await c.alarm();
 assert.equal(h.calls.length,calls);assert.equal(JSON.stringify(await c.report()),before);
 assert.deepEqual(h.stored.get('replay-archive-ltfm-v2:0'),replay.frames);
});
