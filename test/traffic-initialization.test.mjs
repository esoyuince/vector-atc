import test from 'node:test';
import assert from 'node:assert/strict';
import {AIRPORT} from '../src/airport.mjs';
import {createAirborneSimulation,makePlan,applyFleetDecision,advanceSimulation} from '../src/simulation.mjs';

test('seeded upstream arrivals are inside the measured sector, with explicit unresolved-separation labels',()=>{
 for(let seed=1;seed<=100;seed++){
  const sim=createAirborneSimulation(0,seed);
  for(const f of sim.flights.filter(f=>f.phase==='arrival')){
   assert.ok(Math.hypot(f.x,f.y)<AIRPORT.sectorRadiusNm,'outside sector: seed '+seed+' '+f.id);
   assert.equal(typeof f.initialCondition.initialSeparationUnresolved,'boolean');
  }
 }
});
test('first airborne frame does not produce sector violations caused by initial placement',()=>{
 for(const seed of [1,42,100,2940039836]){
  const sim=createAirborneSimulation(0,seed),plan=makePlan(sim);
  const answers=Object.fromEntries(plan.flights.flatMap(p=>{
   const f=sim.flights.find(f=>f.id===p.id);
   return [['route',f.mission==='arrival'?f.arrival:f.requestedDeparture],['altitude','18000'],['speed','250'],['rate','1500']].map(([k,choice])=>[f.id+'_'+k,{choice}]);
  }));
  applyFleetDecision(sim,plan,answers);advanceSimulation(sim,1);
  assert.equal(sim.stats.sectorViolations,0,'seed '+seed);
 }
});
test('airborne initialization remains exactly seeded and has no hidden unseeded draw',()=>{
 assert.deepEqual(createAirborneSimulation(0,42),createAirborneSimulation(0,42));
 assert.notDeepEqual(createAirborneSimulation(0,42).flights,createAirborneSimulation(0,43).flights);
});
