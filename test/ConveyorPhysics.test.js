import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateLine } from '../src/simulation/LineSimulationEngine.js';
import { resolveAccumulationZoneDefinition } from '../src/simulation/FormatGeometryAdapter.js';

function line({speed=100,movingGap=10,packedGap=0,sourceRate=4,sinkRate=4}={}) {
  return {id:'physics',unitOfFlow:'bottles',equipment:[
    {id:'source',name:'Source',type:'FILLER',nominalRatePerSecond:sourceRate,initialMode:'AUTO'},
    {id:'belt',name:'Belt',type:'CONVEYOR',nominalRatePerSecond:999,initialMode:'AUTO',processData:{accumulation:{speedMode:'MANUAL',usableLengthMm:1000,productLengthMm:10,gapMm:10,movingGapMm:movingGap,accumulatedGapMm:packedGap,conveyorSpeedMmPerSecond:speed,primeSensorPositionMm:800,backupSensorPositionMm:200,backupRestartPositionMm:300,blockedTimeDelaySeconds:0.5,clearTimeDelaySeconds:0.5,upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:0}}},
    {id:'sink',name:'Sink',type:'CUSTOM',nominalRatePerSecond:sinkRate,initialMode:'AUTO'}
  ]};
}
function run(model, overrides={}) {
  const response=simulateLine({case:model,run:{durationSeconds:100,tickSeconds:0.25,sampleEverySeconds:0.25,seed:42,...overrides}});
  assert.equal(response.ok,true,JSON.stringify(response.error)); return response.result;
}
function conserved(result) {
  assert.ok(Math.abs(result.summary.materialBalance.residualUnits)<1e-5);
  for(const sample of result.samples) for(const z of sample.accumulationZones) {
    assert.ok(z.inventoryUnits>=-1e-6 && z.inventoryUnits<=z.capacityUnits+1e-6);
    assert.ok(Math.abs(z.inventoryUnits-z.waitingUnits-z.inTransitUnits)<2e-6);
  }
  for(const m of Object.values(result.equipmentMetrics)) assert.ok(Math.abs(Object.values(m.stateSeconds).reduce((a,b)=>a+b,0)-result.durationSeconds)<1e-5);
}

test('slower physical speed limits output independently of legacy conveyor BPM',()=>{
  const slow=run(line({speed:20})),fast=run(line({speed:100}));
  assert.ok(slow.summary.outputCount<fast.summary.outputCount);
  assert.ok(slow.summary.outputCount<=2*100);
  assert.equal(slow.accumulationZoneMetrics['belt--physical-zone'].transferCapacityPerSecond,2);
  conserved(slow);conserved(fast);
});

test('manual FlowPilot speed overrides automatic speed and survives geometry resolution',()=>{
  const model=line();model.equipment[1].processData={geometry:{lactMm:1000,lpPrimeMm:200},upstream:{packageLengthMm:10,dischargePitchMm:20},accumulation:{speedMode:'MANUAL',conveyorSpeedFactorPercent:5,conveyorSpeedMmPerSecond:40,movingGapMm:10,accumulatedGapMm:0,backupSensorPositionMm:200}};
  const {definition}=resolveAccumulationZoneDefinition(model.equipment,1);
  assert.equal(definition.conveyorSpeedMmPerSecond,40);
  assert.equal(definition.productPitchMm,10);assert.equal(definition.accumulatedPitchMm,10);assert.equal(definition.gapMm,0);
  const result=run(model);conserved(result);
  assert.equal(result.samples[0].accumulationZones[0].geometry.travelSeconds,25);
  assert.ok(result.summary.outputCount<=400);
});

test('a stopped conveyor freezes transport and prevents discharge of queued inventory',()=>{
  const result=run(line({sinkRate:1}),{commands:[{atVirtualSecond:35,equipmentId:'belt',action:'STOP'},{atVirtualSecond:50,equipmentId:'belt',action:'RUN'}]});
  const before=result.samples.find(s=>s.virtualSecond===35),after=result.samples.find(s=>s.virtualSecond===50);
  assert.ok(before.accumulationZones[0].waitingUnits>0);
  assert.equal(before.accumulationZones[0].beltRunning,true);
  assert.equal(after.accumulationZones[0].beltRunning,false);
  assert.equal(result.samples.at(-1).accumulationZones[0].beltRunning,true);
  assert.equal(after.outputCount,before.outputCount);
  assert.equal(after.accumulationZones[0].inventoryUnits,before.accumulationZones[0].inventoryUnits);
  assert.ok(result.samples.at(-1).outputCount>after.outputCount);conserved(result);
});

