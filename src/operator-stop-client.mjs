// Shared by the browser and CLI. No retry, token persistence, query-string secret or redirect following.
export function operatorStopUrl(baseUrl){
 const base=new URL(baseUrl),loopback=['127.0.0.1','localhost','[::1]'].includes(base.hostname);
 if(base.username||base.password||!(base.protocol==='https:'||(base.protocol==='http:'&&loopback)))throw Error('Stop requires HTTPS or local HTTP');
 return new URL('/api/operator/stop',base);
}
export async function requestOperatorStop(baseUrl,token,target,{fetchImpl=fetch}={}){
 const url=operatorStopUrl(baseUrl);
 if(typeof token!=='string'||token.length<32||token.length>512)throw Error('Invalid operator token');
 if(!target||!Number.isSafeInteger(target.experimentId)||target.experimentId<0||!(target.runId===null||(typeof target.runId==='string'&&/^[-a-zA-Z0-9_]{1,60}$/.test(target.runId))))throw Error('Invalid stop target');
 let response;
 try{response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({runId:target.runId,experimentId:target.experimentId}),redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch{throw Error('stop-outcome-unknown');}
 if(!response.ok)throw Error('stop-http-'+response.status);
 let text;try{text=await response.text();}catch{throw Error('stop-outcome-unknown');}
 if(text.includes(token))throw Error('stop-invalid-receipt');
 let value;try{value=JSON.parse(text);}catch{throw Error('stop-invalid-receipt');}
 if(value.ok!==true||value.stopped!==true||value.durable!==true||value.runId!==target.runId||value.experimentId!==target.experimentId||typeof value.id!=='string'||!Number.isFinite(value.stoppedAt))throw Error('stop-invalid-receipt');
 const keys=['id','runId','experimentId','requestedAt','stoppedAt','simulatedSeconds','reason','journalStatus','journalError','pendingDispatch','alarmCleared'];
 return {ok:true,stopped:true,durable:true,...Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]))};
}
