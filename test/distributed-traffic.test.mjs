import test from 'node:test';
import assert from 'node:assert/strict';
import {createAirborneSimulation,makePlan,applyFleetDecision} from '../src/simulation.mjs';
import {PROCEDURES,FIXES,navigation,routeOptions} from '../src/airport.mjs';
import {initializeDistributedTraffic,queueDistributedTraffic,releaseDistributedTraffic,DISTRIBUTED_TRAFFIC} from '../src/traffic-scenario.mjs';
const flying=s=>s.flights.filter(f=>f.phase!=='pending');
test('100 identities start in multiple route phases, not two gate crowds',()=>{
 const s=createAirborneSimulation(0,42),a=flying(s);
 assert.equal(s.flights.length,100);assert.equal(a.length,36);
 assert.equal(a.filter(f=>f.phase==='approach').length,6);assert.equal(a.filter(f=>f.phase==='departure').length,12);
 assert.equal(s.flights.filter(f=>f.phase==='pending'&&f.mission==='arrival').length,26);
 assert.equal(s.flights.filter(f=>f.phase==='pending'&&f.mission==='departure').length,38);
 assert.equal(new Set(a.map(f=>f.initialCondition.route)).size,14);
 assert.ok(new Set(a.map(f=>f.speed)).size>12);
 assert.ok(Math.max(...a.map(f=>f.altitude))-Math.min(...a.map(f=>f.altitude))>10000);
 assert.ok(a.some(f=>f.verticalRate<0)&&a.some(f=>f.verticalRate>0));
 assert.equal(s.stats.aiApplied,0);assert.ok(s.flights.every(f=>f.command===null));
 assert.equal(makePlan(s).flights.length,36);
});
test('warm-start route, next fix and approach permission are scenario data, never Jev decisions',()=>{
 const s=createAirborneSimulation(0,42);
 for(const f of flying(s)){
  const route=f.initialCondition.route,n=navigation(f,route,f.speed);
  assert.ok(Object.hasOwn(routeOptions(f),route));assert.equal(n.index,f.initialCondition.nextIndex);
  assert.equal(n.joining,false);assert.equal(f.lastSource,'scenario');
  if(f.phase==='approach')assert.equal(f.landingClearance,PROCEDURES[route].runway);
 }
});
test('seed sweep has no initial measured separation breach and does not discard a seed',()=>{
 for(let seed=1;seed<=500;seed++){
  const s=createAirborneSimulation(0,seed),a=flying(s);
  assert.equal(a.length,36);
  for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)assert.ok(Math.abs(a[i].altitude-a[j].altitude)>=1000||Math.hypot(a[i].x-a[j].x,a[i].y-a[j].y)>=3,'seed '+seed);
  assert.ok(a.every(f=>Math.hypot(f.x,f.y)<109.5));
 }
});
test('arrival and departure demand have distinct seeded, non-periodic future schedules',()=>{
 const a=createAirborneSimulation(0,42),b=createAirborneSimulation(0,42);assert.deepEqual(a,b);
 for(const mission of ['arrival','departure']){
  const pending=a.flights.filter(f=>f.phase==='pending'&&f.mission===mission).sort((a,b)=>a.releaseAt-b.releaseAt),bounds=mission==='arrival'?[75,150]:[90,165];
  let previous=0;const gaps=[];
  for(const f of pending){const gap=f.releaseAt-previous;assert.ok(gap>=bounds[0]&&gap<=bounds[1]);gaps.push(gap);previous=f.releaseAt;}
  assert.ok(new Set(gaps).size>5);
 }
});
test('newly applied unsafe numeric targets are not repaired by traffic initialization',()=>{
 const s=createAirborneSimulation(0,42),plan=makePlan(s);
 const answers=Object.fromEntries(plan.flights.flatMap(p=>{const f=s.flights.find(f=>f.id===p.id);return [['route',f.initialCondition.route],['altitude','0'],['speed','300'],['rate','2500']].map(([key,choice])=>[f.id+'_'+key,{choice}]);}));
 applyFleetDecision(s,plan,answers);
 for(const f of flying(s)){assert.equal(f.command.altitude,0);assert.equal(f.command.speed,300);assert.equal(f.command.navigation.index,f.initialCondition.nextIndex);}
});
test('initial population cannot be reapplied to an existing scenario or elapsed run',()=>{
 const s=createAirborneSimulation(0,42);assert.throws(()=>initializeDistributedTraffic({...s,elapsed:1}),/fresh untouched/);
});
test('blocked entry keeps incumbents unchanged, logs delay, then admits without a catch-up burst',()=>{
 const s=createAirborneSimulation(0,42),queue=s.flights.filter(f=>f.phase==='pending'&&f.mission==='arrival').sort((a,b)=>a.releaseAt-b.releaseAt),f=queue[0],next=queue[1];
 const blocker=s.flights.find(a=>a.phase==='arrival');
 for(const a of s.flights)if(a!==blocker&&a!==f&&a!==next)a.phase='crashed';
 Object.assign(blocker,{x:f.x,y:f.y,altitude:f.altitude});s.elapsed=f.releaseAt;
 const before=structuredClone(blocker);assert.deepEqual(releaseDistributedTraffic(s),[]);assert.deepEqual(blocker,before);
 assert.equal(f.phase,'pending');assert.equal(f.admissionAttempts,1);assert.equal(s.trafficScenario.admissionDeferrals,1);
 assert.ok(s.events.some(e=>e.code==='traffic-admission-deferred'));
 blocker.phase='crashed';s.elapsed=next.releaseAt+50;
 assert.deepEqual(releaseDistributedTraffic(s),[f.id]);assert.equal(f.initialCondition.admissionDelaySeconds,s.elapsed-f.releaseAt);
 f.phase='crashed';s.elapsed+=1;assert.deepEqual(releaseDistributedTraffic(s),[]);
 s.elapsed+=next.scheduledGapSeconds;assert.deepEqual(releaseDistributedTraffic(s),[next.id]);
 assert.equal(s.stats.arrivalHandoffs,2);assert.equal(s.stats.aiApplied,0);
});
test('recycled arrival and departure identities are queued rather than teleported into active traffic',()=>{
 const s=createAirborneSimulation(0,42);
 for(const mission of ['arrival','departure']){
  const f=s.flights.find(f=>f.mission===mission&&f.phase!=='pending');s.elapsed=120;
  queueDistributedTraffic(s,f);assert.equal(f.phase,'pending');assert.ok(f.releaseAt>s.elapsed);
  assert.equal(f.command,null);assert.equal(f.initialCondition,null);assert.equal(f.landingClearance,null);
 }
 assert.throws(()=>initializeDistributedTraffic(s),/fresh untouched/);
});
