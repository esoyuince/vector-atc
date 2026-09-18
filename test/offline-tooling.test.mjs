import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceInventory,verifyInventory} from '../scripts/lib/source-inventory.mjs';
import {runtimeVersions} from '../server/study-run.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-tooling-test-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('provenance includes added files, CI and deployment-neutral config, never private config',()=>{
 const dir=path.join(root,'inventory');fs.mkdirSync(path.join(dir,'src'),{recursive:true});fs.mkdirSync(path.join(dir,'.github','workflows'),{recursive:true});
 fs.writeFileSync(path.join(dir,'src','one.mjs'),'export const x=1;');fs.writeFileSync(path.join(dir,'.github','workflows','ci.yml'),'name: test');fs.writeFileSync(path.join(dir,'wrangler.jsonc'),'private');fs.writeFileSync(path.join(dir,'wrangler.example.jsonc'),'{}');
 const p=sourceInventory(dir);assert.equal(Object.keys(p.files).length,3);assert.equal(p.files['wrangler.jsonc'],undefined);verifyInventory(dir,p);
 fs.writeFileSync(path.join(dir,'src','new.mjs'),'export const y=2;');assert.throws(()=>verifyInventory(dir,p),/inventory/);
});
test('draft manifest version fields match runtime including the traffic policy',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../docs/run-manifest.example.json',import.meta.url)));
 assert.deepEqual(m.versions,runtimeVersions());assert.equal(m.status,'draft-unfrozen');assert.equal(m.preregistered,false);
});
test('offline guard blocks external fetch and TCP before network dispatch',()=>{
 const script="import net from 'node:net';import assert from 'node:assert/strict';await assert.rejects(fetch('https://api.typesafe.ai/v1/systemone'),/OFFLINE_GUARD/);assert.throws(()=>net.connect({host:'api.typesafe.ai',port:443}),/OFFLINE_GUARD/);console.log('blocked');";
 const result=spawnSync(process.execPath,['--import','./scripts/offline-guard.mjs','--input-type=module','-e',script],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/blocked/);
});
test('CI has immutable action pins, read-only permissions, guarded tests and no deploy or secrets',()=>{
 const text=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(text,/contents: read/);assert.match(text,/persist-credentials: false/);assert.match(text,/test:offline/);assert.match(text,/test:coverage:offline/);assert.match(text,/sweep:offline/);assert.match(text,/make:study-plan/);assert.match(text,/make:rule-review-packet/);assert.match(text,/windows-latest/);assert.match(text,/ubuntu-latest/);
 for(const line of text.split('\n').filter(l=>l.includes('uses:')))assert.match(line,/@[a-f0-9]{40}\s/);
 assert.doesNotMatch(text,/secrets\.|pull_request_target|npm run deploy|wrangler deploy(?!.*dry-run)/);
});
test('provenance canonicalizes text line endings across Windows and Linux checkouts',()=>{
 const lf=path.join(root,'lf'),crlf=path.join(root,'crlf');
 for(const dir of [lf,crlf])fs.mkdirSync(path.join(dir,'src'),{recursive:true});
 fs.writeFileSync(path.join(lf,'src','same.mjs'),'export const value=1;\nexport const next=2;\n');
 fs.writeFileSync(path.join(crlf,'src','same.mjs'),'export const value=1;\r\nexport const next=2;\r\n');
 const a=sourceInventory(lf),b=sourceInventory(crlf);
 assert.equal(a.schemaVersion,2);assert.deepEqual(a,b);
});
test('study preflight fails closed until frozen manifest and independent review are supplied',()=>{
 const result=spawnSync(process.execPath,['--import','./scripts/offline-guard.mjs','scripts/study-preflight.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:10000});
 assert.equal(result.status,2,result.stderr);const report=JSON.parse(result.stdout);assert.ok(report.blockers.includes('frozen-run-manifest'));assert.ok(report.blockers.includes('independent-rule-review'));assert.deepEqual(report.externalPending,['real-provider-acceptance','production-acceptance']);
});
