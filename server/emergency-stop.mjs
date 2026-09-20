// A separate durable latch fences ALL work; deleting an alarm alone cannot stop an in-flight handler.
import {budgetAt,settleBudget} from './budget.mjs';
export const STOP_KEY='operator-stop-v1';
export class StopFenceError extends Error {constructor(){super('Operator stop fenced this operation');this.name='StopFenceError';}}
export const stopTarget=record=>({runId:record.study?.manifest.runId??null,experimentId:record.startedAt});
export const stopRequested=c=>Boolean(c.stopLatch);
export function serializeWrite(c,operation){
 const result=(c.recordWrites??Promise.resolve()).then(operation);
 c.recordWrites=result.catch(()=>{});return result;
}
export function assertNotStopped(c){if(stopRequested(c))throw new StopFenceError();}
export function targetMatches(record,target){
 const current=stopTarget(record);
 return Boolean(target&&target.runId===current.runId&&target.experimentId===current.experimentId);
}
function terminalRecord(record,latch){
 const next=structuredClone(record);
 if(next.study&&['ready','running'].includes(next.study.status)){
  next.study.status='incomplete';next.study.stopReason='operator-stop';next.study.stoppedAt=latch.stoppedAt;
 }
 next.ai.mode='study-stopped';next.ai.stopReason=next.study?.stopReason??'operator-stop';
 next.ai.waitMode=null;next.ai.nextAt=0;next.frameRemaining=0;next.nextTick=0;next.paused=true;
 next.emergencyStop={...latch,...(next.emergencyStop?.id===latch.id?next.emergencyStop:{})};
 return next;
}
export function stopView(c){
 if(!c.stopLatch)return null;
 const recorded=c.record?.emergencyStop?.id===c.stopLatch.id?c.record.emergencyStop:null;
 return {...c.stopLatch,...recorded,durable:Boolean(c.stopDurable),stopped:Boolean(c.stopDurable),pending:!c.stopDurable};
}
async function writeStoppedRecord(c,next,events){
 try{
  if(!c.journal||c.stopJournalError)throw Error('Stop journal unavailable');
  await c.persistRaw(next,events);
 }catch(error){
  // Never make emergency shutdown depend on spare journal capacity or a valid archive tail.
  c.stopJournalError=error.code??'archive-write-failed';
  next.emergencyStop.journalStatus='unavailable';next.emergencyStop.journalError=c.stopJournalError;
  await c.ctx.storage.put('airport-ltfm-v1',next);c.record=next;
 }
}
async function finishStop(c){
 const latch=c.stopLatch;
 if(!c.stopDurable){
  latch.stoppedAt=Date.now();latch.simulatedSeconds=c.record.sim.elapsed;
  latch.previousStudyStatus=c.record.study?.status??null;latch.previousStopReason=c.record.study?.stopReason??null;
  latch.eventKind=c.record.study?.status==='running'?'study-stop':c.record.study?.status==='ready'?'operator-stop-before-arm':'operator-stop-latched';
  await c.ctx.storage.put(STOP_KEY,latch);c.stopDurable=true;
 }
 if(c.record.emergencyStop?.id!==latch.id){
  const next=terminalRecord(c.record,latch);next.emergencyStop.journalStatus='recorded';
  await writeStoppedRecord(c,next,[{kind:latch.eventKind,reason:'operator-stop',stopId:latch.id,at:latch.stoppedAt,requestedAt:latch.requestedAt}]);
 }else c.record=terminalRecord(c.record,latch);
 try{await c.ctx.storage.deleteAlarm();c.stopAlarmCleared=true;}catch{c.stopAlarmCleared=false;}
 return {ok:true,...stopView(c),alarmCleared:c.stopAlarmCleared};
}
export function requestEmergencyStop(c,target){
 if(!targetMatches(c.record,target))return Promise.resolve({ok:false,error:'stop-target-mismatch'});
 if(!c.stopLatch){
  c.stopLatch={version:1,id:crypto.randomUUID(),...stopTarget(c.record),requestedAt:Date.now(),reason:'operator-stop',pendingDispatch:Boolean(c.inFlight)};
 }
 // Fence and abort synchronously. Do not hold the stop behind a provider fetch.
 c.inFlight?.abort();
 if(c.stopWork)return c.stopWork;
 const work=serializeWrite(c,()=>finishStop(c));c.stopWork=work;
 const clear=()=>{if(c.stopWork===work)c.stopWork=null;};work.then(clear,clear);
 return work;
}
export async function restoreEmergencyStop(c,latch){
 if(latch?.version!==1||typeof latch.id!=='string'||!Number.isFinite(latch.stoppedAt)||!targetMatches(c.record,latch))throw Error('Invalid persistent operator stop');
 c.stopLatch=latch;c.stopDurable=true;
 if(c.record.emergencyStop?.journalStatus==='unavailable')c.stopJournalError=c.record.emergencyStop.journalError;
 await serializeWrite(c,()=>finishStop(c));
}
export async function settleStoppedDispatch(c,{outcomes,reservation,reservations,planRevision,budgetBeforeDispatch,sent}){
 if(c.stopWork)await c.stopWork.catch(()=>{});
 return serializeWrite(c,async()=>{
  if(!c.stopDurable)await finishStop(c);
  if(c.record.emergencyStop?.settledPlanRevision===planRevision)return;
  const next=terminalRecord(c.record,c.stopLatch);let events;
  if(!sent){
   const released=reservations.reduce((a,b)=>a+b,0);next.budget=budgetAt(budgetBeforeDispatch,Date.now());
   next.ai.totalCalls-=reservations.length;if(next.study)next.study.accountedInputTokens-=released;
   events=[{kind:'dispatch-cancelled',planRevision,reason:'operator-stop-before-send',requestsSent:0,reservationReleased:released}];
  }else{
   for(const [i,outcome] of outcomes.entries())if(outcome.status==='fulfilled'){
    next.budget=settleBudget(next.budget,reservation,reservations[i],outcome.value.usage.input_tokens,Date.now());
    if(next.study)next.study.accountedInputTokens+=outcome.value.usage.input_tokens-reservations[i];
   }
   events=[{kind:'dispatch-outcomes',planRevision,afterOperatorStop:true,application:'not-applied',outcomes:outcomes.map(o=>o.status==='fulfilled'?{status:o.status,result:o.value}:{status:o.status,errorCode:o.reason?.code??'provider-or-contract-failure',httpStatus:o.reason?.status??null})}];
  }
  next.emergencyStop.pendingDispatch=false;next.emergencyStop.settledPlanRevision=planRevision;
  await writeStoppedRecord(c,next,events);
 });
}
// Small fixed-schema body; never put credentials, free-form operator text or arbitrary fields in evidence.
export async function readStopTarget(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return null;
 const reader=request.body?.getReader();if(!reader)return null;
 let bytes=0,text='';const decoder=new TextDecoder();
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>256){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
  const body=JSON.parse(text+decoder.decode());
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='experimentId,runId')return null;
  if(!Number.isSafeInteger(body.experimentId)||body.experimentId<0)return null;
  if(body.runId!==null&&(typeof body.runId!=='string'||!/^[-a-zA-Z0-9_]{1,60}$/.test(body.runId)))return null;
  return body;
 }catch{return null;}
}
