import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyScenarioChanges,diagnoseScenarioLosses,planScenarios,scenarioStopDataCoverage} from '../src/analysis/ScenarioPlanner.js';
import {searchReliabilityTargets} from '../src/analysis/ReliabilityTargetSearch.js';
import {simulateBatch} from '../src/simulation/SimulationBatch.js';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
import {scenarioEvidenceInput,simulatedEvidence} from './helpers/ScenarioEvidenceFixture.js';

function engineeringFixture(){
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('apps-script/DemoCaseFactory.gs','utf8'),context);
  return {id:'stop-class-line',equipment:JSON.parse(JSON.stringify(context.createDemoCaseRequest_().equipment)),dynamicConfig:{durationSeconds:120,tickSeconds:.25,sampleEverySeconds:5,rounds:3,seed:51,commands:[]},results:null};
}
function setObserved(sim,id,values){
  for(const [key,mean] of Object.entries(values))sim.results.batch.equipmentStatistics[id][key]={...sim.results.batch.equipmentStatistics[id][key],mean};
}

test('short aggregate MTTR remains unclassified and does not create a minor-stop buffer target',()=>{
  const sim=engineeringFixture(),upstream=sim.equipment[0];
  upstream.noiseProfile.reliability={mtbfMinutes:2,mttrMinutes:.05};delete upstream.processData.equipment.stopInputs;
  const before=structuredClone(sim),coverage=scenarioStopDataCoverage(sim,upstream),plan=planScenarios(sim);
  assert.equal(coverage.mode,'GENERAL');assert.equal(coverage.classesInferred,false);
  assert.equal(coverage.classSpecificAnalysisAvailable,false);assert.equal(coverage.breakdownRequiredForClassSpecificAttribution,true);
  const check=plan.checks.find(item=>item.rule==='ACCUMULATION_1_TO_2_MTTR'&&item.referenceEquipmentId===upstream.id);
  assert(check);assert.equal(check.coverage,null);assert.equal(check.basis,'MINOR_STOP_INPUT_REQUIRED');
  assert(plan.checks.some(item=>item.equipmentId===upstream.id&&item.rule==='STOP_CLASS_BREAKDOWN_REQUIRED_FOR_TARGETED_DIAGNOSIS'&&!item.blocksFlowOptimization));
  assert(plan.candidates.some(candidate=>candidate.tier==='ZERO'&&candidate.canApply));
  assert.deepEqual(sim,before);
});

test('buffer sizing uses declared minor MTTR even when major stops dominate the aggregate',()=>{
  const sim=engineeringFixture(),upstream=sim.equipment[0];
  upstream.processData.equipment.stopInputs={minor:{mtbfMinutes:1,mttrMinutes:.1},major:{mtbfMinutes:10,mttrMinutes:60}};
  upstream.noiseProfile.reliability={mtbfMinutes:1/1.1,mttrMinutes:6.1/1.1};
  let plan=planScenarios(sim),check=plan.checks.find(item=>item.rule==='ACCUMULATION_1_TO_2_MTTR'&&item.referenceEquipmentId===upstream.id);
  assert.equal(check.mttrMinutes,.1);assert.equal(check.stopClass,'MINOR');assert(Number.isFinite(check.coverage));
  assert(plan.checks.some(item=>item.rule==='MAJOR_STOPS_REQUIRE_CAUSE_AND_INTERVENTION_REVIEW'&&item.equipmentId===upstream.id&&item.replacementRequired===null));
  sim.dynamicConfig.reliabilityCategories={minor:false};plan=planScenarios(sim);
  check=plan.checks.find(item=>item.rule==='ACCUMULATION_1_TO_2_MTTR'&&item.referenceEquipmentId===upstream.id);
  assert.equal(check.coverage,null,'a disabled minor class cannot be used as an active buffer target');
});

test('real replicated diagnosis keeps minor/major reliability events distinct from MICRO_STOP',async()=>{
  const sim=scenarioEvidenceInput(),upstream=sim.equipment[0];
  upstream.processData.equipment.stopInputs={minor:{mtbfMinutes:.25,mttrMinutes:.025},major:{mtbfMinutes:1,mttrMinutes:.15}};
  upstream.noiseProfile.microStop={probabilityPerMinute:6,minDurationSeconds:.25,maxDurationSeconds:.5};
  const input={case:sim,run:sim.dynamicConfig},response=await simulateBatch(input,{summaryOnly:true});
  assert(response.ok,JSON.stringify(response.error));
  sim.results={...response.result,inputSignature:canonicalSimulationInputSignature(input),replicationStatus:{state:'COMPLETE',rounds:3,baseSeed:51}};
  const diagnosis=diagnoseScenarioLosses(sim),row=diagnosis.equipment.find(item=>item.equipmentId===upstream.id);
  assert.equal(diagnosis.status,'OBSERVED');assert.equal(row.stopDataCoverage.mode,'SPLIT');
  assert.equal(row.stopDataCoverage.classSpecificAnalysisAvailable,true);assert.equal(row.generalFailureSeconds,0);
  assert(row.minorFailureSeconds>0);assert(row.majorFailureSeconds>0);assert(row.microStopSeconds>0);
  assert(Math.abs(row.failureSeconds-row.minorFailureSeconds-row.majorFailureSeconds)<1e-6);
  assert.equal(row.ownStopSeconds,row.failureSeconds+row.microStopSeconds);
  assert(diagnosis.opportunities.some(item=>item.kind==='SHORT_STOP_FLOW_RECOVERY'&&item.equipmentId===upstream.id));
  assert(diagnosis.opportunities.some(item=>item.kind==='MAJOR_STOP_CAUSE_REVIEW'&&item.equipmentId===upstream.id));
  assert.deepEqual(diagnosis.stopDataQuality.splitEquipmentIds,[upstream.id]);
  delete sim.results.batch.equipmentStatistics[upstream.id].minorFailureSeconds;
  const incomplete=diagnoseScenarioLosses(sim).equipment.find(item=>item.equipmentId===upstream.id);
  assert.equal(incomplete.minorFailureSeconds,null);assert.equal(incomplete.stopDataCoverage.classSpecificAnalysisAvailable,false);
});

