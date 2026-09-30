import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// Only the Cloudflare host base class is stubbed. Tests import the actual controller/HTTP handler.
registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};
 return next(specifier,context);
}});
const {AirportSimulation,default:worker}=await import('../server/worker.mjs');
const {makePlan}=await import('../src/simulation.mjs');
const {batchPlans}=await import('../server/typesafe.mjs');
const expectedFrameCalls=controller=>{const plan=makePlan(controller.record.sim);plan.state.trigger={reason:'scheduled',at:controller.record.sim.elapsed};return batchPlans(plan).length;};
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
 const controller=new AirportSimulation(ctx,{SIM_SCOPE:'legacy-test-fixture',TYPESAFE_API_KEY:'fixture-only',AI_DAILY_TOKEN_LIMIT:'1000000',AI_HOURLY_REQUEST_LIMIT:'720',...overrides});await ready;
 return {controller,calls,stored,advance:ms=>{now+=ms;},alarm:()=>alarm};
}

test('critical prediction preempts regular timer only for involved aircraft and honors budget',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();const fullFrameCalls=h.calls.length;
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
 assert.ok(c.record.sim.elapsed<60);assert.ok(h.calls.length>fullFrameCalls);
 const count=h.calls.length;h.advance(2000);await c.alarm();assert.equal(h.calls.length,count,'cooldown avoids request on each tick');
 c.record.ai.lastConflictAt=-100;c.env.AI_DAILY_TOKEN_LIMIT='10000';
 c.record.sim.alerts=[{a:a.id,b:b.id,critical:true,seconds:1}];c.record.sim.lastWall=Date.now()+2000;
 h.advance(2000);await c.alarm();assert.equal(c.record.ai.mode,'budget-limit');assert.equal(h.calls.length,count);
});

test('SIM_SPEED advances simulated time and scheduled Jev cadence on the same scale',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne',SIM_SPEED:'10'}),c=h.controller,expected=expectedFrameCalls(c);
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal((await c.snapshot()).speed,10);assert.equal((await c.snapshot()).ai.wallIntervalSeconds,6);
 assert.equal(h.calls.length,expected);assert.equal(c.record.frameRemaining,60);c.record.ai.lastConflictAt=Infinity;
 for(let i=0;i<20;i++){h.advance(200);await c.alarm();}
 assert.equal(c.record.sim.elapsed,40);assert.equal(c.record.frameRemaining,20);assert.equal(h.calls.length,expected);
 for(let i=0;i<10;i++){h.advance(200);await c.alarm();}
 assert.equal(c.record.sim.elapsed,60);assert.equal(h.calls.length,expected*2,'next scheduled frame starts after 60 simulated seconds, not 60 wall seconds');
 assert.equal(c.record.frameRemaining,60);
});

test('SIM_SPEED accepts 1-20 and falls back closed outside the range',async t=>{
 const low=await harness(t,new Map(),{SIM_SPEED:'0'});assert.equal(low.controller.limits().simSpeed,1);
 const high=await harness(t,new Map(),{SIM_SPEED:'21'});assert.equal(high.controller.limits().simSpeed,1);
 const valid=await harness(t,new Map(),{SIM_SPEED:'20'});assert.equal(valid.controller.limits().simSpeed,20);
});

test('provider latency advances aircraft and delayed answers apply to matching generations with measured age',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',SIM_SPEED:'10'}),c=h.controller,expected=expectedFrameCalls(c);
 let started=0,allStartedResolve,release;const allStarted=new Promise(r=>{allStartedResolve=r;}),gate=new Promise(r=>{release=r;});
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{const request=JSON.parse(opts.body);h.calls.push(request);if(++started===expected)allStartedResolve();await gate;return Response.json(response(request));});
 const flight=c.record.sim.flights.find(f=>f.initialCondition?.route&&f.phase!=='pending'),before=[flight.x,flight.y],generation=flight.generation;
 await c.heartbeat('viewer',1,true);const pending=c.alarm();await allStarted;
 h.advance(1000);for(const deadline=performance.now()+5000;c.record.sim.elapsed===0&&performance.now()<deadline;)await new Promise(r=>setTimeout(r,25));
 assert.ok(c.record.sim.elapsed>0,'sim clock must advance before Jev replies');const live=c.record.sim.flights.find(f=>f.id===flight.id);
 assert.equal(live.generation,generation);assert.ok(Math.hypot(live.x-before[0],live.y-before[1])>0,'prior clearance must keep the aircraft moving');
 release();await pending;
 assert.equal(c.record.ai.frames,1);assert.ok(c.record.ai.last.evidence.decisionAgeSimSeconds>0);assert.ok(c.record.ai.last.evidence.applicationRevisionDelta>0);
 assert.equal(c.record.ai.last.applied>0,true);
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
 const h=await harness(t),c=h.controller,expected=expectedFrameCalls(c);
 await c.heartbeat('viewer-a',1,true);await c.heartbeat('viewer-b',1,true);await c.alarm();
 assert.equal(h.calls.length,expected);assert.equal(c.record.ai.last.aircraft,100);assert.equal(c.record.ai.last.questions,403);assert.equal(c.record.ai.last.applied,100);
 const covered=h.calls.flatMap(r=>Object.keys(r.questions));assert.equal(new Set(covered).size,403);
 h.advance(2000);await c.alarm();assert.equal(c.record.sim.elapsed,2);
 await c.heartbeat('viewer-a',3,false);await c.heartbeat('viewer-a',2,true);assert.equal(c.viewers(),1);
 await c.heartbeat('viewer-b',2,false);await c.alarm();const elapsed=c.record.sim.elapsed,callsBeforeAbsence=h.calls.length;assert.equal(h.alarm(),null);
 h.advance(3600000);await c.alarm();assert.equal(c.record.sim.elapsed,elapsed);assert.equal(h.calls.length,callsBeforeAbsence);
 await c.heartbeat('viewer-a',4,true);await c.alarm();assert.equal(c.record.sim.elapsed,elapsed);assert.ok(h.calls.length>callsBeforeAbsence);
});
test('lost disconnect expires in 20s; no API call or simulation catches up during absence',async t=>{
 const h=await harness(t),c=h.controller,expected=expectedFrameCalls(c);await c.heartbeat('viewer',1,true);await c.alarm();
 h.advance(21000);await c.alarm();assert.equal(c.viewers(),0);assert.equal(h.alarm(),null);assert.equal(c.record.sim.elapsed,0);assert.equal(h.calls.length,expected);
 h.advance(86400000);await c.snapshot();assert.equal(h.calls.length,expected);assert.equal(h.alarm(),null);
});

