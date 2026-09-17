import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotStep} from '../src/pilot.mjs';
import {createSimulation,advanceSimulation,makePlan,applyFleetDecision,predictedConflicts,experimentReport} from '../src/simulation.mjs';
import {AIRPORT,FIXES,PROCEDURES,RUNWAYS,navigation,offset} from '../src/airport.mjs';
import {buildRequest,validateResponse} from '../server/typesafe.mjs';

function aircraft(route,changes={}){
 const f=createSimulation(0,42).flights[50];
 Object.assign(f,{type:'B738',phase:'arrival',lane:0,altitude:6000,speed:220,heading:90,verticalRate:0,bank:0},changes);
 [f.x,f.y]=FIXES.ULQAL.point;
 f.command={route,altitude:f.altitude,speed:f.speed,rate:1000,navigation:navigation({...f,command:null},route,f.speed)};
 return f;
}
const numeric=c=>({route:c.route,altitude:c.altitude,speed:c.speed,rate:c.rate});
function applyCommands(sim,select){
 const plan=makePlan(sim),request=buildRequest(plan,'jev-1.13.0');
 const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
  const choice=id.startsWith('runway_')?'wait':select(id,q);
  return [id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];
 }));
 assert.equal(validateResponse({model:'jev-1.13.0',answers,usage:{input_tokens:0,output_tokens:0}},request),true);
 assert.deepEqual(applyFleetDecision(sim,plan,answers),{applied:sim.flights.length,rejected:0});
}

test('holding minimum is observed, not substituted for a lower commanded altitude',()=>{
 const f=aircraft('HOLD_ULQAL');f.command.altitude=4000;const before=numeric(f.command);
 for(let i=0;i<20;i++)pilotStep(f,1);
 assert.equal(f.pilot.targetAltitude,4000);assert.ok(f.altitude<6000);
 assert.ok(f.pilot.constraintWarnings.includes('holding minimum altitude'));
 assert.deepEqual(numeric(f.command),before);
});
for(const target of [1000,10000])test('published approach altitude constraints do not rewrite target '+target,()=>{
 const f=aircraft('ILS_16R_GAZGE');f.command.altitude=target;pilotStep(f,1);
 assert.equal(f.pilot.targetAltitude,target);assert.equal(f.command.altitude,target);
 assert.ok(f.pilot.constraintWarnings.includes(target===1000?'published altitude floor':'published altitude ceiling'));
});
for(const route of ['HOLD_GAZGE','ILS_16R_GAZGE','VECTOR_E'])test('procedure or low-altitude speed rule does not slow the commanded aircraft: '+route,()=>{
 const f=aircraft(route,{speed:280,altitude:5000});f.command.speed=280;
 for(let i=0;i<10;i++)pilotStep(f,1);
 assert.equal(f.speed,280);assert.equal(f.pilot.targetSpeed,280);assert.equal(f.command.speed,280);
 assert.ok(f.pilot.constraintWarnings.length>0);
});

test('post-FAP target is not replaced by an ideal glide path',()=>{
 const route='ILS_16R_GAZGE',f=aircraft(route),p=PROCEDURES[route],r=RUNWAYS[0];
 f.command.navigation.index=p.legs.findIndex(l=>l.fix===p.fap)+1;
 [f.x,f.y]=offset(r.point,r.headingTrue+180,3);f.altitude=1500;f.command.altitude=219;
 pilotStep(f,1);assert.equal(f.pilot.targetAltitude,219);assert.ok(f.altitude<1500);assert.equal(f.command.altitude,219);
});

test('insufficient commanded SID climb rate is not increased to meet the gradient',()=>{
 const f=aircraft('VADEN1F',{phase:'departure',altitude:3000});f.command.altitude=8000;f.command.rate=300;
 for(let i=0;i<10;i++)pilotStep(f,1);
 assert.equal(f.verticalRate,300);assert.equal(f.pilot.targetRateMagnitude,300);assert.equal(f.command.rate,300);
 assert.ok(f.pilot.constraintWarnings.includes('SID climb gradient'));
});

