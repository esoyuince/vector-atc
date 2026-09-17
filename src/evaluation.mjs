import {AIRBORNE_SCOPE} from './traffic-lifecycle.mjs';
import spec from '../docs/evaluation-spec.json' with {type:'json'};
import {RUNWAYS} from './airport.mjs';
export const EVALUATION_PROTOCOL=spec.protocolId;
const bases=['published','demo-rule','integration-rule'];
const phases=['pending','taxi_out','takeoff','departure','arrival','approach','landing','crashed'];
const counts=()=>({checkedCommands:0,commandsWithFindings:0,findingCount:0,physicalLimitRequests:0,commandsByBasis:Object.fromEntries(bases.map(k=>[k,0]))});
export function initializeEvaluationCounters(sim,audit,now){
 if(audit.evaluation)return false;
 audit.evaluation={protocolId:EVALUATION_PROTOCOL,controlPolicy:audit.controlPolicy,startedAt:now,startedAtSimSeconds:sim.elapsed,baselineAuditChecked:audit.checkedCommands,baselineStats:structuredClone(sim.stats),...counts(),byRule:Object.fromEntries(spec.commandRules.map(r=>[r.id,0])),byPhase:Object.fromEntries(phases.map(p=>[p,counts()])),byScope:{airborne:counts(),ground:counts()},unclassifiedFindings:0};
 return true;
}
export function recordEvaluatedCommand(sim,f,issues){
 const e=sim.commandAudit.evaluation;
 if(e.protocolId!==EVALUATION_PROTOCOL||e.controlPolicy!==sim.commandAudit.controlPolicy)return;
 const uniqueRules=new Set(issues.map(i=>i.rule)),uniqueBases=new Set(issues.map(i=>i.basis));
 const isAirborne=['departure','arrival','approach'].includes(f.phase)||(f.phase==='takeoff'&&f.altitude>(RUNWAYS[f.lane]?.elevation??Infinity)+1);
 const physicalLimit=f.command.rate>(f.type==='B789'?1800:2500);
 const targets=[e,e.byPhase[f.phase],e.byScope[isAirborne?'airborne':'ground']].filter(Boolean);
 for(const t of targets){
  t.checkedCommands++;if(issues.length)t.commandsWithFindings++;t.findingCount+=issues.length;
  if(physicalLimit)t.physicalLimitRequests++;
  for(const b of bases)if(uniqueBases.has(b))t.commandsByBasis[b]++;
 }
 for(const rule of uniqueRules){if(Object.hasOwn(e.byRule,rule))e.byRule[rule]++;else e.unclassifiedFindings++;}
}
function fraction(n,d,unit='fraction',scale=1){
 const known=Number.isFinite(n)&&n>=0&&Number.isFinite(d)&&d>=0;
 return {numerator:known?n:null,denominator:known?d:null,value:known&&d>0?scale*n/d:null,unit,status:!known?'missing-or-reset':d===0?'no-denominator':'descriptive'};
}
function commandMetrics(e){
 const n=e?.checkedCommands??0;
 return {checkedCommands:n,commandsWithFindings:e?.commandsWithFindings??0,findingCount:e?.findingCount??0,
  anyFinding:fraction(e?.commandsWithFindings??0,n),
  publishedConstraint:fraction(e?.commandsByBasis.published??0,n),
  simulatorRule:fraction(e?.commandsByBasis['demo-rule']??0,n),
  integrationRule:fraction(e?.commandsByBasis['integration-rule']??0,n),
  physicalLimitRequest:fraction(e?.physicalLimitRequests??0,n)};
}
export function evaluationReport(sim){
 const audit=sim.commandAudit,stored=audit?.evaluation;
 const compatible=stored?.protocolId===EVALUATION_PROTOCOL&&stored?.controlPolicy===audit?.controlPolicy;
 const e=compatible?stored:null;
 const delta=k=>{const a=sim.stats[k],b=e?.baselineStats?.[k];return Number.isFinite(a)&&Number.isFinite(b)&&a>=b?a-b:null;};
 const exposure=delta('aircraftHours'),collisions=delta('collisions'),impacts=delta('groundImpacts');
 const combined=collisions===null||impacts===null?null:collisions+impacts;
 const incidentLast=sim.incidents[0]?.number??0;
 return {protocolId:EVALUATION_PROTOCOL,protocolStatus:spec.status,specification:'docs/evaluation-spec.json',methodology:'docs/methodology.md',studyDesign:spec.studyDesign,
  scope:{target:spec.targetScope,current:sim.trafficScope??'legacy-mixed-v1'},
  coverage:{instrumented:Boolean(e),startedAt:e?.startedAt??null,startedAtSimSeconds:e?.startedAtSimSeconds??null,throughSimSeconds:sim.elapsed,priorAuditedCommandsNotCategorized:e?.baselineAuditChecked??null,historyBeforeAuditStart:'not-reconstructed',incompatibleStoredProtocol:Boolean(stored&&!compatible),backfilled:false,controlPolicy:e?.controlPolicy??null,unclassifiedFindings:e?.unclassifiedFindings??null},
  commands:commandMetrics(e),byRule:e?{...e.byRule}:null,
  byPhase:e?Object.fromEntries(Object.entries(e.byPhase).map(([k,v])=>[k,commandMetrics(v)])):null,
  byScope:e?Object.fromEntries(Object.entries(e.byScope).map(([k,v])=>[k,commandMetrics(v)])):null,
  outcomes:{counterWindow:'Deltas from evaluation start; not the entire historical simulation.',airborneAircraftHours:exposure,collisionGroupEvents:collisions,groundImpactEvents:impacts,
   combinedEventsPer100AircraftHours:fraction(combined,exposure,'events/100 airborne aircraft-hours',100),
   measuredProcedureEpisodes:delta('procedureViolations'),separationEpisodes:delta('separationEpisodes'),criticalEpisodes:delta('criticalEpisodes'),takeoffs:delta('takeoffs'),landings:delta('landings'),completedCycles:delta('cycles')},
  dataAvailability:{commandWindow:{kind:'flagged-only rolling; not a representative sample',retained:audit?.records.length??0,dropped:audit?.droppedRecords??0,maxRecords:spec.retention.commandFlaggedRecords,maxBytes:spec.retention.commandFlaggedBytes},
   incidentWindow:{retained:sim.incidents.length,totalIncidentSequence:incidentLast,maxRecords:spec.retention.incidents},fullDecisionJournal:false,fullIncidentJournal:false,independentlyAdjudicatedLabels:false,preregisteredRunManifest:false},
  interpretation:{noFinding:spec.reporting.noFinding,attribution:spec.reporting.attribution,confidence:spec.reporting.confidence,statistics:spec.reporting.statistics},
  analysisReadiness:{descriptiveCommandCounts:Boolean(e?.checkedCommands),completeDecisionOutcomeStudy:false,blockers:['full-request-response-journal-missing','full-incident-journal-missing','frozen-run-manifest-missing',...(sim.trafficScope===AIRBORNE_SCOPE?[]:['airborne-only-scope-pending']),'independent-rule-adjudication-pending']}};
}
