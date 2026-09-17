import test from 'node:test';
import assert from 'node:assert/strict';
import spec from '../docs/evaluation-spec.json' with {type:'json'};
import {createSimulation,makePlan,applyFleetDecision,advanceSimulation,predictedConflicts,experimentReport,recordIncident} from '../src/simulation.mjs';
import {FIXES,navigation} from '../src/airport.mjs';
import {buildRequest,validateResponse} from '../server/typesafe.mjs';
import {initializeCommandAudit} from '../src/command-audit.mjs';
const report=sim=>experimentReport(sim,{},{}).evaluation;
function fixture(){
 const sim=createSimulation(0,42),f=sim.flights[50];sim.flights=[f];
 Object.assign(f,{type:'B738',phase:'arrival',altitude:6000,speed:200,verticalRate:0,lane:0});[f.x,f.y]=FIXES.ULQAL.point;
 f.command={route:'HOLD_ULQAL',altitude:6000,speed:200,rate:1000,navigation:navigation({...f,command:null},'HOLD_ULQAL',200)};
 return {sim,f};
}
function command(sim,route='HOLD_ULQAL',altitude=4000,speed=280,rate=1000){
 const plan=makePlan(sim),request=buildRequest(plan,'jev-1.13.0');
 const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
  const choice=id.startsWith('runway_')?'wait':id.endsWith('_route')?route:String(id.endsWith('_altitude')?altitude:id.endsWith('_speed')?speed:rate);
  return [id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];
 }));
 assert.ok(validateResponse({model:request.model,answers,usage:{input_tokens:0,output_tokens:0}},request));
 assert.equal(applyFleetDecision(sim,plan,answers).applied,1);return plan;
}
test('evaluation has explicit null denominators, draft status and unavailable study evidence',()=>{
 const {sim}=fixture(),e=report(sim);
 assert.equal(e.protocolId,spec.protocolId);assert.equal(e.commands.anyFinding.value,null);
 assert.equal(e.outcomes.combinedEventsPer100AircraftHours.value,null);
 assert.equal(e.dataAvailability.fullDecisionJournal,false);assert.equal(e.analysisReadiness.completeDecisionOutcomeStudy,false);
 assert.match(e.protocolStatus,/not-preregistered/);assert.equal(e.coverage.backfilled,false);
});
test('command-level rates count a multi-rule command once and keep basis categories separate',()=>{
 const {sim}=fixture();command(sim);command(sim,'HOLD_ULQAL',6000,195);command(sim,'ILS_16R_ULQAL',1000,280);
 const e=report(sim);
 assert.equal(e.commands.checkedCommands,3);assert.equal(e.commands.anyFinding.numerator,2);
 assert.equal(e.commands.anyFinding.value,2/3);assert.equal(e.commands.publishedConstraint.numerator,2);
 assert.equal(e.commands.simulatorRule.numerator,2);assert.equal(e.commands.integrationRule.numerator,1);
 assert.ok(e.commands.findingCount>e.commands.commandsWithFindings);
 assert.equal(e.byRule['holding-minimum-altitude'],1);assert.equal(e.byRule['fap-altitude-floor'],1);
 assert.equal(sim.stats.procedureViolations,0,'command conflict is not a measured flight violation');
});
test('physical capability and permitted vectors are distinct from procedure findings',()=>{
 const {sim,f}=fixture();f.type='B789';f.altitude=18000;f.speed=280;
 command(sim,'VECTOR_E',18000,280,2500);
 const e=report(sim);assert.equal(e.commands.anyFinding.numerator,0);assert.equal(e.commands.physicalLimitRequest.numerator,1);
 assert.equal(e.byScope.airborne.checkedCommands,1);assert.equal(e.byScope.ground.checkedCommands,0);
 assert.equal(f.command.rate,2500);
});
test('ground commands are separately reported and cannot silently become air-only evidence',()=>{
 const sim=createSimulation(0,42),f=sim.flights[0];sim.flights=[f];command(sim,f.requestedDeparture,6000,220);
 const e=report(sim);assert.equal(e.byScope.ground.checkedCommands,1);assert.equal(e.byScope.airborne.checkedCommands,0);
 assert.equal(e.byPhase.taxi_out.checkedCommands,1);assert.equal(e.scope.current,'legacy-mixed-v1');
 assert.ok(e.analysisReadiness.blockers.includes('airborne-only-scope-pending'));
});
test('bounded flagged logs preserve exact aggregate rates across truncation and reload',()=>{
 const {sim}=fixture();for(let i=0;i<100;i++)command(sim);
 const e=report(sim);assert.equal(e.commands.checkedCommands,100);assert.equal(e.commands.anyFinding.value,1);
 assert.equal(e.byRule['holding-minimum-altitude'],100);assert.ok(e.dataAvailability.commandWindow.dropped>0);
 assert.ok(e.dataAvailability.commandWindow.retained<=64);
 assert.deepEqual(report(JSON.parse(JSON.stringify(sim))),e);
});
test('legacy categorization starts at a new baseline without rebuilding totals from a biased window',()=>{
 const {sim}=fixture();command(sim);const a=sim.commandAudit,records=structuredClone(a.records);
 delete a.evaluation;sim.elapsed=123;sim.stats.collisions=5;sim.stats.aircraftHours=20;
 assert.equal(report(sim).coverage.instrumented,false);assert.equal(initializeCommandAudit(sim,2000),true);
 const e=report(sim);assert.equal(e.commands.checkedCommands,0);assert.equal(e.coverage.priorAuditedCommandsNotCategorized,1);
 assert.equal(e.coverage.startedAtSimSeconds,123);assert.equal(e.outcomes.collisionGroupEvents,0);
 assert.deepEqual(a.records,records);assert.equal(a.checkedCommands,1);assert.equal(initializeCommandAudit(sim,3000),false);
 command(sim);assert.equal(report(sim).commands.checkedCommands,1);assert.equal(a.checkedCommands,2);
});
test('outcome rates use the same exposure window and refuse a zero or reset denominator',()=>{
 const {sim}=fixture();sim.stats.collisions=2;sim.stats.groundImpacts=1;sim.stats.aircraftHours=4;
 const e=report(sim);assert.equal(e.outcomes.combinedEventsPer100AircraftHours.numerator,3);
 assert.equal(e.outcomes.combinedEventsPer100AircraftHours.denominator,4);assert.equal(e.outcomes.combinedEventsPer100AircraftHours.value,75);
 sim.stats.aircraftHours=0;assert.equal(report(sim).outcomes.combinedEventsPer100AircraftHours.value,null);
 sim.stats.aircraftHours=-1;assert.equal(report(sim).outcomes.combinedEventsPer100AircraftHours.status,'missing-or-reset');
});
test('reports and forecast clones do not change aggregate observations or inference context',()=>{
 const {sim}=fixture();command(sim);const before=structuredClone(sim.commandAudit.evaluation);
 report(sim);report(sim);predictedConflicts(sim.flights,3);advanceSimulation(sim,1);
 assert.deepEqual(sim.commandAudit.evaluation,before);
 const r=buildRequest(makePlan(sim),'jev-1.13.0');assert.equal(r.state.evaluation,undefined);assert.equal(r.state.commandAudit,undefined);
});
test('measurement command links survive respawn and mean association, not causation',()=>{
 const {sim,f}=fixture();command(sim);const id=f.command.id;
 recordIncident(sim,'test-encounter',[f.id]);const i=sim.incidents[0];
 assert.deepEqual(i.commandIds,[id]);assert.equal(i.commandLinkSemantics,'active-at-measurement-not-causal');
 f.phase='crashed';f.age=0;advanceSimulation(sim,2);
 assert.deepEqual(i.commandIds,[id]);assert.notEqual(f.generation,Number(id.split(':').at(-1)));
});
test('every emitted command detector has an explicit rule definition and no hidden action',()=>{
 const {sim}=fixture();command(sim,'ILS_16R_ULQAL',1000,280);
 const definitions=new Map(spec.commandRules.map(r=>[r.id,r]));
 for(const issue of sim.commandAudit.records[0].issues){
  assert.ok(definitions.has(issue.rule));assert.ok(['published','demo-rule','integration-rule'].includes(issue.basis));
 }
 const fap=sim.commandAudit.records[0].issues.find(i=>i.rule==='fap-altitude-floor');
 assert.equal(fap.basis,'demo-rule');assert.equal(sim.commandAudit.records[0].action,'applied-unmodified');
});


test('incompatible measurement versions are not silently pooled or relabeled',()=>{
 const {sim}=fixture();command(sim);sim.commandAudit.evaluation.protocolId='older-protocol';
 const old=structuredClone(sim.commandAudit.evaluation);command(sim);
 assert.deepEqual(sim.commandAudit.evaluation,old);const e=report(sim);
 assert.equal(e.coverage.instrumented,false);assert.equal(e.coverage.incompatibleStoredProtocol,true);
 assert.equal(e.commands.anyFinding.value,null);assert.equal(sim.commandAudit.checkedCommands,2);
});
