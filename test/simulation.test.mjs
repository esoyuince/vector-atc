import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,advanceSimulation,makePlan,applyFleetDecision,predictedConflicts,experimentReport,CONTROL_SECONDS} from '../src/simulation.mjs';
import {RUNWAYS,FIXES,navigation,offset} from '../src/airport.mjs';
import {budgetAt,reserveBudget,settleBudget} from '../server/budget.mjs';
import {buildRequest,validateResponse,callTypeSafe} from '../server/typesafe.mjs';
export function fixture(request,select=(_id,q)=>Object.keys(q.criteria)[0]){
 return {model:'jev-1.13.0',answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{const choice=select(id,q);return [id,{type:'choice',choice,confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))}]})),usage:{input_tokens:5000,output_tokens:1000}};
}
function commands(sim,change={}){
 const plan=makePlan(sim),request=buildRequest(plan,'jev-1.13.0');
 const data=fixture(request,(id,q)=>change[id]??(id.startsWith('runway_')?'wait':id.endsWith('_route')?Object.keys(q.criteria)[0]:id.endsWith('_altitude')?'6000':id.endsWith('_speed')?'220':'1500'));
 return {plan,answers:data.answers};
}
test('100 telemetry reports expose all four flight controls; physics never chooses an avoidance command',()=>{
 const s=createSimulation(0,42),p=makePlan(s),r=buildRequest(p,'jev-1.13.0');
 assert.equal(s.flights.length,100);assert.equal(new Set(s.flights.map(f=>f.id)).size,100);
 assert.equal(Object.keys(p.state.aircraft).length,100);assert.equal(Object.keys(r.questions).length,403);
 for(const f of s.flights)for(const field of ['route','altitude','speed','rate'])assert.ok(r.questions[f.id+'_'+field]);
 const f=s.flights[50],before={x:f.x,y:f.y,heading:f.heading,altitude:f.altitude};
 advanceSimulation(s,10);assert.deepEqual({x:f.x,y:f.y,heading:f.heading,altitude:f.altitude},before);assert.equal(f.command,null);
});
test('TypeSafe heading/altitude/speed/rate commands drive bounded physical movement and angles',()=>{
 const s=createSimulation(0,42),f=s.flights[50];f.x=0;f.y=20;f.heading=90;f.altitude=6000;f.speed=220;
 const c=commands(s,{[f.id+'_route']:'VECTOR_E',[f.id+'_altitude']:'8000',[f.id+'_speed']:'260',[f.id+'_rate']:'1000'});
 assert.equal(applyFleetDecision(s,c.plan,c.answers).applied,100);advanceSimulation(s,30);
 assert.ok(f.x>1.8);assert.ok(Math.abs(f.y-20)<.01);assert.ok(f.altitude>6400&&f.altitude<6500);assert.ok(f.speed>220&&f.speed<240);assert.equal(f.verticalRate,1000);
 assert.equal(f.lastSource,'typesafe');assert.equal(f.command.altitude,8000);
});
test('stale generation/revision commands are rejected',()=>{
 const s=createSimulation(),c=commands(s);advanceSimulation(s,1);
 assert.equal(applyFleetDecision(s,c.plan,c.answers).applied,0);assert.ok(s.flights.every(f=>f.command===null));
 assert.equal(s.stats.rejected,100);
});

test('contradictory AI final clearance is executed and reported, never locally vetoed',()=>{
 const s=createSimulation(0,42),f=s.flights[50];f.x=-10;f.y=-10;f.lane=0;
 let c=commands(s,{[f.id+'_route']:'ILS_16R_GAZGE'});
 assert.equal(applyFleetDecision(s,c.plan,c.answers).applied,100);assert.equal(f.command.route,'ILS_16R_GAZGE');assert.equal(s.stats.clearanceMismatches,1);
 c=commands(s,{[f.id+'_route']:'ILS_17L_GAZGE'});applyFleetDecision(s,c.plan,c.answers);
 assert.equal(f.command.route,'ILS_17L_GAZGE');assert.equal(s.stats.clearanceMismatches,2);assert.equal(s.stats.rejected,0);
});

