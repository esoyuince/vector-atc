import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {offlineHarness,exportLocalJournal} from '../scripts/lib/offline-harness.mjs';
import {analyzeResearch,applicableRules,ratio} from '../scripts/lib/research-analysis.mjs';
import {readExportManifest,verifiedEntries} from '../scripts/lib/verified-export.mjs';
import {sha256} from '../server/research-journal.mjs';
import {createSimulation} from '../src/simulation.mjs';
import {navigation} from '../src/airport.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-analysis-test-'));let base,expected;
test.before(async()=>{
 const h=await offlineHarness(path.join(root,'storage'));try{
  await h.controller.persist(h.controller.record,[{kind:'evidence-class',value:'synthetic-offline'}]);
  await h.controller.heartbeat('analysis-fixture',1,true);await h.controller.alarm();h.advance(2000);await h.controller.alarm();
  base=path.join(root,'export');await exportLocalJournal(h.controller,base);expected=h.controller.record.sim.commandAudit.checkedCommands;
 }finally{h.close();}
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
let next=0;function copy(){const d=path.join(root,'copy-'+next++);fs.cpSync(base,d,{recursive:true});return d;}
async function rehash(directory,change){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));let previous=null,total=0;
 for(let i=0;i<manifest.entries.length;i++){
  const file=path.join(directory,String(i).padStart(8,'0')+'.json'),entry=JSON.parse(fs.readFileSync(file));change(entry);entry.previousSha256=previous;
  const text=JSON.stringify(entry),digest=await sha256(text),bytes=Buffer.byteLength(text);fs.writeFileSync(file,text);
  Object.assign(manifest.entries[i],{sha256:digest,previousSha256:previous,bytes});total+=bytes;previous=digest;
 }
 manifest.meta.headSha256=previous;manifest.meta.totalBytes=total;fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
}
test('verified replay reconstructs aggregate commands, exact denominators and synthetic usage',async()=>{
 const result=await analyzeResearch(base);assert.equal(result.commands.commands,expected);assert.equal(result.evidenceClass,'synthetic-offline');assert.equal(result.byScope.ground,undefined);
 assert.equal(result.resources.unknownUsageBatches,0);assert.ok(result.resources.knownInputTokens>0);assert.equal(result.prefixStatus,'open-or-unfrozen-prefix');
 assert.ok(result.byRule.every(r=>r.flagged<=r.eligible));assert.ok(result.checkpoints>3);assert.equal(result.outcomes.simulatedSeconds,2);
});
test('same verified export produces byte-for-byte identical analysis objects',async()=>{
 assert.equal(JSON.stringify(await analyzeResearch(base)),JSON.stringify(await analyzeResearch(base)));
});
test('damaged content, missing entry and uncertain tail are not accepted',async()=>{
 let dir=copy();fs.appendFileSync(path.join(dir,'00000000.json'),' ');await assert.rejects(analyzeResearch(dir),/byte count/);
 dir=copy();fs.unlinkSync(path.join(dir,'00000000.json'));await assert.rejects(analyzeResearch(dir),/ENOENT/);
 dir=copy();const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));m.meta.tailUncertain=true;fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(m));await assert.rejects(analyzeResearch(dir),/Uncertain/);
});
test('a self-consistent rehash cannot hide wrong state checkpoints',async()=>{
 const dir=copy();await rehash(dir,e=>{if(e.sequence===0)e.stateSha256='a'.repeat(64);});await assert.rejects(analyzeResearch(dir),/checkpoint mismatch/);
});
test('mixed source fingerprints cannot silently become one paper population',async()=>{
 const dir=copy();await rehash(dir,e=>{for(const event of e.events)if(event.kind==='configuration')event.sourceProvenance.sourceFingerprint='a'.repeat(64);});await assert.rejects(analyzeResearch(dir),/Mixed source/);
});
test('duplicate command observations are rejected even when the archive hashes are rebuilt',async()=>{
 const dir=copy();let changed=false;await rehash(dir,e=>{for(const event of e.events)if(!changed&&event.kind==='application'){event.events.push(structuredClone(event.events.find(c=>c.kind==='command-applied')));changed=true;}});assert.ok(changed);await assert.rejects(analyzeResearch(dir),/Missing command observations/);
});
test('rule applicability includes satisfied rules and excludes unrelated operations',()=>{
 const f=createSimulation(0,42).flights[50];f.altitude=6000;f.command={route:'HOLD_ULQAL',altitude:6000,speed:195,rate:1000,navigation:navigation(f,'HOLD_ULQAL',195)};
 assert.deepEqual(applicableRules(f).sort(),['holding-minimum-altitude','holding-speed-limit','low-altitude-speed-limit'].sort());
 f.command={route:'VECTOR_N',altitude:18000,speed:280,rate:1000,navigation:navigation({...f,command:null},'VECTOR_N',280)};f.altitude=18000;assert.deepEqual(applicableRules(f),[]);assert.equal(ratio(0,0).value,null);
});
test('verified reader also catches head and total-size mismatches',async()=>{
 const dir=copy(),m=await readExportManifest(dir);m.meta.headSha256='a'.repeat(64);
 await assert.rejects(async()=>{for await(const e of verifiedEntries(dir,m))void e;},/Head hash/);
});