for(const disconnect of ['explicit','expired'])test(disconnect+' last viewer disconnect during provider calls aborts without applying commands',async t=>{
 const h=await harness(t),c=h.controller,expected=expectedFrameCalls(c);let started=0,aborted=0,notify;
 const allStarted=new Promise(resolve=>{notify=resolve;});
 t.mock.method(globalThis,'fetch',async(_url,opts)=>new Promise((_resolve,reject)=>{
  opts.signal.addEventListener('abort',()=>{aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true});
  if(++started===expected)notify();
 }));
 await c.heartbeat('viewer',1,true);const pending=c.alarm();await allStarted;
 if(disconnect==='explicit')await c.heartbeat('viewer',2,false);else{h.advance(21000);await c.alarm();}
 await pending;
 assert.equal(aborted,expected);assert.equal(c.record.ai.mode,'idle');assert.equal(c.record.sim.stats.aiApplied,0);assert.equal(c.record.sim.elapsed,0);assert.equal(h.alarm(),null);
 assert.ok(c.record.budget.tokens>0,'unknown upstream charge remains reserved');
});
test('transient provider failure freezes physics during backoff; partial usage settles and unknown charge stays reserved',async t=>{
 const h=await harness(t),c=h.controller,expected=expectedFrameCalls(c);let index=0;
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{index++;if(index===2)return new Response('private provider detail',{status:429});return Response.json(response(JSON.parse(opts.body)));});
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.ai.mode,'backoff');assert.equal(c.record.frameRemaining,0);assert.equal(c.record.sim.stats.aiApplied,0);
 assert.ok(c.record.budget.tokens>(expected-1)*1000);assert.equal(c.record.budget.actualTokens,(expected-1)*1000);
 h.advance(5000);await c.alarm();assert.equal(c.record.sim.elapsed,0,'provider-failure backoff is not simulated exposure');assert.equal(c.record.frameRemaining,0);assert.equal(index,expected);
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
 const h=await harness(t,new Map(),{AI_DAILY_TOKEN_LIMIT:'10000'}),c=h.controller,expected=expectedFrameCalls(c);
 await c.heartbeat('viewer',1,true);await c.alarm();assert.equal(c.record.ai.budgetReason,'daily');
 assert.equal(c.record.ai.nextAt,Date.UTC(2026,8,18));
 c.record.budget.tokens=9000;c.record.budget.actualTokens=9000;
 c.record.ai.mode='awaiting';delete c.record.ai.budgetLimit; // Legacy pause before cap metadata existed.
 delete c.env.AI_DAILY_TOKEN_LIMIT;
 assert.equal(c.limits().dailyTokens,3800000);assert.ok(c.limits().dailyTokens/1000000*.042*30<5);
 h.advance(2000);await c.alarm();assert.equal(c.record.ai.mode,'active');assert.equal(h.calls.length,expected);
 assert.equal(c.record.budget.actualTokens,9000+expected*1000);assert.equal(c.record.budget.tokens,9000+expected*1000);
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


test('latest decision evidence retains all normalized judgments and runway order across reload',async t=>{
 const h=await harness(t),c=h.controller;
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{
  const request=JSON.parse(opts.body);h.calls.push(request);const data=response(request);
  data.extra='private-fixture-value';
  for(const answer of Object.values(data.answers))answer.extra='private-fixture-value';
  return Response.json(data);
 });
 await c.heartbeat('viewer',1,true);await c.alarm();
 const evidence=c.record.ai.last.evidence;
 assert.ok(evidence);assert.equal(evidence.version,3);assert.equal(evidence.planRevision,0);assert.equal(evidence.requestSimSeconds,0);assert.equal(evidence.responseSimSeconds,0);assert.equal(evidence.decisionAgeSimSeconds,0);assert.equal(evidence.applicationRevisionDelta,0);
 assert.equal(Object.keys(evidence.answers).length,403);
 assert.deepEqual(evidence.runwayOrder,['16R','17L','18']);
 assert.equal(evidence.runwayConflictResolution,'last-in-plan-order');
 for(const request of h.calls)assert.deepEqual(Object.fromEntries(Object.keys(request.questions).map(id=>[id,evidence.answers[id]])),response(request).answers);
 const report=await c.report();assert.equal(JSON.stringify(report).includes('private-fixture-value'),false);
 assert.deepEqual(report.ai.last.evidence,evidence);
 assert.ok(Buffer.byteLength(JSON.stringify(c.record))<1000000,'latest-only evidence must fit the storage value');
 const reloaded=await harness(t,h.stored);assert.deepEqual(reloaded.controller.record.ai.last.evidence,evidence);
 assert.equal(reloaded.calls.length,0);
});
test('emergency evidence replaces prior runway judgments rather than reusing stale decisions',async t=>{
 const h=await harness(t),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();
 const [a,b]=c.record.sim.flights.slice(50,52);
 for(const f of c.record.sim.flights)f.phase='taxi_out';
 for(const [i,f] of [a,b].entries()){
  Object.assign(f,{phase:'arrival',altitude:6000,speed:220,verticalRate:0,x:i?1:-1,y:20,heading:i?270:90});
  f.command={route:i?'VECTOR_W':'VECTOR_E',altitude:6000,speed:220,rate:1000,navigation:{kind:'VECTOR',points:[[i?-30:30,20]],index:0}};
 }
 h.advance(2000);await c.alarm();
 assert.equal(c.record.ai.last.trigger.reason,'predicted-conflict');
 assert.deepEqual(c.record.ai.last.evidence.runwayOrder,[]);
 assert.equal(Object.keys(c.record.ai.last.evidence.answers).length,8);
 assert.ok(Object.keys(c.record.ai.last.evidence.answers).every(id=>id.startsWith(a.id+'_')||id.startsWith(b.id+'_')));
});


test('control-policy migration preserves prior results, budget, replay and old decision evidence',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();
 c.record.sim.elapsed=123;c.record.sim.stats.collisions=2;
 delete c.record.sim.controlEpoch;delete c.record.ai.last.evidence.controlPolicy;
 await c.persist(c.record);
 const before=structuredClone(c.record),replay=JSON.stringify(await c.replayData());
 const reloaded=await harness(t,h.stored),next=reloaded.controller;
 assert.equal(reloaded.calls.length,0);assert.equal(next.record.sim.elapsed,123);
 assert.deepEqual(next.record.sim.stats,before.sim.stats);assert.deepEqual(next.record.sim.flights,before.sim.flights);
 assert.deepEqual(next.record.budget,before.budget);assert.deepEqual(next.record.ai.last,before.ai.last);
 assert.equal(JSON.stringify(await next.replayData()),replay);
 assert.equal(next.record.sim.controlEpoch.policy,'jev-command-live-latency-v2');
 assert.equal(next.record.sim.controlEpoch.previousPolicy,'procedure-target-repair-v1');
 assert.equal(next.record.sim.controlEpoch.elapsed,123);
 assert.deepEqual(next.record.sim.controlEpoch.baseline,before.sim.stats);
 const report=await next.report();assert.equal(report.pilotControlPolicy,'jev-command-live-latency-v2');
 assert.equal(report.stats.collisions,2);assert.equal(report.controlEpochStats.collisions,0);
 assert.equal((await next.snapshot()).pilotControlPolicy,'jev-command-live-latency-v2');
 const epoch=structuredClone(next.record.sim.controlEpoch);
 const again=await harness(t,h.stored);assert.deepEqual(again.controller.record.sim.controlEpoch,epoch);
 assert.equal(again.calls.length,0);
});
test('new evidence identifies observational execution without rewriting original answers',async t=>{
 const h=await harness(t);await h.controller.heartbeat('viewer',1,true);await h.controller.alarm();
 const last=h.controller.record.ai.last;
 assert.equal(last.evidence.controlPolicy,'jev-command-live-latency-v2');assert.equal(last.applied,100);
 assert.equal(Object.keys(last.evidence.answers).length,403);
 for(const request of h.calls){
  assert.match(request.state.policy,/never repairs unsafe commands/);
  assert.match(request.state.policy,/constraintWarnings are non-blocking/);
 }
});


