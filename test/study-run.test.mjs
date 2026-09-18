import test from 'node:test';import assert from 'node:assert/strict';
import {createAirborneSimulation} from '../src/simulation.mjs';import {AIRBORNE_SCOPE} from '../src/traffic-lifecycle.mjs';
import {parseStudyManifest,initializeStudy,armStudy,studyStopReason,stopStudy,runtimeVersions,initialStateFingerprint,provenance} from '../server/study-run.mjs';
async function fixture(){const sim=createAirborneSimulation(0,42),record={sim,ai:{totalCalls:0},frameRemaining:60};const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'fixture-run',scope:AIRBORNE_SCOPE,seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(sim),stopping:{targetSimulatedSeconds:30,maxWallSeconds:60,maxTotalInputTokens:10000,stopForFavorableResults:false}};return {record,m};}
test('frozen manifests reject source, version, seed, stop or initial-state drift',async()=>{
 const {record,m}=await fixture();assert.deepEqual(parseStudyManifest(m),m);
 for(const change of [{sourceFingerprint:'a'.repeat(64)},{seed:-1},{versions:{...m.versions,prompt:'unknown'}},{stopping:{...m.stopping,maxWallSeconds:0}},{stopping:{...m.stopping,stopForFavorableResults:true}}])assert.throws(()=>parseStudyManifest({...m,...change}));
 await assert.rejects(initializeStudy(record,{...m,initialStateSha256:'b'.repeat(64)},0));await initializeStudy(record,m,0);await assert.rejects(initializeStudy(record,{...m,runId:'another'},1));
});
test('stopping is exposure/wall/budget based, never outcome dependent',async()=>{
 const {record,m}=await fixture();await initializeStudy(record,m,1000);record.sim.stats.collisions=99;assert.equal(record.study.status,'ready');assert.equal(studyStopReason(record,61000),null);assert.equal(armStudy(record,1000),true);assert.equal(record.study.status,'running');assert.equal(armStudy(record,1001),false);assert.equal(studyStopReason(record,1001),null);
 assert.equal(studyStopReason(record,61000),'wall-time');assert.equal(studyStopReason(record,2000,10001),'input-budget');record.sim.elapsed=30;assert.equal(studyStopReason(record,2000),'target-exposure');stopStudy(record,'target-exposure');assert.equal(record.study.status,'completed');assert.equal(record.frameRemaining,0);
});
test('independent review claims require linked packet and review artifact hashes',async()=>{
 const {m}=await fixture(),packet='b'.repeat(64),review='a'.repeat(64);assert.doesNotThrow(()=>parseStudyManifest({...m,independentRuleReview:false,reviewPacketSha256:null,ruleReviewSha256:null}));
 assert.throws(()=>parseStudyManifest({...m,independentRuleReview:true,reviewPacketSha256:null,ruleReviewSha256:review}),/rule review provenance/);
 assert.throws(()=>parseStudyManifest({...m,independentRuleReview:true,reviewPacketSha256:packet,ruleReviewSha256:null}),/rule review provenance/);
 assert.throws(()=>parseStudyManifest({...m,independentRuleReview:false,reviewPacketSha256:packet,ruleReviewSha256:review}),/rule review provenance/);
 assert.doesNotThrow(()=>parseStudyManifest({...m,independentRuleReview:true,reviewPacketSha256:packet,ruleReviewSha256:review}));
});
test('study manifests validate optional cohort provenance without changing single-run compatibility',async()=>{
 const {m}=await fixture(),storage={researchJournalMaxBytes:67108864},studyPlan={planId:'paper-plan',planSha256:'b'.repeat(64),designCommitmentSha256:'e'.repeat(64),seedListSha256:'f'.repeat(64),startPolicy:'explicit-operator-arm-v1',runIndex:0,runCount:3,seedScheme:'sha256-plan-index-v1'};assert.doesNotThrow(()=>parseStudyManifest({...m,executionStartPolicy:'explicit-operator-arm-v1',sourceCommit:'c'.repeat(40),sourceTree:'d'.repeat(40),storage,studyPlan}));
 for(const change of [{planSha256:'x'},{designCommitmentSha256:'bad'},{seedListSha256:'bad'},{startPolicy:'other'},{runIndex:3},{runCount:0},{seedScheme:'other'}])assert.throws(()=>parseStudyManifest({...m,executionStartPolicy:'explicit-operator-arm-v1',sourceCommit:'c'.repeat(40),sourceTree:'d'.repeat(40),storage,studyPlan:{...studyPlan,...change}}),/study plan provenance/);
});
