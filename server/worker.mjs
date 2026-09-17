import {parseStudyManifest,initializeStudy,studyStopReason,stopStudy,runtimeVersions,provenance} from './study-run.mjs';
import {MEASUREMENT_POLICY} from '../src/flight-events.mjs';
import {ResearchJournal,ArchiveError} from './research-journal.mjs';
import {collectObservations} from '../src/observation-events.mjs';
import {enableAirborneScope,releaseDepartures,AIRBORNE_SCOPE} from '../src/traffic-lifecycle.mjs';
import {resetExperiment,RESET_RECEIPT} from './reset-experiment.mjs';
import {DurableObject} from 'cloudflare:workers';
import {ReplayArchive} from './replay-archive.mjs';
import {createAirborneSimulation,createSimulation,advanceSimulation,makePlan,applyFleetDecision,publicSimulation,experimentReport,CONTROL_SECONDS,addEvent} from '../src/simulation.mjs';
import {buildRequest,callTypeSafe,batchPlans,TYPESAFE_PROMPT_VERSION,TYPESAFE_CONTEXT_VERSION} from './typesafe.mjs';
import {DEFAULT_LIMITS,budgetAt,reserveBudget,settleBudget} from './budget.mjs';
import {PILOT_CONTROL_POLICY} from '../src/pilot.mjs';
import {initializeCommandAudit} from '../src/command-audit.mjs';
import {EVALUATION_PROTOCOL} from '../src/evaluation.mjs';
const VIEWER_LEASE_MS=20000;
const safeInt=(value,fallback,min,max)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;};
export class AirportSimulation extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);const manifest=parseStudyManifest(env.RUN_MANIFEST_JSON);if(manifest&&env.CLEAN_START_PILOT)throw new Error('Historical reset must be disabled for a study');if(manifest&&manifest.requestedModel!==(env.TYPESAFE_MODEL||'jev-1.13.0'))throw new Error('Frozen requested model mismatch');if((manifest&&env.RESEARCH_RUN_ID!==manifest.runId)||(env.RESEARCH_RUN_ID&&!manifest))throw new Error('Study identity/manifest mismatch');this.presence=new Map();this.inFlight=null;
  this.ctx.blockConcurrencyWhile(async()=>{
   this.record=await ctx.storage.get('airport-ltfm-v1');
   if(!this.record){
    const old=await ctx.storage.get('airport-v3')||await ctx.storage.get('airport-v2');
    this.record={sim:(env.SIM_SCOPE==='legacy-test-fixture'?createSimulation:createAirborneSimulation)(Date.now(),manifest?.seed??Date.now()),budget:budgetAt(old?.budget,Date.now()),ai:{mode:'idle',nextAt:0,failures:0,totalFailures:0,totalCalls:0,frames:0,totalLatencyMs:0,last:null},paused:true,frameRemaining:0,nextTick:0,startedAt:Date.now()};
    await ctx.storage.put('airport-ltfm-v1',this.record);
   }
   if(!this.record.sim.physicsEpoch){
    if(!await ctx.storage.get('airport-before-pilot-v1'))await ctx.storage.put('airport-before-pilot-v1',this.record);
    this.record.sim.physicsEpoch={model:'transport-point-mass-v1',startedAt:Date.now(),elapsed:this.record.sim.elapsed,baseline:structuredClone(this.record.sim.stats)};
    this.record.ai.nextAt=0;this.record.frameRemaining=0;
    await ctx.storage.put('airport-ltfm-v1',this.record);
   }
   if(env.CLEAN_START_PILOT==='20260917')this.record=await resetExperiment(ctx.storage,this.record,['airport-ltfm-v1','airport-before-pilot-v1','airport-v3','airport-v2','replay-ltfm-v1','replay-archive-ltfm-v2','replay-archive-ltfm-v2:0']);
   // Tag the control-policy change without resetting counters, billing or replay.
   if(this.record.sim.controlEpoch?.policy!==PILOT_CONTROL_POLICY){
    const sim=this.record.sim;
    sim.controlEpoch={policy:PILOT_CONTROL_POLICY,previousPolicy:sim.controlEpoch?.policy??'procedure-target-repair-v1',startedAt:Date.now(),elapsed:sim.elapsed,baseline:structuredClone(sim.stats)};
    await ctx.storage.put('airport-ltfm-v1',this.record);
   }
   if(this.record.sim.measurementEpoch?.policy!==MEASUREMENT_POLICY||this.record.sim.commandAudit?.evaluation?.protocolId&&this.record.sim.commandAudit.evaluation.protocolId!==EVALUATION_PROTOCOL){
    const sim=this.record.sim,key='before-measurement-'+MEASUREMENT_POLICY;
    if(!await ctx.storage.get(key))await ctx.storage.put(key,{measurementEpoch:sim.measurementEpoch??null,evaluation:sim.commandAudit?.evaluation??null,stats:structuredClone(sim.stats),elapsed:sim.elapsed});
    sim.measurementEpoch={policy:MEASUREMENT_POLICY,startedAt:Date.now(),elapsed:sim.elapsed,baseline:structuredClone(sim.stats)};
    if(sim.commandAudit)delete sim.commandAudit.evaluation;
   }
   if(initializeCommandAudit(this.record.sim))await ctx.storage.put('airport-ltfm-v1',this.record);
   if(env.SIM_SCOPE!=='legacy-test-fixture'&&enableAirborneScope(this.record.sim)){releaseDepartures(this.record.sim);this.record.ai.nextAt=0;this.record.frameRemaining=0;this.record.paused=true;await ctx.storage.put('airport-ltfm-v1',this.record);}
   if(this.record.study&&!manifest)throw new Error('A frozen run cannot resume without its manifest');
   await initializeStudy(this.record,manifest,Date.now());
   if(this.record.study){const limits=this.limits(),oldLimits=this.record.study.runtimeLimits;if(oldLimits&&JSON.stringify(oldLimits)!==JSON.stringify(limits))throw new Error('Frozen runtime limits changed');this.record.study.runtimeLimits=limits;}

   this.journal=await ResearchJournal.open(ctx.storage,safeInt(env.RESEARCH_JOURNAL_MAX_BYTES,64*1024*1024,1000000,1000000000));
   if(this.journal.meta.nextSequence===0)await this.persist(this.record,[{kind:'initial-state',sim:structuredClone(this.record.sim),versions:{prompt:TYPESAFE_PROMPT_VERSION,context:TYPESAFE_CONTEXT_VERSION,control:PILOT_CONTROL_POLICY,evaluation:EVALUATION_PROTOCOL},manifest:this.record.study?.manifest??null,sourceProvenance:provenance,historicalBackfill:false}]);
   if(this.record.activeSourceFingerprint!==provenance.sourceFingerprint){const tagged=structuredClone(this.record);tagged.activeSourceFingerprint=provenance.sourceFingerprint;await this.persist(tagged,[{kind:'configuration',sourceProvenance:provenance,versions:runtimeVersions(),trafficScope:tagged.sim.trafficScope??'legacy-mixed-v1'}]);}
   if(this.record.ai.mode==='evaluating'){
    const interrupted=structuredClone(this.record);interrupted.ai.mode='archive-error';interrupted.ai.stopReason='interrupted-dispatch-outcome-unknown';interrupted.frameRemaining=0;if(interrupted.study){interrupted.study.status='incomplete';interrupted.study.stopReason=interrupted.ai.stopReason;}
    await this.persist(interrupted,[{kind:'interrupted-dispatch',outcome:'unknown',reservationRetained:true}]);
   }
   this.presence=new Map(await ctx.storage.get('viewers-v3')||[]);
   this.totalVisits=await ctx.storage.get('total-visits')||0;
   this.replay=await ReplayArchive.open(ctx.storage,this.record.sim.flights.map(f=>f.id));
  });
 }
 limits(){return {...DEFAULT_LIMITS,dailyTokens:safeInt(this.env.AI_DAILY_TOKEN_LIMIT,DEFAULT_LIMITS.dailyTokens,10000,100000000),hourlyRequests:safeInt(this.env.AI_HOURLY_REQUEST_LIMIT,720,1,720),intervalMs:safeInt(this.env.AI_INTERVAL_SECONDS,60,60,3600)*1000};}
 viewers(now=Date.now()){return [...this.presence.values()].filter(p=>p.active&&p.expires>now).length;}
 async heartbeat(id,sequence,active){
  return this.ctx.blockConcurrencyWhile(async()=>{
   const now=Date.now();
   for(const [key,p] of this.presence)if(p.expires<now-60000)this.presence.delete(key);
   const old=this.presence.get(id);
   if(old&&sequence<=old.sequence)return true;
   if(!old&&this.presence.size>=500)return false;
   const counted=old?.counted||active;
   if(active&&!old?.counted){this.totalVisits++;await this.ctx.storage.put('total-visits',this.totalVisits);}
   this.presence.set(id,{sequence,active,counted,expires:now+VIEWER_LEASE_MS});
   await this.ctx.storage.put('viewers-v3',[...this.presence]);
   if(!this.viewers()){this.inFlight?.abort();await this.ctx.storage.setAlarm(now+1);}
   else if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(now+1);
   return true;
  });
 }
 async snapshot(){
  const {sim,ai,budget}=this.record,viewers=this.viewers();
  return {experimentId:this.record.startedAt,...publicSimulation(sim),serverTime:Date.now(),updatedAt:sim.lastWall,speed:1,viewers,totalVisits:this.totalVisits,viewerLeaseSeconds:VIEWER_LEASE_MS/1000,running:Boolean(viewers&&ai.mode==='active'&&this.record.frameRemaining>0),ai:{...ai,mode:viewers||['archive-error','input-too-large','study-stopped'].includes(ai.mode)?ai.mode:'idle',configured:Boolean(this.env.TYPESAFE_API_KEY)&&this.env.AI_ENABLED!=='false',intervalSeconds:this.limits().intervalMs/1000,budget:{...budgetAt(budget,Date.now()),limit:this.limits().dailyTokens}}};
 }
 async replayData(page=0){return this.replay.read(page);}
 async captureReplay(sim){await this.replay.capture(sim);}
 async report(){
  const journal=await this.journal.read(),result={researchJournal:journal,study:this.record.study??null,sourceProvenance:provenance,reset:await this.ctx.storage.get(RESET_RECEIPT),startedAt:this.record.startedAt,...experimentReport(this.record.sim,this.record.ai,this.record.budget)};
  const covers=Number.isFinite(result.evaluation.coverage.startedAtSimSeconds)&&!journal.tailUncertain&&this.record.ai.mode!=='archive-error'&&journal.coverageStartSimSeconds<=result.evaluation.coverage.startedAtSimSeconds;
  const reviewHash=this.record.study?.manifest.ruleReviewSha256,reviewed=Boolean(this.record.study?.manifest.independentRuleReview&&typeof reviewHash==='string'&&/^[a-f0-9]{64}$/.test(reviewHash));
  result.evaluation.dataAvailability.fullDecisionJournal=covers;result.evaluation.dataAvailability.fullIncidentJournal=covers;
  result.evaluation.dataAvailability.locallyFrozenRunManifest=Boolean(this.record.study);result.evaluation.dataAvailability.independentlyAdjudicatedLabels=reviewed;result.evaluation.dataAvailability.ruleReviewSha256=reviewed?reviewHash:null;result.evaluation.dataAvailability.journalScope='Since archive start; normalized replies, failure status, complete applied commands and events. Raw malformed provider bodies are not retained.';
  result.evaluation.analysisReadiness.blockers=result.evaluation.analysisReadiness.blockers.filter(b=>!(covers&&['full-request-response-journal-missing','full-incident-journal-missing'].includes(b))&&!(this.record.study&&b==='frozen-run-manifest-missing')&&!(reviewed&&b==='independent-rule-adjudication-pending'));
  return result;
 }
 async persist(next,events=[]){
  const previousRevision=this.record?.sim.revision;
  if(!events.length&&this.record?.ai.mode!==next.ai.mode)events=[{kind:'mode-transition',from:this.record?.ai.mode,to:next.ai.mode,reason:next.ai.stopReason??next.ai.budgetReason??null}];
  if(this.journal&&events.length)await this.journal.commit('airport-ltfm-v1',next,events);else await this.ctx.storage.put('airport-ltfm-v1',next);
  this.record=next;
  if(this.replay&&previousRevision!==next.sim.revision)await this.captureReplay(next.sim);
 }
 async researchData(entry=null,chunk=null){return this.journal.read(entry,chunk);}
 async alarm(){
  // Coalesce re-entry before any storage await; a leave can still abort the active dispatch.
  if(this.alarmBusy){if(!this.viewers())this.inFlight?.abort();return;}
  this.alarmBusy=true;
  try{return await this.runAlarm();}
  catch(error){
   if(!(error instanceof ArchiveError))throw error;
   const stopped=structuredClone(this.record);stopped.ai.mode='archive-error';stopped.ai.stopReason=error.code;stopped.frameRemaining=0;if(stopped.study){stopped.study.status='incomplete';stopped.study.stopReason=error.code;}
   await this.ctx.storage.put('airport-ltfm-v1',stopped);this.record=stopped;await this.ctx.storage.deleteAlarm();
  }finally{this.alarmBusy=false;}
 }
 async runAlarm(){
  const now=Date.now(),next=structuredClone(this.record),limits=this.limits(),journalEvents=[];
  if(['archive-error','study-stopped'].includes(next.ai.mode)||['archive-error','study-stopped'].includes(next.ai.waitMode)){await this.ctx.storage.deleteAlarm();return;}
  const stopBefore=studyStopReason(next,now);if(stopBefore){stopStudy(next,stopBefore);await this.persist(next,[{kind:'study-stop',reason:stopBefore}]);await this.ctx.storage.deleteAlarm();return;}
  if(!this.viewers(now)){this.inFlight?.abort();next.paused=true;next.frameRemaining=0;if(next.ai.mode!=='idle')next.ai.waitMode=next.ai.mode;next.ai.mode='idle';next.sim.lastWall=now;await this.persist(next,journalEvents);await this.ctx.storage.deleteAlarm();return;}
  await this.ctx.storage.setAlarm(now+2000);
  if(this.inFlight||now<next.nextTick)return;
  if(next.ai.blockedRevision===next.sim.revision&&next.ai.blockedContextVersion===TYPESAFE_CONTEXT_VERSION){await this.ctx.storage.deleteAlarm();return;}
  if(next.paused){next.paused=false;next.sim.lastWall=now;next.ai.mode=['budget-limit','backoff','disabled','input-too-large','archive-error','study-stopped'].includes(next.ai.waitMode)?next.ai.waitMode:'awaiting';}
  if(next.ai.mode==='active'&&next.frameRemaining>0){
   const seconds=Math.min(next.study?Math.max(0,next.study.manifest.stopping.targetSimulatedSeconds-(next.sim.elapsed-next.study.startSimSeconds)):Infinity,next.frameRemaining,Math.max(0,Math.min(3,(now-next.sim.lastWall)/1000)));
   const beforeElapsed=next.sim.elapsed;const capture=collectObservations(next.sim,()=>advanceSimulation(next.sim,seconds));journalEvents.push({kind:'physics-step',from:beforeElapsed,to:next.sim.elapsed,events:capture.events});next.frameRemaining-=next.sim.elapsed-beforeElapsed;
   if(next.frameRemaining<=0)next.ai.mode='awaiting';
  }
  const stopAfter=studyStopReason(next,now);if(stopAfter){stopStudy(next,stopAfter);journalEvents.push({kind:'study-stop',reason:stopAfter});await this.persist(next,journalEvents);await this.ctx.storage.deleteAlarm();return;}
  if(next.sim.trafficScope===AIRBORNE_SCOPE&&next.sim.requiresDecision){next.frameRemaining=0;next.ai.nextAt=0;next.ai.mode='awaiting';}
  next.sim.lastWall=now;next.nextTick=now+1500;
  if(this.env.AI_ENABLED==='false'||!this.env.TYPESAFE_API_KEY){
   next.ai.mode='disabled';next.frameRemaining=0;await this.persist(next,journalEvents);return;
  }
  // Re-evaluate a blocked frame after a configured cap change; never reset spent tokens.
  const legacyBudgetWait=next.ai.mode==='awaiting'&&next.ai.budgetLimit===undefined&&next.ai.nextAt>now+limits.intervalMs;
  if((next.ai.mode==='budget-limit'||legacyBudgetWait)&&next.ai.budgetLimit!==limits.dailyTokens)next.ai.nextAt=0;
  const threats=next.sim.alerts.filter(c=>c.critical&&c.seconds<=45);
  const emergency=next.ai.mode==='active'&&threats.length>0&&next.sim.elapsed-(next.ai.lastConflictAt??-Infinity)>=10;
  if(!emergency&&(next.frameRemaining>0||now<next.ai.nextAt)){await this.persist(next,journalEvents);return;}
  if(next.ai.mode==='input-too-large'&&next.ai.blockedRevision===next.sim.revision&&next.ai.blockedContextVersion===TYPESAFE_CONTEXT_VERSION){await this.ctx.storage.deleteAlarm();await this.persist(next,journalEvents);return;}
  const plan=makePlan(next.sim);
  const remaining=next.frameRemaining;
  if(emergency){
   const ids=new Set(threats.flatMap(c=>[c.a,c.b]));
   plan.flights=plan.flights.filter(f=>ids.has(f.id));plan.runways=[];
   next.ai.lastConflictAt=next.sim.elapsed;
   plan.state.trigger={reason:'predicted-conflict',at:next.sim.elapsed,threats};
  }else plan.state.trigger={reason:'scheduled',at:next.sim.elapsed};
  if(!plan.flights.length){
   next.sim.requiresDecision=false;const beforeElapsed=next.sim.elapsed;
   const idleSeconds=Math.min(2,next.study?Math.max(0,next.study.manifest.stopping.targetSimulatedSeconds-(next.sim.elapsed-next.study.startSimSeconds)):Infinity);
   const capture=collectObservations(next.sim,()=>advanceSimulation(next.sim,idleSeconds));
   journalEvents.push({kind:'physics-step',idleAdvance:true,from:beforeElapsed,to:next.sim.elapsed,events:capture.events});next.sim.lastWall=now;
   const reason=studyStopReason(next,now);if(reason){stopStudy(next,reason);journalEvents.push({kind:'study-stop',reason});}
   await this.persist(next,journalEvents);if(reason)await this.ctx.storage.deleteAlarm();return;
  }
  let requests;
  try{requests=batchPlans(plan).map(p=>buildRequest(p,this.env.TYPESAFE_MODEL||'jev-1.13.0'));}
  catch(error){if(error?.code!=='input-too-large')throw error;
   next.ai.mode='input-too-large';next.frameRemaining=0;next.ai.blockedRevision=next.sim.revision;next.ai.blockedContextVersion=TYPESAFE_CONTEXT_VERSION;next.ai.planningFailures=(next.ai.planningFailures||0)+1;
   addEvent(next.sim,'AI input too large; no request dispatched','system',{code:'input-too-large',planRevision:plan.revision});
   journalEvents.push({kind:'planning-failure',reason:'input-too-large',planRevision:plan.revision,dispatched:false});
   if(next.study){stopStudy(next,'input-too-large');journalEvents.push({kind:'study-stop',reason:'input-too-large'});}
   await this.persist(next,journalEvents);await this.ctx.storage.deleteAlarm();return;
  }
  const reservations=requests.map(request=>new TextEncoder().encode(JSON.stringify(request)).length+4096);
  const totalReserve=reservations.reduce((a,b)=>a+b,0),stopBudget=studyStopReason(next,now,totalReserve);if(stopBudget){stopStudy(next,stopBudget);journalEvents.push({kind:'study-stop',reason:stopBudget});await this.persist(next,journalEvents);await this.ctx.storage.deleteAlarm();return;}
  const budgetBeforeDispatch=structuredClone(next.budget);
  let reservation=next.budget;
  for(const reserved of reservations){reservation=reserved<=80000?reserveBudget(reservation,now,reserved,limits):null;if(!reservation)break;}
  if(!reservation){
   next.ai.mode='budget-limit';next.frameRemaining=0;
   const current=budgetAt(next.budget,now);
   next.ai.budgetLimit=limits.dailyTokens;
   next.ai.budgetReason=current.requests+requests.length>limits.hourlyRequests?'hourly':'daily';
   next.ai.nextAt=next.ai.budgetReason==='hourly'?(Math.floor(now/3600000)+1)*3600000:(Math.floor(now/86400000)+1)*86400000;
   await this.persist(next,journalEvents);return;
  }
  journalEvents.push({kind:'dispatch-intent',plan:{revision:plan.revision,flights:plan.flights,runways:plan.runways},planRevision:plan.revision,trigger:plan.state.trigger,requests:requests.map(r=>JSON.stringify(r)),reservations});
  if(next.study)next.study.accountedInputTokens+=totalReserve;
  next.budget=reservation;next.ai.totalCalls+=requests.length;next.ai.mode='evaluating';if(!emergency)next.ai.nextAt=now+limits.intervalMs;await this.persist(next,journalEvents);
  if(!this.viewers()){
   const cancelled=structuredClone(this.record);
   cancelled.budget=budgetAt(budgetBeforeDispatch,Date.now());cancelled.ai.totalCalls-=requests.length;
   if(cancelled.study)cancelled.study.accountedInputTokens-=totalReserve;
   cancelled.ai.mode='idle';cancelled.ai.nextAt=0;cancelled.paused=true;cancelled.frameRemaining=0;
   await this.persist(cancelled,[{kind:'dispatch-cancelled',planRevision:plan.revision,reason:'no-viewers-before-send',requestsSent:0,reservationReleased:totalReserve}]);
   await this.ctx.storage.deleteAlarm();return;
  }
  this.inFlight=new AbortController();
  const batchStart=Date.now();
  const outcomes=await Promise.allSettled(requests.map(request=>callTypeSafe(request,this.env.TYPESAFE_API_KEY,{signal:this.inFlight.signal})));
  this.inFlight=null;
  const settled=structuredClone(this.record);const outcomeEvents=[{kind:'dispatch-outcomes',planRevision:plan.revision,outcomes:outcomes.map(o=>o.status==='fulfilled'?{status:o.status,result:o.value}:{status:o.status,errorCode:o.reason?.code??'provider-or-contract-failure',httpStatus:o.reason?.status??null})}];
  outcomes.forEach((o,i)=>{if(o.status==='fulfilled')settled.budget=settleBudget(settled.budget,reservation,reservations[i],o.value.usage.input_tokens,Date.now());});
  if(settled.study)outcomes.forEach((o,i)=>{if(o.status==='fulfilled')settled.study.accountedInputTokens+=o.value.usage.input_tokens-reservations[i];});
  const stopAfterResponse=studyStopReason(settled,Date.now());if(stopAfterResponse){stopStudy(settled,stopAfterResponse);outcomeEvents.push({kind:'study-stop',reason:stopAfterResponse,application:'not-applied'});await this.persist(settled,outcomeEvents);return;}
  if(outcomes.some(o=>o.status==='rejected')){
   const failed=settled;failed.frameRemaining=0;
   if(this.viewers()){failed.ai.failures++;failed.ai.totalFailures++;failed.ai.mode='backoff';failed.ai.nextAt=Date.now()+Math.min(600000,limits.intervalMs*2**Math.min(failed.ai.failures,4));addEvent(failed.sim,'AI yanıtı yok · deney duraklatıldı');}
   else{failed.paused=true;failed.ai.mode='idle';await this.ctx.storage.deleteAlarm();}
   if(failed.study){stopStudy(failed,'provider-or-contract-failure');outcomeEvents.push({kind:'study-stop',reason:'provider-or-contract-failure'});}
   await this.persist(failed,outcomeEvents);return;
  }
  const results=outcomes.map(o=>o.value);
  if(settled.study&&results.some(r=>r.model!==settled.study.manifest.requestedModel)){
   stopStudy(settled,'returned-model-mismatch');
   outcomeEvents.push({kind:'study-stop',reason:'returned-model-mismatch',application:'not-applied'});
   await this.persist(settled,outcomeEvents);await this.ctx.storage.deleteAlarm();return;
  }
  const result={model:results[0].model,answers:Object.assign({},...results.map(r=>r.answers)),usage:{input_tokens:results.reduce((n,r)=>n+r.usage.input_tokens,0),output_tokens:results.reduce((n,r)=>n+r.usage.output_tokens,0)},latencyMs:Date.now()-batchStart};
  settled.ai.totalLatencyMs+=result.latencyMs;settled.ai.failures=0;
  let applied={applied:0,rejected:0};
  if(this.viewers()){
   const capture=collectObservations(settled.sim,()=>applyFleetDecision(settled.sim,plan,result.answers));applied=capture.value;outcomeEvents.push({kind:'application',planRevision:plan.revision,...applied,events:capture.events});settled.frameRemaining=emergency?Math.max(1,remaining):CONTROL_SECONDS;settled.ai.mode='active';settled.ai.frames++;
   addEvent(settled.sim,'TypeSafe filo komutları · '+applied.applied+' uçak · '+Object.keys(result.answers).length+' karar','typesafe');
  }else{settled.frameRemaining=0;settled.paused=true;settled.ai.mode='idle';await this.ctx.storage.deleteAlarm();}
  settled.sim.lastWall=Date.now();
  const requestEvidence=await Promise.all(requests.map(async(request,index)=>{
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request)));
   return {batch:index,requestSha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),requestedModel:request.model,returnedModel:results[index].model,questionCount:Object.keys(request.questions).length,inputTokens:results[index].usage.input_tokens,outputTokens:results[index].usage.output_tokens,latencyMs:results[index].latencyMs};
  }));
  const evidence={version:1,promptVersion:TYPESAFE_PROMPT_VERSION,contextVersion:TYPESAFE_CONTEXT_VERSION,requests:requestEvidence,evaluationProtocol:EVALUATION_PROTOCOL,controlPolicy:PILOT_CONTROL_POLICY,planRevision:plan.revision,runwayOrder:plan.runways.map(r=>r.id),runwayConflictResolution:'last-in-plan-order',answers:result.answers};
  settled.ai.last={trigger:plan.state.trigger,telemetry:plan.state.aircraft,at:Date.now(),model:result.model,latencyMs:result.latencyMs,usage:result.usage,aircraft:plan.flights.length,questions:Object.keys(result.answers).length,...applied,evidence,decisions:plan.flights.map(f=>({flight:f.id,route:result.answers[f.id+'_route'].choice,altitude:result.answers[f.id+'_altitude'].choice,speed:result.answers[f.id+'_speed'].choice,rate:result.answers[f.id+'_rate'].choice,confidence:result.answers[f.id+'_route'].confidence}))};
  outcomeEvents.push({kind:'frame-result',planRevision:plan.revision,...applied,viewersPresent:Boolean(this.viewers())});
  await this.persist(settled,outcomeEvents);
 }
}
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
async function readPresence(request){
 const reader=request.body?.getReader();if(!reader)return null;let text='',size=0;const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
 try{const p=JSON.parse(text);return typeof p.id==='string'&&/^[a-zA-Z0-9-]{20,40}$/.test(p.id)&&Number.isSafeInteger(p.sequence)&&p.sequence>=0&&typeof p.active==='boolean'?p:null;}catch{return null;}
}
function objectName(env){if(!env.RESEARCH_RUN_ID)return 'istanbul-demo-v2';if(!/^[-a-zA-Z0-9_]{1,60}$/.test(env.RESEARCH_RUN_ID))throw Error('Invalid study id');return 'study-'+env.RESEARCH_RUN_ID;}
export default{
 async fetch(request,env){
  const url=new URL(request.url);let response;
  try{
   if(url.pathname==='/api/presence'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin)response=new Response('Forbidden',{status:403});
    else if(!(await env.PRESENCE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'local'})).success)response=new Response('Too many requests',{status:429});
    else{const p=await readPresence(request);response=!p?new Response('Invalid presence',{status:400}):await env.AIRPORT.getByName(objectName(env)).heartbeat(p.id,p.sequence,p.active)?new Response(null,{status:204}):new Response('Viewer capacity',{status:429});}
   }else if(!['GET','HEAD'].includes(request.method))response=Response.json({error:'Salt okunur demo.'},{status:405,headers:{Allow:'GET, HEAD'}});
   else if(url.pathname==='/api/state'){
    const cacheKey=new Request(new URL('/__snapshot-pilot-v2/'+objectName(env),url).href);response=await caches.default.match(cacheKey);
    if(!response){
     const {success}=await env.STATE_READ_LIMITER.limit({key:'vector-atc-public-snapshot'});
     if(!success)response=Response.json({error:'Yoğunluk sınırı; tekrar bağlanılıyor.'},{status:429,headers:{'Retry-After':'2'}});
     else{response=Response.json(await env.AIRPORT.getByName(objectName(env)).snapshot(),{headers:{'Cache-Control':'public, max-age=2'}});await caches.default.put(cacheKey,response.clone());}
    }
    response=new Response(response.body,response);response.headers.set('Cache-Control','no-store');
   }else if(url.pathname==='/api/replay'){
    const raw=url.searchParams.get('page')??'0',page=Number(raw);
    if(!/^\d{1,9}$/.test(raw))response=new Response('Invalid page',{status:400});
    else{
     const cacheKey=new Request(new URL('/__replay-pilot-v2/'+objectName(env)+'/'+page,url).href);response=await caches.default.match(cacheKey);
     if(!response){
      const {success}=await env.STATE_READ_LIMITER.limit({key:'vector-atc-replay'});
      if(!success)response=new Response('Too many requests',{status:429});
      else{
       const data=await env.AIRPORT.getByName(objectName(env)).replayData(page);
       response=data?Response.json(data,{headers:{'Cache-Control':'public, max-age=2'}}):new Response('Page not found',{status:404});
       if(data)await caches.default.put(cacheKey,response.clone());
      }
     }
     response=new Response(response.body,response);response.headers.set('Cache-Control','no-store');
    }
   }else if(url.pathname==='/api/research'){
    const entryRaw=url.searchParams.get('entry'),chunkRaw=url.searchParams.get('chunk');
    if((entryRaw!==null&&!/^\d{1,9}$/.test(entryRaw))||(chunkRaw!==null&&(entryRaw===null||!/^\d{1,3}$/.test(chunkRaw))))response=new Response('Invalid archive index',{status:400});
    else if(!(await env.STATE_READ_LIMITER.limit({key:'vector-research-export'})).success)response=new Response('Too many requests',{status:429});
    else{const data=await env.AIRPORT.getByName(objectName(env)).researchData(entryRaw===null?null:Number(entryRaw),chunkRaw===null?null:Number(chunkRaw));response=data?Response.json(data,{headers:{'Cache-Control':'no-store'}}):new Response('Not found',{status:404});}
   }else if(url.pathname==='/api/report'){
    const {success}=await env.STATE_READ_LIMITER.limit({key:'vector-atc-report'});
    response=success?Response.json(await env.AIRPORT.getByName(objectName(env)).report(),{headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="vector-atc-report.json"'}}):new Response('Too many requests',{status:429});
   }else if(url.pathname==='/api/health')response=Response.json({ok:true,version:'0.6.3'},{headers:{'Cache-Control':'no-store'}});
   else if(url.pathname==='/'||/^\/assets\/[a-zA-Z0-9._-]+\.(js|css|woff2?)$/.test(url.pathname))response=await env.ASSETS.fetch(request);
   else response=new Response('Not found',{status:404});
  }catch{response=Response.json({error:'Sektör geçici olarak kullanılamıyor.'},{status:503});}
  const out=new Response(request.method==='HEAD'?null:response.body,response);
  for(const [k,v] of Object.entries(headers))out.headers.set(k,v);
  if(url.protocol==='https:')out.headers.set('Strict-Transport-Security','max-age=31536000');
  return out;
 },
 // Old in-flight cron deliveries cannot wake the experiment.
 async scheduled(){},
};
