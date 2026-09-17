import React from 'react';
import {AIRPORT,DATASET_INFO,procedureContext} from './airport.mjs';
export default function ProcedureInfo({state,flight,language}){
 const en=language==='en',context=procedureContext(flight);
 return <details className="procedure-info"><summary>{en?'LTFM procedures & data sources':'LTFM prosedürleri ve veri kaynakları'} · {AIRPORT.id}</summary>
 <p>{en?'South flow; selected published procedures. Retrieved':'Güney yönlü kullanım; seçilmiş yayımlanmış prosedürler. Alınma tarihi'}: {AIRPORT.retrieved}. {en?'Not a current operational database.':'Güncel operasyon veri tabanı değildir.'}</p>
 <p>{en?'2 STARs · 6 SIDs · 9 ILS Z transitions · 3 missed approaches · 6 holding fixes':'2 STAR · 6 SID · 9 ILS Z geçişi · 3 pas geçme · 6 bekleme noktası'}</p>
 <p>{en?'Holding fix, inbound course and turn direction come from charts; one-minute legs and rate-one turns are demo assumptions.':'Bekleme noktası, giriş doğrultusu ve dönüş yönü haritalardan; bir dakikalık bacaklar ve saniyede 3° dönüş demo varsayımıdır.'}</p>
 <p>{en?'Procedure violations (demo tolerances)':'Prosedür ihlalleri (demo toleransları)'}: <b>{state.stats.procedureViolations||0}</b> · {en?'Altitude / speed / route':'İrtifa / hız / rota'}: {state.stats.altitudeViolations||0} / {state.stats.speedViolations||0} / {state.stats.routeViolations||0}</p>
 {!state.isReplay&&<p>{flight.id} · {context.active||context.assignedArrival||context.requestedDeparture} · {en?'Next':'Sıradaki'}: {context.nextLeg?.fix||'—'} · {context.distanceToNextNm??'—'} NM</p>}
 <ul>{DATASET_INFO.sources.map(s=><li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">DHMİ {s.id}</a> · {s.date}</li>)}</ul>
 </details>;
}
