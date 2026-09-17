import test from 'node:test';import assert from 'node:assert/strict';
import {createAirborneSimulation,createSimulation,makePlan} from '../src/simulation.mjs';
import {batchPlans,buildRequest,InputEnvelopeError} from '../server/typesafe.mjs';
import {FIXES,PROCEDURES} from '../src/airport.mjs';
test('every offered HOLD and every runway retains geometry and unambiguous timing',()=>{
 const p=makePlan(createAirborneSimulation(0,42));for(const b of batchPlans(p)){
  const r=buildRequest(b,'jev-1.13.0');for(const rw of r.state.runways)assert.deepEqual(rw.thresholdNm.length,2);
  for(const f of b.flights)for(const key of Object.keys(f.routes))if(key.startsWith('HOLD_')){const h=r.state.holds.find(h=>h.fix===key.slice(5));assert.ok(h);assert.equal(h.positionNm.length,2);assert.ok(Number.isFinite(h.inboundTrueDeg));assert.equal(h.legTimingSeconds.above14000Ft,90);assert.equal(h.legSeconds,undefined);}
  for(const f of Object.values(r.state.aircraft)){assert.ok(f.type);assert.ok(f.performance.maxVerticalFpm>0);assert.ok('guidance' in f);}
 }
});
test('packing never changes allowed keys, omits a question or mutates the frozen plan',()=>{
 const p=makePlan(createAirborneSimulation(0,42)),before=JSON.stringify(p),raw=buildRequest(p,'jev-1.13.0').questions;
 const packed=batchPlans(p).flatMap(b=>Object.entries(buildRequest(b,'jev-1.13.0').questions));assert.equal(new Set(packed.map(([k])=>k)).size,Object.keys(raw).length);
 for(const [id,q] of packed)assert.deepEqual(Object.keys(q.criteria),Object.keys(raw[id].criteria));assert.equal(JSON.stringify(p),before);
});
test('dense input fails explicitly rather than dropping conflicts; invalid batch sizes cannot loop',()=>{
 const s=createSimulation(0,42),[x,y]=FIXES.GAZGE.point;for(const [i,f] of s.flights.slice(50).entries())Object.assign(f,{x:x+i*.001,y,altitude:6000});
 assert.throws(()=>batchPlans(makePlan(s)),InputEnvelopeError);for(const n of [0,-1,NaN,1.5,Infinity])assert.throws(()=>batchPlans(makePlan(s),n),RangeError);
});
