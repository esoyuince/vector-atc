import test from 'node:test';
import assert from 'node:assert/strict';
import {PROCEDURES,RUNWAYS,FIXES,navigation} from '../src/airport.mjs';
import {createSimulation,makePlan,applyFleetDecision,experimentReport} from '../src/simulation.mjs';
import {batchPlans,buildRequest,validateResponse} from '../server/typesafe.mjs';
import {eventText} from '../src/i18n.mjs';

function singleArrival(entry='GAZGE'){
 const sim=createSimulation(0,42),flight=sim.flights[50];sim.flights=[flight];
 [flight.x,flight.y]=FIXES[entry].point;flight.altitude=6000;flight.speed=220;
 flight.lane=RUNWAYS.findIndex(r=>r.id==='16R');
 const route='HOLD_'+entry;
 flight.command={route,altitude:6000,speed:220,rate:1500,navigation:navigation(flight,route,220)};
 return {sim,flight};
}
function responseFor(plan,overrides={}){
 const request=buildRequest(plan,'jev-1.13.0');
 const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
  const choice=overrides[id]??(id.startsWith('runway_')?'wait':id.endsWith('_route')?Object.keys(q.criteria)[0]:id.endsWith('_altitude')?'6000':id.endsWith('_speed')?'220':'1500');
  return [id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];
 }));
 const response={model:'jev-1.13.0',answers,usage:{input_tokens:1000,output_tokens:100}};
 assert.equal(validateResponse(response,request),true,'fixture must pass the real provider contract');
 return response;
}

for(const procedure of Object.values(PROCEDURES).filter(p=>p.kind==='APP')){
 test('active approach survives the next frame and storage reload: '+procedure.id,()=>{
  let {sim,flight}=singleArrival(procedure.legs[0].fix);
  const plan=makePlan(sim);
  assert.ok(Object.hasOwn(plan.flights[0].routes,procedure.id));
  const response=responseFor(plan,{[flight.id+'_route']:procedure.id,['runway_'+procedure.runway]:flight.id});
  assert.equal(applyFleetDecision(sim,plan,response.answers).applied,1);
  flight.command.navigation.index=2;
  sim=JSON.parse(JSON.stringify(sim));flight=sim.flights[0];
  const nextPlan=makePlan(sim),before=JSON.stringify(sim);
  assert.ok(Object.hasOwn(nextPlan.flights[0].routes,procedure.id),'active ILS must remain selectable');
  for(const r of ['16R','17L','18'])assert.ok(Object.hasOwn(nextPlan.flights[0].routes,'ILS_'+r+'_'+procedure.legs[0].fix));
  const batch=batchPlans(nextPlan)[0],request=buildRequest(batch,'jev-1.13.0');
  assert.ok(request.state.procedures[procedure.id],'active procedure constraints must be available');
  assert.equal(JSON.stringify(sim),before,'planning must not mutate navigation');
  const again=responseFor(nextPlan,{[flight.id+'_route']:procedure.id});
  assert.equal(applyFleetDecision(sim,nextPlan,again.answers).applied,1);
  assert.equal(flight.command.navigation.index,2,'same-route command must retain waypoint progress');
  assert.equal(flight.landingClearance,procedure.runway);
 });
}

