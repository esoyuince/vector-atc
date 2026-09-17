import React,{useState} from 'react';
import {translator} from './i18n.mjs';
import {AIRPORT,FIXES,PROCEDURES,holdPath} from './airport.mjs';
export default function Radar({flights,selected,onSelect,alerts,running,runways,showGround,language,isReplay}){
 const t=translator(language),[range,setRange]=useState(110),[routes,setRoutes]=useState(true);
 const scale=270/range,point=p=>[400+p[0]*scale,305-p[1]*scale],xy=f=>point([f.x,f.y]);
 const poly=points=>points.map(p=>point(p).join(',')).join(' '),warned=new Set(alerts.flatMap(a=>[a.a,a.b]));
 const chosen=flights.find(f=>f.id===selected),nav=chosen?.command?.navigation;
 const active=PROCEDURES[chosen?.command?.route];
 const selectedPoints=nav?.points||(active?active.legs.map(l=>FIXES[l.fix].point):[]);
 return <section className="radar" aria-label={t('Sentetik sektör radarı')}>
 <div className="radar-readout">LTFM · {range} NM · NORTH UP</div>
 <div className="radar-tools"><select aria-label={language==='en'?'Radar range':'Radar menzili'} value={range} onChange={e=>setRange(Number(e.target.value))}>{[12,40,110].map(n=><option key={n} value={n}>{n} NM</option>)}</select><label><input type="checkbox" checked={routes} onChange={e=>setRoutes(e.target.checked)}/>{language==='en'?'Routes':'Rotalar'}</label></div>
 <div className={'radar-live '+(running?'active':'')}><i/>{isReplay?(language==='en'?'RECORDED REPLAY':'KAYITTAN TEKRAR'):running?t('SİMÜLASYON AKTİF'):t('DURAKLATILDI')}</div>
 <svg viewBox="0 0 800 620" role="img" aria-label={t('Uçakların konumları, yönleri ve güncel yakınlaşmalar')}>
 <defs><pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#19303b" strokeWidth=".6"/></pattern><clipPath id="radar-clip"><rect width="800" height="620"/></clipPath></defs>
 <rect width="800" height="620" fill="url(#grid)"/>
 {[1,2,3].map(i=><g key={i}><circle cx="400" cy="305" r={i*90} className="range"/><text x="408" y={320-i*90} className="range-label">{Math.round(range*i/3)} NM</text></g>)}
 <path d="M400 25V585M120 305H680" className="axis"/><g className="compass"><text x="400" y="19">N</text><text x="690" y="310">E</text><text x="400" y="607">S</text><text x="105" y="310">W</text></g>
 <g clipPath="url(#radar-clip)">
 {routes&&Object.values(PROCEDURES).filter(p=>['STAR','SID'].includes(p.kind)).map(p=><polyline key={p.id} points={poly(p.legs.map(l=>FIXES[l.fix].point))} className={'procedure-path '+p.kind}/>)}
 {routes&&AIRPORT.holds.map(h=>{const [x,y]=point(FIXES[h.fix].point);return <g key={h.fix}><polyline points={poly(holdPath(h.fix))} className="holding-path"/><text x={x+5} y={y-6} className="fix-label">{h.fix}</text><circle cx={x} cy={y} r="2" className="fix-dot"/></g>;})}
 {selectedPoints.length>0&&<polyline points={poly(selectedPoints)} className="selected-procedure"/>}
 {active&&active.legs.map(l=>{const [x,y]=point(FIXES[l.fix].point);return <g key={l.fix}><circle cx={x} cy={y} r="2" className="fix-dot"/><text x={x+4} y={y-3} className="fix-label">{l.fix}</text></g>;})}
 {runways.map(r=>{const a=point(r.point),b=point(r.end);return <g key={r.id}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={'physical-runway '+(r.active?'active':'standby')}/>{range===12&&r.active&&<text x={a[0]} y={a[1]-8} className="airport">{r.id}</text>}</g>;})}
 {alerts.map(c=>{const a=flights.find(f=>f.id===c.a),b=flights.find(f=>f.id===c.b);if(!a||!b)return null;const p=xy(a),q=xy(b);return <line key={c.a+c.b} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} className="conflict-line"/>;})}
 {flights.filter(f=>f.phase!=='pending'&&(showGround||f.id===selected||!['taxi_out','crashed','landing'].includes(f.phase))).map(f=>{const [x,y]=xy(f);return <g key={f.id} transform={`translate(${x},${y})`} className={`aircraft traffic-target ${warned.has(f.id)?'warning':''} ${f.id===selected?'selected':''}`} role="button" tabIndex="0" aria-label={language==='en'?`Select flight ${f.id}`:`${f.id} uçuşunu seç`} onClick={()=>onSelect(f.id)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();onSelect(f.id);}}}><circle r="14" className="hit-area"/>{f.id===selected&&<circle r="12" className="selection-ring"/>}<path d="M0 -6L4 5 0 3 -4 5Z" transform={`rotate(${f.heading})`} className="plane"/>{f.id===selected&&<g className="target-label"><text x="16" y="-10">{f.id}</text><text x="16" y="6">{f.altitude} ft</text></g>}</g>;})}
 </g></svg>
 <div className="radar-summary">{language==='en'?'LTFM south flow · 5 physical / 3 active runways':'LTFM güney yönü · 5 fiziksel / 3 aktif pist'} · {isReplay?'REPLAY':alerts.length+' '+(language==='en'?'predicted encounters':'öngörülen yakınlaşma')}</div>
 </section>;
}
