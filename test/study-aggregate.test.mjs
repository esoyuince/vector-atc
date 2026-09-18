import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import provenance from '../server/build-provenance.mjs';import {deriveSeed} from '../scripts/lib/study-plan.mjs';import {aggregateStudy} from '../scripts/lib/study-aggregate.mjs';
const H='a'.repeat(64),P='b'.repeat(64),D='1'.repeat(64),S='2'.repeat(64),R='c'.repeat(64),Q='d'.repeat(64),C='e'.repeat(40),T='f'.repeat(40),versions={prompt:'p',context:'c',control:'x',measurement:'m',evaluation:'e',traffic:'t'},stopping={targetSimulatedSeconds:60,maxWallSeconds:600,maxTotalInputTokens:100000,stopForFavorableResults:false};
function summary(i,status='completed'){
 const commands=100+i*10,flagged=10+i,hours=2+i,collisions=i,impacts=1;
 const stopReason=status==='completed'?'target-exposure':status==='incomplete'?'wall-time':null,simulatedSeconds=status==='completed'?60:status==='incomplete'?40:30;return {schemaVersion:1,analysisVersion:'verified-replay-descriptive-v3',sourceFingerprint:H,runId:'plan-r00'+(i+1),evidenceClass:'live-study',recordedAt:{first:1000+i*1000,last:1500+i*1000,wallDurationMs:500},prefixStatus:status,stopReason,studyManifest:{seed:deriveSeed('plan',i),executionStartPolicy:'explicit-operator-arm-v1',sourceCommit:C,sourceTree:T,scope:'airborne-handoff-v1',stopping,storage:{researchJournalMaxBytes:67108864},requestedModel:'jev-1.13.0',versions,independentRuleReview:true,reviewPacketSha256:Q,ruleReviewSha256:R,studyPlan:{planId:'plan',planSha256:P,designCommitmentSha256:D,seedListSha256:S,startPolicy:'explicit-operator-arm-v1',runIndex:i,runCount:3,seedScheme:'sha256-plan-index-v1'}},commands:{commands,flagged,findings:flagged,physicalLimits:0,published:flagged,demo:0,integration:0,anyFinding:{value:flagged/commands}},outcomes:{simulatedSeconds,airborneAircraftHours:hours,statsDelta:{aircraftHours:hours,collisions,groundImpacts:impacts},combinedEventsPer100AircraftHours:{value:100*(collisions+impacts)/hours}},resources:{knownInputTokens:1000+i,knownOutputTokens:10,failedBatches:i===1?1:0,unknownUsageBatches:i===1?1:0},byRule:[{id:'rule-a',basis:'published',flagged:1+i,eligible:20+i,fraction:{value:(1+i)/(20+i)}},{id:'rule-b',basis:'demo-rule',flagged:0,eligible:5,fraction:{value:0}}]};
}
test('study aggregation keeps run rows and computes descriptive pooled denominators',()=>{
 const out=aggregateStudy([summary(2),summary(0),summary(1,'incomplete')]);assert.equal(out.runCount,3);assert.deepEqual(out.runs.map(r=>r.runIndex),[0,1,2]);assert.deepEqual(out.status,{completed:2,incomplete:1,open:0,allRunsPresent:true});
 assert.deepEqual(out.commands.fractions.anyFinding,{numerator:33,denominator:330,value:.1,status:'descriptive'});assert.equal(out.outcomes.airborneAircraftHours,9);assert.equal(out.outcomes.collisionGroups,3);assert.equal(out.outcomes.groundImpacts,3);assert.equal(out.resources.unknownUsageBatches,1);assert.equal(out.inference,'none; descriptive run-level and pooled denominators only');
 const rule=out.byRule.find(r=>r.id==='rule-a');assert.equal(rule.flagged,6);assert.equal(rule.eligible,63);assert.equal(rule.runFractionDistribution.count,3);
});
test('study aggregation fails closed on missing, duplicate, mixed-source or detector-drift runs',()=>{
 assert.throws(()=>aggregateStudy([summary(0),summary(1)]),/Missing study run analyses/);
 const dup=[summary(0),summary(1),summary(1)];assert.throws(()=>aggregateStudy(dup),/Duplicate run/);
 const mixed=[summary(0),summary(1),summary(2)];mixed[2].sourceFingerprint='d'.repeat(64);assert.throws(()=>aggregateStudy(mixed));
 const drift=[summary(0),summary(1),summary(2)];drift[2].byRule.pop();assert.throws(()=>aggregateStudy(drift),/Detector set drift/);
});
test('open runs remain visible instead of being silently treated as completed',()=>{
 const runs=[summary(0),summary(1,'incomplete'),summary(2,'open-or-unfrozen-prefix')],out=aggregateStudy(runs);assert.deepEqual(out.status,{completed:1,incomplete:1,open:1,allRunsPresent:true});assert.equal(out.runs[2].prefixStatus,'open-or-unfrozen-prefix');
});
test('aggregate CLI writes a complete cohort once and rejects synthetic evidence',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-aggregate-'));try{const dirs=[];for(let i=0;i<3;i++){const dir=path.join(root,'r'+i);fs.mkdirSync(dir);const s=summary(i);s.sourceFingerprint=provenance.sourceFingerprint;fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(s));dirs.push(dir);}const out=path.join(root,'out'),repo=fileURLToPath(new URL('..',import.meta.url));
  const run=()=>spawnSync(process.execPath,['--import','./scripts/offline-guard.mjs','scripts/aggregate-study.mjs',out,...dirs],{cwd:repo,encoding:'utf8',timeout:10000});const first=run();assert.equal(first.status,0,first.stderr);assert.ok(fs.existsSync(path.join(out,'COMPLETE.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(out,'summary.json'))).runCount,3);assert.notEqual(run().status,0);
  fs.rmSync(out,{recursive:true,force:true});const bad=JSON.parse(fs.readFileSync(path.join(dirs[2],'summary.json')));bad.evidenceClass='synthetic-offline';fs.writeFileSync(path.join(dirs[2],'summary.json'),JSON.stringify(bad));const rejected=run();assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/live-study/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('study aggregation rejects observed run starts that violate frozen index order',()=>{
 const runs=[summary(0),summary(1),summary(2)];runs[1].recordedAt.first=500;runs[1].recordedAt.last=900;runs[1].recordedAt.wallDurationMs=400;assert.throws(()=>aggregateStudy(runs),/overlap or differ/);
});
test('cohort censoring status must agree with stop reason and simulated exposure',()=>{
 const completed=[summary(0),summary(1),summary(2)];completed[0].outcomes.simulatedSeconds=59;assert.throws(()=>aggregateStudy(completed),/exposure mismatch/);
 const incomplete=[summary(0),summary(1,'incomplete'),summary(2)];incomplete[1].stopReason='target-exposure';assert.throws(()=>aggregateStudy(incomplete),/Incomplete run/);
 const open=[summary(0),summary(1),summary(2,'open-or-unfrozen-prefix')];open[2].stopReason='wall-time';assert.throws(()=>aggregateStudy(open),/Open prefix/);
});
