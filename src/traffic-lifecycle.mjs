import {AIRPORT,RUNWAYS,FIXES,PROCEDURES,heading,offset} from './airport.mjs';
import {trueAirspeed} from './pilot.mjs';
export const AIRBORNE_SCOPE='airborne-handoff-v1';
export const TRAFFIC_POLICY=Object.freeze({id:'seeded-gates-v2',arrivalBoundaryMarginNm:0.5,departureIntervalSeconds:60,departureIasKt:180,arrivalIasKt:250,arrivalEntry:'assigned STAR first fix, upstream seeded scatter',departureEntry:'first SID fix at max(its minimum, runway elevation +1500 ft)',groundControl:false});
export function enableAirborneScope(sim,now=Date.now()){
 if(sim.trafficScope===AIRBORNE_SCOPE)return false;
 sim.trafficScope=AIRBORNE_SCOPE;sim.trafficEpoch={startedAt:now,elapsed:sim.elapsed,baseline:structuredClone(sim.stats),policy:TRAFFIC_POLICY.id};
 sim.nextDepartureAt=sim.elapsed;sim.requiresDecision=false;
 for(const f of [...sim.flights].sort((a,b)=>a.id.localeCompare(b.id)))if(f.phase==='taxi_out')queueDeparture(sim,f);
 return true;
}
export function queueDeparture(sim,f){
 f.phase='pending';f.command=null;f.releaseAt=sim.nextDepartureAt??sim.elapsed;
 sim.nextDepartureAt=f.releaseAt+TRAFFIC_POLICY.departureIntervalSeconds;
 f.lastSource='scenario';f.lastCommand='Scheduled airborne handoff';
}
export function releaseDepartures(sim){
 if(sim.trafficScope!==AIRBORNE_SCOPE)return [];
 const released=[];
 for(const f of [...sim.flights].sort((a,b)=>a.id.localeCompare(b.id)))if(f.phase==='pending'&&f.releaseAt<=sim.elapsed){
  const p=PROCEDURES[f.requestedDeparture],r=RUNWAYS[f.lane],leg=p.legs[0];[f.x,f.y]=FIXES[leg.fix].point;
  f.altitude=leg.altitude??Math.max(leg.minAltitude??0,r.elevation+1500);f.targetAltitude=f.altitude;f.speed=TRAFFIC_POLICY.departureIasKt;
  f.groundSpeed=f.trueAirspeed=trueAirspeed(f.speed,f.altitude);f.verticalRate=0;f.heading=heading(FIXES[leg.fix].point,FIXES[p.legs[1].fix].point);
  f.phase='departure';f.command=null;f.age=0;f.lastSource='scenario';f.lastCommand='Airborne handoff; awaiting Jev';
  f.initialCondition={source:'scenario',policy:TRAFFIC_POLICY.id,at:sim.elapsed,fix:leg.fix,runway:r.id};
  sim.stats.departureHandoffs=(sim.stats.departureHandoffs||0)+1;released.push(f.id);
 }
 if(released.length)sim.requiresDecision=true;return released;
}
export function placeArrivalAtGate(sim,f,random){
 const p=PROCEDURES[f.arrival],first=FIXES[p.legs[0].fix].point,back=heading(FIXES[p.legs[1].fix].point,first);
 const limit=AIRPORT.sectorRadiusNm-TRAFFIC_POLICY.arrivalBoundaryMarginNm;
 if(Math.hypot(...first)>=limit)throw new Error('STAR entry does not fit the scenario sector');
 const overlaps=candidate=>sim.flights.some(o=>o!==f&&['arrival','approach','departure'].includes(o.phase)&&Math.abs(o.altitude-candidate.altitude)<1000&&Math.hypot(o.x-candidate.x,o.y-candidate.y)<3);
 f.progress={[f.arrival]:0};f.speed=TRAFFIC_POLICY.arrivalIasKt;
 let attempts=0,boundaryRejectedProposals=0,chosen=null,lastAltitude=16000;
 for(;attempts<200;){
  attempts++;
  const upstream=offset(first,back,4+random(sim)*16),point=offset(upstream,random(sim)*360,2+random(sim)*6);
  lastAltitude=16000+Math.floor(random(sim)*8)*1000;
  // Scenario admission, not an AI correction: never inject outside the measured sector.
  if(Math.hypot(...point)>=limit){boundaryRejectedProposals++;continue;}
  chosen={x:point[0],y:point[1],altitude:lastAltitude};
  if(!overlaps(chosen))break;
 }
 const fallback=chosen===null;
 if(fallback)chosen={x:first[0],y:first[1],altitude:lastAltitude};
 Object.assign(f,chosen);
 f.heading=heading([f.x,f.y],first);f.targetAltitude=f.altitude;f.groundSpeed=f.trueAirspeed=trueAirspeed(f.speed,f.altitude);
 f.initialCondition={source:'scenario',policy:TRAFFIC_POLICY.id,at:sim.elapsed,fix:p.legs[0].fix,attempts,boundaryRejectedProposals,boundaryMarginNm:TRAFFIC_POLICY.arrivalBoundaryMarginNm,fallbackToEntryFix:fallback,initialSeparationUnresolved:overlaps(chosen)};
 sim.requiresDecision=true;
}
export function upcomingHandoffs(sim){return sim.flights.filter(f=>f.phase==='pending').sort((a,b)=>a.releaseAt-b.releaseAt||a.id.localeCompare(b.id)).slice(0,3).map(f=>({id:f.id,inSeconds:Math.max(0,f.releaseAt-sim.elapsed),runway:RUNWAYS[f.lane].id,procedure:f.requestedDeparture}));}
