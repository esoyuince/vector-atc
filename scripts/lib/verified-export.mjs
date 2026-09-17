import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha256} from '../../server/research-journal.mjs';
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
async function readFile(file,limit) {
 const stat=await fs.lstat(file);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit,'Not a bounded regular file: '+file);
 return fs.readFile(file,'utf8');
}
export async function readExportManifest(directory) {
 const m=JSON.parse(await readFile(path.join(directory,'manifest.json'),32*1024*1024));
 assert.ok(m.meta&&Array.isArray(m.entries),'Export manifest required');
 assert.ok(Number.isSafeInteger(m.meta.nextSequence)&&m.meta.nextSequence>=0&&m.meta.nextSequence<=1000000,'Invalid sequence count');
 assert.equal(m.entries.length,m.meta.nextSequence,'Incomplete descriptor list');
 assert.equal(m.meta.tailUncertain,false,'Uncertain archive tail is not a verified complete prefix');
 assert.ok(Number.isSafeInteger(m.meta.totalBytes)&&m.meta.totalBytes>=0,'Invalid content size');
 return m;
}
export async function* verifiedEntries(directory,manifest) {
 let previous=null,totalBytes=0;
 for(let i=0;i<manifest.entries.length;i++) {
  const d=manifest.entries[i];
  assert.equal(d.sequence,i,'Descriptor sequence mismatch');assert.equal(d.previousSha256,previous,'Descriptor chain mismatch');
  assert.ok(digest(d.sha256)&&Number.isSafeInteger(d.bytes)&&d.bytes>0&&d.bytes<=8*1024*1024,'Invalid descriptor');
  const text=await readFile(path.join(directory,String(i).padStart(8,'0')+'.json'),8*1024*1024);
  assert.equal(Buffer.byteLength(text),d.bytes,'Entry byte count mismatch');assert.equal(await sha256(text),d.sha256,'Entry hash mismatch');
  const e=JSON.parse(text);assert.equal(e.version,1,'Unknown journal schema');assert.equal(e.sequence,i,'Entry sequence mismatch');assert.equal(e.previousSha256,previous,'Entry chain mismatch');
  assert.ok(Array.isArray(e.events)&&Number.isFinite(e.simSeconds)&&e.simSeconds>=0&&digest(e.stateSha256),'Invalid entry content');
  totalBytes+=d.bytes;previous=d.sha256;yield e;
 }
 assert.equal(previous,manifest.meta.headSha256,'Head hash mismatch');assert.equal(totalBytes,manifest.meta.totalBytes,'Export content size mismatch');
}
