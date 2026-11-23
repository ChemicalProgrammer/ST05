import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinePlaybackSession,simulateLine,simulateLineAsync} from '../src/simulation/LineSimulationEngine.js';

function input(durationSeconds=60){
  const machine=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',unitOfFlow:'bottles',nominalRatePerSecond:rate,
    processData:{equipment:{internalCapacityBottles:36,residenceTimeSeconds:id==='source'?3:0,occupancyMode:'STORAGE'},flowUnits:{input:'BOTTLES',output:'BOTTLES'}}});
  return {case:{id:'live-playback',unitOfFlow:'bottles',equipment:[machine('source',8),
    {id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',unitOfFlow:'bottles',nominalRatePerSecond:10,
      processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},accumulation:{speedMode:'MANUAL',usableLengthMm:1000,
        productLengthMm:20,movingGapMm:10,accumulatedGapMm:0,conveyorSpeedMmPerSecond:500,
        primeSensorPositionMm:900,backupSensorPositionMm:100,backupRestartPositionMm:200,
        upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:0,
        blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5}}},machine('sink',10)]},
    run:{durationSeconds,tickSeconds:.25,sampleEverySeconds:1,seed:7,reliabilityEnabled:false,
      machineResidenceEnabled:true,calculationMode:'LIVE',historyFormat:'COMPACT',commands:[]}};
}

function advance(session,target,options={budgetMs:1000,maxTicks:1000}){
  const desired=Math.floor((target+1e-8)/session.tickSeconds)*session.tickSeconds;
  let attempts=0,frame=session.snapshot();
  while(!session.finished&&session.time+1e-8<desired){
    frame=session.advanceTo(target,options);
    assert(++attempts<100000,'Playback must make progress toward its requested physical time');
  }
  return frame;
}

test('one-day playback supplies exact 20-FPS frames and one-second chart samples without a horizon-based interval',()=>{
  const data=input(86400),before=JSON.stringify(data),session=createLinePlaybackSession(data),frames=[];
  assert.equal(session.tickSeconds,1/120);
  assert.equal(session.chartIntervalSeconds,1);
  for(let index=1;index<=120;index++){
    const frame=advance(session,index/20);
    assert(Math.abs(frame.virtualSecond-index/20)<1e-8);
    frames.push(frame);
  }
  assert(new Set(frames.filter(frame=>frame.virtualSecond>=4).map(frame=>frame.equipment[0].outputCount)).size>=10,
    'A long horizon must not freeze the machine counter behind an archive sample');
  const frame=frames.at(-1),machine=frame.equipment[0];
  for(const field of ['stateSeconds','runningSeconds','failureSeconds','microStopSeconds','runningDesignOutput',
    'outputCount','designSpeedPerSecond','pausedSeconds','stoppedSeconds','plannedStopSeconds'])assert.notEqual(machine[field],undefined,field);
  assert(frame.accumulationZones[0].geometry,'Full playback frames carry conveyor geometry even with COMPACT archive history');
  assert.equal(machine.actualRatePerSecond,8,'The displayed rate is a measured one-second count delta, not a 0/120 tick impulse');
  assert.equal(machine.meanRatePerSecond,8);
  assert(!('minRatePerSecond' in machine)&&!('maxRatePerSecond' in machine),
    'A live frame must not retain raw 0/120 tick extrema that stretch a 480-bpm chart to 7200 bpm');
  const chart=session.drainChartSamples();
  assert.deepEqual(chart.map(point=>point.virtualSecond),[0,1,2,3,4,5,6]);
  assert(chart.every(point=>!('accumulationZones' in point)&&point.equipment.every(unit=>!('stateSeconds' in unit))),
    'Chart history contains compact observations, not full equipment frames');
  assert(chart.every(point=>point.equipment.every(unit=>!('minRatePerSecond' in unit)&&!('maxRatePerSecond' in unit))),
    'Live chart extrema are determined from the measured curve points, not physical tick impulses');
  assert.equal(Math.max(...chart.filter(point=>point.virtualSecond>=4).map(point=>point.equipment[0].actualRatePerSecond)),8);
  assert.deepEqual(session.drainChartSamples(),[],'Chart deliveries are deltas');
  assert.equal(session.retainedSampleCount,0,'Full archival frames do not accumulate in a playback session');
  assert.equal(JSON.stringify(data),before,'Playback does not mutate configured inputs');
});

