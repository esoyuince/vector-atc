import test from 'node:test';
import assert from 'node:assert/strict';
import {AIRPORT,RUNWAYS,ACTIVE_RUNWAYS,FIXES,PROCEDURES,project,unproject,holdPath,navigation} from '../src/airport.mjs';
import {createSimulation,advanceSimulation,makePlan,recordIncident} from '../src/simulation.mjs';
import {batchPlans,buildRequest} from '../server/typesafe.mjs';
test('published subset is connected, projected consistently and has closed holds',()=>{
 assert.equal(RUNWAYS.length,5);assert.equal(ACTIVE_RUNWAYS.length,3);
 assert.equal(Object.keys(PROCEDURES).length,20);assert.equal(AIRPORT.holds.length,6);
 for(const p of Object.values(PROCEDURES))for(const leg of p.legs)assert.ok(FIXES[leg.fix],p.id+':'+leg.fix);
 const ll=unproject(...project(41.2,28.9));assert.ok(Math.abs(ll[0]-41.2)<1e-9);assert.ok(Math.abs(ll[1]-28.9)<1e-9);
 assert.equal(PROCEDURES.RIXEN1P.legs.find(l=>l.fix==='FM458').altitude,10000);
 for(const h of AIRPORT.holds){const points=holdPath(h.fix);assert.deepEqual(points[0],points.at(-1));assert.ok(points.every(p=>p.every(Number.isFinite)));}
});
test('waypoint crossing records violations with bounded pilot response and retains progress',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 const f=s.flights[50];f.phase='arrival';f.arrival='RIXEN1P';f.progress.RIXEN1P=0;
 [f.x,f.y]=FIXES.RIXEN.point;f.altitude=22000;f.speed=280;
 f.command={route:'RIXEN1P',altitude:22000,speed:280,rate:500,navigation:navigation(f,'RIXEN1P',280)};
 advanceSimulation(s,1);assert.equal(f.command.navigation.index,1);assert.ok(f.altitude<22000&&f.altitude>21990);assert.equal(f.command.altitude,22000);
 assert.equal(s.stats.altitudeViolations,1);assert.equal(s.stats.speedViolations,1);
 assert.equal(navigation(f,'RIXEN1P',280).index,1);
});
test('full-fleet request reservations fit per-request envelope in ground and airborne scenarios',()=>{
 for(const airborne of [false,true]){
  const s=createSimulation();if(airborne)for(const f of s.flights)if(f.phase==='taxi_out')f.phase='departure';
  for(const p of batchPlans(makePlan(s)))assert.ok(Buffer.byteLength(JSON.stringify(buildRequest(p,'jev-1.13.0')))+4096<=80000);
 }
});

test('early ILS descent is measured without changing the unsafe target',()=>{
 const s=createSimulation();for(const f of s.flights)f.phase='taxi_out';
 const f=s.flights[50];f.phase='approach';f.lane=0;[f.x,f.y]=FIXES.GAZGE.point;f.altitude=2000;
 const route='ILS_16R_GAZGE';f.command={route,altitude:202,speed:220,rate:500,navigation:navigation(f,route,220)};
 advanceSimulation(s,1);assert.ok(s.incidents.some(i=>i.rule==='descent below FAP level before crossing FAP'));
 assert.equal(f.command.altitude,202);assert.ok(f.altitude>2000);assert.ok(f.pilot.unable.length>0);assert.ok(f.pilot.targetAltitude>=3000);
});

test('SID gradient applies during commanded climb, not cleared level flight',()=>{
 for(const target of [3000,6000]){
  const s=createSimulation();for(const a of s.flights)a.phase='taxi_out';
  const f=s.flights[0];f.phase='departure';f.altitude=3000;f.speed=220;
  const route=f.requestedDeparture;f.command={route,altitude:target,speed:220,rate:1000,navigation:navigation(f,route,220)};
  advanceSimulation(s,1);assert.equal(s.incidents.some(i=>i.rule==='SID climb gradient'),target===6000);
 }
});
test('maximum incident window preserves participant IDs with bounded command evidence below SQLite value limit',()=>{
 const s=createSimulation(),ids=s.flights.map(f=>f.id);
 const commands=s.flights.map(f=>({route:'HOLD_GAZGE',altitude:6000,speed:220,rate:1500,navigation:navigation(f,'HOLD_GAZGE',220)}));
 for(let i=0;i<220;i++)recordIncident(s,'collision',ids,{commands});
 assert.equal(s.incidents.length,200);assert.equal(s.events.length,100);
 assert.equal(s.incidents[0].aircraft.length,100);assert.equal(s.incidents[0].commandCount,100);assert.equal(s.incidents[0].commands.length,10);
 assert.ok(!JSON.stringify(s.incidents).includes('navigation'));
 assert.ok(Buffer.byteLength(JSON.stringify(s))<1000000);
});
