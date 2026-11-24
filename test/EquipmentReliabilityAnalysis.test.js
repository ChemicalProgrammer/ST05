import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentReliabilityAssessment as assess,analyzeEquipmentReliability as analyze} from '../src/analysis/ScenarioPlanner.js';
const machine=(bf,tr)=>({id:'a',type:'FILLER',name:'Filler',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:bf,mttrMinutes:tr}}});
test('availability, targets and replacement review remain separate',()=>{
  const r=assess(machine(20,10));
  assert.ok(Math.abs(r.availability-2/3)<1e-12);
  assert.ok(Math.abs(r.requiredMtbfMinutes-190)<1e-9);
  assert.ok(Math.abs(r.requiredMttrMinutes-20/19)<1e-9);
  assert.equal(r.status,'FAIL');assert.equal(r.action,'IMPROVE_MTBF');assert.equal(r.replacementRequired,null);
  assert.equal(assess(machine(20,11)).action,'REBUILD_OR_REPLACE_REVIEW');
  assert.equal(assess(machine(900,1)).status,'PASS');
  assert.equal(assess(machine(20,.1)).status,'REVIEW');
  assert.equal(assess(machine(900,50)).action,'IMPROVE_MTTR');
});
test('missing, invalid, disabled and split reliability inputs',()=>{
  assert.equal(assess({type:'FILLER'}).status,'NOT EVALUATED');
  assert.equal(assess(machine(20,0)).reason,'INVALID_INPUTS');
  assert.equal(assess(machine(20,2),{reliabilityEnabled:false}).reason,'FAILURES_DISABLED');
  assert.equal(assess(machine(20,2),{reliabilityCategories:{general:false}}).reason,'CATEGORIES_DISABLED');
  const e=machine(1,1);e.processData={equipment:{stopInputs:{minor:{mtbfMinutes:30,mttrMinutes:1},major:{mtbfMinutes:90,mttrMinutes:13}}}};
  const both=assess(e),minor=assess(e,{reliabilityCategories:{major:false}});
  assert.ok(Math.abs(both.mtbfMinutes-22.5)<1e-10);
  assert.ok(Math.abs(both.mttrMinutes-4)<1e-10);
  assert.equal(minor.mtbfMinutes,30);assert.equal(minor.mttrMinutes,1);
  assert.equal(assess(e,{reliabilityCategories:{minor:false,major:false}}).reason,'CATEGORIES_DISABLED');
});
test('observed own losses and buffer coverage are separate from the static verdict',()=>{
  const sim={equipment:[machine(20,10)]};
  const r=analyze(sim,'a',{observed:{durationSeconds:3600,failureSeconds:600,failureCount:2,starvedSeconds:180,reliabilityExposureSeconds:1200},
    audits:[{equipmentId:'c',upstreamId:'a',engineering:{calculated:{antiStarveSeconds:120}}}]});
  assert.equal(r.observed.failureCount,2);assert.equal(r.observed.observedExposurePerFailureMinutes,10);
  assert.equal(r.observed.observedFaultTimePerFailureMinutes,5);
  assert.equal(r.bufferCoverage[0].ratio,null);assert.equal(r.bufferCoverage[1].ratio,.2);assert.equal(r.bufferCoverage[1].status,'FAIL');
  assert.equal(r.counterfactual,null);assert.equal(r.replacementRequired,null);
});
