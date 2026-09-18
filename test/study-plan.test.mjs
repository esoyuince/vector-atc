import test from 'node:test';import assert from 'node:assert/strict';
import {makeStudyPlan,validateStudyPlan,deriveSeed,objectSha256,SEED_SCHEME} from '../scripts/lib/study-plan.mjs';
const args={planId:'paper-alpha',runCount:8,targetSimulatedSeconds:3600,maxWallSeconds:7200,maxTotalInputTokens:500000,researchJournalMaxBytes:67108864,gitCommit:'a'.repeat(40),gitTree:'b'.repeat(40)};
test('study plan derives deterministic unique seeds without outcome filtering',()=>{
 const a=makeStudyPlan(args),b=makeStudyPlan(args);assert.deepEqual(a,b);assert.equal(a.seedDerivation.scheme,SEED_SCHEME);assert.equal(a.seedDerivation.encoding,'utf8-null-separated-decimal-index-v1');assert.match(a.designCommitmentSha256,/^[a-f0-9]{64}$/);assert.equal(a.seedListSha256,objectSha256(a.runs.map(r=>r.seed)));assert.equal(a.seedDerivation.selectionPolicy,'all-derived-seeds-no-outcome-filtering');assert.equal(new Set(a.runs.map(r=>r.seed)).size,a.runCount);assert.equal(a.maximumPlannedInputTokenAllowance,args.runCount*args.maxTotalInputTokens);assert.equal(a.perRunStorage.researchJournalMaxBytes,args.researchJournalMaxBytes);
 a.runs.forEach((r,i)=>{assert.equal(r.seed,deriveSeed(a.planId,i));assert.equal(r.index,i);assert.deepEqual(r.stopping,a.perRunStopping);});assert.equal(validateStudyPlan(a),a);assert.equal(objectSha256(a),objectSha256(b));
});
test('study plan rejects seed, stop, version and selection-policy drift',()=>{
 const p=makeStudyPlan(args);for(const mutate of [x=>x.runs[0].seed++,x=>x.runs[1].stopping.maxWallSeconds++,x=>x.executionStartPolicy='other',x=>x.seedDerivation.selectionPolicy='pick-low-conflict',x=>x.seedDerivation.encoding='other',x=>x.designCommitmentSha256='0'.repeat(64),x=>x.seedListSha256='0'.repeat(64),x=>x.versions.prompt='other',x=>x.perRunStorage.researchJournalMaxBytes=999,x=>x.gitCommit='bad',x=>x.preregistered=true]){const x=structuredClone(p);mutate(x);assert.throws(()=>validateStudyPlan(x));}
});
test('seed schedule is stable across a larger cohort',()=>{
 const p=makeStudyPlan({...args,runCount:1000});assert.equal(new Set(p.runs.map(r=>r.seed)).size,1000);assert.equal(p.runs[999].seed,deriveSeed(p.planId,999));
});
