import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioSourceReadiness} from '../src/analysis/ScenarioReadiness.js';
import {simulateBatch} from '../src/simulation/SimulationBatch.js';
import {simulateLineAsync} from '../src/simulation/LineSimulationEngine.js';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';
import {scenarioEvidenceInput,simulatedEvidence} from './helpers/ScenarioEvidenceFixture.js';

async function evidenceFor(run,unbatched=false){
  const simulation=scenarioEvidenceInput();
  Object.assign(simulation.dynamicConfig,run);
  const input={case:simulation,run:simulation.dynamicConfig};
  const response=unbatched?await simulateLineAsync(input,{summaryOnly:true,yieldBetweenChunks:false}):
    await simulateBatch(input,{summaryOnly:true});
  assert.equal(response.ok,true,JSON.stringify(response.error));
  simulation.results={...response.result,inputSignature:canonicalSimulationInputSignature(input),
    replicationStatus:{state:'COMPLETE',rounds:input.run.rounds,baseSeed:input.run.seed}};
  return simulation;
}

test('complete current numerical replications enable scenarios without mutating evidence',async()=>{
  const simulation=await simulatedEvidence(),before=JSON.stringify(simulation);
  assert.deepEqual(scenarioSourceReadiness(simulation),{
    ready:true,reason:null,sourceStatus:'CURRENT',rounds:3,completedRounds:3,
    unitOfFlow:'bottles',comparisonBasis:'FIXED_CALENDAR_HORIZON'
  });
  assert.equal(JSON.stringify(simulation),before);
});

test('missing, calculating, pending and cancelled numerical results cannot enable scenarios',async()=>{
  for(const simulation of [undefined,{},scenarioEvidenceInput(),{results:{}},{results:{summary:null}}])
    assert.equal(scenarioSourceReadiness(simulation).reason,'NO_RESULTS');
  const source=await simulatedEvidence();
  for(const state of ['CALCULATING','PENDING','CANCELLED','FAILED','RUNNING',undefined]){
    const simulation=structuredClone(source);
    simulation.results.replicationStatus={state,rounds:3,baseSeed:51};
    const readiness=scenarioSourceReadiness(simulation);
    assert.equal(readiness.ready,false,state);assert.equal(readiness.reason,'INCOMPLETE_REPLICATIONS');
  }
});

test('a COMPLETE label cannot substitute for all requested distinct replication rows',async()=>{
  const source=await simulatedEvidence();
  for(const damage of [
    simulation=>simulation.results.batch.rows.pop(),
    simulation=>simulation.results.batch.rows.push(structuredClone(simulation.results.batch.rows[0])),
    simulation=>{simulation.results.batch.rows=[];},
    simulation=>{simulation.results.batch.rows={};}
  ]){
    const simulation=structuredClone(source);damage(simulation);
    assert.equal(scenarioSourceReadiness(simulation).reason,'INCOMPLETE_REPLICATION_ROWS');
  }
  const duplicate=structuredClone(source);duplicate.results.batch.rows[1].seed=duplicate.results.batch.rows[0].seed;
  assert.equal(scenarioSourceReadiness(duplicate).reason,'REPLICATION_SEEDS_MISMATCH');
});

test('replication seeds must match the requested sequence, including unsigned wrapping',async()=>{
  const source=await simulatedEvidence();
  for(const seed of [52.5,-1,999,NaN,Infinity,null]){
    const simulation=structuredClone(source);simulation.results.batch.rows[0].seed=seed;
    assert.equal(scenarioSourceReadiness(simulation).reason,'REPLICATION_SEEDS_MISMATCH');
  }
  const wrapping=await evidenceFor({durationSeconds:5,seed:4294967295,rounds:3});
  assert.deepEqual(wrapping.results.batch.rows.map(row=>row.seed),[4294967295,0,1]);
  assert.equal(scenarioSourceReadiness(wrapping).ready,true);
});

test('inconsistent round headers and invalid numerical row metrics remain incomplete',async()=>{
  const source=await simulatedEvidence();
  for(const damage of [
    simulation=>{simulation.results.replicationStatus.rounds=2;},
    simulation=>{simulation.results.batch.rounds=2;}
  ]){
    const simulation=structuredClone(source);damage(simulation);
    assert.equal(scenarioSourceReadiness(simulation).reason,'REPLICATION_COUNT_MISMATCH');
  }
  for(const damage of [
    simulation=>{simulation.results.batch.rows[1].summary=null;},
    simulation=>{simulation.results.batch.rows[1].summary.lineOeePercent=NaN;},
    simulation=>{simulation.results.batch.rows[1].summary.outputCount=-1;}
  ]){
    const simulation=structuredClone(source);damage(simulation);
    assert.equal(scenarioSourceReadiness(simulation).reason,'INVALID_REPLICATION_METRICS');
  }
});

test('every fixed-horizon round must reach the configured calendar duration',async()=>{
  const source=await simulatedEvidence();
  for(const damage of [
    simulation=>{simulation.results.durationSeconds=60;},
    simulation=>{simulation.results.batch.rows[1].durationSeconds=60;},
    simulation=>{simulation.results.batch.rows[1].durationSeconds=121;},
    simulation=>{simulation.results.batch.rows[1].durationSeconds=NaN;}
  ]){
    const simulation=structuredClone(source);damage(simulation);
    assert.equal(scenarioSourceReadiness(simulation).reason,'INCOMPLETE_REPLICATION_HORIZON');
  }
});

