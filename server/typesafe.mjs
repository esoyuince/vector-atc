import {SURFACE_MODEL,EXIT_POLICY} from '../src/flight-events.mjs';
import {ALTITUDES,SPEEDS,RATES,FIXES,PROCEDURES,AIRPORT} from '../src/airport.mjs';
export const TYPESAFE_PROMPT_VERSION='jev-atc-airborne-observe-v2';
export const TYPESAFE_CONTEXT_VERSION='compact-state-geometry-v2';
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
const choiceNumbers=values=>Object.fromEntries(values.map(n=>[String(n),null]));
const ALTITUDE_CHOICES=choiceNumbers(ALTITUDES),SPEED_CHOICES=choiceNumbers(SPEEDS),RATE_CHOICES=choiceNumbers(RATES);
const REQUEST_LIMIT=79000,RESERVE_BYTES=4096;
const trafficRow=f=>[f.id,f.phase,...f.positionNm,f.altitudeFt,f.speedKt,f.headingDeg,f.verticalRateFpm,f.waitSeconds,f.command?[f.command.route,f.command.altitudeFt,f.command.speedKt,f.command.verticalRateFpm]:null,f.procedure.nextLeg?.fix||null,f.pilot?[...(f.pilot.constraintWarnings||[]),...(f.pilot.unable||[])]:[]];
const compactRunway=r=>({id:r.id,thresholdNm:[r.x,r.y].map(n=>Math.round(n*1000)/1000),active:r.active,elevation:r.elevation,lengthM:r.lengthM,headingTrue:r.headingTrue,reserved:r.reserved||null,reservations:r.reservations||[],occupants:r.occupants||[],completed:r.completed||0});
function aircraftContext(f){
 const {positionLatLon,headingTrueDeg,...fields}=f;const p=PROCEDURES[f.procedure?.active],distance=f.procedure?.distanceToNextNm,gs=f.groundSpeedKt;
 const seconds=Number.isFinite(distance)&&gs>0?Math.round(distance/gs*3600):null,leg=f.procedure?.nextLeg;
 return {...fields,guidance:{estimate:'current-GS straight-to-next-fix; not a clearance',timeToNextFixSeconds:seconds,nextAltitudeBandFt:leg?[leg.altitude??leg.minAltitude??null,leg.altitude??leg.maxAltitude??null]:null,
  verticalFpmToNextBand:seconds>0&&leg?[leg.altitude??leg.minAltitude,leg.altitude??leg.maxAltitude].map(n=>n==null?null:Math.round((n-f.altitudeFt)*60/seconds)):null,
  requiredSidGradientFpm:p?.kind==='SID'&&f.altitudeFt<p.climbGradientUntil?Math.ceil(p.minClimbFtPerNm*gs/60):null}};
}
function makeBatch(plan,flights,runwayBatch){
 const ids=new Set(flights.map(f=>f.id)),runwayIds=new Set(runwayBatch?plan.runways.map(r=>r.id):[]),contextIds=new Set(ids);
 if(runwayBatch){for(const r of plan.runways)for(const c of r.choices)contextIds.add(c.id);for(const r of plan.state.runways)if(runwayIds.has(r.id))for(const id of [...(r.occupants||[]),...(r.reservations||[]),...(r.reserved?[r.reserved]:[])])contextIds.add(id);}
 const needed=new Set(flights.flatMap(f=>Object.keys(f.routes)).filter(id=>PROCEDURES[id]));
 const procedures=Object.fromEntries([...needed].map(id=>{const p=PROCEDURES[id];return [id,{...p,legs:p.legs.map(l=>({...l,positionNm:FIXES[l.fix].point.map(n=>Math.round(n*100)/100)}))}];}));
 const holdFixes=new Set(flights.flatMap(f=>Object.keys(f.routes).filter(id=>id.startsWith('HOLD_')).map(id=>id.slice(5))));for(const id of needed)if(PROCEDURES[id]?.hold)holdFixes.add(PROCEDURES[id].hold);
 const runwayCandidates=runwayBatch?plan.runways.flatMap(r=>r.choices.map(c=>{const f=plan.state.aircraft[c.id],p=f.procedure||{},cmd=f.command||{};return [c.id,r.id,c.kind,f.waitSeconds,p.assignedArrival,p.requestedDeparture,p.active,p.nextLeg?.fix||null,p.distanceToNextNm,cmd.route||null,cmd.altitudeFt??null,cmd.speedKt??null,cmd.verticalRateFpm??null];})):undefined;
 return {...plan,flights,runways:runwayBatch?plan.runways:[],state:{trafficScope:plan.state.trafficScope,upcomingHandoffs:plan.state.upcomingHandoffs,surfaceModel:SURFACE_MODEL,exitPolicy:EXIT_POLICY,units:plan.state.units,horizonSeconds:plan.state.horizonSeconds,airport:plan.state.airport,trigger:plan.state.trigger,aircraft:Object.fromEntries(Object.entries(plan.state.aircraft).filter(([id])=>ids.has(id)).map(([id,f])=>[id,aircraftContext(f)])),runways:plan.state.runways.map(compactRunway),procedures,holds:AIRPORT.holds.filter(h=>holdFixes.has(h.fix)).map(({legSeconds,...h})=>({...h,positionNm:FIXES[h.fix].point.map(n=>Math.round(n*1000)/1000),inboundTrueDeg:(h.inboundMag+AIRPORT.variation+360)%360,legTimingSeconds:{atOrBelow14000Ft:60,above14000Ft:90}})),trafficColumns:['id','phase','xNM','yNM','altFt','speedKt','headingTrueDeg','verticalFpm','waitSec','command','nextLeg','pilot'],traffic:Object.values(plan.state.aircraft).filter(f=>!ids.has(f.id)).map(trafficRow),runwayCandidateColumns:runwayBatch?['id','runway','kind','waitSec','assignedArrival','requestedDeparture','activeProcedure','nextFix','distanceToNextNm','commandRoute','commandAltFt','commandSpeedKt','commandVerticalFpm']:undefined,runwayCandidates,conflicts:plan.state.conflicts.filter(c=>contextIds.has(c.a)||contextIds.has(c.b))}};
}
export class InputEnvelopeError extends Error{constructor(){super('TypeSafe request cannot fit the configured envelope.');this.name='InputEnvelopeError';this.code='input-too-large';}}
export function batchPlans(plan,size=24){
 if(!Number.isSafeInteger(size)||size<1||size>100)throw new RangeError('Batch size must be an integer from 1 to 100.');
 const batches=[];let start=0;
 while(start<plan.flights.length){let take=Math.min(size,plan.flights.length-start),batch;
  while(take>0){batch=makeBatch(plan,plan.flights.slice(start,start+take),start===0&&plan.runways.length>0);const bytes=new TextEncoder().encode(JSON.stringify(buildRequest(batch,'jev-1.13.0'))).length+RESERVE_BYTES;if(bytes<=REQUEST_LIMIT)break;take--;}
  if(!take)throw new InputEnvelopeError();batches.push(batch);start+=take;
 }
 return batches;
}
export function buildRequest(plan,model){
 const questions={};
 for(const f of plan.flights){
  const common='Aircraft '+f.id+': use state.aircraft.'+f.id+', state.policy and conflicts; next '+plan.state.horizonSeconds+'s. ';
  questions[f.id+'_route']={type:'choice',instructions:common+'Choose route. Continue its active procedure when appropriate. Arrivals use assigned STAR then matching ILS; HOLD delays, MISSED goes around, VECTOR intervenes. Departures use an offered SID. See state.procedures.',criteria:f.routes};
  questions[f.id+'_altitude']={type:'choice',instructions:common+'Choose target altitude in ft MSL. Obey procedure/next-leg limits, hold minima, FAP floor until crossed, SID climb constraints and runway elevation on touchdown.',criteria:ALTITUDE_CHOICES};
  questions[f.id+'_speed']={type:'choice',instructions:common+'Choose IAS (kt). Obey next-leg speed/max; 140-160 at touchdown only. Sequence traffic.',criteria:SPEED_CHOICES};
  questions[f.id+'_rate']={type:'choice',instructions:common+'Choose vertical-rate magnitude in ft/min; sign follows target altitude. Use guidance estimates and performance limits. Meet the next restriction and SID gradient; never descend into terrain.',criteria:RATE_CHOICES};
 }
 for(const r of plan.runways)questions['runway_'+r.id]={type:'choice',instructions:'Runway '+r.id+': choose one candidate aircraft or wait. Never clear an occupied runway; balance arrivals/departures and wait. An arrival clearance requires its matching ILS route. Use state.runways, runwayCandidates and conflicts.',criteria:{...Object.fromEntries(r.choices.map(c=>[c.id,c.kind])),wait:'No new clearance'}};
 return {model,state:{...plan.state,policy:'Sole ATC; simultaneous commands. Pilot follows your targets, never repairs unsafe commands; constraintWarnings are non-blocking, unable reports physical limits. No local traffic-avoidance controller. Prioritize predicted conflicts, terrain and occupied runways; resolve conflict pairs asymmetrically. Arrivals follow assigned STAR then matching ILS, using holds for sequencing and MISSED for go-around. Departures prefer requested SID but may use another offered SID for that runway. Altitudes are MSL; touchdown target is runway elevation, not zero. Route sequencing is autopilot; altitude/speed/rate are clearance targets. Only airborne aircraft need flight commands; upcoming handoffs are scenario inputs. Keep route, numeric and runway choices mutually compatible; these questions are independent and share only this state. Balance queues. Emergency requests contain only affected aircraft; all other clearances remain in force.'},questions};
}
export function validateResponse(data,request){
 if(typeof data?.model!=='string'||data.model.length>80||!Number.isSafeInteger(data.usage?.input_tokens)||data.usage.input_tokens<0||!Number.isSafeInteger(data.usage?.output_tokens)||data.usage.output_tokens<0)return false;
 return Object.entries(request.questions).every(([id,q])=>{const a=data.answers?.[id],keys=Object.keys(q.criteria);return a?.type==='choice'&&keys.includes(a.choice)&&unit(a.confidence)&&a.probabilities&&Object.keys(a.probabilities).length===keys.length&&keys.every(k=>Object.hasOwn(a.probabilities,k)&&unit(a.probabilities[k]))&&Math.abs(Object.values(a.probabilities).reduce((n,v)=>n+v,0)-1)<.06&&a.probabilities[a.choice]>=Math.max(...Object.values(a.probabilities))-.011;});
}
export async function callTypeSafe(request,apiKey,{fetchImpl=fetch,signal}={}){
 const start=Date.now();let response;
 try{response=await fetchImpl('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(request),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});}catch{throw new Error('TypeSafe çağrısı tamamlanamadı.');}
 if(!response.ok){await response.body?.cancel();throw new Error(response.status===429||response.status===529?'TypeSafe kullanım sınırı/yoğunluk.':'TypeSafe isteği başarısız.');}
 const reader=response.body.getReader();let bytes=0;const parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1000000){await reader.cancel();throw new Error('Model yanıtı boyut sınırını aştı.');}parts.push(value);}
 const buffer=new Uint8Array(bytes);let offset=0;for(const p of parts){buffer.set(p,offset);offset+=p.length;}
 let data;try{data=JSON.parse(new TextDecoder().decode(buffer));}catch{throw new Error('Model yanıtı geçersiz.');}
 if(!validateResponse(data,request))throw new Error('Model yanıtı sözleşme kontrolünü geçemedi.');
 return {model:data.model,answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{const a=data.answers[id];return [id,{type:'choice',choice:a.choice,confidence:a.confidence,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,a.probabilities[k]]))}];})),usage:{input_tokens:data.usage.input_tokens,output_tokens:data.usage.output_tokens},latencyMs:Date.now()-start};
}
