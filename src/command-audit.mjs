import {PROCEDURES} from './airport.mjs';
import {initializeEvaluationCounters,recordEvaluatedCommand} from './evaluation.mjs';
import {procedureCommandIssues,PILOT_CONTROL_POLICY,trueAirspeed} from './pilot.mjs';
export const COMMAND_LOG_MAX_RECORDS=64;
export const COMMAND_LOG_MAX_BYTES=32000;
const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const round=n=>Math.round(n*1000)/1000;
export const commandSnapshot=c=>c?{...(c.id?{id:c.id}:{}),route:c.route,altitude:c.altitude,speed:c.speed,rate:c.rate,at:c.at}:null;
export function initializeCommandAudit(sim,now=Date.now()){
 let changed=false;
 if(!sim.commandAudit){sim.commandAudit={version:1,controlPolicy:PILOT_CONTROL_POLICY,startedAt:now,startedAtSimSeconds:sim.elapsed,checkedCommands:0,procedureCommands:0,constraintFindings:0,droppedRecords:0,records:[]};changed=true;}
 return initializeEvaluationCounters(sim,sim.commandAudit,now)||changed;
}
export function recordProcedureCommand(sim,flight,planRevision){
 initializeCommandAudit(sim);
 const audit=sim.commandAudit,issues=procedureCommandIssues(flight,{includeClearance:true}).map(({message,...issue})=>issue);
 audit.checkedCommands++;recordEvaluatedCommand(sim,flight,issues);
 if(!issues.length)return null;
 const c=flight.command,n=c.navigation,p=PROCEDURES[n.procedure];
 const entry={code:'procedure-command',commandId:c.id,planRevision,time:round(sim.elapsed),aircraft:flight.id,generation:flight.generation,action:'applied-unmodified',command:commandSnapshot(c),context:{phase:flight.phase,procedure:p?.id??c.route,legIndex:n.index,fix:n.fix??p?.legs[n.index]?.fix??null,positionNm:[round(flight.x),round(flight.y)],altitudeFt:round(flight.altitude),iasKt:round(flight.speed),groundSpeedKt:round(trueAirspeed(flight.speed,flight.altitude))},issues};
 audit.procedureCommands++;audit.constraintFindings+=issues.length;audit.records.unshift(entry);
 // Command warnings must not displace the independent physical-incident window.
 while(audit.records.length>COMMAND_LOG_MAX_RECORDS||byteLength(audit.records)>COMMAND_LOG_MAX_BYTES){audit.records.pop();audit.droppedRecords++;}
 return entry;
}
export function commandAuditSummary(sim){
 const a=sim.commandAudit;
 return {version:1,controlPolicy:a?.controlPolicy??null,startedAt:a?.startedAt??null,startedAtSimSeconds:a?.startedAtSimSeconds??null,checkedCommands:a?.checkedCommands??0,procedureCommands:a?.procedureCommands??0,constraintFindings:a?.constraintFindings??0,droppedRecords:a?.droppedRecords??0,retainedRecords:a?.records.length??0,maxRecords:COMMAND_LOG_MAX_RECORDS,maxRecordBytes:COMMAND_LOG_MAX_BYTES};
}
export function commandAuditReport(sim){
 return {...commandAuditSummary(sim),scope:'Accepted commands versus active constraints at receipt, not measured flight violations. Published limits, demo rules and integration rules are labeled separately. No historical backfill; repeated new decisions count again, physics ticks do not. Old records are bounded; cumulative counters remain.',records:sim.commandAudit?.records??[]};
}
