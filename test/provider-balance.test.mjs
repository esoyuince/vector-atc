import test from 'node:test';import assert from 'node:assert/strict';
import {dailyTokenLimit,reserveBudget,settleBudget,DEFAULT_LIMITS} from '../server/budget.mjs';
import {parseStudyManifest,initializeStudy,armStudy,studyStopReason,runtimeVersions,initialStateFingerprint,provenance} from '../server/study-run.mjs';
import {createAirborneSimulation} from '../src/simulation.mjs';import {AIRBORNE_SCOPE} from '../src/traffic-lifecycle.mjs';
import {callTypeSafe} from '../server/typesafe.mjs';
async function fixture(){const sim=createAirborneSimulation(0,42),record={sim,ai:{totalCalls:0}};
 const m={status:'frozen-local',executionStartPolicy:'explicit-operator-arm-v1',runId:'collection-fixture',scope:AIRBORNE_SCOPE,seed:42,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(sim),evidenceClass:'live-unreviewed-collection',stopping:{targetSimulatedSeconds:7200,maxWallSeconds:null,maxTotalInputTokens:null,tokenBudgetPolicy:'provider-balance-v1',stopForFavorableResults:false},runtime:{simSpeed:1},independentRuleReview:false,preregistered:false};return {record,m};}
test('provider balance is explicit, frozen and never enabled by missing/invalid config',()=>{
 assert.equal(dailyTokenLimit('provider-balance',true),null);
 assert.throws(()=>dailyTokenLimit('provider-balance'),/explicit frozen/);
 assert.throws(()=>dailyTokenLimit('3800000',true),/matching runtime/);
 for(const value of [undefined,'unlimited','',null,-1,'Infinity'])assert.equal(dailyTokenLimit(value),DEFAULT_LIMITS.dailyTokens);
});
test('null token ceiling does not disable hourly throttling or usage accounting',()=>{
 const now=Date.UTC(2026,8,20),limits={...DEFAULT_LIMITS,dailyTokens:null,hourlyRequests:2};
 const first=reserveBudget({},now,5000000,limits);assert.equal(first.tokens,5000000);
 const second=reserveBudget(first,now,5000000,limits);assert.equal(second.tokens,10000000);
 assert.equal(reserveBudget(second,now,1,limits),null);
 assert.equal(settleBudget(second,first,5000000,2000,now).tokens,5002000);
 assert.equal(reserveBudget({},now,0,limits),null);
 assert.equal(reserveBudget({day:'2026-09-20',tokens:Number.MAX_SAFE_INTEGER},now,1,limits),null);
});
test('provider balance keeps exposure stop but has no daily/total/wall ceiling',async()=>{
 const {record,m}=await fixture();assert.deepEqual(parseStudyManifest(m),m);await initializeStudy(record,m,0);armStudy(record,0);
 record.study.accountedInputTokens=1000000000;assert.equal(studyStopReason(record,86400000,1000000),null);
 record.sim.elapsed=7200;assert.equal(studyStopReason(record,86400000),'target-exposure');
});
test('uncapped collection cannot silently become a reviewed or capped study',async()=>{
 const {m}=await fixture();
 for(const change of [{evidenceClass:'live-study'},{independentRuleReview:true},{preregistered:true},{studyPlan:{}},{stopping:{...m.stopping,tokenBudgetPolicy:'unknown'}},{stopping:{...m.stopping,maxTotalInputTokens:100000}},{stopping:{...m.stopping,maxWallSeconds:60}},{stopping:{...m.stopping,targetSimulatedSeconds:0}},{runtime:undefined},{runtime:{simSpeed:0}},{runtime:{simSpeed:21}},{runtime:{simSpeed:1.5}},{runtime:{simSpeed:1,extra:true}}])assert.throws(()=>parseStudyManifest({...m,...change}));
 assert.throws(()=>parseStudyManifest({...m,stopping:{...m.stopping,tokenBudgetPolicy:undefined}}));
});
test('payment-required is terminal typed evidence with no secret body retention',async()=>{
 const request={model:'jev-1.13.0',state:{},questions:{}};
 await assert.rejects(callTypeSafe(request,'never-log-this-secret',{fetchImpl:async()=>new Response('never-log-this-secret',{status:402})}),e=>e.status===402&&e.code==='provider-payment-required'&&!e.message.includes('never-log'));
});
