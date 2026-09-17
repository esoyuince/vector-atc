import {replayState,ReplayPlayer} from './replay.mjs';
import ProcedureInfo from './ProcedureInfo.jsx';
import {translator} from './i18n.mjs';
import React,{useEffect,useRef,useState} from 'react';
import Radar from './Radar.jsx';
import DecisionPanel from './DecisionPanel.jsx';
import {PHASES} from './simulation.mjs';
const clock=t=>String(Math.floor(t/3600)).padStart(2,'0')+':'+String(Math.floor(t/60)%60).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
export default function App(){
 const [language,setLanguage]=useState(()=>{try{return localStorage.getItem('vector-language')==='en'?'en':'tr';}catch{return 'tr';}});
 const t=translator(language),locale=language==='en'?'en-GB':'tr-TR';
 useEffect(()=>{document.documentElement.lang=language;try{localStorage.setItem('vector-language',language);}catch{}},[language]);
 const [liveState,setState]=useState(null),[selected,setSelected]=useState('AJT151'),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[error,setError]=useState(''),[now,setNow]=useState(Date.now()),[showGround,setShowGround]=useState(false);
 const [recording,setRecording]=useState(null),[replayStart,setReplayStart]=useState(0),[replayError,setReplayError]=useState(false);
 const replay=liveState?.ai.mode==='budget-limit'?replayState(liveState,recording,(now-replayStart)/1000,{loop:false}):null;
 const state=replay||liveState;
 useEffect(()=>{
  if(liveState?.ai.mode!=='budget-limit'){setRecording(null);setReplayError(false);return;}
  const controller=new AbortController();
  const player=new ReplayPlayer({load:async page=>{const r=await fetch('/api/replay?page='+page,{signal:controller.signal});if(!r.ok)throw new Error();return r.json();},onPage:(data,start)=>{setRecording(data);setReplayStart(start);setReplayError(false);},onError:()=>setReplayError(true)});
  const tick=()=>{if(document.visibilityState==='visible')void player.tick();};
  tick();const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',tick);
  return()=>{player.stop();controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[liveState?.ai.mode,liveState?.experimentId]);
 const session=useRef(crypto.randomUUID()),sequence=useRef(0);
 useEffect(()=>{
  let stopped=false,timer;const controller=new AbortController();
  const presence=active=>{
   const body=JSON.stringify({id:session.current,sequence:++sequence.current,active});
   if(!active){navigator.sendBeacon('/api/presence',new Blob([body],{type:'application/json'}));return;}
   fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal}).catch(()=>{});
  };
  const visibility=()=>presence(document.visibilityState==='visible'),leave=()=>presence(false);
  async function poll(){
   try{if(document.visibilityState==='visible'){const r=await fetch('/api/state',{signal:controller.signal});if(!r.ok)throw new Error();const data=await r.json();if(!stopped){setState(data);setError('');}}}
   catch(e){if(!stopped&&e.name!=='AbortError')setError("Sektör bağlantısı kesildi · yeniden bağlanılıyor");}
   finally{if(!stopped)timer=setTimeout(poll,2000);}
  }
  visibility();poll();const heartbeat=setInterval(()=>{if(document.visibilityState==='visible')presence(true);},7000),clockTimer=setInterval(()=>setNow(Date.now()),1000);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leave);
  return()=>{stopped=true;leave();controller.abort();clearTimeout(timer);clearInterval(heartbeat);clearInterval(clockTimer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);};
 },[]);
 if(!state)return <div className="loading-screen"><div className="brand">VECTOR</div><p>{t(error)||t("TypeSafe uçuş deneyi bağlanıyor…")}</p><span className="spinner"/></div>;
 const flight=state.flights.find(f=>f.id===selected)||state.flights[0],stale=!state.isReplay&&state.running&&now-state.updatedAt>15000;
 const rows=state.flights.filter(f=>(filter==='all'||f.phase===filter)&&f.id.includes(search.toUpperCase()));
 return <div className="app-shell autonomous">
  <header className="topbar"><div className="brand">VECTOR</div><div className="brand-sub"><strong>TypeSafe ATC</strong><span>{t("100 UÇAK · OTONOM KONTROL DENEYİ")}</span></div><div className="header-spacer"/><select className="language-select" aria-label="Language / Dil" value={language} onChange={e=>setLanguage(e.target.value)}><option value="tr">Türkçe</option><option value="en">English</option></select><a className="report-link" href="/api/report" download>{t("Deney raporu ↓")}</a><div className="sim-clock"><label>{state.isReplay?(language==='en'?'REPLAY TIME':'TEKRAR ZAMANI'):t("DENEY ZAMANI · 1×")}</label><b>{clock(state.elapsed)}</b></div></header>
  <div className="toolbar"><div className="sector"><span className="section-label">{t("SEKTÖR")}</span><strong>{language==='en'?'Istanbul / LTFM south flow':'İstanbul / LTFM güney yönü'}</strong></div><div className="connection"><i className={error||stale?'offline':''}/>{error||stale?t("Bağlantı bekleniyor"):state.viewers+t(" aktif izleyici · boşken durur")}</div><label className="ground-toggle"><input type="checkbox" checked={showGround} onChange={e=>setShowGround(e.target.checked)}/>{t("Yerdeki uçakları göster")}</label></div>
  <div className="traffic-stats" aria-label={state.isReplay?(language==='en'?'Live experiment counters, not replay counters':'Canlı deney sayaçları; tekrar sayılmaz'):undefined}>{[[t("UÇAK"),state.flights.length],[t("KALKIŞ / İNİŞ"),state.stats.takeoffs+' / '+state.stats.landings],[t("TAMAMLANAN"),state.stats.cycles],[t("ÇARPIŞMA"),state.stats.collisions],[t("YER TEMASI"),state.stats.groundImpacts],[t("KRİTİK YAKINLAŞMA"),state.stats.criticalEpisodes]].map(([label,value])=><div key={t(label)}><span>{t(label)}</span><strong>{value}</strong></div>)}</div>
  <div className={'experiment-banner '+(state.running?'':'paused')}>{state.isReplay?(language==='en'?'RECORDED REPLAY · AI limit reached · no AI calls':'KAYITTAN TEKRAR · AI limiti doldu · AI çağrısı yok'):state.running?t("TypeSafe komutları uygulanıyor"):t("Uçuşlar duraklatıldı · ")+({'idle':t("izleyici bekleniyor"),'evaluating':t("filo kararları alınıyor"),'budget-limit':t("AI kullanım sınırı"),'backoff':t("AI yeniden deneme bekleniyor"),'disabled':t("AI bağlantısı kapalı")}[state.ai.mode]||t("sonraki kontrol bekleniyor"))}<span>{t("ATC düzeltmeleri yalnızca TypeSafe · model hataları ölçülür")}</span></div>
  {state.ai.mode==='budget-limit'&&<section className="budget-notice" role="status" aria-live="polite"><strong>{state.ai.budgetReason==='hourly'?t("Saatlik AI çağrı sınırına ulaşıldı"):t("Bugünkü AI kullanım sınırına ulaşıldı")}</strong><p>{t("Aylık kullanım kredimizi korumak için deney duraklatıldı. Son uçuş durumu ve deney raporu görüntülenebilir.")}</p><p>{t("Yenilenme: ")}<b>{new Intl.DateTimeFormat(locale,{timeZone:'Europe/Istanbul',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(state.ai.nextAt))}{t(" (Türkiye saati)")}</b>{t(". O sırada bir izleyici varsa deney otomatik devam eder.")}</p></section>}
  {state.isReplay&&<p className="replay-note">{language==='en'?'Recorded positions loop; counters and report remain the last live results.':'Kaydedilmiş konumlar döngüde oynatılır; sayaçlar ve rapor son canlı sonuçları gösterir.'}</p>}{error&&<div className="connection-error" role="alert">{t(error)}</div>}
  {recording&&<p className="replay-note">{language==='en'?'Growing replay archive':'Birikimli replay arşivi'}: <b>{clock(Math.floor(recording.archivedSeconds||0))}</b> · {language==='en'?'Part':'Bölüm'} {(recording.page??0)+1} / {recording.pageCount||1} · {language==='en'?'New live flights are appended every day.':'Her gün yeni canlı uçuşlar arşive eklenir.'}</p>}
  {replayError&&<p className="replay-note" role="status">{language==='en'?'Replay connection interrupted; retrying from the same part.':'Replay bağlantısı kesildi; aynı bölümden yeniden deneniyor.'}</p>}
  <ProcedureInfo state={state} flight={flight} language={language}/><main><Radar isReplay={state.isReplay} language={language} flights={state.flights} selected={selected} onSelect={setSelected} alerts={state.alerts} running={state.running&&!error&&!stale} runways={state.runways} showGround={showGround}/><DecisionPanel language={language} flight={flight} state={state} now={now}/></main>
  <section className="traffic-board"><div className="board-heading"><h2>{t("Uçuş telemetrisi ")}<span>{rows.length} / 100</span></h2><div><input aria-label={t("Uçuş ara")} placeholder={t("Çağrı işareti ara…")} value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label={t("Uçuş aşaması")} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{t("Tüm aşamalar")}</option>{Object.entries(PHASES).map(([key,label])=><option key={key} value={key}>{t(label)} ({state.phases[key]})</option>)}</select></div></div>
  <div className="traffic-table-wrap"><table><thead><tr><th>{t("UÇUŞ")}</th><th>{t("AŞAMA")}</th><th>{t("İRTİFA / HEDEF")}</th><th>{t("HIZ")}</th><th>{t("DİKEY HIZ")}</th><th>{t("AÇI")}</th><th>{t("AI ROTASI")}</th><th>{t("TAMAMLANAN")}</th></tr></thead><tbody>{rows.map(f=><tr key={f.id} className={f.id===selected?'selected-row':''}><td><button onClick={()=>setSelected(f.id)} aria-pressed={f.id===selected}>{f.id}</button></td><td>{t(PHASES[f.phase])}</td><td>{f.altitude} / {f.command?.altitude??'—'} ft</td><td>{f.speed} kt</td><td>{f.verticalRate} fpm</td><td>{f.flightPathAngle}°</td><td>{f.command?.route||t("AI bekleniyor")}</td><td>{f.cycles}</td></tr>)}</tbody></table>{rows.length===0&&<p className="empty-search">{t("Bu filtreye uygun uçuş yok.")}</p>}</div></section>
  <footer><span className="visitor-count">{language==='en'?'Total visits':'Toplam ziyaret'}: {(state.totalVisits||0).toLocaleString(locale)}</span><span>{t("Yayımlanmış LTFM rotaları · sentetik trafik · kaza sayıları gerçek dünya tahmini değildir")}</span><span>© 2026 Ender Soyuince · <a href="https://alaz.tr">alaz.tr</a></span></footer>
 </div>;
}
