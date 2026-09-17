import './offline-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {offlineHarness,exportLocalJournal} from './lib/offline-harness.mjs';
import {analyzeResearch} from './lib/research-analysis.mjs';
const [output,secondsRaw='3600']=process.argv.slice(2),seconds=Number(secondsRaw);
if(!output||!Number.isSafeInteger(seconds)||seconds<1||seconds>14400)throw Error('Usage: node scripts/offline-soak.mjs NEW_OUTPUT_DIRECTORY [SIM_SECONDS 1..14400]');
fs.mkdirSync(output,{recursive:false});const h=await offlineHarness(path.join(output,'store'));
const timings=[],memory=[],start=performance.now();let ticks=0;
try {
 // Mark this archive as fabricated evidence, never a Jev evaluation result.
 await h.controller.persist(h.controller.record,[{kind:'evidence-class',value:'synthetic-offline',policy:'deliberately mixed safe/unsafe scripted replies; no model inference'}]);
 await h.controller.heartbeat('offline-soak-viewer',1,true);await h.controller.alarm();
 while(h.controller.record.sim.elapsed<seconds&&ticks<seconds*3+100) {
  ticks++;h.advance(2000);if(ticks%3===0)await h.controller.heartbeat('offline-soak-viewer',ticks+1,true);
  const before=performance.now();await h.controller.alarm();timings.push(performance.now()-before);
  if(ticks%25===0){if(global.gc)global.gc();memory.push({tick:ticks,simSeconds:h.controller.record.sim.elapsed,...process.memoryUsage()});}
  if(ticks%100===0){await h.reload();console.log(JSON.stringify({progress:true,ticks,simSeconds:h.controller.record.sim.elapsed,calls:h.metrics.syntheticProviderCalls,heapMb:Math.round(process.memoryUsage().heapUsed/1048576)}));}
  if(h.controller.record.ai.mode==='budget-limit'){
   const before=h.controller.record.sim.elapsed,calls=h.metrics.syntheticProviderCalls;
   h.metrics.budgetPauses=(h.metrics.budgetPauses||0)+1;
   await h.controller.alarm();assert.equal(h.controller.record.sim.elapsed,before);assert.equal(h.metrics.syntheticProviderCalls,calls);
   h.advance(Math.max(0,h.controller.record.ai.nextAt-h.now())+2000);await h.controller.heartbeat('offline-soak-viewer',ticks+2,true);await h.controller.alarm();
  }
  if(['archive-error','input-too-large','study-stopped','backoff'].includes(h.controller.record.ai.mode))throw Error('Offline fixture stopped unexpectedly: '+h.controller.record.ai.mode+' / '+h.controller.record.ai.stopReason);
 }
 assert.ok(h.controller.record.sim.elapsed>=seconds,'No progress');
 const record=h.controller.record;
 await h.controller.heartbeat('offline-soak-viewer',ticks+10,false);await h.controller.alarm();
 const beforeCalls=h.metrics.syntheticProviderCalls,beforeTime=record.sim.elapsed;
 h.advance(86400000);await h.controller.alarm();assert.equal(h.metrics.syntheticProviderCalls,beforeCalls);assert.equal(h.controller.record.sim.elapsed,beforeTime);
 await exportLocalJournal(h.controller,path.join(output,'export'));
 const analysis=await analyzeResearch(path.join(output,'export'));
 assert.equal(analysis.commands.commands,h.controller.record.sim.commandAudit.checkedCommands);assert.equal(analysis.evidenceClass,'synthetic-offline');
 timings.sort((a,b)=>a-b);
 const result={passed:true,evidenceClass:'synthetic-offline',requestedSimSeconds:seconds,simulatedSeconds:record.sim.elapsed,ticks,...h.metrics,wallSeconds:(performance.now()-start)/1000,alarmMs:{p50:timings[Math.floor(timings.length*.5)],p95:timings[Math.floor(timings.length*.95)],max:timings.at(-1)},memory,heapMeasurement:'Periodic samples; GC only when launched with --expose-gc. Not a formal leak proof.',journal:await h.controller.researchData(),stats:record.sim.stats,replayCheckpoints:analysis.checkpoints,commandsVerified:analysis.commands.commands,apiCreditsSpent:0};
 fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(output,'analysis.json'),JSON.stringify(analysis,null,2));console.log(JSON.stringify({...result,memory:memory.length+' samples',journal:{entries:result.journal.nextSequence,bytes:result.journal.totalBytes}}));
} finally {h.close();}
