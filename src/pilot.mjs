import {AIRPORT,FIXES,PROCEDURES,RUNWAYS,heading,navigation,distance} from './airport.mjs';
const rad=Math.PI/180;
export const norm=n=>(n%360+360)%360;
export const angle=(a,b)=>(a-b+540)%360-180;
const approach=(a,b,step)=>a+Math.sign(b-a)*Math.min(Math.abs(b-a),step);
// Generic transport-jet approximations, not aircraft performance/AFM data.
export const PILOT_MODEL='transport-point-mass-v1';
// Experimental execution policy, separate from the unchanged physical approximation.
export const PILOT_CONTROL_POLICY='jev-command-observe-v1';
export function holdingSpeedLimit(fix,altitude){
 const h=AIRPORT.holds.find(h=>h.fix===fix);
 return h?.maxSpeed??(altitude<=6000?200:altitude<=14000?230:265);
}
export function performanceProfile(type){return {model:'generic-transport-v1',maxVerticalFpm:type==='B789'?1800:2500,maxBankDeg:25,maxTurnDegPerSecond:3,verticalAccelerationFpmPerSecond:150,accelerationKtPerSecond:type==='B789'?.4:.6,decelerationKtPerSecond:type==='B789'?.6:.8};}
export function trueAirspeed(ias,altitude){
 const height=Math.max(0,Math.min(altitude,36089))*.3048;
 return ias/Math.sqrt((1-.0065*height/288.15)**4.25588);
}
// Pure command assessment: it observes target conflicts, not actual flight violations.
// Kept separate from physical execution so logging cannot modify a clearance.
export function procedureCommandIssues(f,{includeClearance=false}={}){
 const c=f.command,n=c?.navigation;if(!c||!n)return [];
 const p=PROCEDURES[n.procedure],leg=p?.legs[n.index],issues=[];
 const add=(rule,message,field,requested,unit,limits,fix,basis='published',source=p?.source)=>issues.push({rule,message,field,requested,unit,...limits,fix:fix??null,basis,source:source??null});
 if(n.kind==='HOLD'){
  const h=AIRPORT.holds.find(h=>h.fix===n.fix),max=holdingSpeedLimit(n.fix,f.altitude);
  if(h&&c.altitude<h.minAltitude)add('holding-minimum-altitude','holding minimum altitude','altitude',c.altitude,'ft MSL',{min:h.minAltitude},n.fix,'published',h.source);
  if(c.speed>max)add('holding-speed-limit','holding speed limit','speed',c.speed,'kt IAS',{max},n.fix,h?.maxSpeed!=null?'published':'demo-rule',h?.maxSpeed!=null?h.source:'demo-holding-speed');
 }
 if(leg){
  if(leg.speed!=null?c.speed!==leg.speed:c.speed>(leg.maxSpeed??Infinity))add('published-speed-constraint','published speed constraint','speed',c.speed,'kt IAS',leg.speed!=null?{exact:leg.speed}:{max:leg.maxSpeed},leg.fix);
  const min=leg.altitude??leg.minAltitude,max=leg.altitude??leg.maxAltitude;
  if(min!=null&&c.altitude<min)add('published-altitude-floor','published altitude floor','altitude',c.altitude,'ft MSL',{min},leg.fix);
  if(max!=null&&c.altitude>max)add('published-altitude-ceiling','published altitude ceiling','altitude',c.altitude,'ft MSL',{max},leg.fix);
 }
 if(p?.kind==='APP'){
  const fapIndex=p.legs.findIndex(l=>l.fix===p.fap),min=p.legs[fapIndex]?.altitude;
  if(n.index<=fapIndex&&c.altitude<min)add('fap-altitude-floor','FAP level until crossing','altitude',c.altitude,'ft MSL',{min},p.fap,'demo-rule',p.source);
  if(includeClearance&&f.landingClearance!==p.runway)add('approach-clearance-mismatch','approach clearance mismatch','runway',p.runway,'runway id',{clearedRunway:f.landingClearance??null},p.fap,'integration-rule','approach-clearance');
 }
 if(f.altitude<10000&&c.speed>250)add('low-altitude-speed-limit','low altitude speed limit','speed',c.speed,'kt IAS',{max:250},null,'demo-rule','demo-low-altitude-speed');
 if(p?.kind==='SID'&&f.altitude<p.climbGradientUntil&&c.altitude-f.altitude>150){
  const groundSpeedKt=trueAirspeed(f.speed,f.altitude),min=p.minClimbFtPerNm*groundSpeedKt/60;
  if(c.rate<min)add('sid-climb-gradient','SID climb gradient','rate',c.rate,'ft/min',{min,requiredFtPerNm:p.minClimbFtPerNm,groundSpeedKt,untilAltitudeFt:p.climbGradientUntil},leg?.fix);
 }
 return issues;
}
export function holdingEntry(inbound,arrivalHeading,turn){
 const relative=angle(arrivalHeading,inbound)*(turn==='R'?1:-1);
 return relative < -70?'parallel':relative>110?'teardrop':'direct';
}
function holdGuidance(f,n,dt){
 const h=AIRPORT.holds.find(h=>h.fix===n.fix),fix=FIXES[n.fix].point;
 const inbound=norm(h.inboundMag+AIRPORT.variation),outbound=norm(inbound+180),sign=h.turn==='R'?1:-1;
 const state=n.hold??={phase:'to-fix',entry:null,seconds:0,laps:0};
 const near=distance([f.x,f.y],fix)<Math.max(.15,(f.groundSpeed||f.speed)/3600*2);
 const change=phase=>{state.phase=phase;state.seconds=0;};
 const legSeconds=f.altitude>14000?90:60;
 let desired,turn=0;
 if(state.phase==='to-fix'){
  desired=heading([f.x,f.y],fix);
  if(near){state.entry=holdingEntry(inbound,f.heading,h.turn);change(state.entry==='direct'?'turn-out':'entry-out');}
 }
 if(state.phase==='entry-out'){
  desired=norm(outbound-(state.entry==='teardrop'?30*sign:0));
  if(Math.abs(angle(desired,f.heading))<8)state.seconds+=dt;
  if(state.seconds>=legSeconds)change('entry-return');
 }
 if(state.phase==='entry-return'){
  // Parallel return turns toward the holding side; teardrop turns in published direction.
  desired=heading([f.x,f.y],fix);
  turn=state.entry==='parallel'?-sign:sign;
  if(Math.abs(angle(desired,f.heading))<10)turn=0;
  if(near){change('turn-out');state.entry='established';}
 }
 if(state.phase==='turn-out'||state.phase==='turn-in'){
  desired=state.phase==='turn-out'?outbound:inbound;turn=sign;
  if(Math.abs(angle(desired,f.heading))<4){change(state.phase==='turn-out'?'outbound':'inbound');turn=0;}
 }
 if(state.phase==='outbound'){
  desired=outbound;state.seconds+=dt;if(state.seconds>=legSeconds)change('turn-in');
 }
 if(state.phase==='inbound'){
  desired=heading([f.x,f.y],fix);
  if(near){state.laps++;change('turn-out');}
 }
 n.index=0;
 f.pilot={mode:'hold',phase:state.phase,entry:state.entry,fix:n.fix,laps:state.laps,legSeconds};
 return {desired:desired??inbound,turn};
}
export function pilotStep(f,dt){
 const c=f.command,n=c.navigation,r=RUNWAYS[f.lane],p=PROCEDURES[n.procedure];
 const point=n.points[Math.min(n.index,n.points.length-1)];c.point=point;
 // Numeric targets are exactly the schema-valid Jev command, even when unsafe.
 // Procedure restrictions below are observations, never substitute clearances.
 const target=c.altitude,speed=c.speed;
 let desired=heading([f.x,f.y],point),turn=0;
 f.pilot={mode:'route',phase:n.kind||'VECTOR',nextFix:p?.legs[n.index]?.fix||null};
 const reasons=[];
 if(n.kind==='HOLD')({desired,turn}=holdGuidance(f,n,dt));
 if(f.phase==='takeoff'||(['SID','MISSED'].includes(p?.kind)&&f.altitude<p.minTurnAltitude))desired=r.headingTrue;
 const heavy=f.type==='B789',ground=f.phase==='takeoff'&&f.altitude<=r.elevation+1;
 f.speed=approach(f.speed,speed,dt*(ground?(heavy?2.2:3):speed>f.speed?(heavy?.4:.6):(heavy?.6:.8)));
 f.groundSpeed=trueAirspeed(f.speed,f.altitude);f.trueAirspeed=f.groundSpeed;
 const error=angle(desired,f.heading),velocity=Math.max(1,f.groundSpeed*.514444);
 const rate=turn?turn*3:Math.max(-3,Math.min(3,error*.25));
 const targetBank=ground?0:Math.max(-25,Math.min(25,Math.atan(rate*rad*velocity/9.80665)/rad));
 f.bank=approach(f.bank||0,targetBank,dt*5);
 f.heading=ground?r.headingTrue:norm(f.heading+9.80665*Math.tan(f.bank*rad)/velocity/rad*dt);
 f.x+=Math.sin(f.heading*rad)*f.groundSpeed/3600*dt;
 f.y+=Math.cos(f.heading*rad)*f.groundSpeed/3600*dt;
 const difference=target-f.altitude,verticalAcceleration=150;
 const performanceLimit=heavy?1800:2500,limit=Math.min(c.rate,performanceLimit);
 const warnings=procedureCommandIssues(f).map(i=>i.message);
 if(c.rate>performanceLimit)reasons.push('vertical performance limit');
 const desiredRate=ground&&f.speed<140?0:Math.sign(difference)*Math.min(limit,Math.sqrt(2*verticalAcceleration*60*Math.abs(difference)));
 f.verticalRate=approach(f.verticalRate||0,desiredRate,verticalAcceleration*dt);
 f.pilot.motionVerticalRateFpm=f.verticalRate;
 const change=f.verticalRate*dt/60;
 if(Math.sign(change)===Math.sign(difference)&&Math.abs(change)>=Math.abs(difference)){f.altitude=target;f.verticalRate=0;}
 else f.altitude=Math.max(0,f.altitude+change);
 f.pilot.controlPolicy=PILOT_CONTROL_POLICY;
 f.pilot.targetAltitude=target;f.pilot.targetSpeed=speed;f.pilot.targetRateMagnitude=limit;
 f.pilot.constraintWarnings=warnings;f.pilot.unable=reasons;
 return point;
}

// Shared by live execution and forecasting; no traffic-dependent decisions here.
export function advancePilotNavigation(f,before=null){
 const c=f.command,n=c.navigation,p=PROCEDURES[n.procedure];
 if(n.kind==='HOLD'||f.phase==='takeoff')return null;
 const point=n.points[Math.min(n.index,n.points.length-1)];
 let closest=distance([f.x,f.y],point);
 if(before){const dx=f.x-before.x,dy=f.y-before.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point[0]-before.x)*dx+(point[1]-before.y)*dy)/length)):0;closest=Math.min(closest,distance([before.x+t*dx,before.y+t*dy],point));}
 if(closest>=.3)return null;
 const crossed=p?.legs[n.index]||null;
 if(p)n.joining=false;
 if(n.index<n.points.length-1){n.index++;if(p)(f.progress??={})[p.id]=n.index;}
 else if(p?.kind==='MISSED')c.navigation=navigation({...f,command:null},'HOLD_'+p.hold,f.speed);
 else if(p?.kind==='SID')f.procedureDone=true;
 return crossed;
}
