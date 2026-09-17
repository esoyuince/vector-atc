// Read-only interpolation of recorded positions. No physics, decisions or counters run here.
export function replayState(live,recording,seconds,{loop=true}={}){
 const frames=recording?.frames;if(!frames||frames.length<2)return null;
 const start=frames[0].at,end=frames.at(-1).at,duration=end-start;if(duration<=0)return null;
 const at=start+(loop?((seconds%duration)+duration)%duration:Math.max(0,Math.min(seconds,duration-.000001)));
 let index=frames.findIndex((f,i)=>i<frames.length-1&&at>=f.at&&at<frames[i+1].at);
 if(index<0)index=0;
 const a=frames[index],b=frames[index+1],fraction=(at-a.at)/(b.at-a.at);
 const flights=live.flights.map(f=>{
  const i=recording.ids.indexOf(f.id),x=a.flights[i],y=b.flights[i];if(!x||!y)return f;
  const t=x[10]===y[10]?fraction:0,lerp=k=>x[k]+(y[k]-x[k])*t;
  return {...f,x:lerp(0),y:lerp(1),heading:(x[2]+(((y[2]-x[2]+540)%360)-180)*t+360)%360,altitude:Math.round(lerp(3)),speed:Math.round(lerp(4)),verticalRate:Math.round(lerp(5)),phase:x[6],lane:x[9],generation:x[10],command:x[7]?{route:x[7],altitude:x[8],point:x[11]}:null,lastCommand:x[7]||'',flightPathAngle:Math.round(Math.atan2(lerp(5),((x[12]??x[4])+((y[12]??y[4])-(x[12]??x[4]))*t)*6076/60)*180/Math.PI*10)/10};
 });
 return {...live,flights,elapsed:Math.floor(at),running:true,alerts:[],isReplay:true,phases:Object.fromEntries(Object.keys(live.phases).map(p=>[p,flights.filter(f=>f.phase===p).length]))};
}

// Prefetch one page; hold the final recorded position during network retries.
// Memory is bounded to the current and next page, regardless of archive age.
export class ReplayPlayer{
 constructor({load,onPage,onError=()=>{},now=Date.now}){Object.assign(this,{load,onPage,onError,now});this.page=null;this.next=null;this.loading=false;this.stopped=false;this.retryAt=0;}
 stop(){this.stopped=true;this.page=null;this.next=null;}
 adopt(page){this.page=page;this.next=null;this.startedAt=this.now();this.onPage(page,this.startedAt);}
 async tick(){
  if(this.stopped||this.loading)return;
  const duration=this.page?.frames?.length>1?this.page.frames.at(-1).at-this.page.frames[0].at:0;
  if(this.page&&duration>0&&this.now()-this.startedAt>=duration*1000&&this.next){this.adopt(this.next);return;}
  const needsLoad=!this.page||duration<=0||(!this.next&&this.now()-this.startedAt>=(duration-10)*1000);
  if(!needsLoad||this.now()<this.retryAt)return;
  this.loading=true;
  try{
   const data=await this.load(this.page&&duration>0?this.page.nextPage:0);
   if(this.stopped)return;
   if(!data||!Array.isArray(data.frames))throw new Error('Replay page unavailable');
   if(!this.page||duration<=0){this.adopt(data);if(data.frames.length<2)this.retryAt=this.now()+10000;}
   else this.next=data;
  }catch{
   if(!this.stopped){this.retryAt=this.now()+10000;this.onError();}
  }finally{this.loading=false;}
 }
}