test('procedure command audit persists through controller reload without re-logging or spending credits',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();
 const before=structuredClone((await c.report()).commandAudit),budget=structuredClone(c.record.budget);
 assert.equal(before.checkedCommands,100);assert.ok(before.procedureCommands>0);assert.ok(before.records.length>0);
 const frameCalls=h.calls.length;
 for(let i=0;i<3;i++){await c.snapshot();await c.report();}
 assert.equal(h.calls.length,frameCalls);assert.deepEqual((await c.report()).commandAudit,before);
 const reload=await harness(t,h.stored);assert.equal(reload.calls.length,0);
 assert.deepEqual((await reload.controller.report()).commandAudit,before);assert.deepEqual(reload.controller.record.budget,budget);
 assert.equal((await reload.controller.snapshot()).commandAudit.records,undefined);
 for(const request of h.calls)assert.equal(request.state.commandAudit,undefined);
});
test('legacy command audit begins empty at migration, preserves old commands and reports unknown historical coverage',async t=>{
 const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();c.record.sim.elapsed=123;
 delete c.record.sim.commandAudit;await c.persist(c.record);
 const old=structuredClone(c.record),oldReplay=JSON.stringify(await c.replayData());
 const reload=await harness(t,h.stored),next=reload.controller;
 const a=(await next.report()).commandAudit;
 assert.equal(reload.calls.length,0);assert.equal(a.startedAtSimSeconds,123);assert.equal(a.checkedCommands,0);assert.equal(a.procedureCommands,0);assert.deepEqual(a.records,[]);
 assert.deepEqual(next.record.sim.flights,old.sim.flights);assert.deepEqual(next.record.sim.stats,old.sim.stats);
 assert.deepEqual(next.record.ai,old.ai);assert.deepEqual(next.record.budget,old.budget);assert.equal(JSON.stringify(await next.replayData()),oldReplay);
 const again=await harness(t,h.stored);assert.deepEqual((await again.controller.report()).commandAudit,a);assert.equal(again.calls.length,0);
});
test('full command history plus measured incidents and normalized decision evidence fit the storage value',async t=>{
 const {recordIncident}=await import('../src/simulation.mjs');
 const h=await harness(t),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();
 const ids=c.record.sim.flights.map(f=>f.id),commands=c.record.sim.flights.map(f=>f.command);
 for(let i=0;i<200;i++)recordIncident(c.record.sim,'storage-fixture-collision',ids,{commands});
 const before=structuredClone(c.record.sim.incidents);
 assert.equal(c.record.sim.incidents.length,200);assert.ok(c.record.sim.commandAudit.records.length>0);
 assert.ok(Buffer.byteLength(JSON.stringify(c.record))<1000000);
 await c.persist(c.record);const reload=await harness(t,h.stored);
 assert.deepEqual(reload.controller.record.sim.incidents,before);assert.deepEqual(reload.controller.record.sim.commandAudit,c.record.sim.commandAudit);
 assert.equal(reload.calls.length,0);
});


test('evaluation export and request fingerprints persist without extra inference or secret material',async t=>{
 const {createHash}=await import('node:crypto');const h=await harness(t),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();
 const e=c.record.ai.last.evidence,report=await c.report();
 assert.equal(e.evaluationProtocol,report.evaluation.protocolId);assert.equal(report.evaluation.commands.checkedCommands,100);
 assert.equal(e.promptVersion,'jev-atc-airborne-observe-v3');assert.equal(e.contextVersion,'compact-state-geometry-v4');assert.equal(e.requests.length,h.calls.length);
 e.requests.forEach((b,index)=>{assert.equal(b.requestSha256,createHash('sha256').update(JSON.stringify(h.calls[index])).digest('hex'));assert.equal(b.requestedModel,h.calls[index].model);assert.equal(b.returnedModel,'jev-1.13.0');assert.equal(b.inputTokens,1000);});
 assert.equal(JSON.stringify(report).includes('fixture-only'),false);
 const before=structuredClone(report.evaluation),reloaded=await harness(t,h.stored);
 assert.equal(reloaded.calls.length,0);assert.deepEqual((await reloaded.controller.report()).evaluation,before);
});

async function journalEntries(c){const meta=await c.researchData(),entries=[];for(let i=0;i<meta.nextSequence;i++){const d=await c.researchData(i);let text='';for(let j=0;j<d.chunkCount;j++)text+=(await c.researchData(i,j)).text;entries.push(JSON.parse(text));}return entries;}
test('airborne controller never asks pending ground identities and archives every applied command',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller;const initialPlan=makePlan(c.record.sim),expectedQuestions=initialPlan.flights.length*4+initialPlan.runways.length;await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.sim.trafficScope,'airborne-handoff-v1');assert.equal(c.record.ai.last.aircraft,36);assert.equal(c.record.ai.last.questions,expectedQuestions);assert.equal(c.record.ai.last.applied,36);
 const ground=new Set(c.record.sim.flights.filter(f=>f.phase==='pending').map(f=>f.id));for(const r of h.calls)for(const id of Object.keys(r.questions))assert.ok(!ground.has(id.split('_')[0]));
 const entries=await journalEntries(c),commands=entries.flatMap(e=>e.events.filter(e=>e.kind==='application').flatMap(e=>e.events.filter(e=>e.kind==='command-applied')));
 assert.equal(commands.length,36);assert.equal(new Set(commands.map(e=>e.command.id)).size,36);
 assert.equal((await c.report()).evaluation.byScope.ground.checkedCommands,0);assert.equal((await c.report()).evaluation.dataAvailability.fullDecisionJournal,true);
 const before=await c.researchData(),calls=h.calls.length;await c.report();await c.researchData(0,0);assert.deepEqual(await c.researchData(),before);assert.equal(h.calls.length,calls);
});
test('oversized input is visible, does not spend credits and does not retry the same frozen state',async t=>{
 const h=await harness(t),c=h.controller,{FIXES}=await import('../src/airport.mjs'),[x,y]=FIXES.GAZGE.point;
 for(const [i,f] of c.record.sim.flights.slice(50).entries())Object.assign(f,{phase:'arrival',command:null,x:x+i*.001,y,altitude:6000});
 await c.heartbeat('viewer',1,true);await c.alarm();assert.equal(c.record.ai.mode,'input-too-large');assert.equal(c.record.ai.planningFailures,1);assert.equal(h.calls.length,0);
 h.advance(5000);await c.alarm();assert.equal(c.record.ai.planningFailures,1);assert.equal(h.alarm(),null);assert.equal(h.calls.length,0);
});
for(const phase of ['before-dispatch','after-dispatch'])test('archive failure '+phase+' stops without advancing an unacknowledged simulation',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller,original=c.ctx.storage.put;
 t.mock.method(c.ctx.storage,'put',async(k,v)=>{if(typeof k==='object'&&k['research-journal-v1']&&(phase==='before-dispatch'||k['airport-ltfm-v1']?.ai.mode==='active'))throw Error('injected-write-failure');return original(k,v);});
 await c.heartbeat('viewer',1,true);await c.alarm();assert.equal(c.record.ai.mode,'archive-error');assert.equal(c.record.sim.elapsed,0);assert.equal(c.record.sim.stats.aiApplied,0);assert.equal(h.alarm(),null);
 if(phase==='before-dispatch')assert.equal(h.calls.length,0);else{assert.ok(h.calls.length>0);assert.ok(c.record.budget.tokens>0);}
 const calls=h.calls.length;h.advance(5000);await c.alarm();assert.equal(h.calls.length,calls);
});
test('journal permits exact deterministic command/physics replay without another provider call',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();h.advance(2000);await c.alarm();
 const {advanceSimulation,applyFleetDecision}=await import('../src/simulation.mjs'),{simulationStateSha256,STATE_DIGEST_VERSION}=await import('../server/research-journal.mjs');
 const entries=await journalEntries(c),plans=new Map();let sim,outcomes;
 for(const entry of entries){for(const e of entry.events){
  if(e.kind==='initial-state')sim=structuredClone(e.sim);
  if(e.kind==='dispatch-intent')plans.set(e.planRevision,e.plan);
  if(e.kind==='dispatch-outcomes')outcomes=e.outcomes;
  if(e.kind==='application'){const answers=Object.assign({},...outcomes.filter(o=>o.status==='fulfilled').map(o=>o.result.answers));applyFleetDecision(sim,plans.get(e.planRevision),answers);}
  if(e.kind==='physics-step'){if(e.idleAdvance)sim.requiresDecision=false;advanceSimulation(sim,e.to-e.from);}
 }
 assert.equal(entry.stateDigestVersion,STATE_DIGEST_VERSION);const digest=await simulationStateSha256(sim);assert.equal(digest,entry.stateSha256,'journal state digest at '+entry.sequence);
 }
 assert.deepEqual(sim.flights,c.record.sim.flights);assert.deepEqual(sim.stats,c.record.sim.stats);
});
test('frozen controller enforces exposure limit, version identity and records a completed stop',async t=>{
 const {createAirborneSimulation}=await import('../src/simulation.mjs'),{runtimeVersions,initialStateFingerprint,provenance}=await import('../server/study-run.mjs');
 const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'test-frozen',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),stopping:{targetSimulatedSeconds:1,maxWallSeconds:60,maxTotalInputTokens:1000000,stopForFavorableResults:false}};
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(m),RESEARCH_RUN_ID:m.runId}),c=h.controller;
 assert.equal(c.record.study.status,'ready');assert.equal(h.calls.length,0);await c.armStudyRun();await c.heartbeat('viewer',1,true);await c.alarm();h.advance(2000);await c.alarm();assert.equal(c.record.sim.elapsed,1);assert.equal(c.record.ai.mode,'study-stopped');assert.equal(c.record.study.status,'completed');
 const calls=h.calls.length;h.advance(2000);await c.alarm();assert.equal(h.calls.length,calls);assert.equal(c.record.study.manifest.sourceFingerprint,provenance.sourceFingerprint);
});


