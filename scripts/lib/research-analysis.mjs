import assert from 'node:assert/strict';
import {readExportManifest,verifiedEntries} from './verified-export.mjs';
import {applyFleetDecision,advanceSimulation} from '../../src/simulation.mjs';
import {AIRPORT,PROCEDURES} from '../../src/airport.mjs';
import {performanceProfile,procedureCommandIssues} from '../../src/pilot.mjs';
import {isAirborne} from '../../src/flight-events.mjs';
import {simulationStateSha256,STATE_DIGEST_VERSION} from '../../server/research-journal.mjs';
import {provenance,parseStudyManifest} from '../../server/study-run.mjs';
import spec from '../../docs/evaluation-spec.json' with {type:'json'};
export const ANALYSIS_VERSION='verified-replay-descriptive-v3';
export const ratio=(numerator,denominator,scale=1)=>({numerator,denominator,value:denominator>0?scale*numerator/denominator:null,status:denominator>0?'descriptive':'no-denominator'});
export function applicableRules(f) {
 const c=f.command,n=c?.navigation;if(!n)return [];
 const p=PROCEDURES[n.procedure],leg=p?.legs[n.index],out=[];
 if(n.kind==='HOLD') {
  if(AIRPORT.holds.some(h=>h.fix===n.fix&&Number.isFinite(h.minAltitude)))out.push('holding-minimum-altitude');
  out.push('holding-speed-limit');
 }
 if(leg) {
  if(Number.isFinite(leg.altitude??leg.minAltitude))out.push('published-altitude-floor');
  if(Number.isFinite(leg.altitude??leg.maxAltitude))out.push('published-altitude-ceiling');
  if(Number.isFinite(leg.speed??leg.maxSpeed))out.push('published-speed-constraint');
 }
 if(p?.kind==='APP') {
  const idx=p.legs.findIndex(l=>l.fix===p.fap);
  if(idx>=0&&n.index<=idx&&Number.isFinite(p.legs[idx].altitude))out.push('fap-altitude-floor');
  out.push('approach-clearance-mismatch');
 }
 if(f.altitude<10000)out.push('low-altitude-speed-limit');
 if(p?.kind==='SID'&&f.altitude<p.climbGradientUntil&&c.altitude-f.altitude>150&&f.speed>0)out.push('sid-climb-gradient');
 return out;
}
const group=()=>({commands:0,flagged:0,findings:0,physicalLimits:0,published:0,demo:0,integration:0});
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
const clone=x=>structuredClone(x);
export async function analyzeResearch(directory,{onCommand=()=>{}}={}) {
 const manifest=await readExportManifest(directory);
 assert.ok(manifest.entries.length,'An empty journal has no analysis population');
 let sim,initial,sourceFingerprint=null,configurationCount=0,checkpoints=0,runId=null,evidenceClass='unclassified',stopReason=null,studyManifest=null,archiveFirstRecordedAt=null,archiveLastRecordedAt=null,studyArmedRecordedAt=null,studyStoppedRecordedAt=null,studyArmedEventAt=null;
 let attempt=null;const ids=new Set(),flights=new Map(),phaseCounts={},scopeCounts={},totals=group();
 const rules=Object.fromEntries(spec.commandRules.map(r=>[r.id,{id:r.id,basis:r.basis,eligible:0,flagged:0}]));
 const resources={intentBatches:0,outcomeBatches:0,cancelledBeforeSendBatches:0,failedBatches:0,knownInputTokens:0,knownOutputTokens:0,unknownUsageBatches:0,failureCodes:{},returnedModels:{}};
 const latencies=[],measurements={};let framesApplied=0;
 const source=p=>{
  assert.ok(p?.sourceFingerprint,'Source identity missing; exact replay cannot be claimed');
  if(sourceFingerprint!==null)assert.equal(p.sourceFingerprint,sourceFingerprint,'Mixed source configurations require separate analyses');
  sourceFingerprint=p.sourceFingerprint;assert.equal(sourceFingerprint,provenance.sourceFingerprint,'Replay requires the exact archived source checkout and provenance');
 };
 for await(const entry of verifiedEntries(directory,manifest)) {
  assert.equal(entry.stateDigestVersion,STATE_DIGEST_VERSION,'Unsupported checkpoint version');assert.ok(Number.isFinite(entry.recordedAt)&&entry.recordedAt>0,'Invalid journal recordedAt');if(archiveFirstRecordedAt===null)archiveFirstRecordedAt=entry.recordedAt;assert.ok(archiveLastRecordedAt===null||entry.recordedAt>=archiveLastRecordedAt,'Journal wall clock moved backward');archiveLastRecordedAt=entry.recordedAt;
  for(const event of entry.events) {
   if(event.kind==='initial-state') {
    assert.equal(sim,undefined,'Multiple initial states cannot be pooled');source(event.sourceProvenance);
    sim=clone(event.sim);initial=clone(sim);studyManifest=event.manifest??null;if(studyManifest)parseStudyManifest(studyManifest);runId=studyManifest?.runId??null;evidenceClass=event.evidenceClass??'unclassified';
   }
   assert.ok(sim,'Journal must begin with a complete initial state');
   if(event.kind==='configuration'){source(event.sourceProvenance);configurationCount++;}
   if(event.kind==='evidence-class'){assert.equal(event.value,'synthetic-offline');evidenceClass=event.value;}
   if(event.kind==='study-armed'){assert.ok(studyManifest,'Study arm without frozen manifest');assert.equal(event.runId,studyManifest.runId);assert.equal(studyArmedRecordedAt,null,'Duplicate study arm');assert.ok(Number.isFinite(event.at)&&event.at>0,'Invalid study arm time');studyArmedRecordedAt=entry.recordedAt;studyArmedEventAt=event.at;}
   if(studyManifest&&['dispatch-intent','application','physics-step'].includes(event.kind))assert.ok(studyArmedRecordedAt!==null,'Evaluated study activity before explicit arm');
   if(event.kind==='dispatch-intent') {
    assert.ok(!attempt||attempt.settled,'Unresolved overlapping dispatch intents');
    assert.ok(Array.isArray(event.requests)&&event.requests.length>0,'Empty dispatch intent');
    attempt={revision:event.planRevision,plan:event.plan,count:event.requests.length,outcomes:null,settled:false,applied:false};resources.intentBatches+=attempt.count;
   }
   if(event.kind==='dispatch-cancelled') {
    assert.ok(attempt&&!attempt.settled&&attempt.revision===event.planRevision,'Cancellation has no matching intent');
    resources.cancelledBeforeSendBatches+=attempt.count;attempt.settled=true;
   }
   if(event.kind==='dispatch-outcomes') {
    assert.ok(attempt&&!attempt.settled&&attempt.revision===event.planRevision,'Outcome has no unique matching intent');
    assert.equal(event.outcomes.length,attempt.count,'Partial batch outcomes must be explicit');
    attempt.outcomes=event.outcomes;attempt.settled=true;
    for(const outcome of event.outcomes) {
     resources.outcomeBatches++;
     if(outcome.status==='fulfilled') {
      const r=outcome.result;assert.ok(Number.isSafeInteger(r.usage?.input_tokens)&&r.usage.input_tokens>=0&&Number.isSafeInteger(r.usage?.output_tokens)&&r.usage.output_tokens>=0,'Invalid usage');
      resources.knownInputTokens+=r.usage.input_tokens;resources.knownOutputTokens+=r.usage.output_tokens;
      resources.returnedModels[r.model]=(resources.returnedModels[r.model]??0)+1;
      if(Number.isFinite(r.latencyMs)&&r.latencyMs>=0)latencies.push(r.latencyMs);
     } else {
      assert.equal(outcome.status,'rejected');resources.failedBatches++;resources.unknownUsageBatches++;
      const code=outcome.errorCode??'unclassified';resources.failureCodes[code]=(resources.failureCodes[code]??0)+1;
     }
    }
   }
   if(event.kind==='application') {
    assert.ok(attempt?.outcomes&&!attempt.applied&&attempt.revision===event.planRevision,'Application has no unique matching response');
    assert.ok(attempt.outcomes.every(o=>o.status==='fulfilled'),'A partially failed frame cannot be applied');
    attempt.applied=true;
    const answers=Object.assign({},...attempt.outcomes.map(o=>o.result.answers));
    const actual=applyFleetDecision(sim,attempt.plan,answers);
    assert.equal(actual.applied,event.applied,'Applied count mismatch');assert.equal(actual.rejected,event.rejected,'Rejected count mismatch');
    const observed=event.events.filter(e=>e.kind==='command-applied');assert.equal(observed.length,event.applied,'Missing command observations');framesApplied++;
    for(const cmd of observed) {
     const id=cmd.command.id;assert.ok(id&&!ids.has(id),'Duplicate command ID');ids.add(id);
     const f=sim.flights.find(f=>f.id===cmd.aircraft&&f.generation===cmd.generation);assert.ok(f,'Unknown aircraft generation');assert.equal(f.command.id,id);
     const actualIssues=procedureCommandIssues(f,{includeClearance:true}).map(({message,...issue})=>issue);
     assert.deepEqual(cmd.issues,actualIssues,'Recorded detector labels disagree with frozen replay; never silently relabel');
     const unique=new Set(cmd.issues.map(i=>i.rule)),bases=new Set(cmd.issues.map(i=>i.basis)),eligible=new Set(applicableRules(f));
     for(const rule of unique){assert.ok(rules[rule],'Unknown rule');assert.ok(eligible.has(rule),'Finding without an eligible opportunity');rules[rule].flagged++;}
     for(const rule of eligible)rules[rule].eligible++;
     const scope=isAirborne(f)?'airborne':'ground';phaseCounts[f.phase]??=group();scopeCounts[scope]??=group();
     for(const g of [totals,phaseCounts[f.phase],scopeCounts[scope]]) {
      g.commands++;if(unique.size)g.flagged++;g.findings+=cmd.issues.length;
      if(f.command.rate>performanceProfile(f.type).maxVerticalFpm)g.physicalLimits++;
      if(bases.has('published'))g.published++;if(bases.has('demo-rule'))g.demo++;if(bases.has('integration-rule'))g.integration++;
     }
     const key=f.id+':'+f.generation;
     const flight=flights.get(key)??{aircraft:f.id,generation:f.generation,firstCommandSimSeconds:sim.elapsed,lastCommandSimSeconds:sim.elapsed,commands:0,flagged:0};
     flight.lastCommandSimSeconds=sim.elapsed;flight.commands++;if(unique.size)flight.flagged++;flights.set(key,flight);
     await onCommand({commandId:id,aircraft:f.id,generation:f.generation,simSeconds:sim.elapsed,phase:f.phase,scope,route:f.command.route,altitudeFt:f.command.altitude,iasKt:f.command.speed,verticalRateFpm:f.command.rate,findingCount:cmd.issues.length,rules:[...unique].join('|'),bases:[...bases].join('|')});
    }
   }
   if(event.kind==='physics-step') {
    assert.equal(sim.elapsed,event.from,'Missing or reordered physics interval');
    assert.ok(event.to>=event.from&&event.to-event.from<=60,'Invalid physics duration');
    if(event.idleAdvance)sim.requiresDecision=false;advanceSimulation(sim,event.to-event.from);
    assert.equal(sim.elapsed,event.to,'Physics duration not reproducible');
    for(const observation of event.events??[])if(observation.kind==='incident')measurements[observation.type]=(measurements[observation.type]??0)+1;
   }
   if(event.kind==='study-stop'){if(studyManifest){assert.ok(studyArmedRecordedAt!==null,'Study stop before explicit arm');assert.equal(studyStoppedRecordedAt,null,'Duplicate study stop');studyStoppedRecordedAt=entry.recordedAt;}stopReason=event.reason;}
  }
  assert.equal(await simulationStateSha256(sim),entry.stateSha256,'Replay checkpoint mismatch at '+entry.sequence);checkpoints++;
 }
 const statsDelta={};for(const [key,value] of Object.entries(sim.stats)) {
  const baseline=initial.stats[key]??0;assert.ok(Number.isFinite(value)&&value>=baseline,'Counter reset within a source configuration');statsDelta[key]=value-baseline;
 }
 assert.equal(totals.commands,(sim.commandAudit?.checkedCommands??0)-(initial.commandAudit?.checkedCommands??0),'Command population is not complete');
 const missingOutcomes=resources.intentBatches-resources.outcomeBatches-resources.cancelledBeforeSendBatches;
 assert.ok(missingOutcomes>=0,'Outcome accounting mismatch');resources.unresolvedIntentBatches=missingOutcomes;
 resources.unknownUsageBatches+=missingOutcomes;resources.successLatencyMs={count:latencies.length,p50:percentile(latencies,.5),p95:percentile(latencies,.95),max:latencies.length?Math.max(...latencies):null};
 const exposure=statsDelta.aircraftHours??0,isStudy=Boolean(studyManifest);if(isStudy)assert.ok(studyArmedRecordedAt!==null,'Frozen study archive has no explicit arm event');if(stopReason&&isStudy)assert.ok(studyStoppedRecordedAt!==null,'Frozen study stop has no journal timestamp');const observedFirst=isStudy?studyArmedRecordedAt:archiveFirstRecordedAt,observedLast=isStudy?(studyStoppedRecordedAt??archiveLastRecordedAt):archiveLastRecordedAt;assert.ok(Number.isFinite(observedFirst)&&Number.isFinite(observedLast)&&observedLast>=observedFirst,'Invalid observed wall-time window');
 const outcomes={window:isStudy?'Explicit study arm to verified stop/final checkpoint; no pre-arm wall time or historical backfill':'Initial exported state to verified final checkpoint; no historical backfill',simulatedSeconds:sim.elapsed-initial.elapsed,airborneAircraftHours:exposure,statsDelta,incidentCounts:measurements,combinedEventsPer100AircraftHours:ratio((statsDelta.collisions??0)+(statsDelta.groundImpacts??0),exposure,100)};
 const flightRows=[...flights.values()].map(f=>({...f,presentAtPrefixEnd:sim.flights.some(a=>a.id===f.aircraft&&a.generation===f.generation),terminalOutcome:'not-inferred-from-command-association'}));
 return {schemaVersion:1,analysisVersion:ANALYSIS_VERSION,sourceFingerprint,journalHeadSha256:manifest.meta.headSha256,checkpoints,configurationCount,runId,evidenceClass,studyManifest,recordedAt:{first:observedFirst,last:observedLast,wallDurationMs:observedLast-observedFirst},archiveRecordedAt:{first:archiveFirstRecordedAt,last:archiveLastRecordedAt,wallDurationMs:archiveLastRecordedAt-archiveFirstRecordedAt},studyArm:{eventAt:studyArmedEventAt,journalRecordedAt:studyArmedRecordedAt},stopReason,prefixStatus:stopReason?(stopReason==='target-exposure'?'completed':'incomplete'):'open-or-unfrozen-prefix',commands:{...totals,anyFinding:ratio(totals.flagged,totals.commands)},byPhase:phaseCounts,byScope:scopeCounts,byRule:Object.values(rules).map(r=>({...r,fraction:ratio(r.flagged,r.eligible)})),flights:flightRows,outcomes,resources,limitations:['Detector-defined target conflicts, not independently adjudicated aviation errors.','Per-rule denominators are reconstructed from the exact matching code and receipt state.','No confidence-as-safety calibration, causal attribution, independence assumption or comparative superiority.','Known usage excludes uncertain failed/unresolved calls; synthetic replies do not measure billed tokens.','A verified hash chain proves internal integrity, not external authenticity or preregistration.','Flight observation starts at first command; command association alone does not establish terminal causation.']};
}
