import {requestOperatorStop} from '../src/operator-stop-client.mjs';
// Explicit target prevents a stale terminal command from stopping a different run.
const [baseUrl,runIdRaw,experimentIdRaw]=process.argv.slice(2);
if(!baseUrl||!runIdRaw||!/^\d+$/.test(experimentIdRaw??''))throw Error('Usage: STUDY_ARM_TOKEN=... node scripts/stop-study.mjs HTTPS_BASE_URL RUN_ID_OR_dash EXPERIMENT_ID');
const token=process.env.STUDY_ARM_TOKEN;
try{
 const receipt=await requestOperatorStop(baseUrl,token,{runId:runIdRaw==='-'?null:runIdRaw,experimentId:Number(experimentIdRaw)});
 console.log(JSON.stringify(receipt,null,2));
}catch(error){console.error('Emergency stop was not confirmed: '+error.message);process.exitCode=1;}
