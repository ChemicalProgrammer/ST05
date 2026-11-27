import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateLine,createLinePlaybackSession} from '../src/simulation/LineSimulationEngine.js';

function input({sinkMode='AUTO',prime=3000,backup=2000,blockedDelay=1,duration=40,commands=[]}={}){
  const unit=(id)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',nominalRatePerSecond:19/60,
    unitOfFlow:'cases',processData:{flowUnits:{input:'CASES',output:'CASES'}}});
  return {case:{id:'discrete-sensor-diagnostics',unitOfFlow:'cases',equipment:[unit('source'),
    {id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:19/60,unitOfFlow:'cases',
      processData:{flowUnits:{input:'CASES',output:'CASES'},accumulation:{speedMode:'MANUAL',
        usableLengthMm:3750,productLengthMm:310,productPitchMm:1710,movingGapMm:1400,accumulatedGapMm:0,
        conveyorSpeedMmPerSecond:541.5,primeSensorPositionMm:prime,backupSensorPositionMm:backup,
        blockedTimeDelaySeconds:blockedDelay,clearTimeDelaySeconds:.5,
        upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:2}}},
    {...unit('sink'),initialMode:sinkMode}]},run:{durationSeconds:duration,tickSeconds:.25,sampleEverySeconds:.05,
      seed:20260909,reliabilityEnabled:false,machineResidenceEnabled:true,machineDesignEnabled:false,
      numericalResolution:'PRECISE',commands}};
}
function run(i){const response=simulateLine(i);assert(response.ok,JSON.stringify(response.error));return response.result;}
const zoneOf=sample=>sample.accumulationZones.find(z=>z.ownerEquipmentId==='belt');

test('discrete Prime reports a normal passing pulse without authorizing an unfilled reserve',()=>{
  const r=run(input({duration:15,commands:[{equipmentId:'source',atVirtualSecond:4,action:'STOP'}]}));
  assert(r.samples.some(s=>zoneOf(s).prime.state==='PULSING'),'a physically passing case must be visible at Prime');
  assert.equal(r.equipmentMetrics.sink.outputCount,0);
  assert.equal(Object.values(r.accumulationZoneMetrics)[0].primeTriggerCount,0,'a passing pulse is not the required three-case reserve');
});

test('discrete Back-up distinguishes accumulated blockage from a passing product pulse',()=>{
  const r=run(input({sinkMode:'STOP',duration:45}));
  const m=Object.values(r.accumulationZoneMetrics)[0];
  assert(m.backupSignalPulsingSeconds>0,'normal travel crosses the sensor before accumulation reaches it');
  assert(m.backupSignalBlockedSeconds>10,'a stationary accumulated queue must be counted as BLOCKED');
  assert(r.samples.some(s=>zoneOf(s).backup.state==='BLOCKED'&&zoneOf(s).backup.controlActive));
  assert.equal(r.summary.materialBalance.residualUnits,0);
});

test('Back-up debounce continues to react to a sufficiently long individual product pulse',()=>{
  const r=run(input({duration:15,blockedDelay:.5,commands:[{equipmentId:'source',atVirtualSecond:4,action:'STOP'}]}));
  const m=Object.values(r.accumulationZoneMetrics)[0];
  assert.equal(m.backupTriggerCount,1,'310 / 541.5 seconds exceeds the configured 0.5 second blocked delay');
  assert.equal(m.backupSignalBlockedSeconds,0,'one passing product is not an accumulated queue');
  assert(m.backupSignalPulsingSeconds>.5);
});

test('a full conveyor does not claim an uncovered Back-up beam at the leftover entry space',()=>{
  const i=input({sinkMode:'STOP',duration:90,prime:1750,backup:50,blockedDelay:4});
  i.case.equipment[1].processData.accumulation.usableLengthMm=2000;
  i.case.equipment[1].processData.accumulation.conveyorSpeedMmPerSecond=310*19/60;
  const r=run(i),m=Object.values(r.accumulationZoneMetrics)[0];
  assert.equal(m.capacityUnits,6);
  assert.equal(m.maximumInventoryUnits,6);
  // Six packed 310 mm cases leave 140 mm unused before the tail; a sensor at
  // 50 mm is clear even though the capacity-clamped queue threshold is six.
  assert.equal(m.backupSignalBlockedSeconds,0);
  assert.equal(m.backupTriggerCount,0);
  assert.equal(zoneOf(r.samples.at(-1)).backup.state,'CLEAR');
  assert.equal(r.summary.materialBalance.residualUnits,0);
});

