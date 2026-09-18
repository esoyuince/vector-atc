import {emitObservation} from './observation-events.mjs';
import {AIRBORNE_SCOPE,TRAFFIC_POLICY,enableAirborneScope,queueDeparture,releaseDepartures,placeArrivalAtGate,upcomingHandoffs} from './traffic-lifecycle.mjs';
import {MEASUREMENT_POLICY,SURFACE_MODEL,EXIT_POLICY,isAirborne,collisionParticipant,motionSnapshot,encounter,surfaceContact,exitCandidate} from './flight-events.mjs';
import {pilotStep,advancePilotNavigation,trueAirspeed,PILOT_MODEL,PILOT_CONTROL_POLICY,holdingSpeedLimit,performanceProfile} from './pilot.mjs';
// Published LTFM geometry with synthetic traffic. Only TypeSafe selects ATC commands.
import {AIRPORT,DATASET_INFO,RUNWAYS,ACTIVE_RUNWAYS,FIXES,PROCEDURES,ALTITUDES,SPEEDS,RATES,routeOptions,navigation,procedureContext,runwayPosition,unproject,offset} from './airport.mjs';
import {commandSnapshot,initializeCommandAudit,recordProcedureCommand,commandAuditSummary,commandAuditReport} from './command-audit.mjs';
import {evaluationReport} from './evaluation.mjs';
export {RUNWAYS,routeOptions};
export const PHASES={pending:'Hava kontrolune katilim bekliyor',taxi_out:'Kalkış kuyruğu',takeoff:'Kalkış',departure:'Alandan çıkış',arrival:'İniş kuyruğu',approach:'Son yaklaşma',landing:'İniş',crashed:'Kaza / yeniden doğma'};
export const CONTROL_SECONDS=60;
const rad=Math.PI/180;
const norm=n=>(n%360+360)%360;
const round=n=>Math.round(n*10)/10;
const airborne=isAirborne;
const headingTo=(a,b)=>norm(Math.atan2(b[0]-a.x,b[1]-a.y)/rad);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function random(sim){sim.seed=(Math.imul(sim.seed,1664525)+1013904223)>>>0;return sim.seed/4294967296;}
export function addEvent(sim,text,source='system',detail={}){emitObservation(sim,{kind:'event',time:sim.elapsed,text,source,...detail});sim.events.unshift({time:Math.floor(sim.elapsed),text,source,...detail});sim.events=sim.events.slice(0,100);}
function spawn(sim,f,initial=false,completed=false){
 f.generation=(f.generation||0)+1;f.command=null;f.age=0;f.wait=0;f.verticalRate=0;f.targetAltitude=0;f.lastSource='awaiting';f.lastCommand='TypeSafe komutu bekleniyor';
 f.exitPending=false;f.initialCondition=null;f.bank=0;f.pilot=null;f.groundSpeed=f.speed;f.priority=false;f.landingClearance=null;f.progress={};f.constraintEpisodes=[];f.procedureDone=false;
 f.lane=RUNWAYS.indexOf(ACTIVE_RUNWAYS[Math.floor(random(sim)*ACTIVE_RUNWAYS.length)]);
 if(f.mission==='departure'){
  const r=RUNWAYS[f.lane];f.phase='taxi_out';f.x=r.x+.1;f.y=r.y+(Number(f.id.slice(-3))%12)*.04;f.altitude=r.elevation;f.speed=0;f.heading=r.headingTrue;
  const options=Object.values(PROCEDURES).filter(p=>p.kind==='SID'&&p.runway===r.id);f.requestedDeparture=options[Math.floor(random(sim)*options.length)].id;
  f.exit=[...FIXES[PROCEDURES[f.requestedDeparture].legs.at(-1).fix].point];f.arrival=null;
 }
 else{
  f.phase='arrival';f.arrival=random(sim)<.5?'RIXEN1P':'ERSEN1R';f.requestedDeparture=null;
  const p=PROCEDURES[f.arrival],index=Math.floor(random(sim)*(p.legs.length-4));f.progress[f.arrival]=index;
  const entry=FIXES[p.legs[index].fix].point;f.exit=[0,0];
  for(let attempt=0;attempt<200;attempt++){
   const angle=random(sim)*Math.PI*2,r=2+random(sim)*7;
   f.x=entry[0]+Math.sin(angle)*r;f.y=entry[1]+Math.cos(angle)*r;f.altitude=(index>p.legs.length-10?10000:16000)+Math.floor(random(sim)*5)*1000;
   if(!sim.flights.some(o=>o!==f&&airborne(o)&&Math.abs(o.altitude-f.altitude)<1000&&distance(o,f)<3))break;
  }
  f.heading=headingTo(f,entry);f.speed=250;f.targetAltitude=f.altitude;
 }
 if(sim.trafficScope===AIRBORNE_SCOPE){if(f.mission==='departure')queueDeparture(sim,f);else placeArrivalAtGate(sim,f,random);}
 f.groundSpeed=trueAirspeed(f.speed,f.altitude);f.trueAirspeed=f.groundSpeed;
 f.note=f.mission==='arrival'?'Rastgele giriş · iniş talebi':'Kalkış talebi · rastgele çıkış noktası';
 if(!initial){if(completed){f.cycles++;sim.stats.cycles++;}sim.stats.respawns++;addEvent(sim,f.id+' yeniden doğdu · '+PHASES[f.phase]);}
}
export function createSimulation(now=Date.now(),seed=123456789){
 const sim={version:4,dataset:DATASET_INFO.id,revision:0,seed:seed>>>0,initialSeed:seed>>>0,elapsed:0,lastWall:now,flights:[],runways:RUNWAYS.map(r=>({...r,reserved:null,occupants:[],completed:0})),
 stats:{takeoffs:0,landings:0,departures:0,cycles:0,respawns:0,aiApplied:0,rejected:0,collisions:0,groundImpacts:0,separationEpisodes:0,criticalEpisodes:0,runwayIncursions:0,sectorViolations:0,aircraftHours:0,completedWaitSeconds:0,clearances:0},
 events:[],alerts:[],incidents:[],openSeparation:[],openCritical:[],openRunway:[]};
 Object.assign(sim.stats,{procedureViolations:0,altitudeViolations:0,speedViolations:0,routeViolations:0,clearanceMismatches:0,runwayAssignmentConflicts:0});
 for(let i=0;i<100;i++){const f={id:['TRK','PGS','AJT','SXS'][i%4]+(101+i),type:['B738','A320','A21N','B789'][i%4],mission:i<50?'departure':'arrival',cycles:0,generation:0};spawn(sim,f,true);sim.flights.push(f);}
 sim.dataEpoch={dataset:DATASET_INFO.id,previousDataset:null,startedAt:now,elapsed:0,baseline:structuredClone(sim.stats)};
sim.measurementEpoch={policy:MEASUREMENT_POLICY,startedAt:now,elapsed:0,baseline:structuredClone(sim.stats)};
 initializeCommandAudit(sim,now);
 sim.controlEpoch={policy:PILOT_CONTROL_POLICY,previousPolicy:null,startedAt:now,elapsed:0,baseline:structuredClone(sim.stats)};
 return sim;
}
export function createAirborneSimulation(now=Date.now(),seed=123456789){
 const sim=createSimulation(now,seed);enableAirborneScope(sim,now);
 for(const f of sim.flights)if(f.mission==='arrival')placeArrivalAtGate(sim,f,random);
 releaseDepartures(sim);return sim;
}
export function telemetry(f){return {id:f.id,type:f.type,performance:performanceProfile(f.type),generation:f.generation,mission:f.mission,phase:f.phase,positionNm:[round(f.x),round(f.y)],positionLatLon:unproject(f.x,f.y),headingTrueDeg:round(f.heading),headingDeg:round(f.heading),altitudeFt:Math.round(f.altitude),speedKt:round(f.speed),airspeedKind:'IAS',trueAirspeedKt:round(f.trueAirspeed||f.speed),groundSpeedKt:round(f.groundSpeed||f.speed),bankDeg:round(f.bank||0),pilot:f.pilot||null,verticalRateFpm:Math.round(f.verticalRate),flightPathAngleDeg:round(Math.atan2(f.verticalRate,(f.groundSpeed||f.speed)*6076/60)/rad),waitSeconds:Math.floor(f.wait),runway:RUNWAYS[f.lane].id,procedure:procedureContext(f),command:f.command?{route:f.command.route,altitudeFt:f.command.altitude,speedKt:f.command.speed,verticalRateFpm:f.command.rate}:null};}
export function predictedConflicts(flights,horizon=120){
 const list=structuredClone(flights.filter(collisionParticipant)).sort((a,b)=>a.id.localeCompare(b.id)),found=new Map();
 function sample(before,seconds,contacts=new Map()){
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
   const a=list[i],b=list[j];if(a.forecastEnded||b.forecastEnded)continue;
   const a0=before.get(a.id),b0=before.get(b.id),end=Math.min(contacts.get(a.id)?.fraction??1,contacts.get(b.id)?.fraction??1);
   const hit=encounter(a0,a,b0,b,3,1000,end);if(!hit)continue;
   const critical=encounter(a0,a,b0,b,1,500,end),m=critical||hit,key=a.id+':'+b.id,old=found.get(key);
   if(!old||critical&&!old.critical)found.set(key,{a:a.id,b:b.id,seconds:round(Math.max(0,seconds+m.fraction)),distance:round(m.distance),verticalFt:Math.round(m.verticalFt),critical:Boolean(critical)});
  }
 }
 sample(new Map(list.map(f=>[f.id,motionSnapshot(f)])),-1);
 for(let seconds=0;seconds<horizon;seconds++){
  const before=new Map(list.map(f=>[f.id,motionSnapshot(f)])),contacts=new Map();
  for(const f of list){
   if(f.forecastEnded)continue;
   if(f.phase==='landing'){const left=Math.max(0,2-(f.age||0));f.age=(f.age||0)+1;if(left<=1)contacts.set(f.id,{kind:'expiry',fraction:left});continue;}
   if(f.command){pilotStep(f,1);advancePilotNavigation(f,before.get(f.id));const contact=surfaceContact(f,before.get(f.id));if(contact)contacts.set(f.id,contact);}
  }
  sample(before,seconds,contacts);
  for(const [id,c] of contacts){const f=list.find(f=>f.id===id);Object.assign(f,c.point);if(c.kind==='landing'){f.phase='landing';f.age=0;}else f.forecastEnded=true;}
 }
 return [...found.values()].sort((a,b)=>Number(b.critical)-Number(a.critical)||a.seconds-b.seconds||a.a.localeCompare(b.a)||a.b.localeCompare(b.b));
}
export function makePlan(sim){
 const flights=sim.flights.filter(f=>sim.trafficScope===AIRBORNE_SCOPE?airborne(f):f.phase!=='crashed'&&f.phase!=='landing'&&f.phase!=='pending');
 const runways=sim.runways.map(r=>({id:r.id,choices:flights.filter(f=>r.active&&((RUNWAYS[f.lane].id===r.id&&f.phase==='taxi_out')||(f.mission==='arrival'&&f.phase==='arrival'&&['GAZGE','INSTA','ULQAL'].some(id=>Math.hypot(f.x-FIXES[id].point[0],f.y-FIXES[id].point[1])<8)))).sort((a,b)=>b.wait-a.wait).map(f=>({id:f.id,generation:f.generation,kind:f.phase==='taxi_out'?'departure':'arrival'}))}));
 return {revision:sim.revision,flights:flights.map(f=>({id:f.id,generation:f.generation,phase:f.phase,routes:routeOptions(f)})),runways:runways.filter(r=>r.choices.length),state:{trafficScope:sim.trafficScope??'legacy-mixed-v1',upcomingHandoffs:upcomingHandoffs(sim),units:'NM from LTFM ARP; altitude ft MSL, indicated airspeed knots (groundSpeedKt for motion), TRUE heading degrees, fpm. FL approximated as hundreds of ft (standard pressure).' ,horizonSeconds:CONTROL_SECONDS,airport:{id:AIRPORT.id,transitionAltitude:AIRPORT.transitionAltitude,scope:'South flow; published routes, timed 60/90s holds and bank-limited entries. Numeric restrictions are measured, not repaired.'},aircraft:Object.fromEntries(sim.flights.filter(f=>sim.trafficScope!==AIRBORNE_SCOPE||collisionParticipant(f)).map(f=>[f.id,telemetry(f)])),runways:sim.runways,conflicts:predictedConflicts(sim.flights),recentIncidents:sim.incidents.slice(0,5)}};
}
export function recordIncident(sim,type,ids,detail={}){
 const completeCommands=detail.commands?.map(commandSnapshot);const fullCommandIds=ids.map(id=>sim.flights.find(f=>f.id===id)?.command?.id??null);
 // Keep every participant ID, but bounded command evidence without navigation arrays.
 if(detail.command)detail={...detail,command:commandSnapshot(detail.command)};
 if(detail.commands)detail={...detail,commandCount:detail.commands.length,commands:detail.commands.slice(0,10).map(commandSnapshot),commandSampleLimit:10};
 const currentCommandIds=ids.length<=10?ids.map(id=>sim.flights.find(f=>f.id===id)?.command?.id??null):null;
 const commandLinks=currentCommandIds?.some(Boolean)?{commandIds:currentCommandIds,commandLinkSemantics:'active-at-measurement-not-causal'}:{};
 const incident={number:sim.incidents.length?sim.incidents[0].number+1:1,time:round(sim.elapsed),type,aircraft:ids,...commandLinks,...detail};
 emitObservation(sim,{kind:'incident',...incident,commandIds:fullCommandIds,commandLinkSemantics:'active-at-measurement-not-causal',...(completeCommands?{commands:completeCommands,commandCount:completeCommands.length,commandSampleLimit:null}:{})});
 sim.incidents.unshift(incident);sim.incidents=sim.incidents.slice(0,200);addEvent(sim,type+' · '+ids.join(' / '),'measurement',detail);
}
export function applyFleetDecision(sim,plan,answers){
 if(plan.revision!==sim.revision){sim.stats.rejected+=plan.flights.length;return {applied:0,rejected:plan.flights.length};}
 const clearances=new Map(),assignments=new Map();
 for(const r of plan.runways){
  const id=answers['runway_'+r.id]?.choice,c=r.choices.find(c=>c.id===id);if(!c)continue;
  const list=assignments.get(id)||[];list.push({...c,runway:r.id});assignments.set(id,list);clearances.set(id,list.at(-1));
 }
 for(const [id,list] of assignments)if(list.length>1){
  const requestedRunways=list.map(c=>c.runway),executionRunway=requestedRunways.at(-1);
  sim.stats.runwayAssignmentConflicts=(sim.stats.runwayAssignmentConflicts||0)+1;
  recordIncident(sim,'Çelişkili pist izinleri',[id],{code:'multiple-runway-assignment',requestedRunways,executionRunway,resolution:'last-in-plan-order',planRevision:plan.revision});
 }
 let applied=0,rejected=0;
 for(const p of plan.flights){
  const f=sim.flights.find(f=>f.id===p.id),route=answers[f.id+'_route']?.choice,altitude=Number(answers[f.id+'_altitude']?.choice),speed=Number(answers[f.id+'_speed']?.choice),rate=Number(answers[f.id+'_rate']?.choice);
  if(f.generation!==p.generation||!Object.hasOwn(p.routes,route)||!ALTITUDES.includes(altitude)||!SPEEDS.includes(speed)||!RATES.includes(rate)){rejected++;continue;}
  const clearance=clearances.get(f.id),procedure=PROCEDURES[route];
  if(clearance?.kind==='arrival')f.landingClearance=clearance.runway;
  if(procedure?.kind==='APP'&&f.landingClearance!==procedure.runway){
   sim.stats.clearanceMismatches++;recordIncident(sim,'İzinsiz final komutu',[f.id],{route,clearance:f.landingClearance});
  }
  if(procedure?.kind!=='APP')f.landingClearance=null;
  const nav=navigation(f,route,speed);
  f.command={id:plan.revision+':'+f.id+':'+f.generation,route,altitude,speed,rate,navigation:nav,point:nav.points[Math.min(nav.index,nav.points.length-1)],at:sim.elapsed};
  f.targetAltitude=altitude;f.lastSource='typesafe';f.lastCommand=route+' · '+altitude+' ft · '+speed+' kt · '+rate+' fpm';applied++;
  if(procedure?.kind==='APP'){f.lane=RUNWAYS.findIndex(r=>r.id===procedure.runway);f.phase='approach';}
  else if(f.phase==='approach')f.phase='arrival';
  if(clearance?.kind==='departure'&&f.phase==='taxi_out'){
   const r=RUNWAYS[f.lane];f.phase='takeoff';f.x=r.x;f.y=r.y;f.altitude=r.elevation;f.heading=r.headingTrue;f.age=0;
   sim.stats.completedWaitSeconds+=f.wait;sim.stats.clearances++;addEvent(sim,f.id+' kalkış izni · '+clearance.runway,'typesafe');
  }else if(clearance?.kind==='arrival'&&procedure?.kind==='APP'){sim.stats.completedWaitSeconds+=f.wait;sim.stats.clearances++;addEvent(sim,f.id+' iniş izni · '+clearance.runway,'typesafe');}
  const auditEntry=recordProcedureCommand(sim,f,plan.revision);
  emitObservation(sim,{kind:'command-applied',planRevision:plan.revision,aircraft:f.id,generation:f.generation,command:commandSnapshot(f.command),context:telemetry(f),issues:auditEntry?.issues??[]});
  if(auditEntry)addEvent(sim,'Prosedür dışı komut · '+f.id,'measurement',{code:'procedure-command',commandId:f.command.id,findings:auditEntry.issues.length});
 }
 if(sim.trafficScope===AIRBORNE_SCOPE)sim.requiresDecision=sim.flights.some(f=>airborne(f)&&!f.command);
 sim.stats.aiApplied+=applied;sim.stats.rejected+=rejected;sim.revision++;return {applied,rejected};
}
function violation(sim,f,kind,detail,key){
 const eventKey=kind+':'+key;if(f.constraintEpisodes.includes(eventKey))return;
 f.constraintEpisodes.push(eventKey);sim.stats.procedureViolations++;sim.stats[kind+'Violations']++;
 recordIncident(sim,'Prosedür ihlali',[f.id],{category:kind,...detail,command:f.command});
}
function crossing(sim,f,leg){
 const low=leg.altitude??leg.minAltitude??-Infinity,high=leg.altitude??leg.maxAltitude??Infinity;
 if(f.altitude<low-150||f.altitude>high+150)violation(sim,f,'altitude',{fix:leg.fix,actual:round(f.altitude),min:low===-Infinity?null:low,max:high===Infinity?null:high},f.command.route+':'+leg.fix);
 const speed=leg.speed??leg.maxSpeed;
 if(speed&&(leg.speed?Math.abs(f.speed-speed)>5:f.speed>speed+5))violation(sim,f,'speed',{fix:leg.fix,actual:round(f.speed),required:leg.speed,max:leg.maxSpeed},f.command.route+':'+leg.fix);
}
function move(sim,f,dt){
 const c=f.command;if(!c||['taxi_out','crashed','landing'].includes(f.phase)){f.verticalRate=0;return;}
 const n=c.navigation,r=RUNWAYS[f.lane],p=n.procedure?PROCEDURES[n.procedure]:null;
 const before=motionSnapshot(f);const point=pilotStep(f,dt);
 if(['SID','MISSED'].includes(p?.kind)&&f.phase!=='takeoff'&&f.altitude<p.minTurnAltitude&&Math.abs(((f.heading-r.headingTrue+540)%360)-180)>10)violation(sim,f,'altitude',{rule:'minimum turn altitude',required:p.minTurnAltitude,actual:round(f.altitude)},c.route+':turn');
 if(p?.kind==='APP'){
  const fapIndex=p.legs.findIndex(l=>l.fix===p.fap),level=p.legs[fapIndex]?.altitude;
  if(n.index<=fapIndex&&f.altitude<level-150)violation(sim,f,'altitude',{rule:'descent below FAP level before crossing FAP',fix:p.fap,min:level,actual:round(f.altitude)},c.route+':early-descent');
  if(n.index>fapIndex){
   const profileAltitude=r.elevation+Math.tan((p.glideAngle||3)*rad)*Math.hypot(f.x-r.x,f.y-r.y)*6076.12;
   if(Math.abs(f.altitude-profileAltitude)>150)violation(sim,f,'altitude',{rule:'approach vertical path',actual:round(f.altitude),profileAltitude:round(profileAltitude),toleranceFt:150},c.route+':glide-path');
  }
 }
 if(p?.kind==='SID'&&f.speed>0&&(f.phase==='departure'||f.altitude>r.elevation+50)&&f.altitude<p.climbGradientUntil&&f.altitude<f.command.altitude-150&&f.verticalRate/((f.groundSpeed||trueAirspeed(f.speed,f.altitude))/60)<p.minClimbFtPerNm)violation(sim,f,'altitude',{rule:'SID climb gradient',requiredFtPerNm:p.minClimbFtPerNm,actual:round(f.verticalRate/((f.groundSpeed||trueAirspeed(f.speed,f.altitude))/60))},c.route+':gradient');
 if(n.kind==='HOLD'){
  const h=AIRPORT.holds.find(h=>h.fix===n.fix);
  if(f.altitude<h.minAltitude-150)violation(sim,f,'altitude',{rule:'holding minimum',fix:h.fix,min:h.minAltitude,actual:round(f.altitude)},c.route+':hold');
  const maximum=holdingSpeedLimit(n.fix,f.altitude);
  if(f.speed>maximum+5)violation(sim,f,'speed',{rule:'holding speed limit',fix:h.fix,max:maximum,actual:round(f.speed)},c.route+':hold-speed');
 }
 if(p&&!n.joining&&n.index>0){
  const a=n.points[n.index-1],b=n.points[n.index],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  const cross=length?Math.abs((f.x-a[0])*dy-(f.y-a[1])*dx)/length:0;
  if(cross>2)violation(sim,f,'route',{rule:'demo cross-track tolerance',fix:p.legs[n.index].fix,crossTrackNm:round(cross),limitNm:2},c.route+':'+n.index);
 }
 if(f.altitude<10000&&f.speed>255)violation(sim,f,'speed',{rule:'low altitude speed limit',max:250,actual:round(f.speed)},c.route+':low-altitude-speed');
 const crossed=advancePilotNavigation(f,before);if(crossed)crossing(sim,f,crossed);
}
function measurements(sim,before,contacts,dt){
 const list=sim.flights.filter(collisionParticipant).sort((a,b)=>a.id.localeCompare(b.id)),separation=[],critical=[],collisionGroups=[];
 const hitTimes=new Map();
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
  const a=list[i],b=list[j],a0=before.get(a.id),b0=before.get(b.id),key=[a.id+':'+a.generation,b.id+':'+b.generation].join('/');
  const end=Math.min(contacts.get(a.id)?.fraction??1,contacts.get(b.id)?.fraction??1,a0.phase==='landing'?Math.max(0,(2-a0.age)/dt):1,b0.phase==='landing'?Math.max(0,(2-b0.age)/dt):1);
  const d=distance(a,b),v=Math.abs(a.altitude-b.altitude);
  if(airborne(a)&&airborne(b)){
   const sep=encounter(a0,a,b0,b,3,1000,end),crit=encounter(a0,a,b0,b,1,500,end);
   if(sep&&!sim.openSeparation.includes(key)){sim.stats.separationEpisodes++;recordIncident(sim,'Ayrım ihlali',[a.id,b.id],{distanceNm:round(sep.distance),verticalFt:Math.round(sep.verticalFt),time:round(sim.elapsed-dt+sep.fraction*dt)});}
   if(crit&&!sim.openCritical.includes(key)){sim.stats.criticalEpisodes++;recordIncident(sim,'Kritik yakınlaşma',[a.id,b.id],{distanceNm:round(crit.distance),verticalFt:Math.round(crit.verticalFt),time:round(sim.elapsed-dt+crit.fraction*dt)});}
   if(d<3&&v<1000)separation.push(key);if(d<1&&v<500)critical.push(key);
  }
  const hit=encounter(a0,a,b0,b,.12,150,end);if(!hit)continue;
  for(const f of [a,b])hitTimes.set(f.id,Math.min(hitTimes.get(f.id)??1,hit.fraction));
  const group=new Set([a.id,b.id]);
  for(let k=collisionGroups.length-1;k>=0;k--)if([...collisionGroups[k]].some(id=>group.has(id))){for(const id of collisionGroups[k])group.add(id);collisionGroups.splice(k,1);}
  collisionGroups.push(group);
 }
 sim.openSeparation=separation;sim.openCritical=critical;
 for(const group of collisionGroups){const ids=[...group].sort();sim.stats.collisions++;recordIncident(sim,'Çarpışma',ids,{commands:ids.map(id=>sim.flights.find(f=>f.id===id).command),time:round(sim.elapsed-dt+Math.min(...ids.map(id=>hitTimes.get(id)))*dt)});}
 for(const [id] of hitTimes){const f=sim.flights.find(f=>f.id===id);f.phase='crashed';f.age=0;}
 const occupied=[];
 for(const r of sim.runways){
  const reservations=sim.flights.filter(f=>RUNWAYS[f.lane].id===r.id&&['takeoff','approach','landing'].includes(f.phase));
  const occupants=sim.flights.filter(f=>['takeoff','approach','landing','departure'].includes(f.phase)&&Math.abs(runwayPosition(f,r).cross)<.04&&runwayPosition(f,r).along>=-.2&&runwayPosition(f,r).along<=r.lengthM/1852+.2&&f.altitude<r.elevation+150);
  r.reservations=reservations.map(f=>f.id);r.occupants=occupants.map(f=>f.id);r.reserved=r.reservations[0]||null;
  if(occupants.length>1){occupied.push(r.id);if(!sim.openRunway.includes(r.id)){sim.stats.runwayIncursions++;recordIncident(sim,'Pist ihlali',r.occupants,{runway:r.id});}}
 }
 sim.openRunway=occupied;
}
export function advanceSimulation(sim,seconds,{maxStepSeconds=1}={}){
 if(!Number.isFinite(maxStepSeconds)||maxStepSeconds<=0||maxStepSeconds>1)throw new RangeError('maxStepSeconds must be in (0,1]');
 let remaining=Math.max(0,Math.min(seconds,CONTROL_SECONDS));
 if(sim.trafficScope===AIRBORNE_SCOPE&&sim.requiresDecision)return;
 while(remaining>1e-9){
  const dt=Math.min(maxStepSeconds,remaining),ordered=[...sim.flights].sort((a,b)=>a.id.localeCompare(b.id));
  const before=new Map(ordered.map(f=>[f.id,motionSnapshot(f)])),expired=new Set(),contacts=new Map();sim.elapsed+=dt;
  for(const f of ordered){
   f.age+=dt;if(['taxi_out','arrival'].includes(f.phase))f.wait+=dt;
   if(airborne(f))sim.stats.aircraftHours+=dt/3600;
   if(f.phase==='crashed'||f.phase==='landing'){if(f.age>=2)expired.add(f.id);continue;}
   move(sim,f,dt);
   const r=RUNWAYS[f.lane];
   if(f.phase==='takeoff'&&f.altitude>r.elevation+50&&runwayPosition(f,r).along>=r.lengthM/1852){f.phase='departure';sim.stats.takeoffs++;sim.runways[f.lane].completed++;addEvent(sim,f.id+' kalktı','typesafe');}
   const contact=surfaceContact(f,before.get(f.id));if(contact)contacts.set(f.id,contact);
  }
  // No flight is removed/replaced until every participant has been measured.
  measurements(sim,before,contacts,dt);
  const exits=ordered.filter(f=>!['crashed','landing'].includes(f.phase)&&exitCandidate(f));
  const forecasts=exits.length?predictedConflicts(ordered,EXIT_POLICY.conflictHorizonSeconds):[];
  for(const f of ordered){
   if(f.phase==='crashed'){if(expired.has(f.id)&&before.get(f.id).phase==='crashed')spawn(sim,f,false,false);continue;}
   const contact=contacts.get(f.id);
   if(contact){Object.assign(f,contact.point);f.age=0;
    if(contact.kind==='landing'){sim.stats.landings++;sim.runways[f.lane].completed++;f.phase='landing';addEvent(sim,f.id+' touchdown','typesafe',{surface:contact.surface});}
    else{sim.stats.groundImpacts++;recordIncident(sim,'Yer teması',[f.id],{command:f.command,surface:contact.surface,surfaceElevationFt:contact.elevationFt,time:round(sim.elapsed-dt+contact.fraction*dt)});f.phase='crashed';}
    continue;
   }
   if(expired.has(f.id)){spawn(sim,f,false,true);continue;}
   const exit=exitCandidate(f);if(!exit)continue;
   if(exit==='departure'&&forecasts.some(c=>c.a===f.id||c.b===f.id)){f.exitPending=true;continue;}
   if(exit==='departure'){sim.stats.departures++;addEvent(sim,f.id+' sector handoff','typesafe',{exitPolicy:EXIT_POLICY.id});}
   else{sim.stats.sectorViolations++;recordIncident(sim,'Sector boundary violation',[f.id],{mission:f.mission});}
   spawn(sim,f,false,exit==='departure');
  }
  remaining-=dt;
  const released=releaseDepartures(sim);for(const id of released)addEvent(sim,id+' airborne handoff','scenario');
  if(sim.trafficScope===AIRBORNE_SCOPE&&sim.requiresDecision)break;
 }
 sim.alerts=predictedConflicts(sim.flights);sim.revision++;
}
export function publicSimulation(sim){
 return {trafficScope:sim.trafficScope??'legacy-mixed-v1',trafficPolicy:sim.trafficScope===AIRBORNE_SCOPE?TRAFFIC_POLICY:null,physicsModel:PILOT_MODEL,dataEpoch:sim.dataEpoch??null,measurementPolicy:MEASUREMENT_POLICY,measurementEpoch:sim.measurementEpoch??null,surfaceModel:SURFACE_MODEL,exitPolicy:EXIT_POLICY,pilotControlPolicy:PILOT_CONTROL_POLICY,commandAudit:commandAuditSummary(sim),dataset:DATASET_INFO,elapsed:Math.floor(sim.elapsed),flights:sim.flights.map(f=>({...f,x:round(f.x),y:round(f.y),heading:Math.round(f.heading)%360,altitude:Math.round(f.altitude),speed:Math.round(f.speed),verticalRate:Math.round(f.verticalRate),flightPathAngle:round(Math.atan2(f.verticalRate,(f.groundSpeed||f.speed)*6076/60)/rad)})),runways:sim.runways,stats:sim.stats,events:sim.events.slice(0,20),alerts:sim.alerts,phases:Object.fromEntries(Object.keys(PHASES).map(p=>[p,sim.flights.filter(f=>f.phase===p).length]))};
}
export function experimentReport(sim,ai,budget){
 return {schemaVersion:3,trafficScope:sim.trafficScope??'legacy-mixed-v1',trafficPolicy:sim.trafficScope===AIRBORNE_SCOPE?TRAFFIC_POLICY:null,physicsModel:PILOT_MODEL,dataEpoch:sim.dataEpoch??null,measurementPolicy:MEASUREMENT_POLICY,measurementEpoch:sim.measurementEpoch??null,surfaceModel:SURFACE_MODEL,exitPolicy:EXIT_POLICY,pilotControlPolicy:PILOT_CONTROL_POLICY,commandAudit:commandAuditReport(sim),evaluation:evaluationReport(sim),dataEpochStats:sim.dataEpoch?Object.fromEntries(Object.entries(sim.stats).map(([k,v])=>[k,v-(sim.dataEpoch.baseline[k]||0)])):null,controlEpoch:sim.controlEpoch||null,controlEpochStats:sim.controlEpoch?Object.fromEntries(Object.entries(sim.stats).map(([k,v])=>[k,v-(sim.controlEpoch.baseline[k]||0)])):null,physicsEpoch:sim.physicsEpoch||null,physicsEpochStats:sim.physicsEpoch?Object.fromEntries(Object.entries(sim.stats).map(([k,v])=>[k,v-(sim.physicsEpoch.baseline[k]||0)])):sim.stats,currentAircraft:sim.flights.map(telemetry),dataset:DATASET_INFO,kind:'live-typesafe-ltfm-experiment',seed:sim.initialSeed,simulatedSeconds:round(sim.elapsed),aircraft:sim.flights.length,stats:sim.stats,averageClearanceWaitSeconds:sim.stats.clearances?round(sim.stats.completedWaitSeconds/sim.stats.clearances):null,accidents:sim.stats.collisions+sim.stats.groundImpacts,accidentsPer100AircraftHours:sim.stats.aircraftHours?round((sim.stats.collisions+sim.stats.groundImpacts)*100/sim.stats.aircraftHours):null,ai:{calls:ai.totalCalls||0,failures:ai.totalFailures||0,last:ai.last},budget,incidents:sim.incidents,incidentWindow:'Most recent 200 incidents; counters cover this simulation run.',thresholds:{separation:[3,1000],critical:[1,500],collision:[.12,150],units:'horizontal NM, vertical ft'},limitations:DATASET_INFO.assumptions+' Generic transport-jet pilot model with bank/acceleration limits; no certified aircraft performance data. Synthetic physics and thresholds. No human/local ATC corrections, procedure-target substitutions or implicit glide-path capture. Physical performance limits still apply; invalid/stale API responses remain rejected. Flight commands selected from bounded typed options. Pauses and provider latency do not advance simulation. Not a real-world accident forecast.'};
}