test('major and general own-stop time cannot inflate flow-adjustment priority',async()=>{
  const sim=await simulatedEvidence();
  for(const id of ['upstream','reference'])setObserved(sim,id,{failureSeconds:0,minorFailureSeconds:0,majorFailureSeconds:0,generalFailureSeconds:0,microStopSeconds:0,starvedSeconds:0,blockedSeconds:0});
  const candidate=()=>planScenarios(sim).candidates.find(item=>item.kind==='V_CURVE'&&item.equipmentId==='upstream');
  assert(candidate());const baselinePriority=candidate().priority;
  setObserved(sim,'upstream',{failureSeconds:90,generalFailureSeconds:90});
  assert.equal(candidate().priority,baselinePriority);
  setObserved(sim,'upstream',{generalFailureSeconds:0,majorFailureSeconds:90});
  assert.equal(candidate().priority,baselinePriority);
  setObserved(sim,'upstream',{failureSeconds:0,majorFailureSeconds:0,microStopSeconds:30});
  assert(candidate().priority>baselinePriority);
  assert.equal(candidate().evidence.reliabilityParametersChanged,false);
});

test('sensor adjustments retain the exact supplied minor and major failure profiles',()=>{
  const sim=engineeringFixture(),upstream=sim.equipment[0];
  upstream.processData.equipment.stopInputs={minor:{mtbfMinutes:1,mttrMinutes:.1},major:{mtbfMinutes:10,mttrMinutes:60}};
  upstream.noiseProfile.reliability={mtbfMinutes:1/1.1,mttrMinutes:6.1/1.1};
  const candidate=planScenarios(sim).candidates.find(item=>item.kind==='SENSOR_WINDOW'&&item.canApply);
  assert(candidate);const changed=applyScenarioChanges(sim,candidate.changes);
  assert.deepEqual(changed.equipment[0].noiseProfile,upstream.noiseProfile);
  assert.deepEqual(changed.equipment[0].processData.equipment.stopInputs,upstream.processData.equipment.stopInputs);
  assert.equal(candidate.evidence.classificationBasis,'INTERVENTION_SCOPE');assert.equal(candidate.evidence.budgetUsed,false);
});

test('recovery within the installed conveyor length does not create a High CAPEX sensor-only project',()=>{
  const sim=engineeringFixture(),plan=planScenarios(sim);
  for(const candidate of plan.candidates.filter(item=>item.kind==='BUFFER_RECOVERY'&&item.tier==='HIGH')){
    assert(candidate.changes.some(change=>change.path==='processData.geometry.lactMm'&&change.after>change.before));
  }
  const recovered=plan.checks.filter(item=>item.rule==='RECOVERY_WITHIN_INSTALLED_LENGTH');
  assert(recovered.length>0,'fixture exercises a buffer calculation requiring only existing length');
  for(const check of recovered){
    assert.equal(check.classification,'ZERO');
    assert(!plan.candidates.some(item=>item.kind==='BUFFER_RECOVERY'&&item.equipmentId===check.equipmentId));
    assert(plan.candidates.some(item=>item.kind==='SENSOR_POSITION'&&item.equipmentId===check.equipmentId&&item.tier==='ZERO'));
  }
});

test('reliability target priority excludes the unrelated MICRO_STOP process',async()=>{
  const sim=await simulatedEvidence();
  setObserved(sim,'upstream',{failureSeconds:0,microStopSeconds:80});setObserved(sim,'reference',{failureSeconds:30,microStopSeconds:0});
  const report=await searchReliabilityTargets(sim,{run:sim.dynamicConfig,maximumMachines:1,maximumTargets:1,
    measure:async(model,changes)=>({throughput:100+changes.length,oee:50+changes.length/2,warnings:[]})});
  assert.deepEqual(report.equipmentIds,['reference']);
  assert.equal(report.coverage.selectionEvidence[0].observedFailureSeconds,30);
  assert.equal(report.coverage.selectionEvidence[0].stopDataCoverage.mode,'GENERAL');
  assert.equal(report.ranking[0].targetScope,'GENERAL_UNCLASSIFIED');
  assert(report.targetTests.every(item=>item.targetScope==='GENERAL_UNCLASSIFIED'));
});