test('changed equipment, settings, flow units and model versions invalidate the previous result',async()=>{
  const source=await simulatedEvidence();
  for(const [damage,reason] of [
    [simulation=>{simulation.equipment[0].nominalRatePerSecond+=.1;},'EQUIPMENT_CHANGED'],
    [simulation=>{simulation.dynamicConfig.seed++;},'RUN_CONFIGURATION_CHANGED'],
    [simulation=>{simulation.dynamicConfig.tickSeconds=.5;},'RUN_CONFIGURATION_CHANGED'],
    [simulation=>{simulation.dynamicConfig.reliabilityCategories={minor:false,major:true};},'RUN_CONFIGURATION_CHANGED'],
    [simulation=>{simulation.unitOfFlow='cases';},'FLOW_UNIT_CHANGED'],
    [simulation=>{simulation.dynamicConfig.engineId='DES_SIMPY_EXPERIMENTAL';},'ENGINE_MISMATCH'],
    [simulation=>{const p=JSON.parse(simulation.results.inputSignature);p.version='historical';simulation.results.inputSignature=JSON.stringify(p);},'PROVENANCE_VERSION_MISMATCH']
  ]){
    const simulation=structuredClone(source);damage(simulation);
    assert.equal(scenarioSourceReadiness(simulation).reason,reason);
  }
});

test('missing or malformed provenance cannot make a saved result current',async()=>{
  const source=await simulatedEvidence();
  for(const [signature,reason] of [[null,'MISSING_INPUT_SIGNATURE'],['bad json','INVALID_INPUT_SIGNATURE'],['null','INVALID_INPUT_SIGNATURE']]){
    const simulation=structuredClone(source);simulation.results.inputSignature=signature;
    assert.equal(scenarioSourceReadiness(simulation).reason,reason);
  }
});

test('a completed single round is valid without a batch wrapper',async()=>{
  const simulation=await evidenceFor({durationSeconds:10,rounds:1},true);
  assert.equal(simulation.results.batch,undefined);
  const ready=scenarioSourceReadiness(simulation);assert.equal(ready.ready,true);assert.equal(ready.rounds,1);
  simulation.results.seed++;
  assert.equal(scenarioSourceReadiness(simulation).reason,'REPLICATION_SEEDS_MISMATCH');
});

test('an actual streamed partial result stays incomplete despite a contradictory COMPLETE label',async()=>{
  const simulation=scenarioEvidenceInput();
  simulation.dynamicConfig={...simulation.dynamicConfig,durationSeconds:10,rounds:1,calculationMode:'LIVE'};
  const input={case:simulation,run:simulation.dynamicConfig};let partial;
  await simulateLineAsync(input,{yieldBetweenChunks:false,onPartial:result=>{partial??=result;}});
  assert(partial?.provisional);assert(partial.calculatedThroughSeconds<input.run.durationSeconds);
  simulation.results={...partial,inputSignature:canonicalSimulationInputSignature(input),replicationStatus:{state:'COMPLETE',rounds:1}};
  assert.equal(scenarioSourceReadiness(simulation).ready,false);
});

test('completed effective-runtime replications may finish before the calendar limit',async()=>{
  const simulation=await evidenceFor({durationSeconds:30,rounds:3,effectiveRuntimeTargetSeconds:5,reliabilityEnabled:false});
  assert(simulation.results.batch.rows.every(row=>row.effectiveRuntimeStop.status==='REACHED'&&row.durationSeconds<30));
  assert.equal(scenarioSourceReadiness(simulation).ready,true);
  assert.equal(scenarioSourceReadiness(simulation).comparisonBasis,'COMPLETED_RUNTIME_TARGET_OR_LIMIT');
  for(const damage of [
    row=>{delete row.effectiveRuntimeStop;},
    row=>{row.effectiveRuntimeStop.status='RUNNING';},
    row=>{row.effectiveRuntimeStop.accumulatedSeconds=4;},
    row=>{row.effectiveRuntimeStop.limitSeconds=60;},
    row=>{row.effectiveRuntimeStop.targetSeconds=6;},
    row=>{row.effectiveRuntimeStop.status='LIMIT_REACHED';}
  ]){
    const changed=structuredClone(simulation);damage(changed.results.batch.rows[1]);
    assert.equal(scenarioSourceReadiness(changed).reason,'INCOMPLETE_RUNTIME_TARGET');
  }
});

test('a completed runtime-limit run is valid, while a premature limit label is rejected',async()=>{
  const simulation=await evidenceFor({durationSeconds:10,rounds:2,effectiveRuntimeTargetSeconds:5,
    commands:[{atVirtualSecond:0,equipmentId:'upstream',action:'STOP'}]});
  assert(simulation.results.batch.rows.every(row=>row.effectiveRuntimeStop.status==='LIMIT_REACHED'));
  assert.equal(scenarioSourceReadiness(simulation).ready,true);
  simulation.results.batch.rows[0].durationSeconds=5;
  assert.equal(scenarioSourceReadiness(simulation).reason,'INCOMPLETE_RUNTIME_TARGET');
});
