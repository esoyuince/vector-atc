import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotStep,holdingEntry,trueAirspeed} from '../src/pilot.mjs';
import {createSimulation,predictedConflicts,telemetry} from '../src/simulation.mjs';
import {AIRPORT,FIXES,navigation} from '../src/airport.mjs';
function aircraft(route='HOLD_GAZGE'){
 const f=createSimulation(0,42).flights[50];
 [f.x,f.y]=FIXES.GAZGE.point;f.altitude=6000;f.speed=200;f.heading=272.1;f.verticalRate=0;
 f.command={route,altitude:6000,speed:200,rate:1000,navigation:navigation(f,route,200)};return f;
}
test('left/right holding entry sectors mirror and all entries establish repeatable laps',()=>{
 for(const h of AIRPORT.holds.slice(0,3))for(const [relative,entry] of [[0,'direct'],[-100,'parallel'],[150,'teardrop']]){
  const f=aircraft();[f.x,f.y]=FIXES[h.fix].point;
  f.heading=(h.inboundMag+AIRPORT.variation+relative*(h.turn==='R'?1:-1)+360)%360;
  assert.equal(holdingEntry(h.inboundMag+AIRPORT.variation,f.heading,h.turn),entry);
  const route='HOLD_'+h.fix;f.command={route,altitude:6000,speed:200,rate:1000,navigation:navigation({...f,command:null},route,200)};
  for(let i=0;i<1500;i++){pilotStep(f,1);assert.ok(Math.abs(f.bank)<=25);assert.ok(Math.hypot(f.x-FIXES[h.fix].point[0],f.y-FIXES[h.fix].point[1])<12);}
  assert.ok(f.pilot.laps>=3,JSON.stringify({fix:h.fix,entry,pilot:f.pilot}));
 }
});
test('hold timing changes above 14000, release follows new ATC route, and physics ramps',()=>{
 const f=aircraft();f.altitude=15000;f.command.altitude=15000;pilotStep(f,1);assert.equal(f.pilot.legSeconds,90);
 f.command={route:'VECTOR_N',altitude:16000,speed:250,rate:1000,navigation:navigation(f,'VECTOR_N',250)};
 const before={speed:f.speed,altitude:f.altitude};pilotStep(f,1);
 assert.ok(f.speed-before.speed<=.61);assert.ok(Math.abs(f.verticalRate)<=150);assert.ok(f.altitude-before.altitude<=2.5);assert.equal(f.pilot.mode,'route');
 for(let i=0;i<300;i++)pilotStep(f,1);
 assert.equal(f.altitude,16000);assert.equal(f.verticalRate,0);assert.equal(f.command.altitude,16000);
 assert.ok(trueAirspeed(200,15000)>200);
});
test('initial telemetry exposes assigned next leg and trajectory prediction is read-only',()=>{
 const f=aircraft('VECTOR_E'),g=aircraft('VECTOR_W');g.id='TEST2';f.x=-1;g.x=1;f.heading=90;g.heading=270;
 for(const a of [f,g])a.command.navigation=navigation({...a,command:null},a.command.route,200);
 const before=JSON.stringify([f,g]);assert.ok(predictedConflicts([f,g]).some(c=>c.critical&&c.seconds<45));assert.equal(JSON.stringify([f,g]),before);
 const initial=createSimulation(0,2940039836).flights[50];assert.ok(telemetry(initial).trueAirspeedKt>telemetry(initial).speedKt);assert.ok(telemetry(initial).procedure.nextLeg);assert.ok(telemetry(initial).procedure.distanceToNextNm>0);
});
test('stationary touchdown participant is included for imminent runway conflict but expires after respawn time',()=>{
 const a=aircraft('VECTOR_E'),b=aircraft('VECTOR_W');b.id='LANDING';b.phase='landing';b.age=0;b.x=a.x+.1;b.y=a.y;b.command=null;
 assert.ok(predictedConflicts([a,b]).some(c=>c.critical&&c.seconds===0));
 b.x=a.x+2;a.heading=90;a.command.navigation=navigation({...a,command:null},'VECTOR_E',200);
 assert.equal(predictedConflicts([a,b]).some(c=>c.critical),false);
});
