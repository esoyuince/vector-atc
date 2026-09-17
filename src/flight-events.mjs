import {AIRPORT,RUNWAYS,runwayPosition} from './airport.mjs';
export const MEASUREMENT_POLICY='swept-terminal-v2';
export const SURFACE_MODEL=Object.freeze({id:'sea-level-plus-runway-strips-v1',backgroundMslFt:0,runwayHalfWidthM:30,maxTouchdownIasKt:190,maxTouchdownSinkFpm:900,maxHeadingErrorDeg:15});
export const EXIT_POLICY=Object.freeze({id:'outward-handoff-v1',minDistanceNm:30,conflictHorizonSeconds:120});
export const isAirborne=f=>['arrival','approach','departure'].includes(f.phase)||(f.phase==='takeoff'&&f.altitude>RUNWAYS[f.lane].elevation+1);
export const collisionParticipant=f=>['takeoff','departure','arrival','approach','landing'].includes(f.phase);
export const motionSnapshot=f=>({x:f.x,y:f.y,altitude:f.altitude,heading:f.heading,speed:f.speed,verticalRate:f.verticalRate,age:f.age,phase:f.phase,generation:f.generation});
export const interpolate=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,altitude:a.altitude+(b.altitude-a.altitude)*t,speed:a.speed+(b.speed-a.speed)*t,verticalRate:a.verticalRate+(b.verticalRate-a.verticalRate)*t,heading:a.heading+(((b.heading-a.heading+540)%360)-180)*t});
function slab(a,b,lo,hi){const d=b-a;if(Math.abs(d)<1e-12)return a>=lo&&a<=hi?[0,1]:null;const x=(lo-a)/d,y=(hi-a)/d;const l=Math.max(0,Math.min(x,y)),h=Math.min(1,Math.max(x,y));return l<=h?[l,h]:null;}
// Earliest simultaneous horizontal/vertical penetration, not separate minima at different times.
export function encounter(a0,a1,b0,b1,horizontal,vertical,end=1){
 if(end<=1e-12)return Math.hypot(a0.x-b0.x,a0.y-b0.y)<horizontal&&Math.abs(a0.altitude-b0.altitude)<vertical?{fraction:0,distance:Math.hypot(a0.x-b0.x,a0.y-b0.y),verticalFt:Math.abs(a0.altitude-b0.altitude)}:null;
 const x=a0.x-b0.x,y=a0.y-b0.y,dx=a1.x-b1.x-x,dy=a1.y-b1.y-y;
 const aa=dx*dx+dy*dy,bb=2*(x*dx+y*dy),cc=x*x+y*y-horizontal*horizontal;
 let h;if(aa<1e-18){if(cc>=0)return null;h=[0,end];}else{const disc=bb*bb-4*aa*cc;if(disc<=0)return null;const q=Math.sqrt(disc);h=[Math.max(0,(-bb-q)/(2*aa)),Math.min(end,(-bb+q)/(2*aa))];}
 const z=a0.altitude-b0.altitude,dz=a1.altitude-b1.altitude-z;
 if(Math.abs(dz)<1e-12&&Math.abs(z)>=vertical)return null;
 const v=slab(z,z+dz,-vertical,vertical);if(!v)return null;
 const lo=Math.max(h[0],v[0]),hi=Math.min(h[1],v[1],end);if(lo>=hi)return null;
 const at=Math.min(hi,lo+1e-8),distance=Math.hypot(x+dx*at,y+dy*at);
 return {fraction:at,distance,verticalFt:Math.abs(z+dz*at)};
}
export function surfaceContact(f,before){
 if(!f.command||!['arrival','approach','departure','takeoff'].includes(f.phase))return null;
 const contacts=[];
 // Background is explicitly 0 ft MSL; there is no terrain database or invented terrain elevation.
 if(f.altitude<=0&&f.phase!=='takeoff'){
  const t=before.altitude>0&&before.altitude!==f.altitude?before.altitude/(before.altitude-f.altitude):0;
  contacts.push({kind:'impact',fraction:t,point:interpolate(before,f,t),surface:'background',elevationFt:0});
 }
 for(const r of RUNWAYS){
  const a=runwayPosition(before,r),b=runwayPosition(f,r),along=slab(a.along,b.along,0,r.lengthM/1852),cross=slab(a.cross,b.cross,-SURFACE_MODEL.runwayHalfWidthM/1852,SURFACE_MODEL.runwayHalfWidthM/1852);
  if(!along||!cross)continue;
  const below=slab(before.altitude,f.altitude,-Infinity,r.elevation);if(!below)continue;
  const lo=Math.max(along[0],cross[0],below[0]),hi=Math.min(along[1],cross[1],below[1]);if(lo>hi)continue;
  // A departure on its own modeled runway is not an airborne impact while accelerating.
  if(f.phase==='takeoff'&&r.id===RUNWAYS[f.lane].id&&before.altitude>=r.elevation-1)continue;
  const p=interpolate(before,{...f,verticalRate:f.pilot?.motionVerticalRateFpm??f.verticalRate},lo),penetrated=p.altitude<r.elevation-1e-6;
  const aligned=Math.abs(((p.heading-r.headingTrue+540)%360)-180)<SURFACE_MODEL.maxHeadingErrorDeg;
  const landing=f.phase==='approach'&&r.id===RUNWAYS[f.lane].id&&!penetrated&&aligned&&p.speed<=SURFACE_MODEL.maxTouchdownIasKt&&p.verticalRate<=0&&p.verticalRate>=-SURFACE_MODEL.maxTouchdownSinkFpm;
  contacts.push({kind:landing?'landing':'impact',fraction:lo,point:{...p,altitude:r.elevation},surface:r.id,elevationFt:r.elevation});
 }
 if(f.phase==='takeoff'&&runwayPosition(f,RUNWAYS[f.lane]).along>RUNWAYS[f.lane].lengthM/1852+.3&&f.altitude<RUNWAYS[f.lane].elevation+50)contacts.push({kind:'impact',fraction:1,point:motionSnapshot(f),surface:'runway-overrun',elevationFt:RUNWAYS[f.lane].elevation});
 return contacts.sort((a,b)=>a.fraction-b.fraction||(a.kind==='impact'?-1:1))[0]??null;
}
export function exitCandidate(f){
 if(!isAirborne(f))return null;
 const distance=Math.hypot(f.x,f.y),outward=f.x*Math.sin(f.heading*Math.PI/180)+f.y*Math.cos(f.heading*Math.PI/180)>0;
 if(f.mission==='departure'&&(f.procedureDone||distance>AIRPORT.sectorRadiusNm)&&distance>=EXIT_POLICY.minDistanceNm&&outward)return 'departure';
 if(distance>AIRPORT.sectorRadiusNm)return 'sector-violation';
 return null;
}
