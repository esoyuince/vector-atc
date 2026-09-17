import fs from 'node:fs';import path from 'node:path';import {sha256} from '../server/research-journal.mjs';
const [base,out]=process.argv.slice(2);if(!base||!out)throw Error('Usage: node scripts/export-research.mjs BASE_URL NEW_DIRECTORY');
const root=new URL('/api/research',base);if(!['https:','http:'].includes(root.protocol))throw Error('HTTP(S) URL required');fs.mkdirSync(out,{recursive:false});
async function get(params={}){const u=new URL(root);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);for(let n=0;n<5;n++){const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(r.status===429){await new Promise(r=>setTimeout(r,20000));continue;}if(!r.ok)throw Error('Archive HTTP '+r.status);return r.json();}throw Error('Archive rate-limit retries exhausted');}
const meta=await get();let previous=null;const manifest=[];
for(let i=0;i<meta.nextSequence;i++){const d=await get({entry:i});let text='';for(let c=0;c<d.chunkCount;c++)text+=(await get({entry:i,chunk:c})).text;
 if(await sha256(text)!==d.sha256||d.previousSha256!==previous)throw Error('Journal integrity mismatch at '+i);const value=JSON.parse(text);if(value.sequence!==i||value.previousSha256!==previous)throw Error('Invalid journal sequence');
 fs.writeFileSync(path.join(out,String(i).padStart(8,'0')+'.json'),text,{flag:'wx'});manifest.push(d);previous=d.sha256;
}
if(previous!==meta.headSha256)throw Error('Journal head mismatch');fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({meta,entries:manifest},null,2),{flag:'wx'});console.log('Export verified; no viewer registration or inference was requested.');
