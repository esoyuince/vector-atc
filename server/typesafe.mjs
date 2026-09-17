import {ALTITUDES,SPEEDS,RATES,FIXES,PROCEDURES,AIRPORT} from '../src/airport.mjs';
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
export function batchPlans(plan,size=10){
 const traffic=Object.values(plan.state.aircraft).map(f=>[f.id,f.phase,...f.positionNm,f.altitudeFt,f.speedKt,f.headingDeg,f.verticalRateFpm,f.waitSeconds,f.command?[f.command.route,f.command.altitudeFt,f.command.speedKt,f.command.verticalRateFpm]:null,f.procedure.nextLeg?.fix||null,f.pilot?.unable||[]]);
 const batches=[];
 for(let start=0;start<plan.flights.length;start+=size){
  const flights=plan.flights.slice(start,start+size),ids=new Set(flights.map(f=>f.id)),runwayBatch=start===0&&plan.runways.length>0;
  const runwayIds=new Set(runwayBatch?plan.runways.map(r=>r.id):[]),contextIds=new Set(ids);
  if(runwayBatch){
   for(const r of plan.runways)for(const c of r.choices)contextIds.add(c.id);
   for(const r of plan.state.runways)if(runwayIds.has(r.id))for(const id of [...(r.occupants||[]),...(r.reservations||[]),...(r.reserved?[r.reserved]:[])])contextIds.add(id);
  }
  const needed=new Set(flights.flatMap(f=>Object.keys(f.routes)).filter(id=>PROCEDURES[id]));
  const procedures=Object.fromEntries([...needed].map(id=>{const p=PROCEDURES[id];return [id,{...p,legs:p.legs.map(l=>({...l,positionNm:FIXES[l.fix].point.map(n=>Math.round(n*100)/100)}))}];}));
  batches.push({...plan,flights,runways:runwayBatch?plan.runways:[],state:{...plan.state,procedures,holds:AIRPORT.holds,aircraft:Object.fromEntries(Object.entries(plan.state.aircraft).filter(([id])=>ids.has(id))),trafficColumns:['id','phase','xNM','yNM','altFt','speedKt','headingTrueDeg','verticalFpm','waitSec','command','nextLeg','pilot'],traffic,runwayCandidates:runwayBatch?Object.fromEntries(plan.runways.flatMap(r=>r.choices).map(c=>{const f=plan.state.aircraft[c.id];return [c.id,{runway:f.runway,procedure:f.procedure,command:f.command}];})):undefined,conflicts:plan.state.conflicts.filter(c=>contextIds.has(c.a)||contextIds.has(c.b)),recentIncidents:[]}});
 }
 if(size>1&&batches.some(p=>new TextEncoder().encode(JSON.stringify(buildRequest(p,'jev-1.13.0'))).length+4096>79000))return batchPlans(plan,Math.max(1,Math.floor(size/2)));
 return batches;
}
export function buildRequest(plan,model){
 const questions={};
 for(const f of plan.flights){
  const common='Aircraft '+f.id+' under state.aircraft. Follow state.policy and conflicts. Choose the next '+plan.state.horizonSeconds+' second control. ';
  questions[f.id+'_route']={type:'choice',instructions:common+'Select published assigned STAR or a SID for the assigned runway (requested SID is a preference; rerouting is permitted); continue same procedure to retain progress. Near an IAF select its ILS transition with runway clearance. Select named holding fix for delay, MISSED for go-around, VECTOR for necessary intervention. See state.procedures for route constraints.',criteria:f.routes};
  questions[f.id+'_altitude']={type:'choice',instructions:common+'Choose MSL altitude for the next leg in state.aircraft procedure context and state.procedures. Obey min/max/exact crossing levels and holding minima. Descend below FAP altitude only after FAP. Final touchdown target is runway threshold elevation (202/219/221 ft), never zero. Do not descend early. SID initialClimb/minTurnAltitude and gradient are published constraints.',criteria:Object.fromEntries(ALTITUDES.map(n=>[String(n),n+' ft MSL']))};
  questions[f.id+'_speed']={type:'choice',instructions:common+'Choose knots, meeting published next-leg speed (+/-5 knots) or maxSpeed. Sequence traffic. Final touchdown at 140-160. Prevent runway and airborne conflicts.',criteria:Object.fromEntries(SPEEDS.map(n=>[String(n),n+' knots']))};
  questions[f.id+'_rate']={type:'choice',instructions:common+'Choose vertical-rate magnitude ft/min; sign follows target altitude. Use distance/time to next restriction. On glide path use about groundspeed*5.3 fpm for 3 degrees, aim to cross each published profile point at its level. SID requires at least304 ft/NM until8000ft. Do not descend to terrain before threshold.',criteria:Object.fromEntries(RATES.map(n=>[String(n),n+' ft/min']))};
 }
 for(const r of plan.runways)questions['runway_'+r.id]={type:'choice',instructions:'Allocate runway '+r.id+' for the next movement in this synthetic ATC simulation. Choose ONE waiting aircraft or wait. Do not clear while occupied. Balance arrivals/departures and longest waiting time. An arriving aircraft also needs its matching ILS transition selected. Current occupants are in state.runways; aircraft telemetry and conflicts are in state.',criteria:{...Object.fromEntries(r.choices.map(c=>[c.id,c.id+' '+c.kind])),wait:'No new clearance'}};
 return {model,state:{...plan.state,policy: 'You are the sole ATC for this synthetic experiment. Commands apply simultaneously to all aircraft. A pilot executes your clearance with bank, acceleration and vertical-rate limits, published crossing restrictions, holding entry and timing. Pilot unable reasons show conflicting clearances; resolve these. No local controller selects traffic avoidance. Prioritize avoiding predicted conflicts, terrain and occupied runways. Resolve pairs asymmetrically using aircraft IDs/relative geometry so both do not make the same maneuver. Arrivals: follow assigned published STAR, then matching ILS transition via its IAF and FAP. Use named racetrack holds for sequencing. Departures: prefer the requested SID; you may assign another offered SID for the same runway, following its climb restrictions to the exit fix. Altitudes are MSL; runway elevations are not zero. Route sequencing is autopilot only; altitude/speed/rate are clearance targets; the pilot follows published constraints and reports deviations from your target in pilot.unable. Select mutually consistent clearances. Ground aircraft move only with runway clearance. Balance queues; do not hold indefinitely. A regular command follows after 60 simulated seconds. Predicted critical conflicts within 45 seconds trigger an earlier request (10 simulated second cooldown), subject to budget. Emergency requests concern only affected aircraft: other commands remain in force. Route and numeric control questions cannot see each other; coordinate using telemetry and policy.'},questions};
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
