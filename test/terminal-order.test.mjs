import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,advanceSimulation,makePlan} from '../src/simulation.mjs';
import {RUNWAYS,FIXES,PROCEDURES,navigation,offset} from '../src/airport.mjs';
import {trueAirspeed} from '../src/pilot.mjs';
function fixture(){const s=createSimulation(0,42);for(const f of s.flights)f.phase='taxi_out';return s;}
function command(f,route,altitude,speed=140,rate=1000){f.command={id:'fixture:'+f.id,route,altitude,speed,rate,navigation:navigation({...f,command:null},route,speed)};}
test('level overflight 80 ft above runway is not touchdown',()=>{
 const s=fixture(),f=s.flights[50],r=RUNWAYS[0];Object.assign(f,{phase:'approach',lane:0,x:r.x,y:r.y,altitude:r.elevation+80,verticalRate:0,heading:r.headingTrue,speed:140});command(f,'ILS_16R_GAZGE',f.altitude);f.command.navigation={points:[offset(r.point,r.headingTrue,5)],index:0};
 advanceSimulation(s,1);assert.equal(s.stats.landings,0);assert.equal(f.phase,'approach');
});
test('SID exit cannot erase a collision and results are independent of array order',()=>{
 for(const reverse of [false,true]){const s=fixture(),[a,b]=s.flights;const p=PROCEDURES.TUDBU1F,[x,y]=FIXES[p.legs.at(-1).fix].point;
 for(const [i,f] of [a,b].entries()){Object.assign(f,{phase:'departure',lane:0,x:x+i*.05,y,altitude:6000,speed:180,heading:90});command(f,'TUDBU1F',6000,180);f.command.navigation.index=p.legs.length-1;}
 if(reverse)s.flights.reverse();advanceSimulation(s,1);assert.equal(s.stats.collisions,1);assert.equal(s.stats.cycles,0);assert.equal(a.phase,'crashed');assert.equal(b.phase,'crashed');assert.equal(a.generation,1);}
});
test('SID measured gradient uses ground speed like the command diagnostic',()=>{
 const s=fixture(),f=s.flights[0];Object.assign(f,{phase:'departure',lane:0,altitude:6000,speed:220,verticalRate:1200,x:0,y:20});command(f,'TUDBU1F',8000,220,1200);
 assert.ok(1200/(trueAirspeed(220,6000)/60)<304);advanceSimulation(s,1);assert.ok(s.incidents.some(i=>i.rule==='SID climb gradient'));
});
test('runway surface penetration is impact, never a below-surface landing',()=>{
 const s=fixture(),f=s.flights[50],r=RUNWAYS[0];Object.assign(f,{phase:'approach',lane:0,x:r.x,y:r.y,altitude:r.elevation-50,speed:140,heading:r.headingTrue});command(f,'ILS_16R_GAZGE',0);advanceSimulation(s,1);assert.equal(s.stats.landings,0);assert.equal(s.stats.groundImpacts,1);
});
test('fast crossing collision between endpoints is measured',()=>{
 const s=fixture(),[a,b]=s.flights;for(const [i,f] of [a,b].entries()){Object.assign(f,{phase:'arrival',x:i?.065:-.065,y:20,altitude:28000,speed:300,heading:i?270:90});command(f,i?'VECTOR_W':'VECTOR_E',28000,300);}
 advanceSimulation(s,1);assert.equal(s.stats.collisions,1);
});

test('analytic swept contacts agree across 1, 0.5 and 0.25-second substeps',()=>{
 for(const step of [1,.5,.25]){const s=fixture(),[a,b]=s.flights;for(const [i,f] of [a,b].entries()){Object.assign(f,{phase:'arrival',x:i?.065:-.065,y:20,altitude:28000,speed:300,heading:i?270:90});command(f,i?'VECTOR_W':'VECTOR_E',28000,300);}advanceSimulation(s,1,{maxStepSeconds:step});assert.equal(s.stats.collisions,1);assert.equal(s.stats.cycles,0);}
});
test('gentle runway contact lands; excessive contact sink and wrong runway contact are impacts',()=>{
 for(const mode of ['gentle','steep','wrong-runway']){const s=fixture(),f=s.flights[50],r=RUNWAYS[0];Object.assign(f,{phase:'approach',lane:mode==='wrong-runway'?3:0,altitude:r.elevation+2,speed:140,heading:r.headingTrue,verticalRate:mode==='steep'?-1500:-300});[f.x,f.y]=offset(r.point,r.headingTrue,.2);command(f,'ILS_16R_GAZGE',r.elevation,140,mode==='steep'?1500:1000);f.command.navigation={points:[offset(r.point,r.headingTrue,3)],index:0};advanceSimulation(s,1);assert.equal(s.stats.landings,mode==='gentle'?1:0);assert.equal(s.stats.groundImpacts,mode==='gentle'?0:1);}
});
test('different-time horizontal and vertical minima do not invent a simultaneous collision',async()=>{
 const {encounter}=await import('../src/flight-events.mjs');const a0={x:-1,y:0,altitude:0},a1={x:1,y:0,altitude:2000},b0={x:0,y:0,altitude:100},b1={...b0};assert.equal(encounter(a0,a1,b0,b1,.12,150),null);
 assert.equal(encounter({x:-1,y:.12,altitude:0},{x:1,y:.12,altitude:0},{x:0,y:0,altitude:0},{x:0,y:0,altitude:0},.12,150),null);
});
