import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,makePlan,applyFleetDecision,advanceSimulation,predictedConflicts,experimentReport,publicSimulation,recordIncident} from '../src/simulation.mjs';
import {FIXES,navigation} from '../src/airport.mjs';
import {buildRequest,validateResponse} from '../server/typesafe.mjs';
import {eventText} from '../src/i18n.mjs';
import {procedureCommandIssues} from '../src/pilot.mjs';
function fixture(route='HOLD_ULQAL',changes={}){
 const sim=createSimulation(0,42),f=sim.flights[50];sim.flights=[f];
 Object.assign(f,{type:'B738',phase:'arrival',lane:0,altitude:6000,speed:200,heading:90,verticalRate:0},changes);
 [f.x,f.y]=FIXES.ULQAL.point;
 f.command={route,altitude:f.altitude,speed:f.speed,rate:1000,navigation:navigation({...f,command:null},route,f.speed)};
 return {sim,f};
}
function decision(sim,{route='HOLD_ULQAL',altitude=4000,speed=195,rate=1000,clearance=null}={}){
 const plan=makePlan(sim),request=buildRequest(plan,'jev-1.13.0');
 const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
  const choice=id.startsWith('runway_')?(id==='runway_'+clearance?sim.flights[0].id:'wait'):id.endsWith('_route')?route:String(id.endsWith('_altitude')?altitude:id.endsWith('_speed')?speed:rate);
  return [id,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}];
 }));
 assert.equal(validateResponse({model:'jev-1.13.0',answers,usage:{input_tokens:0,output_tokens:0}},request),true);
 return {plan,answers};
}
const audit=sim=>experimentReport(sim,{},{}).commandAudit;
test('out-of-procedure command is logged on receipt before an actual violation, without a veto',()=>{
 const {sim,f}=fixture(),d=decision(sim),raw=JSON.stringify(d.answers);
 assert.deepEqual(applyFleetDecision(sim,d.plan,d.answers),{applied:1,rejected:0});
 assert.equal(f.altitude,6000);assert.equal(f.command.altitude,4000);assert.equal(sim.stats.procedureViolations,0);
 const a=audit(sim);assert.equal(a.checkedCommands,1);assert.equal(a.procedureCommands,1);assert.equal(a.records.length,1);
 const entry=a.records[0],issue=entry.issues.find(i=>i.rule==='holding-minimum-altitude');
 assert.equal(entry.commandId,f.command.id);assert.equal(entry.aircraft,f.id);assert.equal(entry.generation,f.generation);
 assert.equal(entry.planRevision,d.plan.revision);assert.equal(entry.time,0);assert.equal(entry.action,'applied-unmodified');
 assert.equal(issue.requested,4000);assert.equal(issue.min,5000);assert.equal(issue.unit,'ft MSL');assert.equal(issue.fix,'ULQAL');
 assert.equal(issue.basis,'published');assert.equal(issue.source,'IAC_13');assert.equal(entry.command.altitude,4000);
 assert.equal(JSON.stringify(d.answers),raw);assert.equal(sim.incidents.length,0,'command logs must not evict physical incident evidence');
 assert.ok(eventText(sim.events[0].text,'en').startsWith('Out-of-procedure command'));
});
test('valid command, permitted vector and physical-only limitation are not procedure-command errors',()=>{
 for(const opts of [{route:'HOLD_ULQAL',altitude:6000,speed:195},{route:'VECTOR_E',altitude:6000,speed:220},{route:'VECTOR_E',altitude:18000,speed:280,rate:2500}]){
  const {sim,f}=fixture(opts.route,{type:'B789',altitude:opts.altitude,speed:opts.speed}),d=decision(sim,opts);
  applyFleetDecision(sim,d.plan,d.answers);assert.equal(audit(sim).checkedCommands,1);assert.equal(audit(sim).procedureCommands,0);
  assert.equal(audit(sim).records.length,0);assert.equal(f.command.altitude,opts.altitude);
 }
});
for(const row of [
 {name:'published floor',route:'ILS_16R_GAZGE',altitude:1000,speed:220,rule:'published-altitude-floor'},
 {name:'published ceiling',route:'ILS_16R_GAZGE',altitude:10000,speed:220,rule:'published-altitude-ceiling'},
 {name:'FAP floor',route:'ILS_16R_GAZGE',altitude:1000,speed:220,rule:'fap-altitude-floor'},
 {name:'published speed',route:'ILS_16R_GAZGE',altitude:4000,speed:280,rule:'published-speed-constraint'},
 {name:'holding speed',route:'HOLD_ULQAL',altitude:6000,speed:280,rule:'holding-speed-limit'},
 {name:'simulation low-altitude rule',route:'VECTOR_E',altitude:6000,speed:280,rule:'low-altitude-speed-limit'}
])test('command audit classifies '+row.name,()=>{
 const {sim}=fixture(row.route),d=decision(sim,row);applyFleetDecision(sim,d.plan,d.answers);
 const issues=audit(sim).records[0].issues;assert.ok(issues.some(i=>i.rule===row.rule));
 assert.equal(audit(sim).procedureCommands,1);assert.equal(audit(sim).constraintFindings,issues.length);
 if(row.rule==='low-altitude-speed-limit')assert.equal(issues[0].basis,'demo-rule');
});
test('audit records missing approach permission and the required SID gradient separately from physical limits',()=>{
 const approach=fixture('ILS_16R_GAZGE'),d=decision(approach.sim,{route:'ILS_16R_GAZGE',altitude:4000,speed:220});
 applyFleetDecision(approach.sim,d.plan,d.answers);
 assert.ok(audit(approach.sim).records[0].issues.some(i=>i.rule==='approach-clearance-mismatch'));
 const {sim,f}=fixture('VADEN1F',{mission:'departure',phase:'departure',altitude:3000,speed:220});
 f.arrival=null;f.requestedDeparture='VADEN1F';
 const sid=decision(sim,{route:'VADEN1F',altitude:8000,speed:220,rate:300});applyFleetDecision(sim,sid.plan,sid.answers);
 const issue=audit(sim).records[0].issues.find(i=>i.rule==='sid-climb-gradient');
 assert.equal(issue.requested,300);assert.ok(issue.min>1000);assert.equal(issue.requiredFtPerNm,304);assert.equal(issue.basis,'published');assert.equal(issue.source,'SID_01');
 assert.ok(issue.groundSpeedKt>220);assert.equal(f.command.rate,300);
});
test('physics ticks, forecasts and report reads never duplicate a command log; each new decision is counted',()=>{
 const {sim}=fixture(),d=decision(sim);applyFleetDecision(sim,d.plan,d.answers);
 const saved=structuredClone(audit(sim));for(let i=0;i<3;i++){predictedConflicts(sim.flights,3);publicSimulation(sim);experimentReport(sim,{},{});}
 advanceSimulation(sim,3);assert.deepEqual(audit(sim),saved);
 const next=decision(sim);applyFleetDecision(sim,next.plan,next.answers);assert.equal(audit(sim).procedureCommands,2);
 assert.notEqual(audit(sim).records[0].commandId,audit(sim).records[1].commandId);
 const reloaded=JSON.parse(JSON.stringify(sim));assert.deepEqual(audit(reloaded),audit(sim));
});
test('stale revision, stale generation and invalid option do not produce an executed procedure-command log',()=>{
 for(const kind of ['revision','generation','option']){
  const {sim,f}=fixture(),d=decision(sim);if(kind==='revision')d.plan.revision--;else if(kind==='generation')d.plan.flights[0].generation--;else d.answers[f.id+'_altitude'].choice='999999';
  assert.equal(applyFleetDecision(sim,d.plan,d.answers).applied,0);assert.equal(audit(sim).checkedCommands,0);assert.equal(audit(sim).procedureCommands,0);
 }
});
test('command log survives a measured impact and respawn with command identity preserved',()=>{
 const {sim,f}=fixture('ILS_16R_GAZGE',{altitude:100,speed:140}),d=decision(sim,{route:'ILS_16R_GAZGE',altitude:0,speed:140,rate:2500});
 applyFleetDecision(sim,d.plan,d.answers);const id=f.command.id;
 for(let i=0;i<30&&!sim.stats.groundImpacts;i++)advanceSimulation(sim,1);
 assert.equal(sim.stats.groundImpacts,1);assert.ok(sim.incidents.some(i=>i.command?.id===id));
 advanceSimulation(sim,2);assert.equal(sim.stats.cycles,0);assert.equal(audit(sim).procedureCommands,1);
 assert.equal(audit(sim).records[0].commandId,id);assert.ok(f.generation>audit(sim).records[0].generation);
});
test('bounded command history retains totals and does not consume the physical incident window or AI context',()=>{
 const {sim}=fixture();recordIncident(sim,'sentinel-collision',[sim.flights[0].id]);
 for(let i=0;i<100;i++){const d=decision(sim);applyFleetDecision(sim,d.plan,d.answers);}
 const a=audit(sim);assert.equal(a.procedureCommands,100);assert.ok(a.records.length<=64);assert.ok(a.records.length>0);
 assert.equal(a.droppedRecords,100-a.records.length);assert.ok(Buffer.byteLength(JSON.stringify(a.records))<=32000);
 assert.equal(sim.incidents.length,1);assert.equal(sim.incidents[0].type,'sentinel-collision');
 assert.equal(publicSimulation(sim).commandAudit.records,undefined,'polling need not send the complete command history');
 assert.equal(buildRequest(makePlan(sim),'jev-1.13.0').state.commandAudit,undefined,'audit must not add inference input');
});
test('published missed-approach hold speed limits keep their exact IAC provenance',()=>{
 for(const row of [{route:'HOLD_FM166',source:'IAC_13'},{route:'HOLD_IRDED',source:'IAC_15'},{route:'HOLD_TIBNU',source:'IAC_17'}]){
  const {f}=fixture(row.route);f.command={route:row.route,altitude:6000,speed:280,rate:1000,navigation:navigation({...f,command:null},row.route,280)};const issue=procedureCommandIssues(f).find(i=>i.rule==='holding-speed-limit');assert.ok(issue,row.route);assert.equal(issue.max,230);assert.equal(issue.basis,'published');assert.equal(issue.source,row.source);
 }
});
test('transition hold speed fallback remains explicitly demo-only pending manual chart review',()=>{
 for(const route of ['HOLD_GAZGE','HOLD_INSTA','HOLD_ULQAL']){const {sim}=fixture(route),d=decision(sim,{route,altitude:6000,speed:280});applyFleetDecision(sim,d.plan,d.answers);const issue=audit(sim).records[0].issues.find(i=>i.rule==='holding-speed-limit');assert.ok(issue,route);assert.equal(issue.max,200);assert.equal(issue.basis,'demo-rule');assert.equal(issue.source,'demo-holding-speed');}
});
