import '../offline-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {createAirborneSimulation} from '../../src/simulation.mjs';
registerHooks({resolve(s,c,next){return s==='cloudflare:workers'?{url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true}:next(s,c);}});
const {AirportSimulation}=await import('../../server/worker.mjs');
export async function offlineHarness(directory,{seed=42,journalMaxBytes=256*1024*1024}={}) {
 fs.mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(path.join(directory,'storage.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const select=db.prepare('SELECT value FROM kv WHERE key=?'),put=db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 const originalNow=Date.now,originalFetch=globalThis.fetch;let now=Date.UTC(2026,8,18,12),ready,controller;
 const metrics={syntheticProviderCalls:0,networkProviderCalls:0,reloads:0,maxValueBytes:0,storageWrites:0};
 Date.now=()=>now;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://api.typesafe.ai/v1/systemone','Unexpected URL in offline fixture');
  metrics.syntheticProviderCalls++;const r=JSON.parse(options.body);
  const answers=Object.fromEntries(Object.entries(r.questions).map(([id,q])=>{
   const flight=r.state.aircraft[id.split('_')[0]],keys=Object.keys(q.criteria);let choice;
   if(id.startsWith('runway_'))choice='wait';
   else if(id.endsWith('_route'))choice=keys.includes(flight.command?.route)?flight.command.route:keys[0];
   else if(id.endsWith('_altitude'))choice=flight.mission==='arrival'&&Number(flight.id.slice(-3))%3===0?'0':'18000';
   else if(id.endsWith('_speed'))choice=flight.mission==='arrival'?'220':'280';
   else choice='2500';
   assert.ok(keys.includes(choice));return [id,{type:'choice',choice,confidence:.8,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))}];
  }));
  return Response.json({model:'jev-1.13.0',answers,usage:{input_tokens:1000,output_tokens:100}});
 };
 const storage={
  get:async key=>{const row=select.get(key);return row?JSON.parse(row.value):undefined;},
  put:async(key,value)=>{
   const entries=Object.entries(typeof key==='string'?{[key]:value}:key);assert.ok(entries.length<=128,'Bulk key limit');
   const values=entries.map(([k,v])=>{const json=JSON.stringify(v),bytes=Buffer.byteLength(json);metrics.maxValueBytes=Math.max(metrics.maxValueBytes,bytes);assert.ok(bytes<1000000,'Local fixture storage-value ceiling exceeded');return [k,json];});
   db.exec('BEGIN IMMEDIATE');try{for(const args of values)put.run(...args);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}metrics.storageWrites+=values.length;
  },
  getAlarm:async()=>{const row=select.get('@alarm');return row?JSON.parse(row.value):null;},
  setAlarm:async value=>put.run('@alarm',JSON.stringify(value)),deleteAlarm:async()=>db.prepare('DELETE FROM kv WHERE key=?').run('@alarm')
 };
 if(!await storage.get('airport-ltfm-v1'))await storage.put('airport-ltfm-v1',{sim:createAirborneSimulation(now,seed),budget:{},ai:{mode:'idle',nextAt:0,failures:0,totalFailures:0,totalCalls:0,frames:0,totalLatencyMs:0,last:null},paused:true,frameRemaining:0,nextTick:0,startedAt:now});
 const env={TYPESAFE_API_KEY:'offline-fixture-only',AI_ENABLED:'true',SIM_SCOPE:'airborne-only',AI_DAILY_TOKEN_LIMIT:'3800000',AI_HOURLY_REQUEST_LIMIT:'720',RESEARCH_JOURNAL_MAX_BYTES:String(journalMaxBytes)};
 async function load(){const ctx={storage,blockConcurrencyWhile:fn=>(ready=fn())};controller=new AirportSimulation(ctx,env);await ready;return controller;}
 try {await load();}catch(e){Date.now=originalNow;globalThis.fetch=originalFetch;db.close();throw e;}
 return {get controller(){return controller;},metrics,storage,env,advance:ms=>{now+=ms;},now:()=>now,
  reload:async()=>{metrics.reloads++;return load();},
  close:()=>{Date.now=originalNow;globalThis.fetch=originalFetch;db.close();}
 };
}
export async function exportLocalJournal(controller,directory) {
 fs.mkdirSync(directory,{recursive:false});const meta=await controller.researchData(),entries=[];
 for(let i=0;i<meta.nextSequence;i++) {
  const d=await controller.researchData(i);let text='';for(let j=0;j<d.chunkCount;j++)text+=(await controller.researchData(i,j)).text;
  fs.writeFileSync(path.join(directory,String(i).padStart(8,'0')+'.json'),text,{flag:'wx'});entries.push(d);
 }
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({meta,entries},null,2),{flag:'wx'});
}