function runwayContextPlan(){
 const sim=createSimulation(0,42),[a,b,c,d,e,f]=sim.flights.slice(50,56);
 [a.x,a.y]=FIXES.GAZGE.point;b.x=a.x+.5;b.y=a.y;a.altitude=b.altitude=6000;
 const runway=sim.runways.find(r=>r.id==='16R');
 c.phase='approach';c.x=runway.x;c.y=runway.y;c.lane=0;c.altitude=3000;
 d.x=c.x+.5;d.y=c.y;d.altitude=3000;
 runway.occupants=[c.id];runway.reservations=[c.id];runway.reserved=c.id;
 e.x=80;e.y=70;f.x=80.5;f.y=70;e.altitude=f.altitude=25000;
 const plan=makePlan(sim);
 return {plan,a,b,c,d,e,f};
}
const hasPair=(conflicts,a,b)=>conflicts.some(c=>c.a===a.id&&c.b===b.id||c.a===b.id&&c.b===a.id);
for(const size of [10,5,1])test('runway batch retains candidate and occupant conflicts, size '+size,()=>{
 const {plan,a,b,c,d,e,f}=runwayContextPlan(),before=JSON.stringify(plan);
 assert.ok(plan.runways.some(r=>r.choices.some(choice=>choice.id===a.id)));
 assert.ok(hasPair(plan.state.conflicts,a,b));assert.ok(hasPair(plan.state.conflicts,c,d));
 assert.ok(hasPair(plan.state.conflicts,e,f));
 const batches=batchPlans(plan,size),first=batches[0];
 assert.ok(!first.flights.some(flight=>flight.id===a.id));
 assert.ok(hasPair(first.state.conflicts,a,b),'runway candidate conflict lost');
 assert.ok(hasPair(first.state.conflicts,c,d),'runway occupant conflict lost');
 assert.ok(!hasPair(first.state.conflicts,e,f),'unrelated conflicts should remain filtered');
 for(const flight of [a,b,c,d])assert.ok(first.state.traffic.some(row=>row[0]===flight.id));
 const questions=batches.flatMap(b=>Object.keys(buildRequest(b,'jev-1.13.0').questions));
 assert.equal(questions.length,403);assert.equal(new Set(questions).size,403);
 for(const batch of batches)assert.ok(Buffer.byteLength(JSON.stringify(buildRequest(batch,'jev-1.13.0')))+4096<=80000);
 assert.equal(JSON.stringify(plan),before);
});
test('emergency batches do not inherit unrelated runway conflicts or questions',()=>{
 const {plan,a,b,c,d}=runwayContextPlan();plan.flights=plan.flights.filter(f=>f.id===a.id);plan.runways=[];
 const batch=batchPlans(plan)[0];assert.ok(hasPair(batch.state.conflicts,a,b));
 assert.ok(!hasPair(batch.state.conflicts,c,d));assert.equal(batch.runways.length,0);
 assert.ok(!Object.keys(buildRequest(batch,'jev-1.13.0').questions).some(id=>id.startsWith('runway_')));
});

for(const reversed of [false,true])test('multiple runway choices are recorded without changing execution order, reversed='+reversed,()=>{
 const {sim,flight}=singleArrival(),plan=makePlan(sim);if(reversed)plan.runways.reverse();
 const requestedRunways=plan.runways.map(r=>r.id),executionRunway=requestedRunways.at(-1);
 const response=responseFor(plan,{[flight.id+'_route']:'ILS_'+executionRunway+'_GAZGE',...Object.fromEntries(plan.runways.map(r=>['runway_'+r.id,flight.id]))});
 const raw=JSON.stringify(response);
 assert.deepEqual(applyFleetDecision(sim,plan,response.answers),{applied:1,rejected:0});
 assert.equal(flight.landingClearance,executionRunway);assert.equal(sim.stats.clearanceMismatches,0);
 assert.equal(sim.stats.runwayAssignmentConflicts,1);
 const incident=sim.incidents.find(i=>i.code==='multiple-runway-assignment');
 assert.ok(incident,'conflict must be visible even when final route matches the last runway');
 assert.deepEqual(incident.requestedRunways,requestedRunways);assert.equal(incident.executionRunway,executionRunway);
 assert.equal(incident.resolution,'last-in-plan-order');assert.equal(incident.planRevision,plan.revision);
 assert.equal(experimentReport(sim,{},{}).stats.runwayAssignmentConflicts,1);
 assert.equal(JSON.stringify(response),raw,'raw provider answers must remain unchanged');
 const event=sim.events.find(e=>e.code==='multiple-runway-assignment');
 assert.ok(eventText(event.text,'en').startsWith('Conflicting runway clearances'));
});
test('new conflict counter handles legacy state and does not count single or stale decisions',()=>{
 const {sim,flight}=singleArrival();delete sim.stats.runwayAssignmentConflicts;
 let plan=makePlan(sim),response=responseFor(plan,{[flight.id+'_route']:'ILS_16R_GAZGE',runway_16R:flight.id});
 applyFleetDecision(sim,plan,response.answers);assert.equal(sim.stats.runwayAssignmentConflicts??0,0);
 flight.phase='arrival';plan=makePlan(sim);
 response=responseFor(plan,{[flight.id+'_route']:'ILS_18_GAZGE',...Object.fromEntries(plan.runways.map(r=>['runway_'+r.id,flight.id]))});
 const stale=structuredClone(plan);stale.revision--;
 assert.equal(applyFleetDecision(sim,stale,response.answers).applied,0);assert.equal(sim.stats.runwayAssignmentConflicts??0,0);
 applyFleetDecision(sim,plan,response.answers);assert.equal(sim.stats.runwayAssignmentConflicts,1);
});
