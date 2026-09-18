import {createHash} from 'node:crypto';
import provenance from '../../server/build-provenance.mjs';
import {runtimeVersions,STUDY_START_POLICY} from '../../server/study-run.mjs';
import {AIRBORNE_SCOPE} from '../../src/traffic-lifecycle.mjs';
export const STUDY_PLAN_SCHEMA=1,SEED_SCHEME='sha256-plan-index-v1',START_POLICY=STUDY_START_POLICY;
const id=/^[-a-zA-Z0-9_]{1,40}$/;
export const objectSha256=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function deriveSeed(planId,index){
 if(!id.test(planId)||!Number.isSafeInteger(index)||index<0)throw Error('Invalid seed derivation input');
 const d=createHash('sha256').update('vector-atc-seed-v1\0'+planId+'\0'+index).digest();return d.readUInt32BE(0);
}
export function makeStudyPlan({planId,runCount,targetSimulatedSeconds,maxWallSeconds,maxTotalInputTokens,researchJournalMaxBytes,gitCommit,gitTree}){
 for(const [k,v] of Object.entries({runCount,targetSimulatedSeconds,maxWallSeconds,maxTotalInputTokens,researchJournalMaxBytes}))if(!Number.isSafeInteger(v)||v<=0)throw Error('Invalid '+k);
 if(!id.test(planId)||runCount>10000)throw Error('Invalid planId/runCount');
 if(researchJournalMaxBytes<1000000||researchJournalMaxBytes>1000000000)throw Error('Invalid researchJournalMaxBytes');
 if(!/^[a-f0-9]{40}$/.test(gitCommit??'')||!/^[a-f0-9]{40}$/.test(gitTree??''))throw Error('Invalid Git source identity');
 const stopping={targetSimulatedSeconds,maxWallSeconds,maxTotalInputTokens,stopForFavorableResults:false},perRunStorage={researchJournalMaxBytes},versions=runtimeVersions(),requestedModel='jev-1.13.0';
 const designCommitmentSha256=objectSha256({schemaVersion:STUDY_PLAN_SCHEMA,planId,scope:AIRBORNE_SCOPE,executionStartPolicy:START_POLICY,sourceFingerprint:provenance.sourceFingerprint,gitCommit,gitTree,versions,requestedModel,runCount,perRunStopping:stopping,perRunStorage}),seeds=[];
 for(let i=0;i<runCount;i++)seeds.push(deriveSeed(planId,i));if(new Set(seeds).size!==seeds.length)throw Error('Derived seed collision; do not substitute another seed');
 const seedListSha256=objectSha256(seeds),width=Math.max(3,String(runCount).length),runs=seeds.map((seed,index)=>({index,runId:planId+'-r'+String(index+1).padStart(width,'0'),seed,stopping:{...stopping}}));
 const maximumPlannedInputTokenAllowance=runCount*maxTotalInputTokens;if(!Number.isSafeInteger(maximumPlannedInputTokenAllowance))throw Error('Planned input-token allowance exceeds safe integer range');
 return {schemaVersion:STUDY_PLAN_SCHEMA,status:'frozen-local-plan',planId,scope:AIRBORNE_SCOPE,executionStartPolicy:START_POLICY,sourceFingerprint:provenance.sourceFingerprint,gitCommit,gitTree,versions,requestedModel,designCommitmentSha256,seedListSha256,seedDerivation:{scheme:SEED_SCHEME,encoding:'utf8-null-separated-decimal-index-v1',selectionPolicy:'all-derived-seeds-no-outcome-filtering',runOrder:'index-order'},runCount,perRunStopping:stopping,perRunStorage,maximumPlannedInputTokenAllowance,runs,preregistered:false};
}
export function validateStudyPlan(plan){
 if(plan?.schemaVersion!==STUDY_PLAN_SCHEMA||plan.status!=='frozen-local-plan'||!id.test(plan.planId)||plan.scope!==AIRBORNE_SCOPE)throw Error('Invalid study plan identity/scope');
 if(plan.sourceFingerprint!==provenance.sourceFingerprint||!/^[a-f0-9]{40}$/.test(plan.gitCommit??'')||!/^[a-f0-9]{40}$/.test(plan.gitTree??'')||JSON.stringify(plan.versions)!==JSON.stringify(runtimeVersions())||plan.requestedModel!=='jev-1.13.0')throw Error('Study plan source/model/version drift');
 if(plan.executionStartPolicy!==START_POLICY)throw Error('Invalid study start policy');const expectedDesignCommitment=objectSha256({schemaVersion:STUDY_PLAN_SCHEMA,planId:plan.planId,scope:plan.scope,executionStartPolicy:plan.executionStartPolicy,sourceFingerprint:plan.sourceFingerprint,gitCommit:plan.gitCommit,gitTree:plan.gitTree,versions:plan.versions,requestedModel:plan.requestedModel,runCount:plan.runCount,perRunStopping:plan.perRunStopping,perRunStorage:plan.perRunStorage});
 if(plan.designCommitmentSha256!==expectedDesignCommitment||!/^[a-f0-9]{64}$/.test(plan.designCommitmentSha256??''))throw Error('Study design commitment mismatch');
 if(plan.seedDerivation?.scheme!==SEED_SCHEME||plan.seedDerivation?.encoding!=='utf8-null-separated-decimal-index-v1'||plan.seedDerivation?.selectionPolicy!=='all-derived-seeds-no-outcome-filtering'||plan.seedDerivation?.runOrder!=='index-order')throw Error('Invalid seed policy');
 if(!Number.isSafeInteger(plan.runCount)||plan.runCount<1||plan.runCount>10000||!Array.isArray(plan.runs)||plan.runs.length!==plan.runCount)throw Error('Invalid run count');
 const ids=new Set(),seeds=new Set();
 for(let i=0;i<plan.runs.length;i++){
  const run=plan.runs[i];if(run.index!==i||run.seed!==deriveSeed(plan.planId,i)||typeof run.runId!=='string'||ids.has(run.runId)||seeds.has(run.seed))throw Error('Run identity/seed drift at '+i);
  ids.add(run.runId);seeds.add(run.seed);if(JSON.stringify(run.stopping)!==JSON.stringify(plan.perRunStopping))throw Error('Per-run stopping drift at '+i);
 }
 if(plan.seedListSha256!==objectSha256(plan.runs.map(r=>r.seed))||!/^[a-f0-9]{64}$/.test(plan.seedListSha256??''))throw Error('Seed-list commitment mismatch');
 const stop=plan.perRunStopping;for(const k of ['targetSimulatedSeconds','maxWallSeconds','maxTotalInputTokens'])if(!Number.isSafeInteger(stop?.[k])||stop[k]<=0)throw Error('Invalid plan stopping '+k);
 if(stop.stopForFavorableResults!==false)throw Error('Outcome-dependent stop forbidden');
 const journalBytes=plan.perRunStorage?.researchJournalMaxBytes;if(!Number.isSafeInteger(journalBytes)||journalBytes<1000000||journalBytes>1000000000)throw Error('Invalid plan journal capacity');
 if(plan.maximumPlannedInputTokenAllowance!==plan.runCount*stop.maxTotalInputTokens||!Number.isSafeInteger(plan.maximumPlannedInputTokenAllowance))throw Error('Planned input-token allowance mismatch');
 if(plan.preregistered!==false)throw Error('Local plan cannot claim preregistration');return plan;
}
