// Explicitly authorized, unreviewed live collection; never a reviewed paper cohort.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {createAirborneSimulation} from '../src/simulation.mjs';import {AIRBORNE_SCOPE} from '../src/traffic-lifecycle.mjs';
import {runtimeVersions,initialStateFingerprint,provenance,parseStudyManifest,STUDY_START_POLICY} from '../server/study-run.mjs';
import {verifyInventory} from './lib/source-inventory.mjs';
const [output,runId,secondsRaw]=process.argv.slice(2),seconds=Number(secondsRaw);
const root=fileURLToPath(new URL('..',import.meta.url));
if(!output||!/^[-a-zA-Z0-9_]{1,60}$/.test(runId??'')||!Number.isSafeInteger(seconds)||seconds<7200)throw Error('Usage: freeze-collection.mjs OUTSIDE_REPO_JSON RUN_ID SIM_SECONDS (>=7200)');
verifyInventory(root,provenance);
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('Commit the exact collection source before freezing');
const target=path.resolve(output),relative=path.relative(root,target);
if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('Collection artifacts must be outside the repository');
for(const name of [target,target+'.initial.json',target+'.sources.json'])if(fs.existsSync(name))throw Error('Refusing to overwrite '+name);
const seed=createHash('sha256').update('vector-collection-seed-v1\0'+runId).digest().readUInt32BE(0);
const sim=createAirborneSimulation(0,seed);
const manifest={schemaVersion:1,status:'frozen-local',executionStartPolicy:STUDY_START_POLICY,
 runId,scope:AIRBORNE_SCOPE,seed,seedScheme:'sha256-collection-run-id-v1',
 sourceCommit:git('rev-parse','HEAD'),sourceTree:git('rev-parse','HEAD^{tree}'),
 sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',
 initialStateSha256:await initialStateFingerprint(sim),evidenceClass:'live-unreviewed-collection',
 stopping:{targetSimulatedSeconds:seconds,maxWallSeconds:null,maxTotalInputTokens:null,tokenBudgetPolicy:'provider-balance-v1',stopForFavorableResults:false},
 storage:{researchJournalMaxBytes:1000000000},preregistered:false,independentRuleReview:false,reviewPacketSha256:null,ruleReviewSha256:null,
 authorization:{budget:'User authorized removal of numeric token ceilings; use remaining provider credits.',newCreditPurchase:false,automaticTopUpChange:false,providerBalanceVerified:false,providerAutoRechargeSettingVerified:false},
 collectionNotes:'Stop at declared simulated exposure, payment refusal, non-retriable provider/contract failure, six exhausted overload/rate retries, or archive failure. AI latency is not simulated exposure. No wall-time token reset replenishes a local allowance; no local input-token ceiling exists. No independent domain approval or completed study is claimed.'};
parseStudyManifest(manifest);
fs.writeFileSync(target+'.initial.json',JSON.stringify(sim),{flag:'wx'});
fs.writeFileSync(target+'.sources.json',JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(target,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runId,seed,sourceFingerprint:provenance.sourceFingerprint,targetSimulatedSeconds:seconds,inputTokenCap:null,wallTimeCap:null,reviewed:false,providerCalls:0}));
