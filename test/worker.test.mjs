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
test('failure pauses instead of local ATC; partial batch usage settles and unknown charge stays reserved',async t=>{
 const h=await harness(t),c=h.controller,expected=expectedFrameCalls(c);let index=0;
 t.mock.method(globalThis,'fetch',async(_url,opts)=>{index++;if(index===2)return new Response('private provider detail',{status:429});return Response.json(response(JSON.parse(opts.body)));});
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.ai.mode,'backoff');assert.equal(c.record.frameRemaining,0);assert.equal(c.record.sim.stats.aiApplied,0);
 assert.ok(c.record.budget.tokens>(expected-1)*1000);assert.equal(c.record.budget.actualTokens,(expected-1)*1000);
 h.advance(5000);await c.alarm();assert.equal(c.record.sim.elapsed,0);assert.equal(index,expected);
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
 assert.ok(evidence);assert.equal(evidence.version,1);assert.equal(evidence.planRevision,0);
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
 assert.equal(next.record.sim.controlEpoch.policy,'jev-command-observe-v1');
 assert.equal(next.record.sim.controlEpoch.previousPolicy,'procedure-target-repair-v1');
 assert.equal(next.record.sim.controlEpoch.elapsed,123);
 assert.deepEqual(next.record.sim.controlEpoch.baseline,before.sim.stats);
 const report=await next.report();assert.equal(report.pilotControlPolicy,'jev-command-observe-v1');
 assert.equal(report.stats.collisions,2);assert.equal(report.controlEpochStats.collisions,0);
 assert.equal((await next.snapshot()).pilotControlPolicy,'jev-command-observe-v1');
 const epoch=structuredClone(next.record.sim.controlEpoch);
 const again=await harness(t,h.stored);assert.deepEqual(again.controller.record.sim.controlEpoch,epoch);
 assert.equal(again.calls.length,0);
});
test('new evidence identifies observational execution without rewriting original answers',async t=>{
 const h=await harness(t);await h.controller.heartbeat('viewer',1,true);await h.controller.alarm();
 const last=h.controller.record.ai.last;
 assert.equal(last.evidence.controlPolicy,'jev-command-observe-v1');assert.equal(last.applied,100);
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
 assert.equal(e.promptVersion,'jev-atc-airborne-observe-v2');assert.equal(e.contextVersion,'compact-state-geometry-v2');assert.equal(e.requests.length,h.calls.length);
 e.requests.forEach((b,index)=>{assert.equal(b.requestSha256,createHash('sha256').update(JSON.stringify(h.calls[index])).digest('hex'));assert.equal(b.requestedModel,h.calls[index].model);assert.equal(b.returnedModel,'jev-1.13.0');assert.equal(b.inputTokens,1000);});
 assert.equal(JSON.stringify(report).includes('fixture-only'),false);
 const before=structuredClone(report.evaluation),reloaded=await harness(t,h.stored);
 assert.equal(reloaded.calls.length,0);assert.deepEqual((await reloaded.controller.report()).evaluation,before);
});

async function journalEntries(c){const meta=await c.researchData(),entries=[];for(let i=0;i<meta.nextSequence;i++){const d=await c.researchData(i);let text='';for(let j=0;j<d.chunkCount;j++)text+=(await c.researchData(i,j)).text;entries.push(JSON.parse(text));}return entries;}
test('airborne controller never asks pending ground identities and archives every applied command',async t=>{
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only'}),c=h.controller;await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.sim.trafficScope,'airborne-handoff-v1');assert.equal(c.record.ai.last.aircraft,51);assert.equal(c.record.ai.last.questions,204);assert.equal(c.record.ai.last.applied,51);
 const ground=new Set(c.record.sim.flights.filter(f=>f.phase==='pending').map(f=>f.id));for(const r of h.calls)for(const id of Object.keys(r.questions))assert.ok(!ground.has(id.split('_')[0]));
 const entries=await journalEntries(c),commands=entries.flatMap(e=>e.events.filter(e=>e.kind==='application').flatMap(e=>e.events.filter(e=>e.kind==='command-applied')));
 assert.equal(commands.length,51);assert.equal(new Set(commands.map(e=>e.command.id)).size,51);
 assert.equal((await c.report()).evaluation.byScope.ground.checkedCommands,0);assert.equal((await c.report()).evaluation.dataAvailability.fullDecisionJournal,true);
 const before=await c.researchData(),calls=h.calls.length;await c.report();await c.researchData(0,0);assert.deepEqual(await c.researchData(),before);assert.equal(h.calls.length,calls);
});
test('oversized input is visible, does not spend credits and does not retry the same frozen state',async t=>{
 const h=await harness(t),c=h.controller,{FIXES}=await import('../src/airport.mjs'),[x,y]=FIXES.GAZGE.point;
 for(const [i,f] of c.record.sim.flights.slice(50).entries())Object.assign(f,{x:x+i*.001,y,altitude:6000});
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
 const m={status:'frozen-local',runId:'test-frozen',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),stopping:{targetSimulatedSeconds:1,maxWallSeconds:60,maxTotalInputTokens:1000000,stopForFavorableResults:false}};
 const h=await harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(m),RESEARCH_RUN_ID:m.runId}),c=h.controller;
 await c.heartbeat('viewer',1,true);await c.alarm();h.advance(2000);await c.alarm();assert.equal(c.record.sim.elapsed,1);assert.equal(c.record.ai.mode,'study-stopped');assert.equal(c.record.study.status,'completed');
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

async function frozenFixtureHarness(t,targetSimulatedSeconds=10){
 const {createAirborneSimulation}=await import('../src/simulation.mjs'),{runtimeVersions,initialStateFingerprint,provenance}=await import('../server/study-run.mjs');
 const m={status:'frozen-local',runId:'freeze-edge',scope:'airborne-handoff-v1',seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(createAirborneSimulation(0,42)),stopping:{targetSimulatedSeconds,maxWallSeconds:60,maxTotalInputTokens:1000000,stopForFavorableResults:false}};
 return harness(t,new Map(),{SIM_SCOPE:'airborne-only',RUN_MANIFEST_JSON:JSON.stringify(m),RESEARCH_RUN_ID:m.runId});
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
 for(const [i,f] of c.record.sim.flights.slice(50).entries())Object.assign(f,{x:x+i*.001,y,altitude:6000});
 await c.heartbeat('viewer',1,true);await c.alarm();
 assert.equal(c.record.study.status,'incomplete');assert.equal(c.record.study.stopReason,'input-too-large');assert.equal(h.calls.length,0);
 const entries=await journalEntries(c);assert.ok(entries.flatMap(e=>e.events).some(e=>e.kind==='study-stop'&&e.reason==='input-too-large'));
});
