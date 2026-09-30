// Loads a frozen manifest into the real worker under local workerd with AI disabled and no provider key.
// Proves the manifest, SIM_SPEED binding and workerd-computed initial state agree before any deployment.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {parseStudyManifest,usesProviderBalance} from '../server/study-run.mjs';
const [manifestPath]=process.argv.slice(2);if(!manifestPath)throw Error('Usage: workerd-acceptance.mjs FROZEN_MANIFEST_JSON');
const root=fileURLToPath(new URL('..',import.meta.url)),m=parseStudyManifest(fs.readFileSync(manifestPath,'utf8'));
if(!fs.existsSync(path.join(root,'dist/index.html')))throw Error('Run npm run build first');
process.env.WRANGLER_SEND_METRICS='false';
const simSpeed=m.runtime?.simSpeed??1,config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.example.jsonc'),'utf8'));
// A config outside the repository keeps local .dev.vars (and its provider key) out of the process.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-workerd-')),configPath=path.join(dir,'wrangler.json');
Object.assign(config,{main:path.join(root,'server/worker.mjs'),assets:{...config.assets,directory:path.join(root,'dist')},vars:{...config.vars,AI_ENABLED:'false',TYPESAFE_API_KEY:'',SIM_SPEED:String(simSpeed),RESEARCH_RUN_ID:m.runId,RUN_MANIFEST_JSON:JSON.stringify(m),...(m.storage?.researchJournalMaxBytes?{RESEARCH_JOURNAL_MAX_BYTES:String(m.storage.researchJournalMaxBytes)}:{}),...(usesProviderBalance(m)?{AI_DAILY_TOKEN_LIMIT:'provider-balance'}:{})}});
delete config.$schema;fs.writeFileSync(configPath,JSON.stringify(config));
const {unstable_dev}=await import('wrangler');
const worker=await unstable_dev(config.main,{config:configPath,ip:'127.0.0.1',persistTo:path.join(dir,'state'),logLevel:'error',experimental:{disableExperimentalWarning:true}});
let receipt;
try{
 const response=await worker.fetch('/api/state'),state=response.ok?await response.json():null;
 const checks={httpOk:response.ok,studyReady:state?.studyStatus==='ready',runIdMatches:state?.collection?.runId===m.runId,untouched:state?.elapsed===0,speedMatches:state?.speed===simSpeed,aiNotConfigured:state?.ai?.configured===false};
 receipt={workerdAcceptance:Object.values(checks).every(Boolean),checks,runId:m.runId,simSpeed,sourceFingerprint:m.sourceFingerprint,initialStateSha256:m.initialStateSha256,workerdVersion:JSON.parse(fs.readFileSync(path.join(root,'node_modules/workerd/package.json'),'utf8')).version,compatibilityDate:config.compatibility_date,httpStatus:response.status,providerCalls:0};
}finally{await worker.stop();fs.rmSync(dir,{recursive:true,force:true});}
console.log(JSON.stringify(receipt,null,1));
if(!receipt.workerdAcceptance)process.exitCode=1;
