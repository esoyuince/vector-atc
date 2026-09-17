import test from 'node:test';
import assert from 'node:assert/strict';
import {replayState,ReplayPlayer} from '../src/replay.mjs';
test('recorded playback loops, interpolates headings and never mutates live results',()=>{
 const live={flights:[{id:'A',cycles:7}],phases:{arrival:1},stats:{collisions:3},elapsed:200};
 const row=(x,h,g=1)=>[x,10,h,3000,220,0,'arrival','VECTOR_E',3000,0,g,[20,10]];
 const recording={ids:['A'],frames:[{at:10,flights:[row(0,350)]},{at:20,flights:[row(10,10)]}]};
 const before=JSON.stringify({live,recording}),r=replayState(live,recording,5);
 assert.equal(r.flights[0].x,5);assert.equal(r.flights[0].heading,0);assert.equal(r.elapsed,15);
 assert.deepEqual(r.stats,{collisions:3});assert.equal(JSON.stringify({live,recording}),before);
 assert.deepEqual(replayState(live,recording,15),r);
 const stalled=replayState(live,recording,30,{loop:false});assert.ok(stalled.flights[0].x>9.9,'network delay holds end of current page instead of looping it');
 recording.frames[1].flights[0][10]=2;assert.equal(replayState(live,recording,5).flights[0].x,0);
 assert.equal(replayState(live,{frames:[]},5),null);
});

test('streaming player visits every archive page before looping with only one page prefetched',async()=>{
 let now=0;const fetched=[],played=[];
 const page=i=>({page:i,nextPage:(i+1)%3,frames:[{at:i*20},{at:(i+1)*20}]});
 const player=new ReplayPlayer({now:()=>now,load:async i=>{fetched.push(i);return page(i);},onPage:data=>played.push(data.page)});
 await player.tick();
 for(now=10000;now<=60000;now+=10000)await player.tick();
 assert.deepEqual(played,[0,1,2,0]);assert.deepEqual(fetched,[0,1,2,0]);
 player.stop();await player.tick();assert.equal(fetched.length,4);assert.equal(player.page,null);
});
test('page errors retry the same page without restarting the current replay, and stopped loads cannot publish',async()=>{
 let now=0,fail=true,errors=0;const fetched=[],played=[];
 const player=new ReplayPlayer({now:()=>now,load:async i=>{fetched.push(i);if(i===1&&fail)throw Error();return {page:i,nextPage:i+1,frames:[{at:i*20},{at:(i+1)*20}]};},onPage:d=>played.push(d.page),onError:()=>errors++});
 await player.tick();now=10000;await player.tick();assert.equal(errors,1);
 now=15000;await player.tick();assert.deepEqual(fetched,[0,1]);
 fail=false;now=20000;await player.tick();await player.tick();assert.deepEqual(fetched,[0,1,1]);assert.deepEqual(played,[0,1]);
 let resolve;const stopped=new ReplayPlayer({load:()=>new Promise(r=>resolve=r),onPage:()=>assert.fail('stopped player callback')});
 const pending=stopped.tick();stopped.stop();resolve({frames:[]});await pending;
});
