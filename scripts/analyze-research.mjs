import './offline-guard.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {analyzeResearch} from './lib/research-analysis.mjs';
import {verifyInventory} from './lib/source-inventory.mjs';
import provenance from '../server/build-provenance.mjs';
import {fileURLToPath} from 'node:url';
const [input,out]=process.argv.slice(2);
if(!input||!out)throw Error('Usage: node scripts/analyze-research.mjs VERIFIED_EXPORT NEW_OUTPUT_DIRECTORY');
verifyInventory(fileURLToPath(new URL('..',import.meta.url)),provenance);
const dest=path.resolve(out),partial=dest+'.partial';
for(const name of [dest,partial]){try{await fs.lstat(name);throw Error('Refusing to overwrite '+name);}catch(e){if(e.code!=='ENOENT')throw e;}}
await fs.mkdir(partial);
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const commandKeys=['commandId','aircraft','generation','simSeconds','phase','scope','route','altitudeFt','iasKt','verticalRateFpm','findingCount','rules','bases'];
const handle=await fs.open(path.join(partial,'commands.csv'),'wx');await handle.writeFile(commandKeys.join(',')+'\n');
try {
 const result=await analyzeResearch(input,{onCommand:r=>handle.writeFile(commandKeys.map(k=>csv(r[k])).join(',')+'\n')});await handle.close();
 await fs.writeFile(path.join(partial,'summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 for(const [name,rows] of [['rules',result.byRule.map(r=>({rule:r.id,basis:r.basis,flagged:r.flagged,eligible:r.eligible,fraction:r.fraction.value}))],['flights',result.flights]]) {
  const keys=rows.length?Object.keys(rows[0]):[];await fs.writeFile(path.join(partial,name+'.csv'),keys.join(',')+'\n'+rows.map(r=>keys.map(k=>csv(r[k])).join(',')).join('\n')+'\n',{flag:'wx'});
 }
 const outcomes=Object.entries(result.outcomes.statsDelta).map(([metric,value])=>({metric,value,window:'verified export prefix'}));
 const resources=Object.entries(result.resources).filter(([,value])=>typeof value==='number').map(([metric,value])=>({metric,value,evidenceClass:result.evidenceClass}));
 for(const [name,rows] of [['outcomes',outcomes],['resources',resources]]){
  const keys=Object.keys(rows[0]??{});await fs.writeFile(path.join(partial,name+'.csv'),keys.join(',')+'\n'+rows.map(r=>keys.map(k=>csv(r[k])).join(',')).join('\n')+'\n',{flag:'wx'});
 }
 await fs.writeFile(path.join(partial,'COMPLETE.json'),JSON.stringify({verified:true,analysisVersion:result.analysisVersion,journalHeadSha256:result.journalHeadSha256,sourceFingerprint:result.sourceFingerprint}),{flag:'wx'});
 await fs.rename(partial,dest);console.log(JSON.stringify({verified:true,output:dest,checkpoints:result.checkpoints,commands:result.commands.commands,evidenceClass:result.evidenceClass,providerCalls:0}));
} catch(error) {
 await handle.close().catch(()=>{});await fs.writeFile(path.join(partial,'FAILED.json'),JSON.stringify({verified:false,error:error.message})).catch(()=>{});throw error;
}