test('study HTTP reads and presence all address the same run object',async t=>{
 const prior=globalThis.caches,cache=new Map(),addressed=[];
 globalThis.caches={default:{match:async r=>cache.get(r.url)?.clone(),put:async(r,v)=>cache.set(r.url,v.clone())}};
 t.after(()=>{if(prior===undefined)delete globalThis.caches;else globalThis.caches=prior;});
 const limit={limit:async()=>({success:true})};
 const env={RESEARCH_RUN_ID:'routing-test',STATE_READ_LIMITER:limit,PRESENCE_LIMITER:limit,AIRPORT:{getByName:name=>{addressed.push(name);return {snapshot:async()=>({objectName:name}),report:async()=>({objectName:name}),replayData:async()=>({objectName:name}),researchData:async()=>({objectName:name}),heartbeat:async()=>true};}}};
 for(const route of ['/api/state','/api/replay','/api/research','/api/report']){
  const r=await worker.fetch(new Request('https://fixture.invalid'+route),env);assert.equal(r.status,200);assert.equal((await r.json()).objectName,'study-routing-test',route);
 }
 const r=await worker.fetch(new Request('https://fixture.invalid/api/presence',{method:'POST',headers:{Origin:'https://fixture.invalid'},body:JSON.stringify({id:'test-viewer-123456789012345',sequence:1,active:true})}),env);
 assert.equal(r.status,204);assert.equal(addressed.length,5);assert.ok(addressed.every(n=>n==='study-routing-test'));
});
test('state and replay caches cannot leak a previous study or the legacy demo into another run',async t=>{
 const prior=globalThis.caches,cache=new Map();globalThis.caches={default:{match:async r=>cache.get(r.url)?.clone(),put:async(r,v)=>cache.set(r.url,v.clone())}};
 t.after(()=>{if(prior===undefined)delete globalThis.caches;else globalThis.caches=prior;});
 const env={STATE_READ_LIMITER:{limit:async()=>({success:true})},AIRPORT:{getByName:name=>({snapshot:async()=>({objectName:name}),replayData:async()=>({objectName:name})})}};
 for(const runId of ['alpha','beta',undefined])for(const route of ['/api/state','/api/replay?page=0']){
  const r=await worker.fetch(new Request('https://fixture.invalid'+route),{...env,RESEARCH_RUN_ID:runId});assert.equal(r.status,200);assert.equal((await r.json()).objectName,runId?'study-'+runId:'istanbul-demo-v2');
 }
 assert.equal(cache.size,6);
});

async function frozenFixtureHarness(t,targetSimulatedSeconds=10,arm=true){
 const {createAirborneSimulation}=await import('../src/simulation.mjs'),{runtimeVersions,initialStateFingerprint,provenance}=await import('../server/study-run.mjs');
 const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'freeze-edge',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),stopping:{targetSimulatedSeconds,maxWallSeconds:60,maxTotalInputTokens:1000000,stopForFavorableResults:false}};
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(m),RESEARCH_RUN_ID:m.runId});if(arm)await h.controller.armStudyRun();return h;
}
test('a frozen study with no active aircraft stops at its exposure target without overshoot',async t=>{
 const h=await frozenFixtureHarness(t,1),c=h.controller;c.record.sim.elapsed=.75;
 for(const f of c.record.sim.flights)Object.assign(f,{phase:'pending',releaseAt:1000,command:null});
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.sim.elapsed,1);assert.equal(c.record.study.status,'completed');assert.equal(c.record.ai.mode,'study-stopped');assert.equal(h.calls.length,0);assert.equal(h.alarm(),null);
});
test('wall deadline is finalized on the next wake even when every viewer has left',async t=>{
 const h=await frozenFixtureHarness(t),c=h.controller;h.advance(61000);await c.alarm();
 assert.equal(c.record.study.status,'incomplete');assert.equal(c.record.study.stopReason,'wall-time');assert.equal(h.calls.length,0);assert.equal(c.record.sim.elapsed,0);
});
test('oversized study input is an archived infrastructure stop, not an unexplained pause',async t=>{
 const h=await frozenFixtureHarness(t),c=h.controller,{FIXES}=await import('../src/airport.mjs'),[x,y]=FIXES.GAZGE.point;
 for(const [i,f] of c.record.sim.flights.slice(50).entries())Object.assign(f,{phase:'arrival',command:null,x:x+i*.001,y,altitude:6000});
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.study.status,'incomplete');assert.equal(c.record.study.stopReason,'input-too-large');assert.equal(h.calls.length,0);
 const entries=await journalEntries(c);assert.ok(entries.flatMap(e=>e.events).some(e=>e.kind==='study-stop'&&e.reason==='input-too-large'));
});


