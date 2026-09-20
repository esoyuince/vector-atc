import React,{useRef,useState} from 'react';
import {requestOperatorStop} from './operator-stop-client.mjs';
export default function EmergencyStopPanel({state,language,onStopped}){
 const en=language==='en',dialog=useRef(null),password=useRef(null),busy=useRef(false);
 const [target,setTarget]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null);
 const confirmed=receipt??(state.emergencyStop?.durable?state.emergencyStop:null);
 const clear=()=>{if(password.current)password.current.value='';};
 function open(){setTarget(state.operatorTarget??{runId:state.collection?.runId??null,experimentId:state.experimentId});setError('');clear();dialog.current.showModal();}
 function close(){if(pending)return;clear();dialog.current.close();}
 async function submit(event){
  event.preventDefault();if(busy.current)return;
  busy.current=true;setPending(true);setError('');const token=password.current.value;clear();
  try{
   const result=await requestOperatorStop(window.location.origin,token,target);
   setReceipt(result);onStopped(result);dialog.current.close();
  }catch(failure){
   const code=failure.message;
   setError(code==='stop-http-403'?(en?'Authorization failed.':'Yetkilendirme başarısız.'):code==='stop-http-409'?(en?'Run changed. Close and check the target again.':'Koşu değişti. Kapatıp hedefi yeniden kontrol edin.'):(en?'Stop is NOT confirmed. Check status before retrying the same target.':'Durdurma DOĞRULANMADI. Aynı hedefe yeniden göndermeden önce durumu kontrol edin.'));
  }finally{busy.current=false;setPending(false);clear();}
 }
 return <section className="operator-stop-panel" aria-label={en?'Operator emergency stop':'Operatör acil durdurma'}>
  <div><strong>{confirmed?(en?'EMERGENCY STOP LATCHED':'ACİL DURDURMA KİLİTLENDİ'):(en?'Operator control':'Operatör kontrolü')}</strong>
  <p>{confirmed?(en?'This run cannot restart. Records are preserved.':'Bu koşu yeniden başlatılamaz. Kayıtlar korunuyor.'):(en?'Authorized stop; no deployment required.':'Yetkili durdurma; yeniden dağıtım gerektirmez.')}</p>
  {confirmed?.journalStatus==='unavailable'&&<p role="alert">{en?'Stop persisted separately; journal recording failed.':'Durdurma ayrı kayıtta kalıcı; günlük yazımı başarısız.'}</p>}</div>
  <button type="button" className="emergency-stop-button" onClick={open} disabled={Boolean(confirmed)||pending}>{en?'EMERGENCY STOP':'ACİL DURDUR'}</button>
  <dialog ref={dialog} className="operator-stop-dialog" onCancel={event=>{if(pending)event.preventDefault();else clear();}} onClose={clear} aria-labelledby="stop-dialog-title">
   <form onSubmit={submit}>
    <h2 id="stop-dialog-title">{en?'Permanently stop this run?':'Bu koşu kalıcı olarak durdurulsun mu?'}</h2>
    <p>{en?'New calls and aircraft movement stop. Late replies are not applied. Sent requests may still be billed.':'Yeni çağrılar ve uçuş ilerlemesi kesilir. Geç yanıtlar uygulanmaz. Gönderilmiş istekler yine ücretlendirilebilir.'}</p>
    <p className="stop-target">{target?.runId??'demo'} · {target?.experimentId}</p>
    <label htmlFor="operator-secret">{en?'Operator key':'Operatör anahtarı'}</label>
    <input id="operator-secret" ref={password} type="password" required minLength={32} maxLength={512} autoComplete="off" spellCheck={false} disabled={pending}/>
    <small>{en?'Used only for this request; never saved in the browser.':'Yalnız bu istekte kullanılır; tarayıcıya kaydedilmez.'}</small>
    {error&&<p role="alert">{error}</p>}
    <div className="stop-dialog-actions"><button type="button" onClick={close} disabled={pending}>{en?'Cancel':'Vazgeç'}</button>
    <button type="submit" className="emergency-stop-button" disabled={pending}>{pending?(en?'Stopping…':'Durduruluyor…'):(en?'CONFIRM EMERGENCY STOP':'ACİL DURDURMAYI ONAYLA')}</button></div>
   </form>
  </dialog>
 </section>;
}