test('one simultaneous multi-aircraft collision crashes every participant and counts one accident',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 const group=s.flights.slice(0,3);for(const [i,f] of group.entries()){f.phase='arrival';f.x=i*.05;f.y=20;f.altitude=8000;f.command=null;}
 advanceSimulation(s,1);assert.equal(s.stats.collisions,1);assert.ok(group.every(f=>f.phase==='crashed'));
 assert.equal(s.incidents.find(i=>i.type==='Çarpışma').aircraft.length,3);
});
test('predicted collision, measured collision and persistent report do not hide unsafe AI commands',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 const [a,b]=s.flights;for(const f of [a,b]){f.phase='arrival';f.altitude=8000;f.speed=180;f.verticalRate=0;f.y=20;}
 a.x=-.08;a.heading=90;b.x=.08;b.heading=270;
 for(const f of [a,b]){const route=f===a?'VECTOR_E':'VECTOR_W';f.command={route,navigation:navigation(f,route,180),altitude:8000,speed:180,rate:500};}
 assert.ok(predictedConflicts([a,b]).some(c=>c.critical));
 advanceSimulation(s,1);assert.equal(s.stats.collisions,1);assert.equal(s.stats.criticalEpisodes,1);assert.equal(s.stats.separationEpisodes,1);
 assert.equal(a.phase,'crashed');assert.equal(a.command.altitude,8000);
 advanceSimulation(s,1);assert.equal(s.stats.collisions,1,'one accident is not counted every tick');
 const report=experimentReport(s,{},{totalCalls:0});assert.equal(report.accidents,1);assert.equal(report.incidents[0].type,'Çarpışma');
 advanceSimulation(s,2);assert.equal(s.flights.length,100);assert.equal(s.stats.cycles,0,'crash respawn is not a successful flight');
});
test('landing respawns an arrival; outbound sector exit respawns a departure, preserving count',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 const a=s.flights[50],r=RUNWAYS[0];a.phase='approach';a.lane=0;[a.x,a.y]=offset(r.point,r.headingTrue,.05);a.heading=r.headingTrue;a.altitude=r.elevation;a.speed=140;a.command={route:'ILS_16R_GAZGE',navigation:{points:[r.point],index:0},altitude:r.elevation,speed:140,rate:1000};
 advanceSimulation(s,1);assert.equal(s.stats.landings,1);advanceSimulation(s,2);
 assert.equal(a.mission,'arrival');assert.equal(a.phase,'arrival');assert.equal(a.command,null);assert.equal(a.cycles,1);
 const d=s.flights[0];d.phase='departure';d.x=60;d.y=0;d.altitude=6000;d.heading=90;d.procedureDone=true;
 advanceSimulation(s,1);assert.equal(d.phase,'taxi_out');assert.equal(d.mission,'departure');assert.equal(d.command,null);assert.equal(d.cycles,1);assert.equal(s.stats.departures,1);
 assert.equal(s.flights.length,100);assert.equal(s.stats.cycles,2);
});
test('terrain impacts and runway incursions are measured, not repaired by local ATC',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 const a=s.flights[50];a.phase='arrival';a.x=0;a.y=20;a.altitude=10;a.speed=140;a.command={route:'VECTOR_S',navigation:navigation(a,'VECTOR_S',140),altitude:0,speed:140,rate:2500};
 advanceSimulation(s,3);assert.equal(s.stats.groundImpacts,1);
 const [b,c]=s.flights;for(const f of [b,c]){f.phase='takeoff';f.lane=0;[f.x,f.y]=offset(RUNWAYS[0].point,RUNWAYS[0].headingTrue,f===b?.5:1.5);f.altitude=RUNWAYS[0].elevation;f.command=null;}
 advanceSimulation(s,1);assert.equal(s.stats.runwayIncursions,1);advanceSimulation(s,1);assert.equal(s.stats.runwayIncursions,1);
});
test('far final approaches are clearances, not physical runway incursions',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 for(const [i,f] of s.flights.slice(0,2).entries()){f.phase='approach';f.lane=1;f.x=0;f.y=-20-i*10;f.altitude=3000;f.command=null;}
 advanceSimulation(s,1);assert.equal(s.stats.runwayIncursions,0);assert.deepEqual(s.runways[1].occupants,[]);assert.equal(s.runways[1].reservations.length,2);
});

test('touchdown aircraft remains a collision participant until respawn',()=>{
 const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';
 const [a,b]=s.flights;for(const f of [a,b]){f.lane=0;f.x=-10;f.y=-2;f.altitude=0;f.age=0;f.command=null;}
 a.phase='landing';b.phase='takeoff';advanceSimulation(s,1);
 assert.equal(s.stats.collisions,1);assert.equal(a.phase,'crashed');assert.equal(b.phase,'crashed');assert.equal(experimentReport(s,{},{}).accidents,1);
});
test('budget persists reservations, caps requests, charges usage drift and resets in UTC',()=>{
 const now=Date.UTC(2026,8,17,12),limits={dailyTokens:1000,hourlyRequests:2};
 let b=JSON.parse(JSON.stringify(reserveBudget(null,now,400,limits)));
 assert.equal(reserveBudget(b,now,700,limits),null);b=settleBudget(b,b,400,100,now);assert.equal(b.tokens,100);
 const r=reserveBudget(b,now,400,limits);assert.equal(reserveBudget(r,now,1,limits),null);
 assert.equal(budgetAt(r,now+3600000).requests,0);assert.equal(budgetAt(r,now+86400000).tokens,0);
 const drift=settleBudget(r,r,400,1200,now);assert.equal(drift.tokens,1300);assert.equal(reserveBudget(drift,now,1,limits),null);
});
test('400+ typed answers validate; adapter strips extra secret-like fields and fails closed',async()=>{
 const request=buildRequest(makePlan(createSimulation()),'jev-1.13.0'),data=fixture(request);
 data.answers.TRK101_route.extra='fixture-secret';data.usage.extra='fixture-secret';
 assert.equal(validateResponse(data,request),true);
 const result=await callTypeSafe(request,'fixture-secret',{fetchImpl:async(url,opts)=>{assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(opts.headers.Authorization,'Bearer fixture-secret');return Response.json(data);}});
 assert.equal(JSON.stringify(result).includes('fixture-secret'),false);
 const bad=structuredClone(data);bad.answers.TRK101_route.choice='invented';assert.equal(validateResponse(bad,request),false);
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>new Response('private',{status:429})}),/kullanım/);
 await assert.rejects(callTypeSafe(request,'x',{fetchImpl:async()=>Response.json({})}),/sözleşme/);
 assert.equal(CONTROL_SECONDS,60);
});