test('physical performance limits remain finite, visible and do not rewrite the requested rate',()=>{
 const f=aircraft('VECTOR_E',{type:'B789'});f.command.altitude=12000;f.command.rate=2500;f.command.speed=300;
 for(let i=0;i<60;i++){
  const before={speed:f.speed,rate:f.verticalRate,bank:f.bank};pilotStep(f,1);
  assert.ok(Math.abs(f.verticalRate)<=1800);assert.ok(Math.abs(f.verticalRate-before.rate)<=150);
  assert.ok(Math.abs(f.bank)<=25);assert.ok(Math.abs(f.bank-before.bank)<=5);
  assert.ok(f.speed-before.speed<=.400001);
 }
 assert.equal(f.command.rate,2500);assert.equal(f.pilot.targetRateMagnitude,1800);
 assert.ok(f.pilot.unable.includes('vertical performance limit'));
 assert.equal(f.pilot.targetAltitude,12000);assert.equal(f.pilot.targetSpeed,300);
});

test('schema-valid descent before the FAP reaches ground impact and is not rescued',()=>{
 const sim=createSimulation(0,42),f=aircraft('ILS_16R_GAZGE',{altitude:100,speed:140});sim.flights=[f];
 [f.x,f.y]=FIXES.GAZGE.point;
 applyCommands(sim,(id)=>id.endsWith('_route')?'ILS_16R_GAZGE':id.endsWith('_altitude')?'0':id.endsWith('_speed')?'140':'2500');
 for(let i=0;i<30&&!sim.stats.groundImpacts;i++)advanceSimulation(sim,1);
 assert.equal(sim.stats.groundImpacts,1);assert.equal(f.phase,'crashed');assert.equal(f.command.altitude,0);
 assert.equal(f.pilot.targetAltitude,0);assert.ok(sim.incidents.some(i=>i.rule==='descent below FAP level before crossing FAP'));
 const report=experimentReport(sim,{},{});assert.equal(report.accidents,1);
 assert.ok(report.incidents.some(i=>i.type==='Yer teması'&&i.command.altitude===0));
 advanceSimulation(sim,2);assert.equal(sim.stats.cycles,0);assert.equal(sim.stats.groundImpacts,1);
});

test('unsafe holding descent produces forecast and measured collision instead of an altitude repair',()=>{
 const sim=createSimulation(0,42),a=aircraft('HOLD_ULQAL',{altitude:4500,speed:140}),b=aircraft('HOLD_ULQAL',{altitude:4000,speed:140});
 b.id='TEST152';sim.flights=[a,b];
 applyCommands(sim,id=>id.endsWith('_route')?'HOLD_ULQAL':id.endsWith('_altitude')?'4000':id.endsWith('_speed')?'140':'1000');
 const before=JSON.stringify(sim.flights),conflicts=predictedConflicts(sim.flights,40);
 assert.ok(conflicts.some(c=>c.critical));assert.equal(JSON.stringify(sim.flights),before);
 for(let i=0;i<40&&!sim.stats.collisions;i++)advanceSimulation(sim,1);
 assert.equal(sim.stats.collisions,1);assert.ok(sim.flights.every(f=>f.phase==='crashed'));
 assert.ok(sim.flights.every(f=>f.command.altitude===4000));assert.equal(sim.stats.rejected,0);
 assert.equal(experimentReport(sim,{},{}).accidents,1);
 advanceSimulation(sim,2);assert.equal(sim.stats.cycles,0);assert.equal(sim.stats.collisions,1);
});


test('actual speed and glide-path violations are measured without editing the targets',()=>{
 const sim=createSimulation(0,42),f=aircraft('HOLD_ULQAL',{altitude:6000,speed:280});sim.flights=[f];
 advanceSimulation(sim,1);
 assert.equal(f.pilot.targetSpeed,280);assert.equal(f.speed,280);
 assert.ok(sim.incidents.some(i=>i.rule==='holding speed limit'));
 assert.ok(sim.incidents.some(i=>i.rule==='low altitude speed limit'));
 const route='ILS_16R_GAZGE',p=PROCEDURES[route],r=RUNWAYS[0];
 f.phase='approach';f.altitude=2500;f.speed=180;f.command={route,altitude:219,speed:180,rate:1000,navigation:navigation({...f,command:null},route,180)};
 f.command.navigation.index=p.legs.findIndex(l=>l.fix===p.fap)+1;
 [f.x,f.y]=offset(r.point,r.headingTrue+180,3);
 advanceSimulation(sim,1);assert.equal(f.pilot.targetAltitude,219);
 assert.ok(sim.incidents.some(i=>i.rule==='approach vertical path'&&i.command.altitude===219));
 const report=experimentReport(sim,{},{});assert.equal(report.pilotControlPolicy,'jev-command-observe-v1');
});
