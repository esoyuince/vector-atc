import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {gitSourceState} from '../scripts/lib/git-state.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
test('study Git provenance requires a clean committed source tree',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-git-state-'));try{git(dir,'init');git(dir,'config','user.email','fixture@example.invalid');git(dir,'config','user.name','Fixture');fs.writeFileSync(path.join(dir,'a.txt'),'one\n');git(dir,'add','a.txt');git(dir,'commit','-m','initial');const clean=gitSourceState(dir);assert.equal(clean.clean,true);assert.match(clean.commit,/^[a-f0-9]{40}$/);assert.match(clean.tree,/^[a-f0-9]{40}$/);
  fs.writeFileSync(path.join(dir,'a.txt'),'two\n');assert.throws(()=>gitSourceState(dir),/clean Git/);const dirty=gitSourceState(dir,{requireClean:false});assert.equal(dirty.commit,clean.commit);assert.equal(dirty.tree,clean.tree);assert.equal(dirty.clean,false);assert.equal(dirty.dirtyEntries,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
