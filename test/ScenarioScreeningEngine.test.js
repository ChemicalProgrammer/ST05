import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateScenarioFluidRound} from '../src/analysis/ScenarioScreeningEngine.js';
import {scenarioSearchRun,scenarioScreeningEligibility,basicScenarioConfirmationHorizon,assessScenarioConfirmation} from '../src/analysis/ScenarioSearch.js';
const machine=(id,rate)=>({id,name:id,type:'MACHINE',initialMode:'AUTO',nominalRatePerSecond:rate,noiseProfile:{}});
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