test('incremental playback preserves the calculated trajectory through failures, ramps and commands',()=>{
  const data=input();
  data.run.reliabilityEnabled=true;
  Object.assign(data.case.equipment[0],{startupDelaySeconds:.5,restartRampUpSeconds:1,
    noiseProfile:{reliability:{mtbfMinutes:.1,mttrMinutes:.01}}});
  data.run.commands=[{atVirtualSecond:20,equipmentId:'sink',action:'STOP'},
    {atVirtualSecond:25,equipmentId:'sink',action:'RUN'}];
  const expected=simulateLine(data);assert(expected.ok,JSON.stringify(expected.error));
  const session=createLinePlaybackSession(data);
  const fields=['outputCount','processedUnits','internalInventoryBottles','availabilityState','runningSeconds',
    'starvedSeconds','blockedSeconds','failureSeconds','failureCount','startRampSeconds','backupStopSeconds',
    'partialStarvationLossSeconds','partialBlockingLossSeconds','oeePercent'];
  for(let second=1;second<=60;second++){
    const actual=advance(session,second,{budgetMs:1000,maxTicks:37});
    const reference=expected.result.samples.find(sample=>Math.abs(sample.virtualSecond-second)<1e-8);
    assert(reference,'A reference frame exists at '+second);
    for(const field of ['outputCount','effectiveRuntimeSeconds','runtimeLossSeconds'])assert.equal(actual[field],reference[field],field+' at '+second);
    assert.deepEqual(actual.buffers,reference.buffers);
    actual.equipment.forEach((unit,index)=>{
      for(const field of fields)assert.equal(unit[field],reference.equipment[index][field],unit.id+'.'+field+' at '+second);
    });
  }
  assert(session.finished);
  for(const unit of session.snapshot().equipment){
    assert.deepEqual(unit.stateSeconds,expected.result.equipmentMetrics[unit.id].stateSeconds);
    assert.equal(unit.outputCount,expected.result.equipmentMetrics[unit.id].outputCount);
  }
  assert(expected.result.equipmentMetrics.source.failureCount>0,'The comparison actually exercised seeded failures');
  assert(expected.result.equipmentMetrics.source.startRampSeconds>0,'The comparison actually exercised ramp dynamics');
});

test('frames and chart observations are independent of worker chunk sizes and paint cadence',()=>{
  const data=input(20),frequent=createLinePlaybackSession(data),infrequent=createLinePlaybackSession(data);
  for(let frame=1;frame<=200;frame++)advance(frequent,frame/20,{budgetMs:1000,maxTicks:7});
  advance(infrequent,10,{budgetMs:1000,maxTicks:4096});
  assert.deepEqual(frequent.snapshot(),infrequent.snapshot());
  assert.deepEqual(frequent.drainChartSamples(),infrequent.drainChartSamples());
});

test('dense chart history stays bounded and draining does not reset the physical session',()=>{
  const data=input(86400);data.run.sampleEverySeconds=.001;
  const session=createLinePlaybackSession(data);
  advance(session,10,{budgetMs:1000,maxTicks:4096});
  assert.equal(session.chartIntervalSeconds,1/120,'The requested interval is limited only by the physical tick');
  assert.equal(session.retainedChartSampleCount,601);
  const samples=session.drainChartSamples();
  assert.equal(samples.length,601);assert.equal(samples.at(-1).virtualSecond,10);
  assert.equal(session.retainedChartSampleCount,0);assert.equal(session.retainedSampleCount,0);
  const produced=session.snapshot().equipment[0].outputCount;
  advance(session,11);
  assert.equal(session.drainChartSamples().length,120);
  assert(session.snapshot().equipment[0].outputCount>produced);
});