test('no viewer during durable dispatch intent means no outbound provider request',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller,original=c.ctx.storage.put;
 t.mock.method(c.ctx.storage,'put',async(k,v)=>{
  await original(k,v);
  if(typeof k==='object'&&k['airport-ltfm-v1']?.ai.mode==='evaluating')for(const p of c.presence.values())p.active=false;
 });
 await c.heartbeat('test-viewer',1,true);await c.alarm();
 assert.equal(h.calls.length,0);assert.equal(c.record.sim.stats.aiApplied,0);
 const events=(await journalEntries(c)).flatMap(e=>e.events);
 assert.ok(events.some(e=>e.kind==='dispatch-cancelled'&&e.reason==='no-viewers-before-send'));
});
test('infrastructure stop remains visible without viewers',async t=>{
 const h=await harness(t),c=h.controller;
 for(const mode of ['archive-error','input-too-large','study-stopped']){
  c.record.ai.mode=mode;c.record.ai.stopReason='fixture';assert.equal((await c.snapshot()).ai.mode,mode);
 }
});
test('frozen run rejects an unexpected returned model without applying commands',async t=>{
 const {createAirborneSimulation}=await import('../src/simulation.mjs');
 const {initialStateFingerprint,runtimeVersions,provenance}=await import('../server/study-run.mjs');
 const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'model-drift',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),stopping:{targetSimulatedSeconds:60,maxWallSeconds:600,maxTotalInputTokens:1000000,stopForFavorableResults:false}};
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(m),RESEARCH_RUN_ID:m.runId}),c=h.controller;
 t.mock.method(globalThis,'fetch',async(_u,opts)=>Response.json({...response(JSON.parse(opts.body)),model:'jev-other-version'}));
 await c.armStudyRun();await c.heartbeat('test-viewer',1,true);await c.alarm();assert.equal(c.record.sim.stats.aiApplied,0);
 assert.equal(c.record.study.status,'incomplete');assert.equal(c.record.study.stopReason,'returned-model-mismatch');
});

test('simultaneous alarm delivery and duplicate delivery do not duplicate a dispatch or application',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller;
 await c.heartbeat('duplicate-test-viewer',1,true);await Promise.all([c.alarm(),c.alarm(),c.alarm()]);
 assert.equal(c.record.ai.frames,1);assert.equal(c.record.ai.last.applied,36);const calls=h.calls.length;
 await c.alarm();assert.equal(h.calls.length,calls);assert.equal(c.record.sim.stats.aiApplied,36);
 const events=(await journalEntries(c)).flatMap(e=>e.events);assert.equal(events.filter(e=>e.kind==='dispatch-intent').length,1);
});
test('restart after a persisted intent with unknown outcome cannot send it again',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller;
 const pending=structuredClone(c.record);pending.ai.mode='evaluating';pending.budget.tokens=1234;pending.budget.actualTokens=0;
 await c.persist(pending,[{kind:'fixture-pending-dispatch'}]);const again=await harness(t,h.stored,{SIM_SCOPE:'airborne-only'});
 assert.equal(again.controller.record.ai.mode,'archive-error');assert.equal(again.controller.record.budget.tokens,1234);
 await again.controller.heartbeat('unknown-outcome-viewer',1,true);await again.controller.alarm();assert.equal(again.calls.length,0);
 assert.ok((await journalEntries(again.controller)).flatMap(e=>e.events).some(e=>e.kind==='interrupted-dispatch'));
});
test('report links independent adjudication only to a frozen manifest review hash',async t=>{
 const {createAirborneSimulation}=await import('../src/simulation.mjs'),{initialStateFingerprint,runtimeVersions,provenance}=await import('../server/study-run.mjs'),hash='a'.repeat(64);
 const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'review-linked',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),stopping:{targetSimulatedSeconds:60,maxWallSeconds:600,maxTotalInputTokens:1000000,stopForFavorableResults:false},independentRuleReview:true,reviewPacketSha256:'b'.repeat(64),ruleReviewSha256:hash};
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(m),RESEARCH_RUN_ID:m.runId}),report=await h.controller.report();
 assert.equal(report.evaluation.dataAvailability.independentlyAdjudicatedLabels,true);assert.equal(report.evaluation.dataAvailability.reviewPacketSha256,'b'.repeat(64));assert.equal(report.evaluation.dataAvailability.ruleReviewSha256,hash);assert.ok(!report.evaluation.analysisReadiness.blockers.includes('independent-rule-adjudication-pending'));
});
test('AI-disabled snapshot is not advertised as connected even if a local key exists',async t=>{
 const h=await harness(t,new Map(),{AI_ENABLED:'false'}),snapshot=await h.controller.snapshot();assert.equal(snapshot.ai.configured,false);assert.equal(h.calls.length,0);
});
test('journal labels evaluated study and ordinary demo evidence classes explicitly',async t=>{
 const demo=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),demoEntries=await journalEntries(demo.controller);assert.equal(demoEntries[0].events.find(e=>e.kind==='initial-state').evidenceClass,'live-demo');
 const study=await frozenFixtureHarness(t,10),studyEntries=await journalEntries(study.controller);assert.equal(studyEntries[0].events.find(e=>e.kind==='initial-state').evidenceClass,'live-study');
});
test('cohort research-journal capacity is frozen while legacy single-run manifests remain compatible',async t=>{
 const {createAirborneSimulation}=await import('../src/simulation.mjs'),{initialStateFingerprint,runtimeVersions,provenance}=await import('../server/study-run.mjs'),seed=42,sim=createAirborneSimulation(0,seed),studyPlan={planId:'cap-fixture',planSha256:'a'.repeat(64),designCommitmentSha256:'d'.repeat(64),seedListSha256:'e'.repeat(64),startPolicy:'explicit-operator-arm-v1',runIndex:0,runCount:1,seedScheme:'sha256-plan-index-v1'};
 const manifest={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'cap-fixture-r001',scope:'airborne-handoff-v1',seed,sourceFingerprint:provenance.sourceFingerprint,sourceCommit:'b'.repeat(40),sourceTree:'c'.repeat(40),versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(sim),stopping:{targetSimulatedSeconds:60,maxWallSeconds:600,maxTotalInputTokens:100000,stopForFavorableResults:false},storage:{researchJournalMaxBytes:67108864},independentRuleReview:false,reviewPacketSha256:null,ruleReviewSha256:null,studyPlan};
 const ok=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(manifest),RESEARCH_RUN_ID:manifest.runId,RESEARCH_JOURNAL_MAX_BYTES:'67108864'});assert.equal(ok.controller.record.study.manifest.storage.researchJournalMaxBytes,67108864);assert.equal(ok.calls.length,0);
 await assert.rejects(harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(manifest),RESEARCH_RUN_ID:manifest.runId,RESEARCH_JOURNAL_MAX_BYTES:'64000000'}),/Frozen research journal limit mismatch/);
 const legacy={...manifest,runId:'legacy-cap-fixture',studyPlan:undefined,sourceCommit:undefined,sourceTree:undefined,storage:undefined};const old=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(legacy),RESEARCH_RUN_ID:legacy.runId});assert.equal(old.calls.length,0);
});
test('frozen study stays ready indefinitely until explicitly armed; public viewers cannot start it',async t=>{
 const h=await frozenFixtureHarness(t,10,false),c=h.controller;assert.equal(c.record.study.status,'ready');assert.equal(c.record.study.startedAt,null);assert.equal((await c.snapshot()).studyStatus,'ready');
 await c.heartbeat('ready-viewer-123456789012',1,true);await c.alarm();assert.equal(h.calls.length,0);assert.equal(c.record.sim.elapsed,0);assert.equal(h.alarm(),null);
 h.advance(120000);await c.alarm();assert.equal(c.record.study.status,'ready');assert.equal(c.record.sim.elapsed,0);assert.equal(h.calls.length,0);
});
test('explicit arm is idempotent, spends no credit itself and running study no longer depends on viewers',async t=>{
 const h=await frozenFixtureHarness(t,10,false),c=h.controller,first=await c.armStudyRun();assert.equal(first.armed,true);assert.equal(first.status,'running');assert.equal(h.calls.length,0);assert.ok(h.alarm()!=null);
 const again=await c.armStudyRun();assert.equal(again.armed,false);assert.equal(h.calls.length,0);
 await c.alarm();assert.ok(h.calls.length>0);assert.ok(c.record.sim.stats.aiApplied>0);assert.equal(c.record.study.status,'running');assert.equal(c.viewers(),0);
 const armedEvents=(await journalEntries(c)).flatMap(e=>e.events).filter(e=>e.kind==='study-armed');assert.equal(armedEvents.length,1);
});
test('study arm HTTP endpoint requires the operator secret and does not expose it',async()=>{
 let arms=0;const token='study-arm-fixture-token-0123456789abcdef',env={RESEARCH_RUN_ID:'http-arm',RUN_MANIFEST_JSON:'fixture-present',STUDY_ARM_TOKEN:token,AIRPORT:{getByName:name=>({armStudyRun:async()=>{arms++;return {runId:name,status:'running',armed:true};}})}};
 for(const auth of [null,'Bearer wrong-token-that-is-long-enough-000000']){const headers=auth?{Authorization:auth}:{};const r=await worker.fetch(new Request('https://fixture.invalid/api/study/arm',{method:'POST',headers}),env);assert.equal(r.status,403);assert.equal(arms,0);}
 const ok=await worker.fetch(new Request('https://fixture.invalid/api/study/arm',{method:'POST',headers:{Authorization:'Bearer '+token}}),env);assert.equal(ok.status,200);const body=await ok.json();assert.equal(body.status,'running');assert.equal(arms,1);assert.ok(!JSON.stringify(body).includes(token));
 const demo=await worker.fetch(new Request('https://fixture.invalid/api/study/arm',{method:'POST',headers:{Authorization:'Bearer '+token}}),{...env,RESEARCH_RUN_ID:undefined,RUN_MANIFEST_JSON:undefined});assert.equal(demo.status,404);assert.equal(arms,1);
});
test('evaluation v2 to v3 migration starts a new baseline without rewriting cumulative history',async t=>{
 const h=await harness(t),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();c.record.sim.elapsed=123;c.record.sim.stats.collisions=2;c.record.budget.tokens=456;
 const audit=c.record.sim.commandAudit,checked=audit.checkedCommands;assert.ok(checked>0);audit.evaluation.protocolId='vector-observational-v2';audit.evaluation.checkedCommands=77;audit.evaluation.commandsWithFindings=55;h.stored.set('before-measurement-swept-terminal-v2',{sentinel:'older-measurement-archive'});await c.persist(c.record);
 const before=structuredClone(c.record),replay=JSON.stringify(await c.replayData()),reload=await harness(t,h.stored),next=reload.controller,e=next.record.sim.commandAudit.evaluation;
 assert.equal(reload.calls.length,0);assert.equal(e.protocolId,'vector-observational-v3');assert.equal(e.baselineAuditChecked,checked);assert.equal(e.checkedCommands,0);assert.equal(e.commandsWithFindings,0);assert.equal(next.record.sim.elapsed,123);assert.equal(next.record.sim.stats.collisions,2);assert.equal(next.record.budget.tokens,456);assert.equal(JSON.stringify(await next.replayData()),replay);
 assert.deepEqual(h.stored.get('before-measurement-swept-terminal-v2'),{sentinel:'older-measurement-archive'});const archived=h.stored.get('before-evaluation-vector-observational-v3');assert.equal(archived.evaluation.protocolId,'vector-observational-v2');assert.equal(archived.evaluation.checkedCommands,77);assert.deepEqual(archived.stats,before.sim.stats);
});
for(const previousDataset of ['LTFM-SOUTH-v1','LTFM-SOUTH-v2'])test('dataset '+previousDataset+' to v3 migration preserves history but starts new data/evaluation epochs',async t=>{
 const h=await harness(t),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();c.record.sim.dataset=previousDataset;delete c.record.sim.dataEpoch;c.record.sim.elapsed=123;c.record.sim.stats.collisions=2;c.record.budget.tokens=456;
 const checked=c.record.sim.commandAudit.checkedCommands,beforeEval=structuredClone(c.record.sim.commandAudit.evaluation);assert.equal(beforeEval.protocolId,'vector-observational-v3');await c.persist(c.record);const before=structuredClone(c.record),replay=JSON.stringify(await c.replayData());
 const reload=await harness(t,h.stored),next=reload.controller,e=next.record.sim.commandAudit.evaluation;assert.equal(reload.calls.length,0);assert.equal(next.record.sim.dataset,'LTFM-SOUTH-v3');assert.equal(next.record.sim.dataEpoch.dataset,'LTFM-SOUTH-v3');assert.equal(next.record.sim.dataEpoch.previousDataset,previousDataset);assert.equal(next.record.sim.dataEpoch.elapsed,123);assert.deepEqual(next.record.sim.dataEpoch.baseline,before.sim.stats);
 assert.equal(e.protocolId,'vector-observational-v3');assert.equal(e.baselineAuditChecked,checked);assert.equal(e.checkedCommands,0);assert.equal(next.record.sim.elapsed,123);assert.equal(next.record.sim.stats.collisions,2);assert.equal(next.record.budget.tokens,456);assert.equal(JSON.stringify(await next.replayData()),replay);
 const archived=h.stored.get('before-dataset-LTFM-SOUTH-v3');assert.equal(archived.dataset,previousDataset);assert.deepEqual(archived.evaluation,beforeEval);assert.deepEqual(archived.stats,before.sim.stats);assert.equal(archived.elapsed,123);
 const report=await next.report();assert.equal(report.dataset.id,'LTFM-SOUTH-v3');assert.equal(report.dataEpochStats.collisions,0);
});

