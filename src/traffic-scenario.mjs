// Route-aware synthetic demand. These are disclosed scenario inputs, not measured LTFM traffic.
import {AIRPORT,ACTIVE_RUNWAYS,RUNWAYS,FIXES,PROCEDURES,heading} from './airport.mjs';
import {trueAirspeed} from './pilot.mjs';
import {emitObservation} from './observation-events.mjs';
import {initialRouteProfile} from './traffic-profile.mjs';
export const DISTRIBUTED_TRAFFIC=Object.freeze({id:'distributed-flow-v1',initialArrivals:18,initialDepartures:12,initialApproaches:6,arrivalGapSeconds:[75,150],departureGapSeconds:[90,165],admissionRetrySeconds:15,initialHorizontalNm:3.1,initialVerticalFt:1000,maxInitialAttempts:400,groundControl:false});
const active=f=>['arrival','approach','departure','takeoff'].includes(f.phase);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,precision=1e6)=>Math.round(v*precision)/precision;
function draw(sim,key='placementRng') {const s=sim.trafficScenario;s[key]=(Math.imul(s[key],1664525)+1013904223)>>>0;return s[key]/4294967296;}
function shuffle(sim,items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(draw(sim)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const paths=new Map();
function pathFor(p){
 if(paths.has(p.id))return paths.get(p.id);
 const points=p.legs.map(l=>FIXES[l.fix].point),distances=[0];
 for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
 const value={points,distances,total:distances.at(-1)};paths.set(p.id,value);return value;
}
export function scenarioRouteProfile(p,lane){return initialRouteProfile(p,pathFor(p),RUNWAYS[lane]);}
const profile=scenarioRouteProfile;
function separated(sim,f,candidate,horizontal=DISTRIBUTED_TRAFFIC.initialHorizontalNm){
 return !sim.flights.some(o=>o!==f&&active(o)&&Math.abs(o.altitude-candidate.altitude)<DISTRIBUTED_TRAFFIC.initialVerticalFt&&Math.hypot(o.x-candidate.x,o.y-candidate.y)<horizontal);
}
function sampleRoute(sim,f,p,lower,upper,stage){
 const path=pathFor(p),values=profile(p,f.lane);
 for(let attempt=1;attempt<=DISTRIBUTED_TRAFFIC.maxInitialAttempts;attempt++){
  const travelled=path.total*(lower+(upper-lower)*draw(sim));
  let index=1;while(index<path.distances.length-1&&path.distances[index]<travelled)index++;
  const a=path.points[index-1],b=path.points[index],length=path.distances[index]-path.distances[index-1],t=(travelled-path.distances[index-1])/length;
  const cross=(draw(sim)-.5)*(p.kind==='APP'?.04:.3),dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length;
  const v0=values[index-1],v1=values[index],altitude=Math.round(v0.altitude+(v1.altitude-v0.altitude)*t);
  const candidate={x:round(a[0]+(b[0]-a[0])*t-dy*cross),y:round(a[1]+(b[1]-a[1])*t+dx*cross),altitude};
  if(Math.hypot(candidate.x,candidate.y)>=AIRPORT.sectorRadiusNm-.5||!separated(sim,f,candidate))continue;
  if(sim.flights.some(o=>o!==f&&active(o)&&Math.hypot(o.x-candidate.x,o.y-candidate.y)<1))continue;
  const speed=round(Math.min(altitude<10000?250:Infinity,v0.speed+(v1.speed-v0.speed)*t),10);
  Object.assign(f,candidate,{speed,heading:round(heading([candidate.x,candidate.y],b)),verticalRate:0,bank:0,command:null,pilot:null,age:0,wait:0,progress:{[p.id]:index},targetAltitude:altitude,phase:p.kind==='SID'?'departure':p.kind==='APP'?'approach':'arrival',lastSource:'scenario',lastCommand:'Scenario initial state; awaiting Jev',landingClearance:p.kind==='APP'?p.runway:null});
  f.trueAirspeed=f.groundSpeed=round(trueAirspeed(speed,altitude));
  f.verticalRate=Math.round(clamp((v1.altitude-v0.altitude)/length*f.groundSpeed/60,-1500,1800));
  f.initialCondition={source:'scenario',policy:DISTRIBUTED_TRAFFIC.id,kind:'warm-start',stage,route:p.id,at:sim.elapsed,nextFix:p.legs[index].fix,nextIndex:index,alongTrackNm:round(travelled),remainingRouteNm:round(path.total-travelled),crossTrackNm:round(cross),attempts:attempt,initialSeparationUnresolved:false,initialClearance:p.kind==='APP'?{runway:p.runway,source:'scenario-not-Jev'}:null};
  return;
 }
 throw Error('Distributed traffic placement exhausted: '+stage+' '+p.id+' '+f.id);
}
export function queueDistributedTraffic(sim,f){
 const s=sim.trafficScenario,arrival=f.mission==='arrival',key=arrival?'nextArrivalAt':'nextDepartureAt',range=arrival?DISTRIBUTED_TRAFFIC.arrivalGapSeconds:DISTRIBUTED_TRAFFIC.departureGapSeconds;
 const gap=range[0]+Math.floor(draw(sim,'scheduleRng')*(range[1]-range[0]+1));
 s[key]=Math.max(sim.elapsed,s[key]??sim.elapsed)+gap;
 const {p,state}=entryState(f);
 Object.assign(f,state,{phase:'pending',command:null,pilot:null,verticalRate:0,bank:0,age:0,wait:0,targetAltitude:state.altitude,progress:{[p.id]:0},releaseAt:s[key],admissionRetryAt:null,landingClearance:null,initialCondition:null,lastSource:'scenario',lastCommand:'Scheduled '+f.mission+' handoff; not yet in the sector'});
 f.groundSpeed=f.trueAirspeed=round(trueAirspeed(f.speed,f.altitude));
 f.scheduledGapSeconds=gap;f.admissionAttempts=0;
}
export function initializeDistributedTraffic(sim){
 if(sim.trafficScenario||sim.elapsed!==0||sim.flights.some(f=>f.command))throw Error('Distributed initialization requires a fresh untouched simulation');
 sim.trafficScenario={id:DISTRIBUTED_TRAFFIC.id,placementRng:(sim.initialSeed^0xa5c31f27)>>>0,scheduleRng:(sim.initialSeed^0x79bdf246)>>>0,nextArrivalAt:0,nextDepartureAt:0,admissionDeferrals:0,initialPopulation:{arrivals:18,departures:12,approaches:6,pending:64},evidenceClass:'synthetic-scenario-not-observed-airport-traffic'};
 for(const f of sim.flights){f.phase='pending';f.command=null;f.landingClearance=null;f.initialCondition=null;}
 const arrivals=shuffle(sim,sim.flights.filter(f=>f.mission==='arrival')),departures=shuffle(sim,sim.flights.filter(f=>f.mission==='departure'));
 const stars=['RIXEN1P','ERSEN1R'],bands=[[.03,.27,'arrival-enroute'],[.30,.59,'arrival-descent'],[.62,.94,'arrival-terminal']];
 // Place constrained approach slots first; wider upstream bands are filled afterwards.
 for(const i of [3,4,5,0,1,2]){
  const f=arrivals[18+i],r=ACTIVE_RUNWAYS[i%3],entry=i<3?['GAZGE','INSTA','ULQAL'][i]:['INSTA','GAZGE','INSTA'][i-3],p=PROCEDURES['ILS_'+r.id+'_'+entry];
  f.lane=RUNWAYS.findIndex(a=>a.id===r.id);
  // Separate synthetic approach observation ages; do not bunch parallel approaches at equal distances.
  const slot=(i-3+(sim.initialSeed%3)+3)%3,total=pathFor(p).total,remaining=3+7*slot;
  const firstLegFraction=pathFor(p).distances[1]/total;
  const band=i<3?[.10*firstLegFraction,.40*firstLegFraction,'approach-transition']:[1-(remaining+.5)/total,1-(remaining-.5)/total,remaining>12?'approach-intercept':'approach-final'];
  sampleRoute(sim,f,p,...band);
 }
 for(let group=0;group<3;group++)for(let i=0;i<6;i++){
  const f=arrivals[group*6+i],p=PROCEDURES[stars[(i+group)%2]];f.arrival=p.id;
  f.lane=RUNWAYS.findIndex(r=>r.id===ACTIVE_RUNWAYS[(i+group)%3].id);
  sampleRoute(sim,f,p,...bands[group]);
 }
 const sids=Object.keys(PROCEDURES).filter(id=>PROCEDURES[id].kind==='SID').sort();
 for(let i=0;i<12;i++){
  const f=departures[i],p=PROCEDURES[sids[i%6]];f.requestedDeparture=p.id;f.arrival=null;
  f.lane=RUNWAYS.findIndex(r=>r.id===p.runway);f.exit=[...FIXES[p.legs.at(-1).fix].point];
  sampleRoute(sim,f,p,...(i<6?[.02,.30,'departure-climb']:[.35,.82,'departure-outbound']));
 }
 for(const f of arrivals.slice(24))queueDistributedTraffic(sim,f);
 for(const f of departures.slice(12))queueDistributedTraffic(sim,f);
 sim.stats.arrivalHandoffs=0;sim.stats.departureHandoffs=0;sim.requiresDecision=true;
 sim.trafficEpoch.policy=DISTRIBUTED_TRAFFIC.id;
}
function entryState(f){
 const p=PROCEDURES[f.mission==='arrival'?f.arrival:f.requestedDeparture],point=FIXES[p.legs[0].fix].point,value=profile(p,f.lane)[0];
 const altitude=Math.round(value.altitude),speed=round(value.speed,10);
 return {p,state:{x:round(point[0]),y:round(point[1]),altitude,speed,heading:round(heading(point,FIXES[p.legs[1].fix].point))}};
}
function admissionEvent(sim,f){
 const event={kind:'event',time:sim.elapsed,text:f.id+' scenario admission deferred',source:'scenario',code:'traffic-admission-deferred',aircraft:f.id,mission:f.mission,scheduledAt:f.releaseAt,retryAt:f.admissionRetryAt};
 emitObservation(sim,event);const {kind,...display}=event;sim.events.unshift(display);sim.events=sim.events.slice(0,100);
}
export function releaseDistributedTraffic(sim){
 const released=[],seen=new Set();
 for(const f of sim.flights.filter(f=>f.phase==='pending').sort((a,b)=>a.releaseAt-b.releaseAt||a.id.localeCompare(b.id))){
  if(seen.has(f.mission))continue;seen.add(f.mission);
  const lastKey=f.mission==='arrival'?'lastArrivalAt':'lastDepartureAt',last=sim.trafficScenario[lastKey];
  if(f.releaseAt>sim.elapsed||(f.admissionRetryAt??0)>sim.elapsed||(last!=null&&last+f.scheduledGapSeconds>sim.elapsed))continue;
  const {p,state}=entryState(f);f.admissionAttempts++;
  // Admission control only: never move an airborne flight or change its command.
  if(!separated(sim,f,state)){
   f.admissionRetryAt=sim.elapsed+DISTRIBUTED_TRAFFIC.admissionRetrySeconds;
   sim.trafficScenario.admissionDeferrals++;admissionEvent(sim,f);continue;
  }
  Object.assign(f,state,{phase:f.mission==='arrival'?'arrival':'departure',command:null,pilot:null,bank:0,verticalRate:0,age:0,wait:0,progress:{[p.id]:0},targetAltitude:state.altitude,landingClearance:null,lastSource:'scenario',lastCommand:'Scheduled sector entry; awaiting Jev',admissionRetryAt:null});
  f.groundSpeed=f.trueAirspeed=round(trueAirspeed(f.speed,f.altitude));
  f.initialCondition={source:'scenario',policy:DISTRIBUTED_TRAFFIC.id,kind:'scheduled-entry',route:p.id,at:sim.elapsed,fix:p.legs[0].fix,nextIndex:0,scheduledAt:f.releaseAt,admissionDelaySeconds:sim.elapsed-f.releaseAt,attempts:f.admissionAttempts,initialSeparationUnresolved:false};
  sim.trafficScenario[lastKey]=sim.elapsed;
  const counter=f.mission==='arrival'?'arrivalHandoffs':'departureHandoffs';sim.stats[counter]=(sim.stats[counter]??0)+1;released.push(f.id);
 }
 if(released.length)sim.requiresDecision=true;return released;
}
