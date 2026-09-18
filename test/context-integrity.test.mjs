import test from 'node:test';import assert from 'node:assert/strict';
import {createAirborneSimulation,createSimulation,makePlan} from '../src/simulation.mjs';
import {batchPlans,buildRequest,InputEnvelopeError,TYPESAFE_CONTEXT_VERSION} from '../server/typesafe.mjs';
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
test('context v3 carries corrected hold-speed and SID-gradient source provenance',()=>{
 assert.equal(TYPESAFE_CONTEXT_VERSION,'compact-state-geometry-v3');const plan=makePlan(createAirborneSimulation(0,42)),requests=batchPlans(plan).map(b=>buildRequest(b,'jev-1.13.0')),holds=new Map(),procedures=new Map();
 for(const r of requests){for(const h of r.state.holds)holds.set(h.fix,h);for(const [id,p] of Object.entries(r.state.procedures))procedures.set(id,p);}
 for(const [fix,source] of [['FM166','IAC_13'],['IRDED','IAC_15'],['TIBNU','IAC_17']]){const h=holds.get(fix);assert.ok(h,fix);assert.equal(h.maxSpeed,230);assert.equal(h.source,source);}
 for(const fix of ['GAZGE','INSTA','ULQAL']){const h=holds.get(fix);assert.ok(h,fix);assert.equal(h.maxSpeed,undefined);}
 const sids=[...procedures.values()].filter(p=>p.kind==='SID');assert.ok(sids.length);assert.ok(sids.every(p=>p.gradientSource==='SID_01'&&p.source==='SID_01_A'));
});