test('a capacity-clamped Prime threshold cannot authorize a reserve that does not reach its sensor',()=>{
  const i=input({duration:90,prime:50,backup:0,blockedDelay:100});
  i.case.equipment[1].processData.accumulation.usableLengthMm=2000;
  i.case.equipment[1].processData.accumulation.conveyorSpeedMmPerSecond=310*19/60;
  const r=run(i),m=Object.values(r.accumulationZoneMetrics)[0];
  assert.equal(m.capacityUnits,6);
  assert.equal(m.maximumInventoryUnits,6);
  assert.equal(m.primeTriggerCount,0,'the packed tail is 140 mm from the entry; Prime at 50 mm is outside the actual reserve');
  assert.equal(r.equipmentMetrics.sink.outputCount,0);
  assert.equal(r.equipmentMetrics.sink.startRampCount,0);
  assert.equal(zoneOf(r.samples.at(-1)).prime.state,'CLEAR');
  assert.equal(r.summary.materialBalance.residualUnits,0);
});

test('normal advancement of an occupied Prime beam is not reported as CLEAR',()=>{
  const i=input({duration:60,prime:3000,backup:50,blockedDelay:20});
  const session=createLinePlaybackSession(i);
  while(session.time<35)session.advanceTo(35,{budgetMs:1000,maxTicks:5000});
  let observedMovingCoverage=false;
  for(let n=0;n<1200;n++){
    const sample=session.advanceTo(35+(n+1)/120,{budgetMs:1000,maxTicks:2});
    const z=zoneOf(sample);
    // Saved transit positions are leading edges. Test away from the rounded
    // package boundary, independently of the engine's readiness boolean.
    const covered=z.transitPositionsMm.some(front=>front>z.prime.positionMm+2&&front-310<z.prime.positionMm-2);
    if(covered){
      observedMovingCoverage=true;
      assert.notEqual(z.prime.state,'CLEAR',`occupied Prime beam at ${sample.virtualSecond}s`);
    }
  }
  assert(observedMovingCoverage,'the fixture must exercise moving material over Prime');
});

test('a discrete ramp attributes reduced service even when its first case completes after the ramp',()=>{
  const r=run(input({duration:60,backup:50,blockedDelay:20}));
  const m=r.equipmentMetrics.sink;
  assert.equal(m.startRampCount,1);
  assert.equal(m.startRampOutputUnits,0,'19 cases/min cannot finish one case during a two-second linear ramp');
  assert(Math.abs(m.rampRateLossSeconds-1)<.02,`two-second linear ramp loses about one second of nominal service, got ${m.rampRateLossSeconds}`);
  assert(Math.abs(r.summary.lineRateLossRampSeconds-1)<.02,'line attribution uses the active reference and must not depend on package completion ticks');
});

test('a completed blocked lot does not accumulate hypothetical ramp service loss',()=>{
  const i=input({sinkMode:'STOP',duration:40,prime:1750,backup:50,blockedDelay:100});
  const [source,belt]=i.case.equipment;
  source.nominalRatePerSecond=2;
  source.processData.downstream={rampUpTimeSeconds:20};
  Object.assign(belt.processData.accumulation,{usableLengthMm:2000,conveyorSpeedMmPerSecond:620});
  const session=createLinePlaybackSession(i);
  while(session.time<20)session.advanceTo(20,{budgetMs:1000,maxTicks:5000});
  const before=session.snapshot().equipment.find(e=>e.id==='source');
  assert.equal(before.availabilityState,'BLOCKED');
  assert.equal(before.processingInventoryUnits,1);
  assert.equal(before.processingServiceUnits,1);
  assert(before.rampRateLossSeconds>0,'the accelerating source worked before blocking');
  while(session.time<30)session.advanceTo(30,{budgetMs:1000,maxTicks:5000});
  const after=session.snapshot().equipment.find(e=>e.id==='source');
  assert.equal(after.availabilityState,'BLOCKED');
  assert.equal(after.rampRateLossSeconds,before.rampRateLossSeconds);
  assert.equal(after.outputCount,before.outputCount);
});
