import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/ltfm-data.json' with {type:'json'};
import {createAirborneSimulation,makePlan,applyFleetDecision} from '../src/simulation.mjs';
import {procedureCommandIssues} from '../src/pilot.mjs';
const leg=(route,fix)=>data.procedures[route].legs.find(l=>l.fix===fix);
// STAR_01 page 1: chart and formal description, frozen SHA 5358189d...e2d1.
test('ERSEN1R FL260 ceiling is at FM450, not the following FM642',()=>{
 assert.equal(leg('ERSEN1R','FM450').maxAltitude,26000);
 assert.equal(leg('ERSEN1R','FM642').maxAltitude,undefined);
});
for(const [route,fix,speed] of [['RIXEN1P','RIXEN',250],['ERSEN1R','EPEKI',280],['ERSEN1R','FM644',250]]){
 test(route+' '+fix+' preserves exact K'+speed+' rather than an upper bound',()=>{
  assert.equal(leg(route,fix).speed,speed);
  assert.equal(leg(route,fix).maxSpeed,undefined);
 });
}
function appliedAt(route,fix,speed,altitude=18000){
 const sim=createAirborneSimulation(0,42),f=sim.flights.find(a=>a.mission==='arrival');sim.flights=[f];
 f.arrival=route;f.phase='arrival';f.altitude=altitude;f.speed=speed;
 f.progress[route]=data.procedures[route].legs.findIndex(l=>l.fix===fix);f.command=null;
 const plan=makePlan(sim),answers=Object.fromEntries(Object.entries({route,altitude:String(altitude),speed:String(speed),rate:'1000'}).map(([k,choice])=>[f.id+'_'+k,{choice}]));
 assert.deepEqual(applyFleetDecision(sim,plan,answers),{applied:1,rejected:0});
 assert.equal(f.command.navigation.index,f.progress[route]);
 assert.equal(f.command.speed,speed);assert.equal(f.command.altitude,altitude);
 return {sim,f,issues:procedureCommandIssues(f)};
}
for(const [route,fix,exact,values] of [['RIXEN1P','RIXEN',250,[230,250,260]],['ERSEN1R','EPEKI',280,[260,280,300]],['ERSEN1R','FM644',250,[230,250,260]]]){
 test(route+' '+fix+' observes low/high speed commands without repairing either',()=>{
  for(const speed of values){
   const {f,issues}=appliedAt(route,fix,speed);
   const finding=issues.find(i=>i.rule==='published-speed-constraint');
   assert.equal(Boolean(finding),speed!==exact);
   if(finding){assert.equal(finding.exact,exact);assert.equal(finding.requested,speed);assert.equal(finding.fix,fix);}
   assert.equal(f.command.speed,speed);
  }
 });
}
test('FL260 receipt-time assessment follows FM450 and never moves the ceiling to FM642',()=>{
 for(const fix of ['FM450','FM642']){
  const {f,issues}=appliedAt('ERSEN1R',fix,250,28000);
  const finding=issues.find(i=>i.rule==='published-altitude-ceiling');
  assert.equal(Boolean(finding),fix==='FM450');
  if(finding){assert.equal(finding.max,26000);assert.equal(finding.fix,'FM450');}
  assert.equal(f.command.altitude,28000,'unsafe numeric target remains unchanged');
 }
});
