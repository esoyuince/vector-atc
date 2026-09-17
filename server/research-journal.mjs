export const JOURNAL_KEY='research-journal-v1';
const CHUNK_CHARS=16000,MAX_CHUNKS=120;
export const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export const STATE_DIGEST_VERSION='sim-core-state-v2';
export function simulationStateSha256(sim){
 const {lastWall,events,incidents,...state}=sim;
 // Wall timing and bounded presentation windows are excluded; their observations are journaled.
 return sha256(JSON.stringify(state));
}
export class ArchiveError extends Error{constructor(code='archive-write-failed'){super(code);this.name='ArchiveError';this.code=code;}}
export class ResearchJournal{
 static async open(storage,maxBytes=64*1024*1024){const meta=await storage.get(JOURNAL_KEY);return new ResearchJournal(storage,meta??{version:1,nextSequence:0,headSha256:null,totalBytes:0,startedAt:null,coverageStartSimSeconds:null},maxBytes);}
 constructor(storage,meta,maxBytes){this.storage=storage;this.meta=meta;this.maxBytes=maxBytes;this.queue=Promise.resolve();this.failed=false;}
 commit(recordKey,record,events=[]){
  const work=this.queue.then(async()=>{
   if(this.failed)throw new ArchiveError('archive-tail-uncertain');
   const seq=this.meta.nextSequence;
   const entry={version:1,sequence:seq,previousSha256:this.meta.headSha256,recordedAt:Date.now(),simSeconds:record.sim.elapsed,revision:record.sim.revision,events,stateDigestVersion:STATE_DIGEST_VERSION,stateSha256:await simulationStateSha256(record.sim)};
   const text=JSON.stringify(entry),bytes=new TextEncoder().encode(text).length,chunkCount=Math.ceil(text.length/CHUNK_CHARS);
   if(chunkCount>MAX_CHUNKS)throw new ArchiveError('archive-entry-too-large');
   if(this.meta.totalBytes+bytes>this.maxBytes)throw new ArchiveError('archive-capacity-stop');
   const digest=await sha256(text),key=JOURNAL_KEY+':'+seq;
   const descriptor={sequence:seq,sha256:digest,previousSha256:this.meta.headSha256,chunkCount,bytes};
   const meta={...this.meta,nextSequence:seq+1,headSha256:digest,totalBytes:this.meta.totalBytes+bytes,startedAt:this.meta.startedAt??Date.now(),coverageStartSimSeconds:this.meta.coverageStartSimSeconds??record.sim.elapsed};
   const writes={[recordKey]:record,[key]:descriptor,[JOURNAL_KEY]:meta};
   for(let i=0;i<chunkCount;i++)writes[key+':'+i]=text.slice(i*CHUNK_CHARS,(i+1)*CHUNK_CHARS);
   try{await this.storage.put(writes);}catch{this.failed=true;throw new ArchiveError();}
   this.meta=meta;return descriptor;
  });
  this.queue=work.catch(()=>{});return work;
 }
 async read(entry=null,chunk=null){
  if(entry===null)return {...this.meta,maxBytes:this.maxBytes,tailUncertain:this.failed,format:'immutable JSON string chunks; join and verify SHA-256 and predecessor chain',historicalBackfill:false};
  if(!Number.isSafeInteger(entry)||entry<0||entry>=this.meta.nextSequence)return null;
  const key=JOURNAL_KEY+':'+entry,descriptor=await this.storage.get(key);
  if(!descriptor)throw new ArchiveError('archive-descriptor-missing');
  if(chunk===null)return descriptor;
  if(!Number.isSafeInteger(chunk)||chunk<0||chunk>=descriptor.chunkCount)return null;
  const text=await this.storage.get(key+':'+chunk);if(typeof text!=='string')throw new ArchiveError('archive-chunk-missing');return {entry,chunk,text};
 }
}
