import test from 'node:test';import assert from 'node:assert/strict';import {ResearchJournal,JOURNAL_KEY,sha256} from '../server/research-journal.mjs';
function storage(){const map=new Map();let fail=false;return {map,setFail:v=>fail=v,get:async k=>structuredClone(map.get(k)),put:async obj=>{if(fail)throw Error('fixture');assert.ok(Object.keys(obj).length<=128);for(const [k,v] of Object.entries(obj))map.set(k,structuredClone(v));}};}
const record={sim:{elapsed:1,revision:2},ai:{mode:'active'}};
test('journal chunks round-trip Unicode, immutable entries and SHA chain across reload',async()=>{
 const s=storage(),j=await ResearchJournal.open(s);await j.commit('state',record,[{kind:'fixture',text:'\u0131\ud83d\ude80'.repeat(30000)}]);await j.commit('state',{...record,sim:{elapsed:2,revision:3}},[]);
 const reloaded=await ResearchJournal.open(s);let prev=null;
 for(let i=0;i<2;i++){const d=await reloaded.read(i);let text='';for(let n=0;n<d.chunkCount;n++)text+=(await reloaded.read(i,n)).text;assert.equal(await sha256(text),d.sha256);assert.equal(d.previousSha256,prev);prev=d.sha256;assert.equal(JSON.parse(text).sequence,i);}
 assert.equal((await reloaded.read()).headSha256,prev);assert.equal(await reloaded.read(99),null);
});
test('failed journal commit cannot advance state, index or acknowledged sequence',async()=>{
 const s=storage(),j=await ResearchJournal.open(s);await j.commit('state',record,[]);const before=structuredClone([...s.map]);s.setFail(true);
 await assert.rejects(j.commit('state',{sim:{elapsed:999,revision:999}},[]));assert.deepEqual([...s.map],before);assert.equal(j.meta.nextSequence,1);assert.equal(j.failed,true);
});
test('capacity stops explicitly without truncating old observations',async()=>{
 const s=storage(),j=await ResearchJournal.open(s,1000);await j.commit('state',record,[]);const before=structuredClone([...s.map]);await assert.rejects(j.commit('state',record,[{text:'x'.repeat(2000)}]),/capacity/);assert.deepEqual([...s.map],before);
});

test('checkpoint covers lifecycle, forecast, audit and episode state, not just flight coordinates',async()=>{
 const base={seed:42,revision:2,elapsed:1,flights:[],stats:{},runways:[],nextDepartureAt:60,requiresDecision:false,openSeparation:[],alerts:[],commandAudit:{checkedCommands:1}};
 for(const change of [{nextDepartureAt:120},{requiresDecision:true},{openSeparation:['A/B']},{alerts:[{a:'A',b:'B'}]},{commandAudit:{checkedCommands:2}},{runways:[{id:'16R',reserved:'A'}]}]){
  const s=storage(),j=await ResearchJournal.open(s);await j.commit('state',{sim:base},[]);await j.commit('state',{sim:{...base,...change}},[]);
  const a=JSON.parse((await j.read(0,0)).text),b=JSON.parse((await j.read(1,0)).text);assert.notEqual(a.stateSha256,b.stateSha256,JSON.stringify(change));
 }
});

test('queued journal writes snapshot their input before callers can mutate it',async()=>{
 const s=storage(),j=await ResearchJournal.open(s),r={sim:{elapsed:0,revision:0,seed:42}},events=[{kind:'fixture',text:'original'}];
 const pending=j.commit('state',r,events);r.sim.elapsed=999;events[0].text='mutated';await pending;
 const text=(await j.read(0,0)).text;assert.equal(JSON.parse(text).simSeconds,0);assert.equal(JSON.parse(text).events[0].text,'original');assert.equal((await s.get('state')).sim.elapsed,0);
});
test('reopening a corrupt journal tail fails before accepting further observations',async()=>{
 const s=storage(),j=await ResearchJournal.open(s);await j.commit('state',record,[]);
 s.map.set(JOURNAL_KEY+':0:0','tampered');await assert.rejects(ResearchJournal.open(s),/integrity/);
});