test('a paused downstream builds a compressed queue and restart releases it without losing material',()=>{
  const result=run(line(),{commands:[{atVirtualSecond:30,equipmentId:'sink',action:'PAUSE'},{atVirtualSecond:60,equipmentId:'sink',action:'RUN'}]});
  const queue=result.samples.find(s=>s.virtualSecond===60).accumulationZones[0];
  assert.equal(queue.capacityUnits,100);assert.equal(queue.geometry.productPitchMm,25);assert.equal(queue.geometry.accumulatedPitchMm,10);
  assert.ok(queue.waitingUnits>0);assert.ok(queue.queueLengthMm>0);
  assert.ok(result.events.some(e=>e.type==='BACKUP_SENSOR_BLOCKED'));
  assert.ok(result.samples.at(-1).accumulationZones[0].waitingUnits<queue.waitingUnits);
  conserved(result);
});

test('fractional travel crossing avoids a fake throughput bottleneck at different ticks',()=>{
  const model=line({speed:107,sourceRate:3,sinkRate:3});
  const a=run(model,{tickSeconds:0.25}),b=run(model,{tickSeconds:0.125});
  assert.ok(Math.abs(a.summary.outputCount-b.summary.outputCount)<1);
  const prime=a.events.find(event=>event.type==='PRIME_SENSOR_TRIGGERED');
  assert(prime.atVirtualSecond>1000/107);
  assert.ok(a.summary.outputCount>3*(100-prime.atVirtualSecond)-2);
  conserved(a);conserved(b);
});

test('invalid speed mode and manual speed fail validation; historical gaps are ignored',()=>{
  for(const patch of [{speedMode:'BAD'},{conveyorSpeedMmPerSecond:0}]) {
    const model=line();Object.assign(model.equipment[1].processData.accumulation,patch);
    assert.equal(simulateLine({case:model,run:{durationSeconds:10,tickSeconds:0.25,seed:1}}).ok,false);
  }
});

test('legacy gaps and stored pitch do not affect calculated transport or packed capacity',()=>{
 const model=line(),a=run(model),historical=structuredClone(model);
 Object.assign(historical.equipment[1].processData.accumulation,{movingGapMm:-1,accumulatedGapMm:80,productPitchMm:999,accumulatedPitchMm:90,gapMm:999});
 const b=run(historical);assert.deepEqual(a.summary,b.summary);assert.equal(b.accumulationZoneMetrics['belt--physical-zone'].movingPitchMm,25);assert.equal(b.accumulationZoneMetrics['belt--physical-zone'].accumulatedPitchMm,10);
});
test('Test 03 reference: eight hours conserve material and reproduce deterministic FlexSim throughput',async()=>{
  const {createTest03ReferenceInput}=await import('../src/simulation/Test03Reference.js');
  const input=createTest03ReferenceInput(),response=simulateLine(input);
  assert.equal(response.ok,true);const result=response.result;
  // Two-unit tolerance acknowledges fractional vs discrete item output and
  // handoff timing; this is a regression check, not complete model validation.
  assert.ok(Math.abs(result.summary.outputCount-47852)<2);
  const inventories=Object.values(result.accumulationZoneMetrics);
  assert.ok(Math.abs(inventories[0].finalInventoryUnits-100)<1);
  assert.ok(Math.abs(inventories[1].finalInventoryUnits-80)<1);
  const machines=input.case.equipment.filter(e=>e.type!=='CONVEYOR');
  [83.39,99.86,83.08].forEach((expected,index)=>{
    const metric=result.equipmentMetrics[machines[index].id];
    assert.ok(Math.abs(metric.processingCapacityPercent-expected)<0.02);
  });
  conserved(result);
});

test('failures and recovery preserve material and state time across seeds',()=>{
  for(const seed of [1,17,42]) {
    const model=line({sourceRate:5,sinkRate:3});
    for(const equipment of model.equipment) equipment.noiseProfile={reliability:{mtbfMinutes:0.2,mttrMinutes:0.03}};
    const result=run(model,{seed,commands:[{atVirtualSecond:20,equipmentId:'source',action:'PAUSE'},{atVirtualSecond:35,equipmentId:'source',action:'RUN'}]});
    assert.ok(result.summary.totalFailureSeconds>0);conserved(result);
  }
});

test('connection loss counters include full and partial constraints without exceeding run time',()=>{
  for(const model of [line({sinkRate:1}),line({sourceRate:1,sinkRate:8})]){
    const result=run(model),zone=result.accumulationZoneMetrics['belt--physical-zone'];
    assert(zone.blockingEquivalentSeconds>=0&&zone.blockingEquivalentSeconds<=result.durationSeconds);
    assert(zone.starvingEquivalentSeconds>0&&zone.starvingEquivalentSeconds<=result.durationSeconds);
    assert(zone.constraintLossEquivalentSeconds>=Math.max(zone.blockingEquivalentSeconds,zone.starvingEquivalentSeconds));
    assert(zone.conveyorConstraintLossPercent>=0&&zone.conveyorConstraintLossPercent<=100);
    conserved(result);
  }
});
