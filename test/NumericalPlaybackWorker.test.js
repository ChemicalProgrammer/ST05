import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createNumericalPlayback,numericalPlaybackWorkerMain} from '../src/simulation/NumericalPlayback.js';
import {createLinePlaybackSession} from '../src/simulation/LineSimulationEngine.js';

function input(durationSeconds=60){
  const machine=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',nominalRatePerSecond:rate,
    processData:{equipment:{internalCapacityBottles:36,residenceTimeSeconds:id==='source'?3:0},flowUnits:{input:'BOTTLES',output:'BOTTLES'}}});
  return {case:{id:'playback-worker',unitOfFlow:'bottles',equipment:[machine('source',8),
    {id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:10,
      processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},accumulation:{speedMode:'MANUAL',usableLengthMm:1000,
        productLengthMm:20,movingGapMm:10,accumulatedGapMm:0,conveyorSpeedMmPerSecond:500,
        primeSensorPositionMm:900,backupSensorPositionMm:100,backupRestartPositionMm:200,
        upstreamStopResponseSeconds:0,bottlesDischargedAtStop:0,downstreamRampUpSeconds:0,blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5}}},machine('sink',10)]},
    run:{durationSeconds,tickSeconds:.25,sampleEverySeconds:1,seed:7,reliabilityEnabled:false,
      machineResidenceEnabled:true,calculationMode:'LIVE',eventsEnabled:true,
      commands:[{atVirtualSecond:5,equipmentId:'source',action:'STOP'},{atVirtualSecond:7,equipmentId:'source',action:'RUN'}]}};
}
function realWorkerFactory(){
  const moduleUrl=new URL('../src/simulation/NumericalPlayback.js',import.meta.url).href;
  const source=`const {parentPort}=require('node:worker_threads');
    globalThis.self=globalThis;self.postMessage=data=>parentPort.postMessage(data);
    import(${JSON.stringify(moduleUrl)}).then(({numericalPlaybackWorkerMain})=>{
      numericalPlaybackWorkerMain(self);parentPort.on('message',data=>self.onmessage({data}));
    });`;
  return ()=>{
    const thread=new Worker(source,{eval:true}),worker={
      postMessage:message=>thread.postMessage(message),terminate:()=>thread.terminate()
    };
    thread.on('message',data=>worker.onmessage?.({data}));
    thread.on('error',error=>worker.onerror?.(error));
    return worker;
  };
}
async function reach(controller,time){
  let frame;const chart=[];
  do{
    frame=await controller.advanceTo(time);
    chart.push(...frame.chartSamples);
  }while(!controller.finished&&controller.time+1e-8<time);
  return {frame,chart};
}
const cleanFrame=frame=>{const copy=structuredClone(frame);delete copy.chartSamples;return copy;};

test('the isolated worker uses one complete bounded work budget without timer gaps',async()=>{
  const messages=[],work=[];
  const session={time:0,tickSeconds:1/120,durationSeconds:86400,finished:false,
    snapshot(){return {virtualSecond:this.time,equipment:[]};},
    advanceTo(target,options){work.push({target,...options});this.time=3;return this.snapshot();},
    drainChartSamples(){return [];}};
  const scope={postMessage:message=>messages.push(message)};
  numericalPlaybackWorkerMain(scope,()=>session);
  await scope.onmessage({data:{type:'init',id:0,input:input()}});
  await scope.onmessage({data:{type:'advance',id:1,target:86400,budgetMs:32}});
  assert.equal(work.length,1,'A worker request must not insert main-thread yield timers');
  assert.equal(work[0].budgetMs,32);assert(work[0].maxTicks>2048);
  assert.equal(messages.at(-1).frame.virtualSecond,3,'Only the computed partial state is returned');
});

test('demand-driven worker and yielding fallback preserve the same exact physical state and chart samples',async()=>{
  const model=input(),local=createNumericalPlayback(model),worker=createNumericalPlayback(model,{createWorker:realWorkerFactory()});
  try{
    const localChart=[],workerChart=[];
    for(const target of [0,.125,.25,.5,1,2,5,6,7,10,20]){
      const [a,b]=await Promise.all([reach(local,target),reach(worker,target)]);
      assert.deepEqual(cleanFrame(a.frame),cleanFrame(b.frame),'worker and main-thread fallback must use the same model at '+target);
      localChart.push(...a.chart);workerChart.push(...b.chart);
      assert.equal(local.time,worker.time);
      assert(local.time<=target+1e-8);
    }
    assert.equal(local.backend,'local');assert.equal(worker.backend,'worker');
    assert.deepEqual(localChart,workerChart);
    assert.deepEqual(workerChart.map(s=>s.virtualSecond),Array.from({length:21},(_,i)=>i));
    assert.equal(new Set(workerChart.map(s=>s.virtualSecond)).size,workerChart.length);
  }finally{local.close();worker.close();}
});

