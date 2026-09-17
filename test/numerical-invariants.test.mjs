import test from 'node:test';import assert from 'node:assert/strict';
import {createAirborneSimulation,makePlan,applyFleetDecision,advanceSimulation,predictedConflicts} from '../src/simulation.mjs';
import {ALTITUDES,SPEEDS,RATES} from '../src/airport.mjs';
const finiteKeys=['x','y','altitude','speed','heading','verticalRate','groundSpeed','trueAirspeed','bank'];
function generator(seed){let x=(seed||1)>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
function pick(values,rnd){return values[Math.floor(rnd()*values.length)];}
function assertFinite(sim){
 assert.equal(new Set(sim.flights.map(f=>f.id)).size,100);for(const f of sim.flights){for(const key of finiteKeys)assert.ok(Number.isFinite(f[key]??0),f.id+' '+key);assert.ok(Number.isFinite(f.age)&&f.age>=0);if(f.command)for(const key of ['altitude','speed','rate'])assert.ok(Number.isFinite(f.command[key]));}
 for(const value of Object.values(sim.stats))assert.ok(Number.isFinite(value)&&value>=0);assert.doesNotThrow(()=>predictedConflicts(sim.flights,5));
}
test('valid but adversarial bounded commands never create NaN/Infinity or corrupt identities',()=>{
 for(let seed=1;seed<=25;seed++){const sim=createAirborneSimulation(0,seed),rnd=generator(seed^0x9e3779b9);let prior=sim.elapsed;
  for(let frame=0;frame<12;frame++){const plan=makePlan(sim),answers={};for(const f of plan.flights){answers[f.id+'_route']={choice:pick(Object.keys(f.routes),rnd)};answers[f.id+'_altitude']={choice:String(pick(ALTITUDES,rnd))};answers[f.id+'_speed']={choice:String(pick(SPEEDS,rnd))};answers[f.id+'_rate']={choice:String(pick(RATES,rnd))};}for(const r of plan.runways)answers['runway_'+r.id]={choice:'wait'};
   const applied=applyFleetDecision(sim,plan,answers);assert.equal(applied.rejected,0);advanceSimulation(sim,10);assert.ok(sim.elapsed>=prior);prior=sim.elapsed;assertFinite(sim);
  }
 }
});
