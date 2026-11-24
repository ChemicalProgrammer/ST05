import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {diagnoseScenarioLosses,planScenarios} from '../src/analysis/ScenarioPlanner.js';
import {simulatedEvidence} from './helpers/ScenarioEvidenceFixture.js';

function historicalDemo(){const context=vm.createContext({Utilities:{base64Decode:s=>Buffer.from(s,'base64'),newBlob:b=>b,ungzip:b=>({getDataAsString:()=>gunzipSync(b).toString('utf8')})}});for(const file of ['DemoCaseFactory.gs','DemoResults.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),context);return JSON.parse(JSON.stringify(context.createDemoCaseRequest_().simulations[0]));}

test('current engine replication means feed diagnosis with compatible canonical provenance',async()=>{
  const sim=await simulatedEvidence(),before=structuredClone(sim),d=diagnoseScenarioLosses(sim);
  assert.equal(d.status,'OBSERVED');assert.equal(d.sourceStatus,'CURRENT');assert.equal(d.referenceId,'reference');
  for(const row of d.equipment){
    const stats=sim.results.batch.equipmentStatistics[row.equipmentId];
    assert.equal(row.failureSeconds,stats.failureSeconds.mean);
    assert.equal(row.failureCount,stats.failureCount.mean);
    assert.equal(row.starvedSeconds,stats.starvedSeconds.mean);
    assert.equal(row.countBasis,'MEAN_PER_REPLICATION');
    assert.equal(row.microStopCount,null,'the engine does not record microstop event counts');
  }
  assert(d.equipment.some(row=>row.failureCount>0));
  assert(d.equipment.every(row=>row.equipmentId!=='belt'));
  assert.equal(planScenarios(sim).hasDynamicEvidence,true);
  assert.deepEqual(sim,before);
});

test('changed equipment, run, unit, engine and incomplete results cannot drive diagnostic priorities',async()=>{
  const base=await simulatedEvidence();
  const cases=[
    [s=>s.equipment[0].nominalRatePerSecond+=1,'EQUIPMENT_CHANGED'],
    [s=>s.dynamicConfig.seed++,'RUN_CONFIGURATION_CHANGED'],
    [s=>s.dynamicConfig.commands.push({atVirtualSecond:10,equipmentId:'upstream',action:'STOP'}),'RUN_CONFIGURATION_CHANGED'],
    [s=>s.unitOfFlow='cases','FLOW_UNIT_CHANGED'],
    [s=>s.dynamicConfig.engineId='DES_SIMPY_EXPERIMENTAL','ENGINE_MISMATCH'],
    [s=>s.results.replicationStatus.state='PENDING','INCOMPLETE_REPLICATIONS'],
    [s=>delete s.results.inputSignature,'MISSING_INPUT_SIGNATURE']
  ];
  for(const [mutate,reason] of cases){
    const sim=structuredClone(base);mutate(sim);
    const diagnosis=diagnoseScenarioLosses(sim);assert.equal(diagnosis.status,'NO_COMPATIBLE_RESULTS');assert.equal(diagnosis.reason,reason);
    const plan=planScenarios(sim);assert.equal(plan.hasDynamicEvidence,false);assert(plan.candidates.every(p=>p.evidence.priorityBonus===0));
  }
});

test('legacy prepared demo evidence stays historical instead of being relabeled as a current run',()=>{
  const sim=historicalDemo(),signature=sim.results.inputSignature,d=diagnoseScenarioLosses(sim);
  assert.equal(d.status,'NO_COMPATIBLE_RESULTS');assert.equal(d.sourceStatus,'HISTORICAL');assert.equal(d.reason,'PROVENANCE_VERSION_MISMATCH');
  assert.equal(sim.results.inputSignature,signature);assert.equal(planScenarios(sim).hasDynamicEvidence,false);
  assert.equal(diagnoseScenarioLosses({...sim,results:null}).reason,'NO_RESULTS');
});

test('loss rankings keep frequency, duration and propagated states separate without additive attribution',async()=>{
  const sim=await simulatedEvidence();
  // Controlled report fixture for overlapping equipment states, not a new
  // simulated production result: each state is a per-replication mean.
  for(const [id,values] of Object.entries({upstream:{failureSeconds:40,microStopSeconds:0,failureCount:2,starvedSeconds:0,blockedSeconds:50},reference:{failureSeconds:10,microStopSeconds:0,failureCount:8,starvedSeconds:60,blockedSeconds:0}})){
    for(const [key,value] of Object.entries(values))sim.results.batch.equipmentStatistics[id][key].mean=value;
  }
  const d=diagnoseScenarioLosses(sim);
  assert.equal(d.rankings.ownStopDuration[0].equipmentId,'upstream');
  assert.equal(d.rankings.failureFrequency[0].equipmentId,'reference');
  assert.equal(d.rankings.starvationDuration[0].equipmentId,'reference');
  assert.equal(d.rankings.blockingDuration[0].equipmentId,'upstream');
  assert.equal(d.attribution.additive,false);assert.equal(d.attribution.causalStatus,'NOT_ESTABLISHED');
  assert(d.opportunities.some(row=>row.kind==='UPSTREAM_SUPPLY_OR_BUFFER'&&row.equipmentId==='reference'));
  assert(d.opportunities.every(row=>row.evidenceLevel==='HYPOTHESIS'&&row.causalStatus==='NOT_ESTABLISHED'));
  assert.equal(d.rankings.microStopFrequency.length,0,'missing incidence counts are not invented from duration');
});

test('missing replicated metrics stay missing instead of falling back to the first round',async()=>{
  const sim=await simulatedEvidence();delete sim.results.batch.equipmentStatistics.upstream.failureCount;
  delete sim.results.batch.equipmentStatistics.upstream.microStopSeconds;
  const row=diagnoseScenarioLosses(sim).equipment.find(row=>row.equipmentId==='upstream');
  assert(sim.results.equipmentMetrics.upstream.failureCount>0);assert.equal(row.failureCount,null);
  assert.equal(row.ownStopSeconds,null);assert.equal(row.ownStopPercent,null);assert.equal(row.dataCoverage.ownStopDuration,false);
});
