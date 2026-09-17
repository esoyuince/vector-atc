import {createSimulation} from '../src/simulation.mjs';
export const RESET_RECEIPT='pilot-clean-start-20260917';
export async function resetPreview(storage){
 const keys=[];
 for(const key of ['airport-ltfm-v1','airport-before-pilot-v1','airport-v3','airport-v2','replay-ltfm-v1','replay-archive-ltfm-v2'])if(await storage.get(key)!==undefined)keys.push(key);
 const meta=await storage.get('replay-archive-ltfm-v2');
 let startAfter;
 do{
  const pages=await storage.list({prefix:'replay-archive-ltfm-v2:',limit:1000,...(startAfter?{startAfter}:{})});
  for(const key of pages.keys()){
   if(!/^replay-archive-ltfm-v2:\d+$/.test(key))throw new Error('Unexpected replay key; inspection required');
   keys.push(key);
  }
  startAfter=pages.size===1000?[...pages.keys()].at(-1):null;
 }while(startAfter);

 return {keys,preserve:['billed budget','total-visits','viewers-v3','Worker secrets'],replayFrames:meta?.frameCount||0};
}
export async function resetExperiment(storage,record,expectedKeys){
 if(await storage.get(RESET_RECEIPT))return record;
 const preview=await resetPreview(storage);
 if(JSON.stringify(preview.keys)!==JSON.stringify(expectedKeys))throw new Error('Reset inventory changed; dry run required');
 const now=Date.now(),sim=createSimulation(now,now);
 sim.physicsEpoch={model:'transport-point-mass-v1',startedAt:now,elapsed:0,baseline:structuredClone(sim.stats)};
 const fresh={sim,budget:structuredClone(record.budget),ai:{mode:'idle',nextAt:0,failures:0,totalFailures:0,totalCalls:0,frames:0,totalLatencyMs:0,last:null},paused:true,frameRemaining:0,nextTick:0,startedAt:now};
 await storage.transaction(async tx=>{
  for(const key of preview.keys)await tx.delete(key);
  await tx.put('airport-ltfm-v1',fresh);
  await tx.put(RESET_RECEIPT,{at:now,deletedKeys:preview.keys,budgetPreserved:true,replayFramesRemoved:preview.replayFrames});
 });
 return fresh;
}
