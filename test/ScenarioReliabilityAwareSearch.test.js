import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioSearchProfile,scenarioSearchRun,planScenarioFinalistRanking} from '../src/analysis/ScenarioSearch.js';
const equipment=[13.6,10.5,38.2].map(mtbfMinutes=>({type:'MACHINE',noiseProfile:{reliability:{mtbfMinutes,mttrMinutes:1}}}));
const run={durationSeconds:86400,durationMode:'FIXED',tickSeconds:.25,commands:[],reliabilityEnabled:true};
const settings={speedProfile:'FAST'};
test('a long unreliable production line receives a reliability-aware exploration and intermediate comparison horizon',()=>{
  const p=scenarioSearchProfile('LIGHT',settings,{run,equipment});
  assert.equal(p.explorationSeconds,1800);assert.equal(p.confirmationSeconds,3600);assert.equal(p.fullHorizonFinalists,2);
  assert.equal(p.maxCandidates,48);assert.equal(p.maxFactors,0);
  assert.equal(scenarioSearchRun(run,'LIGHT',false,3,settings,equipment).durationSeconds,1800);
  const plan=planScenarioFinalistRanking(run,'LIGHT',5,{searchSettings:settings,equipment});
  assert.equal(plan.screenRun.durationSeconds,3600);assert.equal(plan.fullRun.durationSeconds,86400);assert.equal(plan.fullHorizonFinalists,2);
  assert.equal(scenarioSearchRun(run,'LIGHT','validation',7,settings,equipment).rounds,7);
});
test('no artificial extension for a failure-free or short run',()=>{
  assert.equal(scenarioSearchProfile('LIGHT',settings,{run:{...run,reliabilityEnabled:false},equipment}).explorationSeconds,300);
  assert.equal(scenarioSearchProfile('LIGHT',settings,{run,equipment:[]}).explorationSeconds,300);
  assert.equal(scenarioSearchProfile('LIGHT',settings,{run:{...run,durationSeconds:600},equipment}).explorationSeconds,600);
});
