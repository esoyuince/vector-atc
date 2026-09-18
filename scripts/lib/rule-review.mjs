import spec from '../../docs/evaluation-spec.json' with {type:'json'};
export const SIMULATION_ASSUMPTIONS=['surface-model','touchdown-criteria','departure-handoff','arrival-injection','departure-injection','holding-entry-and-timing','separation-thresholds','generic-aircraft-performance'];
const allowed=new Set(['accepted','accepted-with-limitation','rejected']);
function exactIds(rows,expected,label,errors){
 if(!Array.isArray(rows)){errors.push(label+' missing');return;}
 const ids=rows.map(r=>r?.id),unique=new Set(ids);if(unique.size!==ids.length)errors.push(label+' has duplicate ids');
 for(const id of expected)if(!unique.has(id))errors.push(label+' missing '+id);for(const id of unique)if(!expected.includes(id))errors.push(label+' unknown '+id);
}
export function validateRuleReview(review){
 const errors=[];if(review?.schemaVersion!==1)errors.push('schemaVersion');if(review?.dataset!=='LTFM-SOUTH-v2')errors.push('dataset');if(review?.evaluationProtocol!==spec.protocolId)errors.push('evaluationProtocol');
 if(review?.status!=='approved')errors.push('status must be approved');if(!/^[a-f0-9]{64}$/.test(review?.reviewPacketSha256??''))errors.push('reviewPacketSha256');const r=review?.reviewer??{};for(const key of ['name','role','reviewedAt'])if(typeof r[key]!=='string'||!r[key].trim())errors.push('reviewer.'+key);
 const ruleIds=spec.commandRules.map(x=>x.id);exactIds(review?.rules,ruleIds,'rules',errors);exactIds(review?.simulationAssumptions,SIMULATION_ASSUMPTIONS,'simulationAssumptions',errors);
 for(const row of [...(review?.rules??[]),...(review?.simulationAssumptions??[])]){if(!allowed.has(row?.decision))errors.push((row?.id??'unknown')+' decision');if(row?.decision==='rejected')errors.push(row.id+' rejected');if(row?.decision==='accepted-with-limitation'&&!(typeof row.notes==='string'&&row.notes.trim()))errors.push(row.id+' limitation needs notes');if(!Array.isArray(row?.evidence)||row.evidence.length===0)errors.push((row?.id??'unknown')+' evidence');}
 return {valid:errors.length===0,errors};
}
