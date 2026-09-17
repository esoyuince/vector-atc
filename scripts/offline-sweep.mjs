import {createAirborneSimulation,makePlan} from '../src/simulation.mjs';
import {AIRPORT} from '../src/airport.mjs';
import {batchPlans,buildRequest} from '../server/typesafe.mjs';
const count=Number(process.argv[2]??1000);if(!Number.isSafeInteger(count)||count<1||count>100000)throw Error('seed count must be 1..100000');
const failures=[],summary={evidenceClass:'synthetic-offline',seeds:count,unresolvedInitialSeparation:0,outsideSector:0,nonFinite:0,pendingAsked:0,maxRequests:0,maxRequestBytes:0,providerCalls:0};
const numeric=['x','y','altitude','speed','heading','verticalRate','groundSpeed','trueAirspeed'];
for(let seed=0;seed<count;seed++){
 const sim=createAirborneSimulation(0,seed),plan=makePlan(sim),asked=new Set(plan.flights.map(f=>f.id));
 if(sim.flights.length!==100||new Set(sim.flights.map(f=>f.id)).size!==100)failures.push({seed,kind:'identity-pool'});
 for(const f of sim.flights){
  for(const key of numeric)if(!Number.isFinite(f[key])){summary.nonFinite++;failures.push({seed,kind:'non-finite',id:f.id,key});}
  if(f.initialCondition?.initialSeparationUnresolved){summary.unresolvedInitialSeparation++;failures.push({seed,kind:'unresolved-initial-separation',id:f.id});}
  if(['arrival','approach','departure'].includes(f.phase)&&Math.hypot(f.x,f.y)>AIRPORT.sectorRadiusNm+1e-9){summary.outsideSector++;failures.push({seed,kind:'outside-sector',id:f.id});}
  if(f.phase==='pending'&&asked.has(f.id)){summary.pendingAsked++;failures.push({seed,kind:'pending-asked',id:f.id});}
 }
 plan.state.trigger={reason:'synthetic-sweep',at:sim.elapsed};const requests=batchPlans(plan).map(p=>buildRequest(p,'jev-1.13.0'));
 summary.maxRequests=Math.max(summary.maxRequests,requests.length);for(const r of requests)summary.maxRequestBytes=Math.max(summary.maxRequestBytes,Buffer.byteLength(JSON.stringify(r))+4096);
 if(seed<10){const replay=createAirborneSimulation(0,seed);if(JSON.stringify(sim)!==JSON.stringify(replay))failures.push({seed,kind:'nondeterministic-initial-state'});}
}
summary.passed=failures.length===0;summary.failureCount=failures.length;if(failures.length)summary.failures=failures.slice(0,20);console.log(JSON.stringify(summary));if(!summary.passed)process.exitCode=1;
