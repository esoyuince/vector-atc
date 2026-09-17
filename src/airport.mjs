import data from './ltfm-data.json' with {type:'json'};
export const AIRPORT=data;
const rad=Math.PI/180;
export const project=(lat,lon)=>[(lon-data.arp[1])*60*Math.cos(data.arp[0]*rad),(lat-data.arp[0])*60];
export const unproject=(x,y)=>[data.arp[0]+y/60,data.arp[1]+x/(60*Math.cos(data.arp[0]*rad))];
export const FIXES=Object.fromEntries(Object.entries(data.fixes).map(([id,f])=>[id,{...f,id,point:project(f.lat,f.lon)}]));
export const RUNWAYS=data.runways.map(r=>({...r,point:project(r.lat,r.lon),end:project(r.endLat,r.endLon)})).map(r=>({...r,x:r.point[0],y:r.point[1]}));
export const ACTIVE_RUNWAYS=RUNWAYS.filter(r=>r.active);
export const PROCEDURES=data.procedures;
export const ALTITUDES=[0,202,219,221,500,760,900,1000,1500,1800,1850,1870,2000,2030,2100,2500,3000,4000,5000,6000,7000,8000,10000,12000,14000,16000,18000,19000,22000,24000,26000,28000];
export const SPEEDS=[140,160,180,195,205,210,220,230,250,260,280,300];
export const RATES=[300,500,700,1000,1500,2000,2500];
export const heading=(a,b)=>(Math.atan2(b[0]-a[0],b[1]-a[1])/rad+360)%360;
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export const offset=(p,h,d)=>[p[0]+Math.sin(h*rad)*d,p[1]+Math.cos(h*rad)*d];
export function runwayPosition(f,r){
 const dx=f.x-r.x,dy=f.y-r.y,h=r.headingTrue*rad;
 return {along:dx*Math.sin(h)+dy*Math.cos(h),cross:dx*Math.cos(h)-dy*Math.sin(h)};
}
// Sampled racetrack: published fix, inbound bearing and turn side; one-minute legs
// and rate-one turns are explicit demo assumptions, not extracted chart values.
export function holdPath(id,speed=220){
 const h=data.holds.find(h=>h.fix===id),point=FIXES[id].point,sign=h.turn==='R'?1:-1;
 const r=speed/3600/(3*rad),inbound=(h.inboundMag+data.variation)*rad,path=[point];
 let p=point,angle=inbound;
 for(let lap=0;lap<2;lap++){
  const start=p;
  for(let i=1;i<=18;i++){const a=angle+sign*Math.PI*i/18;path.push([start[0]+sign*r*(Math.cos(angle)-Math.cos(a)),start[1]+sign*r*(Math.sin(a)-Math.sin(angle))]);}
  p=path.at(-1);angle+=sign*Math.PI;p=offset(p,angle/rad,speed*h.legSeconds/3600);path.push(p);
 }
 path[path.length-1]=point;return path;
}
export function routeDescription(p){return p.kind+' '+p.id+(p.runway?' RWY '+p.runway:'')+' via '+p.legs.map(l=>l.fix).join(' → ');}
export function routeOptions(f){
 const choices={};
 if(f.mission==='arrival'){
  choices[f.arrival]=routeDescription(PROCEDURES[f.arrival]);
  const hold=f.command?.navigation?.fix,entry=['GAZGE','INSTA','ULQAL'].includes(hold)?hold:'GAZGE';
  for(const p of Object.values(PROCEDURES))if((p.kind==='APP'&&p.id.endsWith('_'+entry))||(p.kind==='MISSED'&&p.runway===RUNWAYS[f.lane].id))choices[p.id]=routeDescription(p);
 }else for(const p of Object.values(PROCEDURES))if(p.kind==='SID'&&p.runway===RUNWAYS[f.lane].id)choices[p.id]=routeDescription(p);
 if(f.phase!=='taxi_out'){
  for(const h of data.holds.slice(0,3))choices['HOLD_'+h.fix]='Holding fix '+h.fix+', inbound '+h.inboundMag+' MAG, turn '+h.turn+', minimum '+h.minAltitude+' ft; demo 1-minute legs';
  for(const v of ['N','NE','E','SE','S','SW','W','NW'])choices['VECTOR_'+v]='ATC vector '+v+'; select a procedure to rejoin';
 }
 return choices;
}
export function navigation(f,route,speed){
 if(f.command?.route===route)return f.command.navigation;
 if(route.startsWith('HOLD_'))return {kind:'HOLD',points:holdPath(route.slice(5),speed),index:0,loop:true,fix:route.slice(5)};
 const p=PROCEDURES[route];
 if(p){
  // Rejoining an assigned STAR resumes its last passed fix; no automatic routing choice.
  const index=p.kind==='STAR'?(f.progress?.[route]||0):0;
  return {kind:p.kind,points:p.legs.map(l=>FIXES[l.fix].point),index,procedure:route,joining:true,entry:[f.x,f.y]};
 }
 const bearing={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315}[route.slice(7)];
 return {kind:'VECTOR',points:[offset([f.x,f.y],bearing,30)],index:0,entry:[f.x,f.y]};
}
export function procedureContext(f){
 const n=f.command?.navigation||(f.arrival?navigation(f,f.arrival,f.speed):f.requestedDeparture?navigation(f,f.requestedDeparture,f.speed):null),p=n?.procedure?PROCEDURES[n.procedure]:null;
 return {assignedArrival:f.arrival||null,requestedDeparture:f.requestedDeparture||null,active:p?.id||f.command?.route||null,nextLeg:p?.legs[n.index]||null,remainingLegs:p?.legs.slice(n.index,n.index+4)||[],distanceToNextNm:n?Math.round(distance([f.x,f.y],n.points[Math.min(n.index,n.points.length-1)])*10)/10:null};
}
export const DATASET_INFO={id:data.id,retrieved:data.retrieved,sources:data.sources,scope:'South flow: 5 physical runways, 3 active; 2 STARs, 6 SIDs, 9 ILS Z transitions, 3 missed approaches, 6 holding fixes. Selected published procedures, not a complete/current operational database.',assumptions:'Local NM projection; standard atmosphere FL=hundreds of feet; no wind/terrain/wake turbulence; generic transport-jet point-mass physics, not AFM performance; no ARINC turn anticipation; FAA-style 60/90-second holding timing and entry sectors, bank limited to 25 degrees, no wind correction; not a complete LTFM operational holding implementation; point-aircraft separation thresholds are experimental, including parallel approaches.'};
