import test from 'node:test';import assert from 'node:assert/strict';
import {createAirborneSimulation,createSimulation,makePlan,applyFleetDecision,advanceSimulation} from '../src/simulation.mjs';
import {AIRBORNE_SCOPE,enableAirborneScope,releaseDepartures} from '../src/traffic-lifecycle.mjs';
import {buildRequest} from '../server/typesafe.mjs';
function answer(p){return Object.fromEntries(Object.entries(buildRequest(p,'jev-1.13.0').questions).map(([id,q])=>[id,{choice:id.startsWith('runway_')?'wait':id.endsWith('_route')?Object.keys(q.criteria)[0]:id.endsWith('_altitude')?'18000':id.endsWith('_speed')?'250':'1500'}]));}
test('airborne scenario preserves 100 identities but has no ground command questions',()=>{
 const s=createAirborneSimulation(0,42),p=makePlan(s),r=buildRequest(p,'jev-1.13.0');assert.equal(s.flights.length,100);assert.equal(s.trafficScope,AIRBORNE_SCOPE);
 assert.equal(s.flights.filter(f=>f.phase==='pending').length,49);assert.equal(p.flights.length,51);assert.equal(Object.keys(r.questions).filter(id=>!id.startsWith('runway_')).length,204);
 for(const f of s.flights.filter(f=>f.phase==='pending'))assert.ok(!Object.keys(r.questions).some(k=>k.startsWith(f.id+'_')));
 assert.equal(s.stats.takeoffs,0);assert.equal(s.stats.departureHandoffs,1);
});
test('fixed seed/gates/schedule reproduce and initial commands are not falsely attributed to Jev',()=>{
 const a=createAirborneSimulation(0,42),b=createAirborneSimulation(0,42);assert.deepEqual(a,b);for(const f of a.flights)assert.equal(f.command,null);
 for(const f of a.flights.filter(f=>f.mission==='arrival'))assert.equal(f.progress[f.arrival],0);
});
test('handoff pauses evolution for a fresh decision rather than hovering silently to next timer',()=>{
 const s=createAirborneSimulation(0,42);advanceSimulation(s,10);assert.equal(s.elapsed,0);
 const p=makePlan(s);applyFleetDecision(s,p,answer(p));assert.equal(s.requiresDecision,false);
 advanceSimulation(s,60);assert.ok(s.requiresDecision);const at=s.elapsed;advanceSimulation(s,30);assert.equal(s.elapsed,at);
 assert.ok(makePlan(s).flights.some(f=>!s.flights.find(a=>a.id===f.id).command));
});
test('scope migration preserves counters and live flights, schedules only ground identities once',()=>{
 const s=createSimulation(0,42);s.stats.collisions=4;s.elapsed=100;const arrival=structuredClone(s.flights[50]);
 assert.equal(enableAirborneScope(s,1234),true);releaseDepartures(s);assert.equal(s.stats.collisions,4);assert.deepEqual(s.flights[50],arrival);assert.equal(enableAirborneScope(s,5555),false);assert.equal(s.trafficEpoch.elapsed,100);
});
