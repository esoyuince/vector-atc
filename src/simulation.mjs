import {pilotStep,advancePilotNavigation,trueAirspeed,PILOT_MODEL} from './pilot.mjs';
// Published LTFM geometry with synthetic traffic. Only TypeSafe selects ATC commands.
import {AIRPORT,DATASET_INFO,RUNWAYS,ACTIVE_RUNWAYS,FIXES,PROCEDURES,ALTITUDES,SPEEDS,RATES,routeOptions,navigation,procedureContext,runwayPosition,unproject,offset} from './airport.mjs';
export {RUNWAYS,routeOptions};
export const PHASES={taxi_out:'Kalkış kuyruğu',takeoff:'Kalkış',departure:'Alandan çıkış',arrival:'İniş kuyruğu',approach:'Son yaklaşma',landing:'İniş',crashed:'Kaza / yeniden doğma'};
export const CONTROL_SECONDS=60;
const rad=Math.PI/180;
const norm=n=>(n%360+360)%360;
const round=n=>Math.round(n*10)/10;
const airborne=f=>!['taxi_out','crashed','landing'].includes(f.phase);
const headingTo=(a,b)=>norm(Math.atan2(b[0]-a.x,b[1]-a.y)/rad);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function random(sim){sim.seed=(Math.imul(sim.seed,1664525)+1013904223)>>>0;return sim.seed/4294967296;}
export function addEvent(sim,text,source='system',detail={}){sim.events.unshift({time:Math.floor(sim.elapsed),text,source,...detail});sim.events=sim.events.slice(0,100);}
function spawn(sim,f,initial=false,completed=false){
 f.generation=(f.generation||0)+1;f.command=null;f.age=0;f.wait=0;f.verticalRate=0;f.targetAltitude=0;f.lastSource='awaiting';f.lastCommand='TypeSafe komutu bekleniyor';
 f.bank=0;f.pilot=null;f.groundSpeed=f.speed;f.priority=false;f.landingClearance=null;f.progress={};f.constraintEpisodes=[];f.procedureDone=false;
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
 f.groundSpeed=trueAirspeed(f.speed,f.altitude);f.trueAirspeed=f.groundSpeed;
 f.note=f.mission==='arrival'?'Rastgele giriş · iniş talebi':'Kalkış talebi · rastgele çıkış noktası';
 if(!initial){if(completed){f.cycles++;sim.stats.cycles++;}sim.stats.respawns++;addEvent(sim,f.id+' yeniden doğdu · '+PHASES[f.phase]);}
}
export function createSimulation(now=Date.now(),seed=123456789){
 const sim={version:4,dataset:DATASET_INFO.id,revision:0,seed:seed>>>0,initialSeed:seed>>>0,elapsed:0,lastWall:now,flights:[],runways:RUNWAYS.map(r=>({...r,reserved:null,occupants:[],completed:0})),
 stats:{takeoffs:0,landings:0,departures:0,cycles:0,respawns:0,aiApplied:0,rejected:0,collisions:0,groundImpacts:0,separationEpisodes:0,criticalEpisodes:0,runwayIncursions:0,sectorViolations:0,aircraftHours:0,completedWaitSeconds:0,clearances:0},
 events:[],alerts:[],incidents:[],openSeparation:[],openCritical:[],openRunway:[]};
 Object.assign(sim.stats,{procedureViolations:0,altitudeViolations:0,speedViolations:0,routeViolations:0,clearanceMismatches:0});
 for(let i=0;i<100;i++){const f={id:['TRK','PGS','AJT','SXS'][i%4]+(101+i),type:['B738','A320','A21N','B789'][i%4],mission:i<50?'departure':'arrival',cycles:0,generation:0};spawn(sim,f,true);sim.flights.push(f);}
 return sim;
}
export function telemetry(f){return {id:f.id,generation:f.generation,mission:f.mission,phase:f.phase,positionNm:[round(f.x),round(f.y)],positionLatLon:unproject(f.x,f.y),headingTrueDeg:round(f.heading),headingDeg:round(f.heading),altitudeFt:Math.round(f.altitude),speedKt:round(f.speed),airspeedKind:'IAS',trueAirspeedKt:round(f.trueAirspeed||f.speed),groundSpeedKt:round(f.groundSpeed||f.speed),bankDeg:round(f.bank||0),pilot:f.pilot||null,verticalRateFpm:Math.round(f.verticalRate),flightPathAngleDeg:round(Math.atan2(f.verticalRate,(f.groundSpeed||f.speed)*6076/60)/rad),waitSeconds:Math.floor(f.wait),runway:RUNWAYS[f.lane].id,procedure:procedureContext(f),command:f.command?{route:f.command.route,altitudeFt:f.command.altitude,speedKt:f.command.speed,verticalRateFpm:f.command.rate}:null};}
export function predictedConflicts(flights,horizon=120){
 const list=structuredClone(flights.filter(f=>airborne(f)||f.phase==='landing')),found=new Map();
 const sample=(seconds)=>{
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
   const a=list[i],b=list[j];if(a.forecastEnded||b.forecastEnded)continue;const d=distance(a,b),v=Math.abs(a.altitude-b.altitude);
   if(d>=3||v>=1000)continue;
   const key=a.id+':'+b.id,critical=d<1&&v<500,old=found.get(key);
   if(!old||(critical&&!old.critical))found.set(key,{a:a.id,b:b.id,seconds:round(seconds),distance:round(d),verticalFt:Math.round(v),critical});
  }
 };
 sample(0);
 for(let seconds=1;seconds<=horizon;seconds++){
  for(const f of list){
   if(f.forecastEnded)continue;
   if(f.phase==='landing'){f.age=(f.age||0)+1;if(f.age>=2)f.forecastEnded=true;continue;}
   if(f.command){
    pilotStep(f,1);
    advancePilotNavigation(f);
    if(f.phase==='takeoff'&&f.altitude>RUNWAYS[f.lane].elevation+50&&runwayPosition(f,RUNWAYS[f.lane]).along>=RUNWAYS[f.lane].lengthM/1852)f.phase='departure';
    const terminal=flightTerminal(f);
    if(terminal==='landing'){f.phase='landing';f.age=0;}else if(terminal)f.forecastEnded=true;
   }
  }
  sample(seconds);
 }
 return [...found.values()].sort((a,b)=>Number(b.critical)-Number(a.critical)||a.seconds-b.seconds);

}
export function makePlan(sim){
 const flights=sim.flights.filter(f=>f.phase!=='crashed'&&f.phase!=='landing');
 const runways=sim.runways.map(r=>({id:r.id,choices:flights.filter(f=>r.active&&((RUNWAYS[f.lane].id===r.id&&f.phase==='taxi_out')||(f.mission==='arrival'&&f.phase==='arrival'&&['GAZGE','INSTA','ULQAL'].some(id=>Math.hypot(f.x-FIXES[id].point[0],f.y-FIXES[id].point[1])<8)))).sort((a,b)=>b.wait-a.wait).map(f=>({id:f.id,generation:f.generation,kind:f.phase==='taxi_out'?'departure':'arrival'}))}));
 return {revision:sim.revision,flights:flights.map(f=>({id:f.id,generation:f.generation,phase:f.phase,routes:routeOptions(f)})),runways:runways.filter(r=>r.choices.length),state:{units:'NM from LTFM ARP; altitude ft MSL, indicated airspeed knots (groundSpeedKt for motion), TRUE heading degrees, fpm. FL approximated as hundreds of ft (standard pressure).' ,horizonSeconds:CONTROL_SECONDS,airport:{id:AIRPORT.id,transitionAltitude:AIRPORT.transitionAltitude,scope:'South flow; published route choices. Pilot executes published constraints; holds use 60/90-second legs, bank-limited turns and entry maneuvers.'},aircraft:Object.fromEntries(sim.flights.map(f=>[f.id,telemetry(f)])),runways:sim.runways,conflicts:predictedConflicts(sim.flights),recentIncidents:sim.incidents.slice(0,5)}};
}
const commandSnapshot=c=>c?{route:c.route,altitude:c.altitude,speed:c.speed,rate:c.rate,at:c.at}:null;
export function recordIncident(sim,type,ids,detail={}){
 // Keep every participant ID, but bounded command evidence without navigation arrays.
 if(detail.command)detail={...detail,command:commandSnapshot(detail.command)};
 if(detail.commands)detail={...detail,commandCount:detail.commands.length,commands:detail.commands.slice(0,10).map(commandSnapshot),commandSampleLimit:10};
 const incident={number:sim.incidents.length?sim.incidents[0].number+1:1,time:round(sim.elapsed),type,aircraft:ids,...detail};
 sim.incidents.unshift(incident);sim.incidents=sim.incidents.slice(0,200);addEvent(sim,type+' · '+ids.join(' / '),'measurement',detail);
}
export function applyFleetDecision(sim,plan,answers){
 if(plan.revision!==sim.revision){sim.stats.rejected+=plan.flights.length;return {applied:0,rejected:plan.flights.length};}
 const clearances=new Map();
 for(const r of plan.runways){const id=answers['runway_'+r.id]?.choice,c=r.choices.find(c=>c.id===id);if(c)clearances.set(id,{...c,runway:r.id});}
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
  f.command={route,altitude,speed,rate,navigation:nav,point:nav.points[Math.min(nav.index,nav.points.length-1)],at:sim.elapsed};
  f.targetAltitude=altitude;f.lastSource='typesafe';f.lastCommand=route+' · '+altitude+' ft · '+speed+' kt · '+rate+' fpm';applied++;
  if(procedure?.kind==='APP'){f.lane=RUNWAYS.findIndex(r=>r.id===procedure.runway);f.phase='approach';}
  else if(f.phase==='approach')f.phase='arrival';
  if(clearance?.kind==='departure'&&f.phase==='taxi_out'){
   const r=RUNWAYS[f.lane];f.phase='takeoff';f.x=r.x;f.y=r.y;f.altitude=r.elevation;f.heading=r.headingTrue;f.age=0;
   sim.stats.completedWaitSeconds+=f.wait;sim.stats.clearances++;addEvent(sim,f.id+' kalkış izni · '+clearance.runway,'typesafe');
  }else if(clearance?.kind==='arrival'&&procedure?.kind==='APP'){sim.stats.completedWaitSeconds+=f.wait;sim.stats.clearances++;addEvent(sim,f.id+' iniş izni · '+clearance.runway,'typesafe');}

 }
 sim.stats.aiApplied+=applied;sim.stats.rejected+=rejected;sim.revision++;return {applied,rejected};
}
function violation(sim,f,kind,detail,key){
 const eventKey=kind+':'+key;if(f.constraintEpisodes.includes(eventKey))return;
 f.constraintEpisodes.push(eventKey);sim.stats.procedureViolations++;sim.stats[kind+'Violations']++;
 recordIncident(sim,'Prosedür ihlali',[f.id],{category:kind,...detail,command:{route:f.command.route,altitude:f.command.altitude,speed:f.command.speed,rate:f.command.rate}});
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
 const point=pilotStep(f,dt);
 if(['SID','MISSED'].includes(p?.kind)&&f.phase!=='takeoff'&&f.altitude<p.minTurnAltitude&&Math.abs(((f.heading-r.headingTrue+540)%360)-180)>10)violation(sim,f,'altitude',{rule:'minimum turn altitude',required:p.minTurnAltitude,actual:round(f.altitude)},c.route+':turn');
 if(p?.kind==='APP'){
  const fapIndex=p.legs.findIndex(l=>l.fix===p.fap),level=p.legs[fapIndex]?.altitude;
  if(n.index<=fapIndex&&f.altitude<level-150)violation(sim,f,'altitude',{rule:'descent below FAP level before crossing FAP',fix:p.fap,min:level,actual:round(f.altitude)},c.route+':early-descent');
 }
 if(p?.kind==='SID'&&f.speed>0&&(f.phase==='departure'||f.altitude>r.elevation+50)&&f.altitude<p.climbGradientUntil&&f.altitude<f.command.altitude-150&&f.verticalRate/(f.speed/60)<p.minClimbFtPerNm)violation(sim,f,'altitude',{rule:'SID climb gradient',requiredFtPerNm:p.minClimbFtPerNm,actual:round(f.verticalRate/(f.speed/60))},c.route+':gradient');
 if(n.kind==='HOLD'){
  const h=AIRPORT.holds.find(h=>h.fix===n.fix);
  if(f.altitude<h.minAltitude-150)violation(sim,f,'altitude',{rule:'holding minimum',fix:h.fix,min:h.minAltitude,actual:round(f.altitude)},c.route+':hold');
 }
 if(p&&!n.joining&&n.index>0){
  const a=n.points[n.index-1],b=n.points[n.index],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  const cross=length?Math.abs((f.x-a[0])*dy-(f.y-a[1])*dx)/length:0;
  if(cross>2)violation(sim,f,'route',{rule:'demo cross-track tolerance',fix:p.legs[n.index].fix,crossTrackNm:round(cross),limitNm:2},c.route+':'+n.index);
 }
 const crossed=advancePilotNavigation(f);if(crossed)crossing(sim,f,crossed);
}
function measurements(sim){
 const list=sim.flights.filter(f=>airborne(f)||f.phase==='landing'),separation=[],critical=[],crashed=new Set(),collisionGroups=[];
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
  const a=list[i],b=list[j];if(a.forecastEnded||b.forecastEnded)continue;const d=distance(a,b),v=Math.abs(a.altitude-b.altitude),key=[a.id,b.id].sort().join(':');
  if(airborne(a)&&airborne(b)&&d<3&&v<1000){separation.push(key);if(!sim.openSeparation.includes(key)){sim.stats.separationEpisodes++;recordIncident(sim,'Ayrım ihlali',[a.id,b.id],{distanceNm:round(d),verticalFt:Math.round(v)});}}
  if(airborne(a)&&airborne(b)&&d<1&&v<500){critical.push(key);if(!sim.openCritical.includes(key)){sim.stats.criticalEpisodes++;recordIncident(sim,'Kritik yakınlaşma',[a.id,b.id],{distanceNm:round(d),verticalFt:Math.round(v)});}}
  if(d<.12&&v<150){
   const group=new Set([a.id,b.id]);
   for(let k=collisionGroups.length-1;k>=0;k--)if([...collisionGroups[k]].some(id=>group.has(id))){for(const id of collisionGroups[k])group.add(id);collisionGroups.splice(k,1);}
   collisionGroups.push(group);
  }
 }
 for(const group of collisionGroups){sim.stats.collisions++;for(const id of group)crashed.add(id);recordIncident(sim,'Çarpışma',[...group],{commands:[...group].map(id=>sim.flights.find(f=>f.id===id).command)});}
 sim.openSeparation=separation;sim.openCritical=critical;
 for(const id of crashed){const f=sim.flights.find(f=>f.id===id);f.phase='crashed';f.age=0;}
 const occupied=[];
 for(const r of sim.runways){
  const reservations=sim.flights.filter(f=>RUNWAYS[f.lane].id===r.id&&['takeoff','approach','landing'].includes(f.phase));
  const occupants=sim.flights.filter(f=>['takeoff','approach','landing','departure'].includes(f.phase)&&Math.abs(runwayPosition(f,r).cross)<.04&&runwayPosition(f,r).along>=-.2&&runwayPosition(f,r).along<=r.lengthM/1852+.2&&f.altitude<r.elevation+150);
  r.reservations=reservations.map(f=>f.id);r.occupants=occupants.map(f=>f.id);r.reserved=r.reservations[0]||null;
  if(occupants.length>1){occupied.push(r.id);if(!sim.openRunway.includes(r.id)){sim.stats.runwayIncursions++;recordIncident(sim,'Pist ihlali',r.occupants,{runway:r.id});}}
 }
 sim.openRunway=occupied;
}
function flightTerminal(f){
 const runway=RUNWAYS[f.lane],along=runwayPosition(f,runway).along;
 if(f.phase==='approach'&&Math.hypot(f.x-runway.x,f.y-runway.y)<.18&&Math.abs(f.altitude-runway.elevation)<=100&&f.speed<=190&&Math.abs(((f.heading-runway.headingTrue+540)%360)-180)<15)return 'landing';
 if(airborne(f)&&f.command&&((f.phase!=='takeoff'&&f.altitude<=0)||(f.phase==='takeoff'&&along>runway.lengthM/1852+.3&&f.altitude<runway.elevation+50)))return 'impact';
 if(airborne(f)&&(f.procedureDone||Math.hypot(f.x,f.y)>AIRPORT.sectorRadiusNm))return 'exit';
 return null;
}
export function advanceSimulation(sim,seconds){
 let remaining=Math.max(0,Math.min(seconds,CONTROL_SECONDS));
 while(remaining>0){
  const dt=Math.min(1,remaining);sim.elapsed+=dt;
  for(const f of sim.flights){
   f.age+=dt;if(['taxi_out','arrival'].includes(f.phase))f.wait+=dt;
   if(airborne(f))sim.stats.aircraftHours+=dt/3600;
   if(f.phase==='crashed'||f.phase==='landing'){if(f.age>=2)spawn(sim,f,false,f.phase==='landing');continue;}
   move(sim,f,dt);
   const runway=RUNWAYS[f.lane],along=runwayPosition(f,runway).along;
   if(f.phase==='takeoff'&&f.altitude>runway.elevation+50&&along>=runway.lengthM/1852){f.phase='departure';sim.stats.takeoffs++;sim.runways[f.lane].completed++;addEvent(sim,f.id+' kalktı','typesafe');}
   const terminal=flightTerminal(f);
   if(terminal==='landing'){
    sim.stats.landings++;sim.runways[f.lane].completed++;f.phase='landing';f.age=0;addEvent(sim,f.id+' indi · yeni geliş uçuşu oluşturulacak','typesafe');
   }else if(terminal==='impact'){
    sim.stats.groundImpacts++;recordIncident(sim,'Yer teması',[f.id],{command:f.command});f.phase='crashed';f.age=0;
   }else if(terminal==='exit'){
    if(f.mission==='departure'&&f.procedureDone){sim.stats.departures++;addEvent(sim,f.id+' sektörden çıktı · kalkış kuyruğuna dönüş','typesafe');}
    else{sim.stats.sectorViolations++;recordIncident(sim,'Geliş uçağı sektör dışına çıktı',[f.id]);}
    spawn(sim,f,false,f.mission==='departure'&&f.procedureDone);
   }
  }
  measurements(sim);remaining-=dt;
 }
 sim.alerts=predictedConflicts(sim.flights);sim.revision++;
}
export function publicSimulation(sim){
 return {physicsModel:PILOT_MODEL,dataset:DATASET_INFO,elapsed:Math.floor(sim.elapsed),flights:sim.flights.map(f=>({...f,x:round(f.x),y:round(f.y),heading:Math.round(f.heading)%360,altitude:Math.round(f.altitude),speed:Math.round(f.speed),verticalRate:Math.round(f.verticalRate),flightPathAngle:round(Math.atan2(f.verticalRate,(f.groundSpeed||f.speed)*6076/60)/rad)})),runways:sim.runways,stats:sim.stats,events:sim.events.slice(0,20),alerts:sim.alerts,phases:Object.fromEntries(Object.keys(PHASES).map(p=>[p,sim.flights.filter(f=>f.phase===p).length]))};
}
export function experimentReport(sim,ai,budget){
 return {schemaVersion:3,physicsModel:PILOT_MODEL,physicsEpoch:sim.physicsEpoch||null,physicsEpochStats:sim.physicsEpoch?Object.fromEntries(Object.entries(sim.stats).map(([k,v])=>[k,v-(sim.physicsEpoch.baseline[k]||0)])):sim.stats,currentAircraft:sim.flights.map(telemetry),dataset:DATASET_INFO,kind:'live-typesafe-ltfm-experiment',seed:sim.initialSeed,simulatedSeconds:round(sim.elapsed),aircraft:sim.flights.length,stats:sim.stats,averageClearanceWaitSeconds:sim.stats.clearances?round(sim.stats.completedWaitSeconds/sim.stats.clearances):null,accidents:sim.stats.collisions+sim.stats.groundImpacts,accidentsPer100AircraftHours:sim.stats.aircraftHours?round((sim.stats.collisions+sim.stats.groundImpacts)*100/sim.stats.aircraftHours):null,ai:{calls:ai.totalCalls||0,failures:ai.totalFailures||0,last:ai.last},budget,incidents:sim.incidents,incidentWindow:'Most recent 200 incidents; counters cover this simulation run.',thresholds:{separation:[3,1000],critical:[1,500],collision:[.12,150],units:'horizontal NM, vertical ft'},limitations:DATASET_INFO.assumptions+' Generic transport-jet pilot model with bank/acceleration limits; no certified aircraft performance data. Synthetic physics and thresholds. No human/local ATC corrections. Flight commands selected from bounded typed options. Pauses and provider latency do not advance simulation. Not a real-world accident forecast.'};
}
