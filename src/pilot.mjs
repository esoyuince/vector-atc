import {AIRPORT,FIXES,PROCEDURES,RUNWAYS,heading,navigation,distance} from './airport.mjs';
const rad=Math.PI/180;
export const norm=n=>(n%360+360)%360;
export const angle=(a,b)=>(a-b+540)%360-180;
const approach=(a,b,step)=>a+Math.sign(b-a)*Math.min(Math.abs(b-a),step);
// Generic transport-jet approximations, not aircraft performance/AFM data.
export const PILOT_MODEL='transport-point-mass-v1';
export function trueAirspeed(ias,altitude){
 const height=Math.max(0,Math.min(altitude,36089))*.3048;
 return ias/Math.sqrt((1-.0065*height/288.15)**4.25588);
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
 let desired=heading([f.x,f.y],point),turn=0,target=c.altitude,speed=c.speed;
 f.pilot={mode:'route',phase:n.kind||'VECTOR',nextFix:p?.legs[n.index]?.fix||null};
 const reasons=[];
 if(n.kind==='HOLD'){
  ({desired,turn}=holdGuidance(f,n,dt));
  const h=AIRPORT.holds.find(h=>h.fix===n.fix);
  const max=f.altitude<=6000?200:f.altitude<=14000?230:265;
  speed=Math.min(speed,h.maxSpeed||max);target=Math.max(target,h.minAltitude);
  if(c.altitude<h.minAltitude)reasons.push('holding minimum altitude');
 }
 const leg=p?.legs[n.index];
 if(leg){
  speed=Math.min(speed,leg.speed??leg.maxSpeed??Infinity);
  const minimum=leg.altitude??leg.minAltitude;
  const maximum=leg.altitude??leg.maxAltitude;
  if(minimum!=null&&target<minimum){target=minimum;reasons.push('published altitude floor');}
  if(maximum!=null&&target>maximum){target=maximum;reasons.push('published altitude ceiling');}
 }
 if(p?.kind==='APP'){
  const fap=p.legs.findIndex(l=>l.fix===p.fap),floor=p.legs[fap]?.altitude;
  if(n.index<=fap&&target<floor){target=floor;reasons.push('FAP level until crossing');}
  if(n.index>fap){
   const range=distance([f.x,f.y],r.point);
   target=Math.max(c.altitude,r.elevation+Math.tan((p.glideAngle||3)*rad)*range*6076.12);
  }
 }
 if(f.phase==='takeoff'||(['SID','MISSED'].includes(p?.kind)&&f.altitude<p.minTurnAltitude))desired=r.headingTrue;
 const heavy=f.type==='B789',ground=f.phase==='takeoff'&&f.altitude<=r.elevation+1;
 if(f.altitude<10000)speed=Math.min(speed,250);
 speed=Math.max(140,speed);
 if(speed!==c.speed)reasons.push('pilot speed limit');
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
 const gradientRate=p?.kind==='SID'&&f.altitude<p.climbGradientUntil&&difference>150?p.minClimbFtPerNm*f.groundSpeed/60:0;
 const limit=Math.min(Math.max(c.rate,gradientRate),heavy?1800:2500);
 if(gradientRate>c.rate)reasons.push('SID climb gradient');
 const desiredRate=ground&&f.speed<140?0:Math.sign(difference)*Math.min(limit,Math.sqrt(2*verticalAcceleration*60*Math.abs(difference)));
 f.verticalRate=approach(f.verticalRate||0,desiredRate,verticalAcceleration*dt);
 const change=f.verticalRate*dt/60;
 if(Math.sign(change)===Math.sign(difference)&&Math.abs(change)>=Math.abs(difference)){f.altitude=target;f.verticalRate=0;}
 else f.altitude=Math.max(0,f.altitude+change);
 f.pilot.targetAltitude=target;f.pilot.targetSpeed=speed;f.pilot.unable=reasons;
 return point;
}

// Shared by live execution and forecasting; no traffic-dependent decisions here.
export function advancePilotNavigation(f){
 const c=f.command,n=c.navigation,p=PROCEDURES[n.procedure];
 if(n.kind==='HOLD'||f.phase==='takeoff')return null;
 const point=n.points[Math.min(n.index,n.points.length-1)];
 if(distance([f.x,f.y],point)>=.3)return null;
 const crossed=p?.legs[n.index]||null;
 if(p)n.joining=false;
 if(n.index<n.points.length-1){n.index++;if(p)(f.progress??={})[p.id]=n.index;}
 else if(p?.kind==='MISSED')c.navigation=navigation({...f,command:null},'HOLD_'+p.hold,f.speed);
 else if(p?.kind==='SID')f.procedureDone=true;
 return crossed;
}
