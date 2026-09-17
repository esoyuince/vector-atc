import {verifyInventory} from './lib/source-inventory.mjs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import fs from 'node:fs';import {createAirborneSimulation} from '../src/simulation.mjs';import {runtimeVersions,initialStateFingerprint,provenance,parseStudyManifest} from '../server/study-run.mjs';import {AIRBORNE_SCOPE} from '../src/traffic-lifecycle.mjs';
// Run write-provenance first. Output is exclusive; an existing protocol cannot be overwritten.
const [out,runId,seedRaw,simRaw,wallRaw,tokensRaw]=process.argv.slice(2);if(!out||!runId||!tokensRaw)throw Error('Usage: node scripts/freeze-run.mjs OUTPUT RUN_ID SEED SIM_SECONDS WALL_SECONDS INPUT_TOKEN_CAP');
const root=fileURLToPath(new URL('..',import.meta.url));
verifyInventory(root,provenance);
const relative=path.relative(root,path.resolve(out));if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('Frozen output must be outside the source repository.');
for(const name of [out,out+'.initial.json',out+'.sources.json'])if(fs.existsSync(name))throw Error('Refusing to overwrite frozen artifact: '+name);
const seed=Number(seedRaw),sim=createAirborneSimulation(0,seed);
const m={schemaVersion:1,status:'frozen-local',runId,scope:AIRBORNE_SCOPE,seed,sourceFingerprint:provenance.sourceFingerprint,versions:runtimeVersions(),requestedModel:'jev-1.13.0',initialStateSha256:await initialStateFingerprint(sim),stopping:{targetSimulatedSeconds:Number(simRaw),maxWallSeconds:Number(wallRaw),maxTotalInputTokens:Number(tokensRaw),stopForFavorableResults:false},preregistered:false,independentRuleReview:false,ruleReviewSha256:null};
parseStudyManifest(m);fs.writeFileSync(out+'.initial.json',JSON.stringify(sim),{flag:'wx'});fs.writeFileSync(out+'.sources.json',JSON.stringify(provenance,null,2),{flag:'wx'});fs.writeFileSync(out,JSON.stringify(m,null,2),{flag:'wx'});console.log('Frozen locally; no deployment, inference or preregistration performed.');