test('a large target returns measured partial progress instead of calculating the entire horizon in one request',async()=>{
  for(const options of [{},{createWorker:realWorkerFactory()}]){
    const controller=createNumericalPlayback(input(86400),options);
    try{
      const first=await controller.advanceTo(86400,{budgetMs:1});
      assert(first.virtualSecond>0&&first.virtualSecond<86400);
      assert.equal(controller.finished,false);
      assert(first.equipment.every(unit=>Number.isFinite(unit.processedUnits)));
      const previous=controller.time;
      const second=await controller.advanceTo(86400,{budgetMs:1});
      assert(controller.time>previous);
      assert(second.virtualSecond<86400);
      assert(second.chartSamples.length<=601);
    }finally{controller.close();}
  }
});

test('unavailable workers fall back to the same calculation without changing the input',async()=>{
  const model=input(),before=JSON.stringify(model),expected=createLinePlaybackSession(model);
  const controller=createNumericalPlayback(model,{createWorker(){throw new Error('Blocked by policy');}});
  try{
    const {frame}=await reach(controller,12);
    let check;do{check=expected.advanceTo(12,{budgetMs:8});}while(expected.time+1e-8<12);
    assert.deepEqual(cleanFrame(frame),check);
    assert.equal(controller.backend,'local');
    assert.equal(JSON.stringify(model),before);
  }finally{controller.close();}
});

test('close rejects a pending request and ignores stale worker responses; concurrent requests cannot build a queue',async()=>{
  let worker,waiting,handler;
  const controller=createNumericalPlayback(input(),{createWorker(){
    worker={terminate(){this.terminated=true;},postMessage(message){
      if(message.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready',id:0,time:0,tickSeconds:1/120,durationSeconds:60,finished:false}}),0);
      else{waiting=message;handler=this.onmessage;}
    }};return worker;
  }});
  const first=controller.advanceTo(10);
  await assert.rejects(controller.advanceTo(20),error=>error.code==='PLAYBACK_BUSY');
  while(!waiting)await new Promise(resolve=>setTimeout(resolve,0));
  const rejected=assert.rejects(first,error=>error.code==='PLAYBACK_CLOSED');
  controller.close();await rejected;
  handler({data:{type:'frame',id:waiting.id,time:10,tickSeconds:1/120,durationSeconds:60,finished:false,frame:{virtualSecond:10,chartSamples:[]}}});
  assert.equal(controller.time,0);assert.equal(worker.terminated,true);
  await assert.rejects(controller.advanceTo(10),error=>error.code==='PLAYBACK_CLOSED');
});

test('model validation failures retain their error code through worker and fallback',async()=>{
  const model=input();model.case.equipment[0].nominalRatePerSecond=-1;
  for(const options of [{},{createWorker:realWorkerFactory()}]){
    const controller=createNumericalPlayback(model,options);
    try{await assert.rejects(controller.advanceTo(1),error=>Boolean(error.code)&&error.code!=='PLAYBACK_WORKER_UNAVAILABLE');}
    finally{controller.close();}
  }
});

test('a worker failure after playback started never replaces the displayed state with an earlier fallback frame',async()=>{
  let requests=0;
  const session={time:0,tickSeconds:1,durationSeconds:100,finished:false,
    snapshot(){return {virtualSecond:this.time,outputCount:this.time,equipment:[]};},
    advanceTo(){this.time++;return this.snapshot();},drainChartSamples(){return [];}};
  const controller=createNumericalPlayback(input(),{createSession:()=>session,createWorker(){
    return {terminate(){},postMessage(message){
      if(message.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready',id:0,time:0,tickSeconds:1,durationSeconds:100,finished:false}}),0);
      else if(++requests===1)setTimeout(()=>this.onmessage?.({data:{type:'frame',id:message.id,time:10,tickSeconds:1,durationSeconds:100,finished:false,frame:{virtualSecond:10,outputCount:10,equipment:[],chartSamples:[]}}}),0);
      else setTimeout(()=>this.onerror?.(new Error('worker disconnected')),0);
    }};
  }});
  try{
    assert.equal((await controller.advanceTo(10)).virtualSecond,10);
    const observed=[];
    do{observed.push((await controller.advanceTo(20,{budgetMs:1})).virtualSecond);}while(controller.time<20);
    assert(observed.every((time,index)=>time>=10&&(index===0||time>=observed[index-1])));
    assert.equal(controller.backend,'local');assert.equal(observed.at(-1),20);
  }finally{controller.close();}
});

test('the fallback yields and close cancels work between bounded physical chunks',async()=>{
  let advances=0,controller;
  const session={time:0,tickSeconds:1,durationSeconds:1000,finished:false,
    snapshot(){return {virtualSecond:this.time,outputCount:this.time,equipment:[]};},
    advanceTo(target,options){assert(options.budgetMs<=8);assert(options.maxTicks<=2048);advances++;this.time++;return this.snapshot();},drainChartSamples(){return [];}};
  controller=createNumericalPlayback(input(),{createSession:()=>session});
  const pending=controller.advanceTo(1000,{budgetMs:50});
  const rejection=assert.rejects(pending,error=>error.code==='PLAYBACK_CLOSED');
  setTimeout(()=>controller.close(),0);await rejection;
  assert(advances>0&&advances<1000,'the entire request must not monopolize the event loop');
});
