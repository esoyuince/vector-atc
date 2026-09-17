import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplayArchive,REPLAY_PAGE_FRAMES} from '../server/replay-archive.mjs';
import {createSimulation} from '../src/simulation.mjs';
const memory=()=>{
 const records=new Map();return {records,get:async k=>structuredClone(records.get(k)),put:async entries=>{for(const [k,v] of Object.entries(entries))records.set(k,structuredClone(v));}};
};
test('replay appends across days and reloads, preserves legacy footage, and bounds each page',async t=>{
 const storage=memory(),s=createSimulation(),ids=s.flights.map(f=>f.id);
 const legacy={ids,frames:[{at:0,flights:[]},{at:6,flights:[]}]};
 storage.records.set('replay-ltfm-v1',legacy);storage.records.set('airport-ltfm-v1',{budget:{tokens:123},stats:{collisions:9}});
 let day=Date.UTC(2026,8,17);t.mock.method(Date,'now',()=>day);
 let archive=await ReplayArchive.open(storage,ids),firstFull;
 for(let i=2;i<155;i++){
  if(i===60||i===110){day+=86400000;archive=await ReplayArchive.open(storage,ids);}
  s.elapsed=i*6;await archive.capture(s);
  if(i===49)firstFull=JSON.stringify((await archive.read(0)).frames);
 }
 assert.equal(archive.meta.frameCount,155);assert.equal(archive.meta.pageCount,4);
 assert.equal(JSON.stringify((await archive.read(0)).frames),firstFull,'closed pages remain unchanged');
 assert.deepEqual(storage.records.get('replay-ltfm-v1'),legacy);
 assert.deepEqual(storage.records.get('airport-ltfm-v1'),{budget:{tokens:123},stats:{collisions:9}});
 const seen=new Set();let previous;
 for(let page=0;page<archive.meta.pageCount;page++){
  const data=await archive.read(page);assert.ok(data.frames.length<=REPLAY_PAGE_FRAMES);
  assert.ok(Buffer.byteLength(JSON.stringify(data))<1024*1024);
  if(previous)assert.deepEqual(previous,data.frames[0]);
  for(const f of data.frames)seen.add(f.at);
  previous=data.frames.at(-1);
 }
 assert.equal(seen.size,155);assert.equal((await archive.read(0)).archivedSeconds,924);
 assert.equal(await archive.read(-1),null);assert.equal(await archive.read(4),null);
 const before=archive.meta.frameCount;await archive.capture(s);assert.equal(archive.meta.frameCount,before,'duplicate capture is ignored');
});
test('archive page and index remain unchanged on failed write',async()=>{
 const storage=memory(),s=createSimulation();const archive=await ReplayArchive.open(storage,s.flights.map(f=>f.id));
 await archive.capture(s);const before=structuredClone(archive.meta);
 storage.put=async()=>{throw new Error('storage unavailable');};s.elapsed=6;
 await assert.rejects(archive.capture(s));assert.deepEqual(archive.meta,before);assert.equal(archive.tail.length,1);
});
