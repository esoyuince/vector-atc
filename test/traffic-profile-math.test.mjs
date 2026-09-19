import test from 'node:test';
import assert from 'node:assert/strict';
import {initialRouteProfile} from '../src/traffic-profile.mjs';
const runway={elevation:200};
const path={total:40,distances:[0,10,20,30,40]};
test('unconstrained intermediate samples interpolate between anchors without a valley',()=>{
 const p={id:'synthetic-profile',kind:'APP',legs:[{altitude:5000,speed:220},{},{altitude:3000,speed:180},{},{}]};
 const before=structuredClone(p),values=initialRouteProfile(p,path,runway);
 assert.deepEqual(values.map(v=>v.altitude),[5000,4000,3000,1600,200]);
 assert.deepEqual(p,before);
});
test('later lower bounds prevent premature descent in initial profile',()=>{
 const p={id:'bounded-profile',kind:'APP',legs:[{minAltitude:4000,maxAltitude:5000,speed:220},{},{},{altitude:4000,speed:180},{}]};
 const v=initialRouteProfile(p,path,runway);
 assert.ok(v.slice(0,4).every(x=>x.altitude>=4000));assert.equal(v.at(-1).altitude,200);
});
test('incompatible monotone anchors fail explicitly instead of silently relaxing bounds',()=>{
 const p={id:'incompatible',kind:'APP',legs:[{altitude:3000},{},{altitude:5000},{},{}]};
 assert.throws(()=>initialRouteProfile(p,path,runway),/Incompatible/);
 assert.throws(()=>initialRouteProfile(p,{total:0,distances:[]},runway),/Invalid/);
});
import {PROCEDURES,RUNWAYS,ACTIVE_RUNWAYS} from '../src/airport.mjs';
import {scenarioRouteProfile} from '../src/traffic-scenario.mjs';
import {createAirborneSimulation} from '../src/simulation.mjs';
test('every frozen route profile preserves its bounds and direction',()=>{
 for(const p of Object.values(PROCEDURES).filter(p=>['APP','STAR','SID'].includes(p.kind))){
  const lane=RUNWAYS.findIndex(r=>r.id===(p.runway??ACTIVE_RUNWAYS[0].id)),values=scenarioRouteProfile(p,lane);
  for(let i=0;i<values.length;i++){
   const v=values[i],leg=p.legs[i];
   for(const field of ['altitude','speed']){
    assert.ok(Number.isFinite(v[field]),p.id);
    if(leg[field]!=null)assert.ok(Math.abs(v[field]-leg[field])<1e-8,p.id+' '+leg.fix+' '+field);
    if(i)assert.ok(p.kind==='SID'?v[field]>=values[i-1][field]-1e-8:v[field]<=values[i-1][field]+1e-8,p.id+' reversal');
   }
   if(leg.minAltitude!=null)assert.ok(v.altitude>=leg.minAltitude-1e-8);
   if(leg.maxAltitude!=null)assert.ok(v.altitude<=leg.maxAltitude+1e-8);
   if(leg.maxSpeed!=null)assert.ok(v.speed<=leg.maxSpeed+1e-8);
  }
  if(p.kind==='APP'){
   const index=p.legs.findIndex(l=>l.fix===p.fap),floor=p.legs[index].altitude;
   assert.ok(values.slice(0,index+1).every(v=>v.altitude>=floor));
   assert.equal(values.at(-1).altitude,RUNWAYS[lane].elevation);
  }
 }
});
test('sampled initial approach states never require climb or begin below their pre-FAP floor',()=>{
 for(let seed=0;seed<100;seed++){
  const s=createAirborneSimulation(0,seed);
  for(const f of s.flights.filter(f=>f.phase==='approach')){
   const p=PROCEDURES[f.initialCondition.route],index=p.legs.findIndex(l=>l.fix===p.fap);
   assert.ok(f.verticalRate<=0,p.id+' seed '+seed);
   if(f.initialCondition.nextIndex<=index)assert.ok(f.altitude>=p.legs[index].altitude,p.id+' floor');
  }
  for(const f of s.flights.filter(f=>f.phase==='departure')){
   assert.ok(f.verticalRate>=0);
   if(f.altitude<8000)assert.ok(f.verticalRate*60/f.groundSpeed>=329,'nominal initial climb');
  }
 }
});
