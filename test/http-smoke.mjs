// Run against local or deployed Worker. Secret values are never printed.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.argv[2]||'http://127.0.0.1:5173';
const secretFile=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const key=secretFile.match(/^TYPESAFE_API_KEY=(.+)$/m)?.[1]?.trim();
assert.ok(key&&key.length>10,'local key available for comparison');
const seen=[];
async function get(path,status=200,method='GET'){
 const r=await fetch(base+path,{method,redirect:'manual'}),body=Buffer.from(await r.arrayBuffer());
 assert.equal(r.status,status,path);assert.equal(body.includes(Buffer.from(key)),false,'credential leak check');
 assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 assert.ok(r.headers.get('content-security-policy')?.includes("connect-src 'self'"));
 seen.push([path,status]);return {r,body};
}
const root=await get('/');assert.ok(root.body.toString().includes('VECTOR'));
const state=await get('/api/state');assert.equal(state.r.headers.get('cache-control'),'no-store');
const data=JSON.parse(state.body);assert.equal(data.flights.length,100);assert.equal(new Set(data.flights.map(f=>f.id)).size,100);
for(const path of ['/.env','/.dev.vars','/server/worker.mjs','/src/App.jsx','/wrangler.jsonc','/assets/index.js.map'])await get(path,404);
await get('/api/state',405,'POST');
const report=await get('/api/report');assert.equal(JSON.parse(report.body).aircraft,100);
const replay=await get('/api/replay');assert.ok(Array.isArray(JSON.parse(replay.body).frames));
assert.equal(JSON.parse(replay.body).version,2);
await get('/api/replay?page=-1',400);await get('/api/replay?page=invalid',400);await get('/api/replay?page=999999999',404);
const assets=await readdir(new URL('../dist/assets/',import.meta.url));
for(const file of assets){const local=await readFile(new URL('../dist/assets/'+file,import.meta.url));assert.equal(local.includes(Buffer.from(key)),false);const remote=await get('/assets/'+file);assert.equal(createHash('sha256').update(remote.body).digest('hex'),createHash('sha256').update(local).digest('hex'),file);}
console.log(JSON.stringify({base,checks:seen.length,assetHashesMatched:assets.length,credentialAbsent:true,flights:data.flights.length,elapsed:data.elapsed,stats:data.stats,ai:{mode:data.ai.mode,calls:data.ai.totalCalls,tokens:data.ai.budget.tokens,lastAt:data.ai.last?.at}},null,2));
