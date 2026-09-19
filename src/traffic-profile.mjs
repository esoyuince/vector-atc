// Synthetic initial-state profiles only. Never used to repair an applied AI command.
export function initialRouteProfile(procedure,path,runway){
 const sid=procedure.kind==='SID',app=procedure.kind==='APP';
 if(!['SID','STAR','APP'].includes(procedure.kind)||path.total<=0||path.distances.length!==procedure.legs.length)throw Error('Invalid initial profile route');
 const baseline=(field,distance)=>{
  const fraction=distance/path.total;
  if(field==='speed')return sid?Math.min(280,180+130*fraction):app?220-75*fraction:280-60*fraction;
  if(sid)return Math.min(18000,(procedure.legs[0].minAltitude??2000)+distance*330);
  return app?5000+(runway.elevation-5000)*fraction:22000-17500*fraction;
 };
 function fieldProfile(field){
  const anchors=[];
  procedure.legs.forEach((leg,index)=>{
   const minimum=field==='altitude'?leg.minAltitude:undefined,maximum=field==='altitude'?leg.maxAltitude:leg.maxSpeed;
   const terminal=app&&index===procedure.legs.length-1;
   if(index===0||index===procedure.legs.length-1||(sid&&field==='altitude')||leg[field]!=null||minimum!=null||maximum!=null){
    const exact=terminal&&field==='altitude'?runway.elevation:leg[field];
    anchors.push({distance:path.distances[index],low:exact??minimum??0,high:exact??maximum??Infinity});
   }
  });
  // Propagate feasible bounds before choosing values, so later anchors never require a reversal.
  if(sid){
   for(let i=1;i<anchors.length;i++)anchors[i].low=Math.max(anchors[i].low,anchors[i-1].low);
   for(let i=anchors.length-2;i>=0;i--)anchors[i].high=Math.min(anchors[i].high,anchors[i+1].high);
  }else{
   for(let i=anchors.length-2;i>=0;i--)anchors[i].low=Math.max(anchors[i].low,anchors[i+1].low);
   for(let i=1;i<anchors.length;i++)anchors[i].high=Math.min(anchors[i].high,anchors[i-1].high);
  }
  for(let i=0;i<anchors.length;i++){
   const a=anchors[i];if(a.low>a.high)throw Error('Incompatible monotone scenario profile: '+procedure.id+' '+field);
   let value=Math.max(a.low,Math.min(a.high,baseline(field,a.distance)));
   if(i)value=sid?Math.max(value,anchors[i-1].value):Math.min(value,anchors[i-1].value);
   a.value=value;
  }
  return path.distances.map(distance=>{
   let next=1;while(next<anchors.length-1&&anchors[next].distance<distance)next++;
   const a=anchors[next-1],b=anchors[next],fraction=(distance-a.distance)/(b.distance-a.distance);
   return a.value+(b.value-a.value)*fraction;
  });
 }
 const altitudes=fieldProfile('altitude'),speeds=fieldProfile('speed');
 return procedure.legs.map((_,i)=>({altitude:altitudes[i],speed:speeds[i]}));
}
