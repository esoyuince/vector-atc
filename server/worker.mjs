import {resetExperiment,RESET_RECEIPT} from './reset-experiment.mjs';
import {DurableObject} from 'cloudflare:workers';
import {ReplayArchive} from './replay-archive.mjs';
import {createSimulation,advanceSimulation,makePlan,applyFleetDecision,publicSimulation,experimentReport,CONTROL_SECONDS,addEvent} from '../src/simulation.mjs';
import {buildRequest,callTypeSafe,batchPlans} from './typesafe.mjs';
import {DEFAULT_LIMITS,budgetAt,reserveBudget,settleBudget} from './budget.mjs';
const VIEWER_LEASE_MS=20000;
const safeInt=(value,fallback,min,max)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;};
export class AirportSimulation extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);this.presence=new Map();this.inFlight=null;
  this.ctx.blockConcurrencyWhile(async()=>{
   this.record=await ctx.storage.get('airport-ltfm-v1');
   if(!this.record){
    const old=await ctx.storage.get('airport-v3')||await ctx.storage.get('airport-v2');
    this.record={sim:createSimulation(Date.now(),Date.now()),budget:budgetAt(old?.budget,Date.now()),ai:{mode:'idle',nextAt:0,failures:0,totalFailures:0,totalCalls:0,frames:0,totalLatencyMs:0,last:null},paused:true,frameRemaining:0,nextTick:0,startedAt:Date.now()};
    await ctx.storage.put('airport-ltfm-v1',this.record);
   }
   if(!this.record.sim.physicsEpoch){
    if(!await ctx.storage.get('airport-before-pilot-v1'))await ctx.storage.put('airport-before-pilot-v1',this.record);
    this.record.sim.physicsEpoch={model:'transport-point-mass-v1',startedAt:Date.now(),elapsed:this.record.sim.elapsed,baseline:structuredClone(this.record.sim.stats)};
    this.record.ai.nextAt=0;this.record.frameRemaining=0;
    await ctx.storage.put('airport-ltfm-v1',this.record);
   }
   if(env.CLEAN_START_PILOT==='20260917')this.record=await resetExperiment(ctx.storage,this.record,['airport-ltfm-v1','airport-before-pilot-v1','airport-v3','airport-v2','replay-ltfm-v1','replay-archive-ltfm-v2','replay-archive-ltfm-v2:0']);
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
  return {experimentId:this.record.startedAt,...publicSimulation(sim),serverTime:Date.now(),updatedAt:sim.lastWall,speed:1,viewers,totalVisits:this.totalVisits,viewerLeaseSeconds:VIEWER_LEASE_MS/1000,running:Boolean(viewers&&ai.mode==='active'&&this.record.frameRemaining>0),ai:{...ai,mode:viewers?ai.mode:'idle',configured:Boolean(this.env.TYPESAFE_API_KEY),intervalSeconds:this.limits().intervalMs/1000,budget:{...budgetAt(budget,Date.now()),limit:this.limits().dailyTokens}}};
 }
 async replayData(page=0){return this.replay.read(page);}
 async captureReplay(sim){await this.replay.capture(sim);}
 async report(){return {reset:await this.ctx.storage.get(RESET_RECEIPT),startedAt:this.record.startedAt,...experimentReport(this.record.sim,this.record.ai,this.record.budget)};}
 async persist(next){await this.ctx.storage.put('airport-ltfm-v1',next);this.record=next;}
 async alarm(){
  const now=Date.now(),next=structuredClone(this.record),limits=this.limits();
  if(!this.viewers(now)){this.inFlight?.abort();next.paused=true;next.frameRemaining=0;if(next.ai.mode!=='idle')next.ai.waitMode=next.ai.mode;next.ai.mode='idle';next.sim.lastWall=now;await this.persist(next);await this.ctx.storage.deleteAlarm();return;}
  await this.ctx.storage.setAlarm(now+2000);
  if(this.inFlight||now<next.nextTick)return;
  if(next.paused){next.paused=false;next.sim.lastWall=now;next.ai.mode=['budget-limit','backoff','disabled'].includes(next.ai.waitMode)?next.ai.waitMode:'awaiting';}
  if(next.ai.mode==='active'&&next.frameRemaining>0){
   const seconds=Math.min(next.frameRemaining,Math.max(0,Math.min(3,(now-next.sim.lastWall)/1000)));
   advanceSimulation(next.sim,seconds);next.frameRemaining-=seconds;await this.captureReplay(next.sim);
   if(next.frameRemaining<=0)next.ai.mode='awaiting';
  }
  next.sim.lastWall=now;next.nextTick=now+1500;
  if(this.env.AI_ENABLED==='false'||!this.env.TYPESAFE_API_KEY){
   next.ai.mode='disabled';next.frameRemaining=0;await this.persist(next);return;
  }
  // Re-evaluate a blocked frame after a configured cap change; never reset spent tokens.
  const legacyBudgetWait=next.ai.mode==='awaiting'&&next.ai.budgetLimit===undefined&&next.ai.nextAt>now+limits.intervalMs;
  if((next.ai.mode==='budget-limit'||legacyBudgetWait)&&next.ai.budgetLimit!==limits.dailyTokens)next.ai.nextAt=0;
  const threats=next.sim.alerts.filter(c=>c.critical&&c.seconds<=45);
  const emergency=next.ai.mode==='active'&&threats.length>0&&next.sim.elapsed-(next.ai.lastConflictAt??-Infinity)>=10;
  if(!emergency&&(next.frameRemaining>0||now<next.ai.nextAt)){await this.persist(next);return;}
  const plan=makePlan(next.sim);
  const remaining=next.frameRemaining;
  if(emergency){
   const ids=new Set(threats.flatMap(c=>[c.a,c.b]));
   plan.flights=plan.flights.filter(f=>ids.has(f.id));plan.runways=[];
   next.ai.lastConflictAt=next.sim.elapsed;
   plan.state.trigger={reason:'predicted-conflict',at:next.sim.elapsed,threats};
  }else plan.state.trigger={reason:'scheduled',at:next.sim.elapsed};
  if(!plan.flights.length){advanceSimulation(next.sim,2);await this.persist(next);return;}
  const requests=batchPlans(plan).map(p=>buildRequest(p,this.env.TYPESAFE_MODEL||'jev-1.13.0'));
  const reservations=requests.map(request=>new TextEncoder().encode(JSON.stringify(request)).length+4096);
  let reservation=next.budget;
  for(const reserved of reservations){reservation=reserved<=80000?reserveBudget(reservation,now,reserved,limits):null;if(!reservation)break;}
  if(!reservation){
   next.ai.mode='budget-limit';next.frameRemaining=0;
   const current=budgetAt(next.budget,now);
   next.ai.budgetLimit=limits.dailyTokens;
   next.ai.budgetReason=current.requests+requests.length>limits.hourlyRequests?'hourly':'daily';
   next.ai.nextAt=next.ai.budgetReason==='hourly'?(Math.floor(now/3600000)+1)*3600000:(Math.floor(now/86400000)+1)*86400000;
   await this.persist(next);return;
  }
  next.budget=reservation;next.ai.totalCalls+=requests.length;next.ai.mode='evaluating';if(!emergency)next.ai.nextAt=now+limits.intervalMs;await this.persist(next);
  this.inFlight=new AbortController();
  const batchStart=Date.now();
  const outcomes=await Promise.allSettled(requests.map(request=>callTypeSafe(request,this.env.TYPESAFE_API_KEY,{signal:this.inFlight.signal})));
  this.inFlight=null;
  const settled=structuredClone(this.record);
  outcomes.forEach((o,i)=>{if(o.status==='fulfilled')settled.budget=settleBudget(settled.budget,reservation,reservations[i],o.value.usage.input_tokens,Date.now());});
  if(outcomes.some(o=>o.status==='rejected')){
   const failed=settled;failed.frameRemaining=0;
   if(this.viewers()){failed.ai.failures++;failed.ai.totalFailures++;failed.ai.mode='backoff';failed.ai.nextAt=Date.now()+Math.min(600000,limits.intervalMs*2**Math.min(failed.ai.failures,4));addEvent(failed.sim,'AI yanıtı yok · deney duraklatıldı');}
   else{failed.paused=true;failed.ai.mode='idle';await this.ctx.storage.deleteAlarm();}
   await this.persist(failed);return;
  }
  const results=outcomes.map(o=>o.value);
  const result={model:results[0].model,answers:Object.assign({},...results.map(r=>r.answers)),usage:{input_tokens:results.reduce((n,r)=>n+r.usage.input_tokens,0),output_tokens:results.reduce((n,r)=>n+r.usage.output_tokens,0)},latencyMs:Date.now()-batchStart};
  settled.ai.totalLatencyMs+=result.latencyMs;settled.ai.failures=0;
  let applied={applied:0,rejected:0};
  if(this.viewers()){
   applied=applyFleetDecision(settled.sim,plan,result.answers);settled.frameRemaining=emergency?Math.max(1,remaining):CONTROL_SECONDS;settled.ai.mode='active';settled.ai.frames++;await this.captureReplay(settled.sim);
   addEvent(settled.sim,'TypeSafe filo komutları · '+applied.applied+' uçak · '+Object.keys(result.answers).length+' karar','typesafe');
  }else{settled.frameRemaining=0;settled.paused=true;settled.ai.mode='idle';await this.ctx.storage.deleteAlarm();}
  settled.sim.lastWall=Date.now();
  const evidence={version:1,planRevision:plan.revision,runwayOrder:plan.runways.map(r=>r.id),runwayConflictResolution:'last-in-plan-order',answers:result.answers};
  settled.ai.last={trigger:plan.state.trigger,telemetry:plan.state.aircraft,at:Date.now(),model:result.model,latencyMs:result.latencyMs,usage:result.usage,aircraft:plan.flights.length,questions:Object.keys(result.answers).length,...applied,evidence,decisions:plan.flights.map(f=>({flight:f.id,route:result.answers[f.id+'_route'].choice,altitude:result.answers[f.id+'_altitude'].choice,speed:result.answers[f.id+'_speed'].choice,rate:result.answers[f.id+'_rate'].choice,confidence:result.answers[f.id+'_route'].confidence}))};
  await this.persist(settled);
 }
}
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
async function readPresence(request){
 const reader=request.body?.getReader();if(!reader)return null;let text='',size=0;const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
 try{const p=JSON.parse(text);return typeof p.id==='string'&&/^[a-zA-Z0-9-]{20,40}$/.test(p.id)&&Number.isSafeInteger(p.sequence)&&p.sequence>=0&&typeof p.active==='boolean'?p:null;}catch{return null;}
}
export default{
 async fetch(request,env){
  const url=new URL(request.url);let response;
  try{
   if(url.pathname==='/api/presence'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin)response=new Response('Forbidden',{status:403});
    else if(!(await env.PRESENCE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'local'})).success)response=new Response('Too many requests',{status:429});
    else{const p=await readPresence(request);response=!p?new Response('Invalid presence',{status:400}):await env.AIRPORT.getByName('istanbul-demo-v2').heartbeat(p.id,p.sequence,p.active)?new Response(null,{status:204}):new Response('Viewer capacity',{status:429});}
   }else if(!['GET','HEAD'].includes(request.method))response=Response.json({error:'Salt okunur demo.'},{status:405,headers:{Allow:'GET, HEAD'}});
   else if(url.pathname==='/api/state'){
    const cacheKey=new Request(new URL('/__snapshot-pilot-v1',url).href);response=await caches.default.match(cacheKey);
    if(!response){
     const {success}=await env.STATE_READ_LIMITER.limit({key:'vector-atc-public-snapshot'});
     if(!success)response=Response.json({error:'Yoğunluk sınırı; tekrar bağlanılıyor.'},{status:429,headers:{'Retry-After':'2'}});
     else{response=Response.json(await env.AIRPORT.getByName('istanbul-demo-v2').snapshot(),{headers:{'Cache-Control':'public, max-age=2'}});await caches.default.put(cacheKey,response.clone());}
    }
    response=new Response(response.body,response);response.headers.set('Cache-Control','no-store');
   }else if(url.pathname==='/api/replay'){
    const raw=url.searchParams.get('page')??'0',page=Number(raw);
    if(!/^\d{1,9}$/.test(raw))response=new Response('Invalid page',{status:400});
    else{
     const cacheKey=new Request(new URL('/__replay-pilot-v1/'+page,url).href);response=await caches.default.match(cacheKey);
     if(!response){
      const {success}=await env.STATE_READ_LIMITER.limit({key:'vector-atc-replay'});
      if(!success)response=new Response('Too many requests',{status:429});
      else{
       const data=await env.AIRPORT.getByName('istanbul-demo-v2').replayData(page);
       response=data?Response.json(data,{headers:{'Cache-Control':'public, max-age=2'}}):new Response('Page not found',{status:404});
       if(data)await caches.default.put(cacheKey,response.clone());
      }
     }
     response=new Response(response.body,response);response.headers.set('Cache-Control','no-store');
    }
   }else if(url.pathname==='/api/report'){
    const {success}=await env.STATE_READ_LIMITER.limit({key:'vector-atc-report'});
    response=success?Response.json(await env.AIRPORT.getByName('istanbul-demo-v2').report(),{headers:{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="vector-atc-report.json"'}}):new Response('Too many requests',{status:429});
   }else if(url.pathname==='/api/health')response=Response.json({ok:true,version:'0.5.0'},{headers:{'Cache-Control':'no-store'}});
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
