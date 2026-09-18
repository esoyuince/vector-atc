import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import data from '../src/ltfm-data.json' with {type:'json'};
const listed=JSON.parse(fs.readFileSync(new URL('../docs/data-sources.json',import.meta.url)));
const hex=/^[a-f0-9]{64}$/;
function sourceIds(value,out=new Set()){
 if(Array.isArray(value))for(const item of value)sourceIds(item,out);
 else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(key==='source'&&typeof item==='string')out.add(item);sourceIds(item,out);}
 return out;
}
test('frozen LTFM subset source hashes match the public provenance inventory',()=>{
 const byUrl=new Map(listed.map(s=>[s.url,s]));assert.equal(byUrl.size,listed.length);
 const ids=new Set();for(const source of data.sources){assert.ok(!ids.has(source.id));ids.add(source.id);assert.match(source.sha256,hex);assert.match(source.date,/^20\d\d-\d\d-\d\d$/);
  const record=byUrl.get(source.url);assert.ok(record,'missing '+source.url);assert.equal(record.sha256,source.sha256);assert.match(record.sha256,hex);assert.ok(record.bytes>0);assert.ok(source.date<=data.retrieved);}
 for(const id of sourceIds(data))assert.ok(ids.has(id),'unknown source id '+id);
});
test('provenance inventory has unique immutable identifiers',()=>{
 assert.equal(new Set(listed.map(s=>s.sha256)).size,listed.length);assert.ok(listed.every(s=>hex.test(s.sha256)&&Number.isSafeInteger(s.bytes)&&s.bytes>0));
 assert.equal(data.id,'LTFM-SOUTH-v1');assert.match(data.retrieved,/^20\d\d-\d\d-\d\d$/);
});
test('committed DHMI download receipt proves exact byte/hash availability without claiming content adjudication',()=>{
 const receipt=JSON.parse(fs.readFileSync(new URL('../docs/source-verification-receipt.json',import.meta.url))),byName=new Map(listed.map(s=>[s.name,s]));assert.equal(receipt.allMatch,true);assert.equal(receipt.contentAdjudication,false);assert.equal(receipt.providerCalls,0);assert.ok(Number.isFinite(Date.parse(receipt.verifiedAt)));assert.equal(receipt.results.length,listed.length);
 for(const row of receipt.results){const source=byName.get(row.name);assert.ok(source);assert.equal(row.url,source.url);assert.equal(row.expectedBytes,source.bytes);assert.equal(row.actualBytes,source.bytes);assert.equal(row.expectedSha256,source.sha256);assert.equal(row.actualSha256,source.sha256);assert.equal(row.bytesMatch,true);assert.equal(row.sha256Match,true);}
});
