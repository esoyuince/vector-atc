import provenance from './build-provenance.mjs';
import {sha256} from './research-journal.mjs';
import {TYPESAFE_PROMPT_VERSION,TYPESAFE_CONTEXT_VERSION} from './typesafe.mjs';
import {PILOT_CONTROL_POLICY} from '../src/pilot.mjs';
import {MEASUREMENT_POLICY} from '../src/flight-events.mjs';
import {AIRBORNE_SCOPE,TRAFFIC_POLICY} from '../src/traffic-lifecycle.mjs';
import {EVALUATION_PROTOCOL} from '../src/evaluation.mjs';
export const runtimeVersions=()=>({prompt:TYPESAFE_PROMPT_VERSION,context:TYPESAFE_CONTEXT_VERSION,control:PILOT_CONTROL_POLICY,measurement:MEASUREMENT_POLICY,evaluation:EVALUATION_PROTOCOL,traffic:TRAFFIC_POLICY.id});
export const initialStateFingerprint=sim=>sha256(JSON.stringify({seed:sim.initialSeed,flights:sim.flights,runways:sim.runways}));
export function parseStudyManifest(text){
 if(!text)return null;const m=typeof text==='string'?JSON.parse(text):structuredClone(text);
 if(m.status!=='frozen-local'||!/^[-a-zA-Z0-9_]{1,60}$/.test(m.runId)||m.scope!==AIRBORNE_SCOPE)throw Error('Invalid frozen run identity/scope');
 if(!Number.isSafeInteger(m.seed)||m.seed<0||m.seed>0xffffffff)throw Error('Invalid frozen seed');
 if(m.sourceFingerprint!==provenance.sourceFingerprint||(!m.versions||Object.keys(m.versions).length!==Object.keys(runtimeVersions()).length||Object.entries(runtimeVersions()).some(([k,v])=>m.versions[k]!==v)))throw Error('Frozen source or versions mismatch');
 if(!/^[a-f0-9]{64}$/.test(m.initialStateSha256)||typeof m.requestedModel!=='string'||m.requestedModel.length>80)throw Error('Invalid frozen provenance');
 for(const k of ['targetSimulatedSeconds','maxWallSeconds','maxTotalInputTokens'])if(!Number.isSafeInteger(m.stopping?.[k])||m.stopping[k]<=0)throw Error('Invalid stop rule '+k);
 if(m.stopping.stopForFavorableResults!==false)throw Error('Outcome-dependent stop forbidden');return m;
}
export async function initializeStudy(record,manifest,now){
 if(!manifest)return;
 const digest=await sha256(JSON.stringify(manifest));
 if(record.study){if(record.study.manifestSha256!==digest)throw Error('Existing run manifest changed');return;}
 if(record.sim.elapsed!==0||record.ai.totalCalls!==0||await initialStateFingerprint(record.sim)!==manifest.initialStateSha256)throw Error('Study requires the matching untouched initial state');
 record.study={manifest,manifestSha256:digest,startedAt:now,startSimSeconds:record.sim.elapsed,accountedInputTokens:0,status:'running',stopReason:null};
}
export function studyStopReason(record,now,reserve=0){
 const s=record.study;if(!s)return null;if(s.status!=='running')return s.stopReason??'already-stopped';
 if(record.sim.elapsed-s.startSimSeconds>=s.manifest.stopping.targetSimulatedSeconds)return 'target-exposure';
 if(now-s.startedAt>=s.manifest.stopping.maxWallSeconds*1000)return 'wall-time';
 if(s.accountedInputTokens+reserve>s.manifest.stopping.maxTotalInputTokens)return 'input-budget';return null;
}
export function stopStudy(record,reason){if(record.study){record.study.status=reason==='target-exposure'?'completed':'incomplete';record.study.stopReason=reason;record.study.stoppedAt=Date.now();}record.ai.mode='study-stopped';record.ai.stopReason=reason;record.frameRemaining=0;}
export {provenance};
