import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateScenarioFluidRound} from '../src/analysis/ScenarioScreeningEngine.js';
import {scenarioSearchRun,scenarioScreeningEligibility,basicScenarioConfirmationHorizon,assessScenarioConfirmation,planBasicScenarioSearch,scenarioOriginalVerificationPlan,assessScenarioOriginalVerification} from '../src/analysis/ScenarioSearch.js';
const machine=(id,rate)=>({id,name:id,type:'MACHINE',initialMode:'AUTO',nominalRatePerSecond:rate,noiseProfile:{}});
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
import {applyScenarioChanges} from '../src/analysis/ScenarioPlanner.js';
const fixture=()=>JSON.parse(fs.readFileSync('test/fixtures/demo-b-case.json','utf8')).simulations[0];
test('fluid direct flow preserves mass, bottleneck and repeated seeds',()=>{
 const input={case:{id:'line',unitOfFlow:'bottles',equipment:[machine('a',4),machine('b',3)]},run:{durationSeconds:3600,tickSeconds:.25,seed:23,reliabilityEnabled:false}};
 const a=simulateScenarioFluidRound(input).result,b=simulateScenarioFluidRound(input).result;
 assert.deepEqual(a,b);assert.equal(a.summary.outputCount,10800);assert.equal(a.summary.materialBalance.residualUnits,0);assert.equal(a.summary.fluidEvents,1);
});
test('fluid demonstration line runs matched finite inventory and reliability',()=>{
 const s=fixture(),input={case:{id:s.id,unitOfFlow:s.unitOfFlow||'bottles',equipment:s.equipment},run:{...s.dynamicConfig,durationSeconds:1800,seed:23}};
 for(const seed of [23,24,25,26,27,28]){
  const run={...input,run:{...input.run,seed}};
  const a=simulateScenarioFluidRound(run).result,b=simulateScenarioFluidRound(run).result;
  assert.deepEqual(a,b);assert(a.summary.outputCount>0);assert(Math.abs(a.summary.materialBalance.residualUnits)<1e-4);assert(a.summary.fluidEvents<1800*120);
 }
});
test('Basic keeps fidelity and horizon separate and preserves scheduled and material rare events',()=>{
 const s={automaticBasic:true,speedProfile:'FAST'},m=machine('a',3),run={durationSeconds:86400,tickSeconds:.25,reliabilityEnabled:false,commands:[]};
 assert.equal(scenarioSearchRun(run,'MEDIUM',false,3,s,[m]).scenarioFidelity,'FLUID_SCREEN_V1');
 assert.equal(scenarioSearchRun(run,'MEDIUM','ranking',3,s,[m]).numericalResolution,'FAST');
 assert.equal(scenarioSearchRun(run,'MEDIUM','validation',6,s,[m]).durationSeconds,3600);
 assert.equal(scenarioSearchRun(run,'MEDIUM','validation',6,s,[m]).numericalResolution,'PRECISE');
 const scheduled={...run,commands:[{atVirtualSecond:7200}]};assert.equal(scenarioScreeningEligibility(scheduled,[m]).supported,false);assert.equal(basicScenarioConfirmationHorizon(scheduled,[m]).seconds,86400);
 const rare={...m,noiseProfile:{reliability:{mtbfMinutes:120,mttrMinutes:10}}};
 assert.equal(basicScenarioConfirmationHorizon({...run,reliabilityEnabled:true},[rare]).seconds,7200);
 assert.equal(scenarioSearchRun(run,'MEDIUM','validation',6,{},[m]).durationSeconds,86400);
});
test('Basic rejects low-fidelity confirmation evidence',()=>{
 const metrics={scenarioFidelity:'FLUID_SCREEN_V1',durationSeconds:3600,unitOfFlow:'bottles',throughput:100,oee:70,roundMetrics:[1,2,3].map(seed=>({seed,durationSeconds:3600,throughput:100,oee:70}))};
 assert.equal(assessScenarioConfirmation(metrics,metrics,{automaticBasic:true},{}).passed,false);
});


test('warmup is simulated but excluded from measured production and conserves inventory',()=>{
 const s=fixture(),input={case:{id:s.id,unitOfFlow:s.unitOfFlow||'bottles',equipment:s.equipment},run:{...s.dynamicConfig,durationSeconds:1800,seed:23,scenarioWarmupSeconds:300}};
 const result=simulateScenarioFluidRound(input).result;
 assert.equal(result.durationSeconds,1800);assert.equal(result.screeningWarmupSeconds,300);assert(result.summary.materialBalance.initialInventoryUnits>0);assert(Math.abs(result.summary.materialBalance.residualUnits)<1e-4);
});
test('Zero can screen six packages and select four atomic factorial factors',()=>{
 const targets=Array.from({length:6},(_,i)=>({priority:10-i,change:{equipmentId:'e'+i,path:'processData.accumulation.blockedTimeDelaySeconds',before:1,after:2,originTier:'ZERO'}}));
 const plan=planBasicScenarioSearch(targets,{tier:'ZERO',maxFactors:4,screeningLimit:16});assert.equal(plan.screeningPackages.length,6);assert.equal(plan.maximumDesignPoints,16);
 assert.throws(()=>planBasicScenarioSearch(targets,{tier:'MEDIUM',maxFactors:4}),/SCENARIO_INVALID_BASIC_FACTOR_LIMIT/);
});
test('original verification uses saved source, exact seed and candidate signature; no gain is rejected',()=>{
 const sim=fixture();sim.unitOfFlow=sim.unitOfFlow||'bottles';const run={...sim.dynamicConfig,durationSeconds:28800,rounds:1,seed:23};sim.dynamicConfig=run;
 sim.results={seed:23,durationSeconds:28800,unitOfFlow:sim.unitOfFlow,replicationStatus:{state:'COMPLETE',rounds:1},summary:{lineOeePercent:75,outputCount:86400}};
 sim.results.inputSignature=canonicalSimulationInputSignature({case:sim,run});
 const plan=scenarioOriginalVerificationPlan(sim);assert(plan.ready);assert.equal(plan.run.seed,23);assert.equal(plan.baseline.throughput,180);
 const equipment=sim.equipment.find(e=>e.noiseProfile?.reliability),changes=[{equipmentId:equipment.id,path:'noiseProfile.reliability.mtbfMinutes',before:equipment.noiseProfile.reliability.mtbfMinutes,after:equipment.noiseProfile.reliability.mtbfMinutes*2,external:true,analysisOnly:true,interventionType:'SENSITIVITY',originTier:'ZERO',justification:'Exploratory target'}];
 const model=applyScenarioChanges(sim,changes,{previewOnly:true}),signature=canonicalSimulationInputSignature({case:{equipment:model.equipment,unitOfFlow:plan.inputUnit},run:plan.run});
 const candidate={...plan.baseline,oee:80,throughput:192,roundMetrics:[{seed:23,durationSeconds:28800,outputCount:92160,oee:80,throughput:192}],inputSignature:signature};
 assert(assessScenarioOriginalVerification(sim,candidate,changes).passed);assert(!assessScenarioOriginalVerification(sim,{...candidate,inputSignature:'wrong'},changes).passed);assert(!assessScenarioOriginalVerification(sim,{...candidate,roundMetrics:[{...candidate.roundMetrics[0],seed:42}]},changes).passed);
 assert.equal(assessScenarioOriginalVerification(sim,{...plan.baseline,inputSignature:signature},changes).status,'NO_ORIGINAL_HORIZON_IMPROVEMENT');
});
