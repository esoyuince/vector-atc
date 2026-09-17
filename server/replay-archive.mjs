const META='replay-archive-ltfm-v2';
const key=page=>META+':'+page;
export const REPLAY_PAGE_FRAMES=50;
// Only metadata and the current page are held in memory. Completed pages are never overwritten.
export class ReplayArchive{
 static async open(storage,ids){
  let meta=await storage.get(META);
  if(!meta){
   const legacy=await storage.get('replay-ltfm-v1'),frames=legacy?.frames||[];
   meta={version:2,ids:legacy?.ids||ids,pageCount:frames.length?1:0,frameCount:frames.length,firstAt:frames[0]?.at??null,lastAt:frames.at(-1)?.at??null};
   await storage.put({[META]:meta,...(frames.length?{[key(0)]:frames}:{})});
  }
  return new ReplayArchive(storage,meta,meta.pageCount?await storage.get(key(meta.pageCount-1)):[]);
 }
 constructor(storage,meta,tail){this.storage=storage;this.meta=meta;this.tail=tail;}
 async capture(sim){
  if(this.meta.lastAt!==null&&sim.elapsed-this.meta.lastAt<5)return;
  const round=n=>Math.round(n*10)/10;
  const frame={at:round(sim.elapsed),recordedAt:Date.now(),flights:sim.flights.map(f=>[round(f.x),round(f.y),round(f.heading),round(f.altitude),round(f.speed),round(f.verticalRate),f.phase,f.command?.route||null,f.command?.altitude??null,f.lane,f.generation,f.command?.point?.map(round)||null,round(f.groundSpeed||f.speed)])};
  let page=Math.max(0,this.meta.pageCount-1),frames=[...this.tail];
  if(frames.length>=REPLAY_PAGE_FRAMES){page++;frames=[frames.at(-1)];} // One shared frame makes the join continuous.
  frames.push(frame);
  const meta={...this.meta,pageCount:page+1,frameCount:this.meta.frameCount+1,firstAt:this.meta.firstAt??frame.at,lastAt:frame.at};
  await this.storage.put({[key(page)]:frames,[META]:meta}); // Page and index commit atomically.
  this.meta=meta;this.tail=frames;
 }
 async read(page=0){
  if(!Number.isSafeInteger(page)||page<0||page>=Math.max(1,this.meta.pageCount))return null;
  const frames=this.meta.pageCount?(page===this.meta.pageCount-1?this.tail:await this.storage.get(key(page))):[];
  return {...this.meta,page,nextPage:page+1<this.meta.pageCount?page+1:0,archivedSeconds:Math.max(0,(this.meta.lastAt??0)-(this.meta.firstAt??0)),frames};
 }
}
