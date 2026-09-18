export function studyArmUrl(baseUrl){
 const url=new URL('/api/study/arm',baseUrl);if(url.protocol!=='https:'&&!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('Study arm requires HTTPS or loopback');return url;
}
export async function armStudy(baseUrl,token,{fetchImpl=fetch}={}){
 if(typeof token!=='string'||token.length<32)throw Error('STUDY_ARM_TOKEN must be at least 32 characters');
 const url=studyArmUrl(baseUrl),response=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Cache-Control':'no-store'}});
 const text=await response.text();if(!response.ok)throw Error('Study arm failed with HTTP '+response.status+(text?': '+text.slice(0,160):''));
 let body;try{body=JSON.parse(text);}catch{throw Error('Study arm returned invalid JSON');}
 if(typeof body.runId!=='string'||body.status!=='running'||typeof body.armed!=='boolean')throw Error('Study arm returned an invalid contract');
 return {runId:body.runId,status:body.status,armed:body.armed,armedAt:body.armedAt??null};
}
