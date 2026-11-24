import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {simulateLine,simulateLineAsync,createLinePlaybackSession,resolveSimulationNumerics} from '../src/simulation/LineSimulationEngine.js';
import {simulateBatch} from '../src/simulation/SimulationBatch.js';
import {validateSimulationInput} from '../src/simulation/SimulationValidation.js';

const reference=JSON.parse(fs.readFileSync(new URL('./fixtures/conveyor-tick-reference.json',import.meta.url),'utf8')).cases[0];
function input(overrides={}){
  const data=structuredClone(reference.input);
  data.run={...data.run,durationSeconds:4,commands:[],...overrides};
  return data;
}
function projection(frame){
  return JSON.parse(JSON.stringify([frame.virtualSecond,frame.outputCount,frame.effectiveRuntimeSeconds,
    frame.runtimeLossSeconds,frame.buffers,
    frame.equipment.map(unit=>[unit.id,unit.outputCount,unit.internalInventoryBottles,
      unit.availabilityState,unit.stateSeconds,unit.failureCount,unit.startRampSeconds]),
    frame.accumulationZones.map(zone=>[zone.id,zone.waitingUnits,zone.inTransitUnits,
      zone.inventoryUnits,zone.backup,zone.prime,zone.transitPositionsMm])]));
}

test('resolution applies to every round and playback while respecting an already finer tick',async()=>{
  for(const [numericalResolution,tickSeconds] of [['PRECISE',1/120],['BALANCED',1/60],['FAST',1/20]]){
    const data=input({numericalResolution,rounds:3,calculationMode:'SUMMARY'});
    const result=await simulateBatch(data,{summaryOnly:true,workerFirstRound:true,
      runRound:(next,options)=>simulateLineAsync(next,{...options,yieldBetweenChunks:false})});
    assert(result.ok,JSON.stringify(result.error));
    assert.equal(result.result.durationSeconds,4);
    assert.deepEqual(result.result.batch.rows.map(row=>row.seed),[7,8,9]);
    for(const row of result.result.batch.rows){
      assert.equal(row.numerics.resolution,numericalResolution);
      assert.equal(row.numerics.requestedTickSeconds,.25);
      assert.equal(row.numerics.effectiveTickSeconds,tickSeconds);
      assert.equal(row.numerics.coarserThanPrecise,numericalResolution!=='PRECISE');
    }
    assert.equal(createLinePlaybackSession(data).tickSeconds,tickSeconds);
  }
  assert.equal(resolveSimulationNumerics(input({numericalResolution:'FAST',tickSeconds:.001}).run).effectiveTickSeconds,.001);
  assert.equal(resolveSimulationNumerics(input({numericalResolution:'FAST',machineResidenceEnabled:false}).run).effectiveTickSeconds,.25);
  const invalid=validateSimulationInput(input({numericalResolution:'QUICK'}));
  assert.equal(invalid.ok,false);
  assert(invalid.error.details.some(detail=>detail.path==='run.numericalResolution'));
});

test('missing or explicit PRECISE preserves the captured historical physical trajectory',()=>{
  for(const numericalResolution of [undefined,'PRECISE']){
    const data=structuredClone(reference.input);data.run.numericalResolution=numericalResolution;
    const session=createLinePlaybackSession(data);
    assert.equal(session.tickSeconds,1/120);
    const final=reference.expected.at(-1);
    while(!session.finished)session.advanceTo(final[0],{budgetMs:1000,maxTicks:10000});
    assert.deepEqual(projection(session.snapshot()),final);
  }
});

test('reusing a first round rejects mixed numerical resolutions and retains legacy or SimPy compatibility',async()=>{
  const data=input({rounds:1}),first=simulateLine(data).result;
  const compact={summaryOnly:true,firstResult:first};
  const accepted=await simulateBatch({...data,run:{...data.run,numericalResolution:'PRECISE'}},compact);
  assert.equal(accepted.ok,true);
  await assert.rejects(simulateBatch({...data,run:{...data.run,numericalResolution:'FAST'}},compact),/BATCH_FIRST_RESULT_RESOLUTION_MISMATCH/);
  const legacy=structuredClone(first);delete legacy.numerics;
  assert.equal((await simulateBatch(data,{summaryOnly:true,firstResult:legacy})).ok,true);
  await assert.rejects(simulateBatch({...data,run:{...data.run,numericalResolution:'BALANCED'}},{summaryOnly:true,firstResult:legacy}),/BATCH_FIRST_RESULT_RESOLUTION_MISMATCH/);
  assert.equal((await simulateBatch({...data,run:{...data.run,engineId:'DES_SIMPY_EXPERIMENTAL',numericalResolution:'FAST'}},{summaryOnly:true,firstResult:legacy})).ok,true);
});

test('SUMMARY avoids an extra full-duration replay while other modes retain it and identical statistics',async()=>{
  const results=[];
  for(const calculationMode of ['SUMMARY','FAST']){
    const data=input({rounds:3,calculationMode}),calls=[];
    const response=await simulateBatch(data,{laterSummaryOnly:true,workerFirstRound:true,
      runRound:async(next,options)=>{
        calls.push({seed:next.run.seed,summaryOnly:options.summaryOnly});
        const output=[0,10,11][next.run.seed-7];
        return {ok:true,result:{seed:next.run.seed,durationSeconds:next.run.durationSeconds,
          numerics:resolveSimulationNumerics(next.run),summary:{outputCount:output,lineOeePercent:output},
          equipmentMetrics:{},accumulationZoneMetrics:{},samples:options.summaryOnly?[]:[{virtualSecond:4}]}};
      }});
    assert.equal(response.result.batch.representativeRound,2);
    assert.equal(calls.length,calculationMode==='SUMMARY'?3:4);
    assert.equal(Boolean(response.result.batch.representativeReplay),calculationMode!=='SUMMARY');
    results.push(response.result.batch.statistics);
  }
  assert.deepEqual(results[0],results[1]);
});