async function collectionFixture(t,stored,overrides={},runtime={simSpeed:1}){
 const {createAirborneSimulation}=await import('../src/simulation.mjs'),{initialStateFingerprint,runtimeVersions,provenance}=await import('../server/study-run.mjs');
 const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'uncapped-fixture',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),evidenceClass:'live-unreviewed-collection',independentRuleReview:false,preregistered:false,stopping:{targetSimulatedSeconds:7200,maxWallSeconds:null,maxTotalInputTokens:null,tokenBudgetPolicy:'provider-balance-v1',stopForFavorableResults:false},runtime};
 return harness(t,stored??new Map(),{SIM_SCOPE:'airborne-only',RESEARCH_RUN_ID:m.runId,RUN_MANIFEST_JSON:JSON.stringify(m),AI_DAILY_TOKEN_LIMIT:'provider-balance',...overrides});
}
test('uncapped collection remains ready until arm and records true policy without viewers',async t=>{
 const h=await collectionFixture(t),c=h.controller;await c.alarm();assert.equal(h.calls.length,0);assert.equal(c.record.study.status,'ready');
 const initial=(await journalEntries(c))[0].events.find(e=>e.kind==='initial-state');assert.equal(initial.evidenceClass,'live-unreviewed-collection');
 await c.armStudyRun();c.record.study.accountedInputTokens=1000000000;c.record.budget={...c.record.budget,day:new Date(Date.now()).toISOString().slice(0,10),tokens:1000000000};await c.alarm();assert.ok(h.calls.length>0);assert.equal(c.viewers(),0);
 h.advance(2000);await c.alarm();assert.ok(c.record.sim.elapsed>0);const s=await c.snapshot();assert.equal(s.ai.budget.limit,null);assert.equal(s.collection.tokenBudgetPolicy,'provider-balance-v1');
 const reload=await collectionFixture(t,h.stored);assert.equal(reload.controller.record.study.status,'running');assert.equal(reload.calls.length,0);assert.equal(reload.controller.record.sim.elapsed,c.record.sim.elapsed);
});
test('payment refusal stops collection once, never retries or resets credits',async t=>{
 const h=await collectionFixture(t),c=h.controller;let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('private',{status:402});});
 await c.armStudyRun();await c.alarm();assert.equal(c.record.study.stopReason,'provider-payment-required');assert.equal(c.record.study.status,'incomplete');assert.equal(c.record.ai.frames,0);
 const before=calls;h.advance(86400000);await c.alarm();assert.equal(calls,before);assert.equal(h.alarm(),null);assert.equal(c.record.sim.elapsed,0);
});
test('collection waits on transient overload and resumes the unchanged state',async t=>{
 const h=await collectionFixture(t),c=h.controller;let overload=true;t.mock.method(globalThis,'fetch',async(_url,opts)=>overload?new Response('',{status:529}):Response.json(response(JSON.parse(opts.body))));
 await c.armStudyRun();await c.alarm();assert.equal(c.record.ai.mode,'backoff');assert.equal(c.record.study.status,'running');assert.equal(c.record.sim.elapsed,0);assert.equal(c.record.ai.frames,0);assert.equal(c.record.frameRemaining,0);const callsBeforeRetry=h.calls.length;h.advance(2000);await c.alarm();assert.equal(h.calls.length,callsBeforeRetry);assert.equal(c.record.ai.mode,'backoff');assert.equal(c.record.sim.elapsed,0);
 overload=false;h.advance(61000);await c.alarm();assert.equal(c.record.ai.mode,'active');assert.equal(c.record.ai.frames,1);assert.equal(c.record.sim.elapsed,0,'the retried frame starts from the unchanged frozen state');
});
test('collection overload retries are bounded and never apply a failed frame',async t=>{
 const h=await collectionFixture(t),c=h.controller;t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429}));
 await c.armStudyRun();for(let attempt=0;attempt<7;attempt++){await c.alarm();h.advance(601000);}
 assert.equal(c.record.study.status,'incomplete');assert.equal(c.record.study.stopReason,'provider-or-contract-failure');assert.equal(c.record.ai.frames,0);assert.equal(c.record.sim.elapsed,0,'transient retry waits freeze simulated time');assert.equal(h.alarm(),null);
});