test('playback obeys tick and time budgets without extrapolating its clock',()=>{
  const session=createLinePlaybackSession(input());
  const frame=session.advanceTo(10,{budgetMs:1000,maxTicks:3});
  assert.equal(frame.virtualSecond,3/120);
  assert.equal(session.time,frame.virtualSecond);
  const previous=session.time;
  assert.equal(session.advanceTo(10,{budgetMs:0}).virtualSecond,previous);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=0;
  try{
    Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now+=10}});
    const partial=session.advanceTo(10,{budgetMs:8,maxTicks:10000});
    assert(partial.virtualSecond>previous&&partial.virtualSecond<10,'Expired wall-time budget returns a real intermediate frame');
  }finally{Object.defineProperty(globalThis,'performance',descriptor);}
  const quantized=createLinePlaybackSession(input());
  const beforeTick=quantized.advanceTo(.004,{budgetMs:1000});assert.equal(beforeTick.virtualSecond,0);
  assert.equal(quantized.advanceTo(.01,{budgetMs:1000}).virtualSecond,1/120);
});

test('non-aligned completion uses the same final whole physical tick as a complete run',()=>{
  const data=input(10.003),expected=simulateLine(data);assert(expected.ok);
  const session=createLinePlaybackSession(data);
  while(!session.finished)session.advanceTo(data.run.durationSeconds,{budgetMs:1000,maxTicks:1000});
  assert.equal(session.time,expected.result.samples.at(-1).virtualSecond);
  assert.equal(session.snapshot().outputCount,expected.result.summary.outputCount);
});

test('effective-runtime completion retains the exact terminal counters and stops before the safety horizon',()=>{
  const data=input(60);data.run.effectiveRuntimeTargetSeconds=3;
  const expected=simulateLine(data);assert(expected.ok,JSON.stringify(expected.error));
  const session=createLinePlaybackSession(data);
  let attempts=0;
  while(!session.finished){session.advanceTo(60,{budgetMs:1000,maxTicks:100});assert(++attempts<1000);}
  const frame=session.snapshot();
  assert.equal(frame.virtualSecond,expected.result.durationSeconds);
  assert(frame.virtualSecond<60);
  assert.equal(frame.outputCount,expected.result.summary.outputCount);
  assert.equal(frame.effectiveRuntimeSeconds,expected.result.samples.at(-1).effectiveRuntimeSeconds);
  assert.strictEqual(session.advanceTo(60),frame,'Further requests retain the terminal physical frame');
});

test('invalid playback requests have explicit errors and callers must create a fresh session to rewind',()=>{
  assert.throws(()=>createLinePlaybackSession({}),error=>error.code==='INVALID_SIMULATION_INPUT'&&Array.isArray(error.details));
  const session=createLinePlaybackSession(input());advance(session,1);
  assert.throws(()=>session.advanceTo(.5),error=>error.code==='PLAYBACK_REWIND_REQUIRED');
  assert.throws(()=>session.advanceTo(NaN),error=>error.code==='INVALID_PLAYBACK_TIME');
  assert.throws(()=>session.advanceTo(-1),error=>error.code==='INVALID_PLAYBACK_TIME');
});

test('async chunks use the effective physical tick while preserving final calculations',async()=>{
  const data=input(10),progress=[];
  const sync=simulateLine(data);assert(sync.ok);
  const async=await simulateLineAsync(data,{detail:true,yieldBetweenChunks:false,
    onPartial(){},progress:value=>progress.push(value*data.run.durationSeconds)});
  assert(async.ok);
  assert(Math.abs(progress[0]-32/120)<1e-8,'The initial 32-tick chunk is not expanded using the requested 0.25-second step');
  assert(progress.slice(1).every((second,index)=>second-progress[index]<=1000/120+1e-8));
  assert.deepEqual(async.result.summary,sync.result.summary);
  assert.deepEqual(async.result.equipmentMetrics,sync.result.equipmentMetrics);
  assert.deepEqual(async.result.samples,sync.result.samples);
});
