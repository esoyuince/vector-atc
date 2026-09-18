import data from '../../src/ltfm-data.json' with {type:'json'};import spec from '../../docs/evaluation-spec.json' with {type:'json'};import sourceReceipt from '../../docs/source-verification-receipt.json' with {type:'json'};import provenance from '../../server/build-provenance.mjs';import {SIMULATION_ASSUMPTIONS} from './rule-review.mjs';
const uniq=values=>[...new Set(values.filter(Boolean))].sort();
const procedures=Object.values(data.procedures??{}),holds=data.holds??[];
const procedureSources=predicate=>uniq(procedures.filter(predicate).map(p=>p.source));
const legSources=predicate=>procedureSources(p=>(p.legs??[]).some(predicate));
function sourceHints(id){
 if(id==='holding-minimum-altitude')return {publishedSources:uniq(holds.filter(h=>Number.isFinite(h.minAltitude)).map(h=>h.source)),demoFallback:[]};
 if(id==='holding-speed-limit')return {publishedSources:uniq(holds.filter(h=>Number.isFinite(h.maxSpeed)).map(h=>h.source)),demoFallback:holds.filter(h=>!Number.isFinite(h.maxSpeed)).map(h=>h.fix).sort()};
 if(id==='published-altitude-floor')return {publishedSources:legSources(l=>Number.isFinite(l.altitude??l.minAltitude)),demoFallback:[]};
 if(id==='published-altitude-ceiling')return {publishedSources:legSources(l=>Number.isFinite(l.altitude??l.maxAltitude)),demoFallback:[]};
 if(id==='published-speed-constraint')return {publishedSources:legSources(l=>Number.isFinite(l.speed??l.maxSpeed)),demoFallback:[]};
 if(id==='fap-altitude-floor')return {publishedSources:procedureSources(p=>p.kind==='APP'&&p.fap),demoFallback:['pre-FAP-floor-interpretation']};
 if(id==='sid-climb-gradient')return {publishedSources:procedureSources(p=>p.kind==='SID'&&Number.isFinite(p.minClimbFtPerNm)),demoFallback:[]};
 return {publishedSources:[],demoFallback:[id==='approach-clearance-mismatch'?'integration-rule':'simulator-rule']};
}
const assumptionDescriptions={
 'surface-model':'0 ft MSL background plus flat 60 m runway strips at sourced threshold elevations; no terrain/obstacle mesh.',
 'touchdown-criteria':'Assigned strip contact, heading error <15 deg, IAS <=190 kt, sink >=-900 fpm; otherwise impact under the simulator model.',
 'departure-handoff':'Departure completion requires procedure/sector exit, >=30 NM, outward heading and no predicted pair conflict in the next 120 s.',
 'arrival-injection':'Seeded upstream scatter around assigned STAR first fix; unresolved initial separation blocks a frozen batch.',
 'departure-injection':'Scenario-injected at first SID fix, 180 kt and max(first-leg minimum, runway elevation +1500 ft), not ground control.',
 'holding-entry-and-timing':'Deterministic entry sectors and 60/90 s timing with bank-limited generic pilot behavior; not complete local holding implementation.',
 'separation-thresholds':'Experimental point-aircraft thresholds: 3 NM/1000 ft separation, 1 NM/500 ft critical, 0.12 NM/150 ft collision.',
 'generic-aircraft-performance':'Generic transport-jet acceleration/bank/vertical-rate envelopes; not AFM-certified aircraft performance.'
};
export function makeRuleReviewPacket(){
 return {schemaVersion:1,status:'unadjudicated-review-packet',sourceFingerprint:provenance.sourceFingerprint,dataset:{id:data.id,retrieved:data.retrieved,sources:data.sources,sourceAvailability:{verifiedAt:sourceReceipt.verifiedAt,method:sourceReceipt.method,allMatch:sourceReceipt.allMatch,contentAdjudication:sourceReceipt.contentAdjudication,files:sourceReceipt.results.map(r=>({name:r.name,url:r.url,bytes:r.actualBytes,sha256:r.actualSha256}))}},evaluationProtocol:spec.protocolId,commandRules:spec.commandRules.map(rule=>({...rule,...sourceHints(rule.id)})),simulationAssumptions:SIMULATION_ASSUMPTIONS.map(id=>({id,description:assumptionDescriptions[id],classification:'simulator-assumption-review'})),reviewInstructions:{decisionValues:['accepted','accepted-with-limitation','rejected'],evidenceRequirement:'Record source ID/page/section or explicit simulator-assumption rationale for every row.',independence:'Software cannot establish reviewer identity, expertise or independence.'}};
}
export function validateRuleReviewPacket(packet){
 if(packet?.schemaVersion!==1||packet.status!=='unadjudicated-review-packet'||packet.sourceFingerprint!==provenance.sourceFingerprint||packet.dataset?.id!==data.id||packet.dataset?.retrieved!==data.retrieved||packet.evaluationProtocol!==spec.protocolId)throw Error('Review packet identity/source mismatch');
 if(JSON.stringify(packet.dataset.sources)!==JSON.stringify(data.sources))throw Error('Review packet source list mismatch');
 const expectedRules=makeRuleReviewPacket().commandRules;if(JSON.stringify(packet.commandRules)!==JSON.stringify(expectedRules))throw Error('Review packet detector definitions mismatch');
 if(JSON.stringify(packet.simulationAssumptions)!==JSON.stringify(makeRuleReviewPacket().simulationAssumptions))throw Error('Review packet assumptions mismatch');return packet;
}