test('a frozen collection refuses to load when the deployed SIM_SPEED differs from its manifest',async t=>{
 await assert.rejects(collectionFixture(t,undefined,{SIM_SPEED:'10'}),/Frozen simulation speed mismatch/);
 await assert.rejects(collectionFixture(t,undefined,{SIM_SPEED:'2'},{simSpeed:1}),/Frozen simulation speed mismatch/);
 const h=await collectionFixture(t,undefined,{SIM_SPEED:'2'},{simSpeed:2});assert.equal(h.controller.record.study.status,'ready');
});
test('requests declare the expected decision delay measured from completed frames',async t=>{
 const h=await harness(t),c=h.controller;
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{h.calls.push(JSON.parse(opts.body));h.advance(4000);return Response.json(response(h.calls.at(-1)));});
 await c.heartbeat('viewer',1,true);await c.alarm();
 const first=h.calls[0].state.timing;assert.equal(first.expectedDecisionDelaySimSeconds,null);assert.equal(first.basis,'no-completed-frame');assert.equal(first.simSpeed,1);assert.equal(first.snapshotSimSeconds,0);
 assert.ok(c.record.ai.recentLatencyMs.length===1&&c.record.ai.recentLatencyMs[0]>=4000*(h.calls.length));
 const before=h.calls.length;h.advance(2000);await c.heartbeat('viewer',2,true);c.record.frameRemaining=0;c.record.ai.nextAt=0;await c.alarm();
 const later=h.calls[before].state.timing;assert.equal(later.basis,'median-recent-frame-latency');assert.equal(later.expectedDecisionDelaySimSeconds,Math.round(c.record.ai.recentLatencyMs[0]/100)/10);
 assert.match(h.calls[before].state.policy,/state\.timing/);
});
const operatorTarget=c=>({runId:c.record.study?.manifest.runId??null,experimentId:c.record.startedAt});
const emergencyStop=c=>c.emergencyStopRun(operatorTarget(c));
test('operator stop is durable, idempotent and cannot be undone by arm, viewers or alarm retry',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller;await c.alarm();
 const sim=structuredClone(c.record.sim),beforeCalls=h.calls.length;
 const first=await emergencyStop(c),head=(await c.researchData()).headSha256;
 assert.equal(first.ok,true);assert.equal(first.durable,true);assert.equal(c.record.study.stopReason,'operator-stop');
 const again=await emergencyStop(c);assert.equal(again.id,first.id);assert.equal((await c.researchData()).headSha256,head);
 await assert.rejects(c.armStudyRun(),/Operator stop/);
 await c.heartbeat('viewer-after-stop',1,true);await c.alarm();assert.equal(h.alarm(),null);
 assert.deepEqual(c.record.sim,sim);assert.equal(h.calls.length,beforeCalls);
 const reload=await harness(t,h.stored,{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(c.record.study.manifest),RESEARCH_RUN_ID:c.record.study.manifest.runId});
 await reload.controller.alarm();assert.equal(reload.calls.length,0);assert.equal(reload.controller.record.study.stopReason,'operator-stop');
 assert.equal((await reload.controller.snapshot()).running,false);assert.equal((await reload.controller.snapshot()).emergencyStop.id,first.id);
 assert.deepEqual(reload.controller.record.sim,sim);
});
test('operator stop before arm preserves zero exposure and never creates an evaluated study-stop event',async t=>{
 const h=await frozenFixtureHarness(t,10,false),c=h.controller;
 const bad=await c.emergencyStopRun({...operatorTarget(c),experimentId:-1});assert.equal(bad.ok,false);assert.equal(c.stopLatch,undefined);
 await emergencyStop(c);await assert.rejects(c.armStudyRun(),/Operator stop/);await c.alarm();
 assert.equal(h.calls.length,0);assert.equal(c.record.sim.elapsed,0);assert.equal(c.record.study.status,'incomplete');
 const events=(await journalEntries(c)).flatMap(e=>e.events);
 assert.equal(events.filter(e=>e.kind==='operator-stop-before-arm').length,1);assert.equal(events.filter(e=>e.kind==='study-stop').length,0);
});
test('stop interrupts a provider wait; a transport that ignores abort cannot apply its late reply',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller,initial=structuredClone(c.record.sim),pending=[];
 let started;const dispatched=new Promise(resolve=>{started=resolve;});
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{const request=JSON.parse(opts.body);h.calls.push(request);return new Promise(resolve=>{pending.push({resolve,request,signal:opts.signal});started();});});
 const alarm=c.alarm();await dispatched;const receipt=await emergencyStop(c);
 assert.equal(receipt.durable,true);assert.ok(pending.every(p=>p.signal.aborted));assert.equal(c.record.study.status,'incomplete');
 const count=pending.length;for(const p of pending)p.resolve(Response.json(response(p.request)));await alarm;
 assert.deepEqual(c.record.sim,initial);assert.equal(c.record.ai.frames,0);assert.equal(c.record.ai.mode,'study-stopped');
 assert.equal(c.record.study.accountedInputTokens,count*1000);assert.equal(c.record.budget.actualTokens,count*1000);
 const events=(await journalEntries(c)).flatMap(e=>e.events),stopIndex=events.findIndex(e=>e.kind==='study-stop');
 assert.ok(events.findIndex(e=>e.kind==='dispatch-outcomes')>stopIndex);assert.ok(!events.some(e=>e.kind==='application'));
 await c.alarm();assert.equal(h.calls.length,count);assert.equal(h.alarm(),null);
});
test('abort retains uncertain charges and cannot schedule a provider retry after stop',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller;let started;const dispatched=new Promise(resolve=>{started=resolve;});
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{h.calls.push(JSON.parse(opts.body));return new Promise((_resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});started();});});
 const alarm=c.alarm();await dispatched;const reserved=c.record.study.accountedInputTokens;await emergencyStop(c);await alarm;
 assert.equal(c.record.study.accountedInputTokens,reserved);assert.equal(c.record.budget.actualTokens,0);
 assert.equal(c.record.ai.stopReason,'operator-stop');assert.equal(c.record.emergencyStop.pendingDispatch,false);assert.equal(h.alarm(),null);
});
test('stop during intent persistence releases known-unsent reservations and prevents outbound dispatch',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller,commit=c.journal.commit.bind(c.journal);
 let entered,release;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 c.journal.commit=async(key,record,events)=>{const result=await commit(key,record,events);if(events.some(e=>e.kind==='dispatch-intent')){entered();await gate;}return result;};
 const alarm=c.alarm();await waiting;const stopped=emergencyStop(c);release();await Promise.all([alarm,stopped]);
 assert.equal(h.calls.length,0);assert.equal(c.record.ai.totalCalls,0);assert.equal(c.record.study.accountedInputTokens,0);
 assert.equal(c.record.sim.elapsed,0);assert.equal(c.record.ai.stopReason,'operator-stop');assert.equal(h.alarm(),null);
 assert.ok((await journalEntries(c)).flatMap(e=>e.events).some(e=>e.kind==='dispatch-cancelled'&&e.reason==='operator-stop-before-send'));
});
test('full journal cannot prevent the persistent emergency latch, and recovery remains stopped',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller;await c.alarm();
 const before=await c.researchData(),sim=structuredClone(c.record.sim);c.journal.maxBytes=before.totalBytes;
 const receipt=await emergencyStop(c);assert.equal(receipt.durable,true);assert.equal(receipt.journalStatus,'unavailable');
 assert.equal((await c.researchData()).headSha256,before.headSha256);assert.deepEqual(c.record.sim,sim);
 const reload=await harness(t,h.stored,{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(c.record.study.manifest),RESEARCH_RUN_ID:c.record.study.manifest.runId});
 await reload.controller.alarm();assert.equal(reload.calls.length,0);assert.equal((await reload.controller.snapshot()).running,false);
 assert.equal((await reload.controller.report()).evaluation.dataAvailability.fullDecisionJournal,false);
});
test('stop never acknowledges a failed latch write and a retry cannot unstop the in-memory run',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller,put=c.ctx.storage.put;let fail=true;
 c.ctx.storage.put=async(key,value)=>{if(key==='operator-stop-v1'&&fail){fail=false;throw Error('fixture-storage-unavailable');}return put(key,value);};
 await assert.rejects(emergencyStop(c),/storage-unavailable/);assert.equal((await c.snapshot()).running,false);
 await c.alarm();assert.equal(h.calls.length,0);const receipt=await emergencyStop(c);assert.equal(receipt.durable,true);
});
test('stop after reply but before frame commit fences the cloned commands and settles usage once',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller,sim=structuredClone(c.record.sim),persist=c.persist.bind(c);
 c.persist=async(next,events=[])=>{if(events.some(e=>e.kind==='frame-result'))await emergencyStop(c);return persist(next,events);};
 await c.alarm();assert.deepEqual(c.record.sim,sim);assert.equal(c.record.ai.frames,0);
 assert.equal(c.record.budget.actualTokens,h.calls.length*1000);assert.equal(c.record.study.accountedInputTokens,h.calls.length*1000);
 const events=(await journalEntries(c)).flatMap(e=>e.events);assert.equal(events.filter(e=>e.kind==='dispatch-outcomes').length,1);assert.ok(!events.some(e=>e.kind==='application'));
});
test('a disabled running study is displayed as paused and cannot take one more physics step',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller;await c.alarm();const elapsed=c.record.sim.elapsed,calls=h.calls.length;
 c.env.AI_ENABLED='false';h.advance(2000);await c.alarm();
 assert.equal(c.record.sim.elapsed,elapsed);assert.equal(h.calls.length,calls);assert.equal((await c.snapshot()).running,false);assert.equal(h.alarm(),null);
});
test('authenticated stop checks origin, fixed target body and identity without exposing its token',async()=>{
 const token='operator-stop-fixture-token-0123456789abcdef',target={runId:'unit-stop',experimentId:123};let calls=0;
 const env={STUDY_ARM_TOKEN:token,RESEARCH_RUN_ID:target.runId,AIRPORT:{getByName:()=>({emergencyStopRun:async supplied=>{calls++;return {ok:supplied.experimentId===123,stopped:true,durable:true,id:'fixture-stop'};}})}};
 const request=(body=target,authorization='Bearer '+token,origin='https://fixture.invalid')=>new Request('https://fixture.invalid/api/operator/stop',{method:'POST',headers:{authorization,'content-type':'application/json',Origin:origin},body:JSON.stringify(body)});
 for(const r of [request(target,'Bearer wrong'),request(target,'Bearer '+token,'https://foreign.invalid')])assert.equal((await worker.fetch(r,env)).status,403);
 for(const body of [null,{}, {...target,extra:'not-evidence'}, {...target,experimentId:'123'}, {...target,runId:'x'.repeat(400)}])assert.equal((await worker.fetch(request(body),env)).status,400);
 assert.equal(calls,0);assert.equal((await worker.fetch(request({...target,experimentId:456}),env)).status,409);
 const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes(token));
 assert.equal((await worker.fetch(new Request('https://fixture.invalid/api/operator/stop'),env)).status,404);
});
test('an exported stopped run replays exactly and remains an incomplete operator-stopped observation',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller;await c.alarm();h.advance(2000);await c.alarm();await emergencyStop(c);
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-stop-replay-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const meta=await c.researchData(),entries=[];
 for(let i=0;i<meta.nextSequence;i++){const d=await c.researchData(i);let text='';for(let j=0;j<d.chunkCount;j++)text+=(await c.researchData(i,j)).text;fs.writeFileSync(path.join(dir,String(i).padStart(8,'0')+'.json'),text);entries.push(d);}
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({meta,entries}));
 const {analyzeResearch}=await import('../scripts/lib/research-analysis.mjs'),result=await analyzeResearch(dir);
 assert.equal(result.stopReason,'operator-stop');assert.equal(result.prefixStatus,'incomplete');assert.equal(result.checkpoints,entries.length);
 assert.equal(result.commands.commands,c.record.sim.commandAudit.checkedCommands);
});
test('a crash after the durable latch but before state/journal completion recovers without inference',async t=>{
 const h=await frozenFixtureHarness(t,100),c=h.controller,put=c.ctx.storage.put;await c.alarm();
 c.journal.commit=async()=>{throw Error('fixture-journal-failure');};
 c.ctx.storage.put=async(key,value)=>{if(key==='airport-ltfm-v1'&&value.emergencyStop)throw Error('fixture-state-failure');return put(key,value);};
 await assert.rejects(emergencyStop(c),/state-failure/);const latch=h.stored.get('operator-stop-v1');assert.ok(latch);
 assert.equal(h.stored.get('airport-ltfm-v1').study.status,'running');
 const reload=await harness(t,h.stored,{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(c.record.study.manifest),RESEARCH_RUN_ID:c.record.study.manifest.runId});
 await reload.controller.alarm();assert.equal(reload.calls.length,0);assert.equal(reload.controller.record.study.stopReason,'operator-stop');
 assert.equal((await reload.controller.snapshot()).emergencyStop.id,latch.id);
});
