import { createLinePlaybackSession } from './LineSimulationEngine.js';

// A demand-driven calculation cursor, independent of the compact saved replay.
// There is no producer running ahead of the reader and no unbounded job queue.
// One request owns at most 32 ms of work by default, in shorter yielding chunks.
export function createNumericalPlayback(input, options = {}) {
  let modelInput=typeof structuredClone==='function'?structuredClone(input):JSON.parse(JSON.stringify(input));
  const createSession=options.createSession||createLinePlaybackSession;
  const now=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const failure=(code,message=code,details)=>Object.assign(new Error(message),{code,details});
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  let worker=null,local=null,ready=false,initializing=null,readyResolve,readyReject,startupTimer;
  let pending=null,nextId=0,closed=false,busy=false,lastFrame=null;
  let time=0,finished=false,tickSeconds=null,durationSeconds=Number(input.run?.durationSeconds)||0;

  function disposeWorker(){
    clearTimeout(startupTimer);
    if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}
    ready=false;
  }
  function workerUnavailable(){
    const error=failure('PLAYBACK_WORKER_UNAVAILABLE');
    disposeWorker();
    if(readyReject){const reject=readyReject;readyResolve=null;readyReject=null;reject(error);}
    if(pending){const request=pending;pending=null;request.reject(error);}
  }
  function accept(message){
    tickSeconds=message.tickSeconds;
    durationSeconds=message.durationSeconds;
    const frame=message.frame;
    // If a worker fails after it advanced, a deterministic local replacement
    // must catch up before it can replace the last displayed state.
    if(lastFrame&&message.time<time-1e-8)return {...lastFrame,chartSamples:[]};
    const previousTime=time;
    time=message.time;finished=message.finished;
    const chartSamples=(frame.chartSamples||[]).filter(sample=>!lastFrame||sample.virtualSecond>previousTime+1e-8);
    lastFrame={...frame,chartSamples:[]};
    return {...lastFrame,chartSamples};
  }
  function startLocal(){
    if(!local)local=createSession(modelInput);
    tickSeconds=local.tickSeconds;durationSeconds=local.durationSeconds;ready=true;
  }
  function start(){
    if(ready)return Promise.resolve();
    if(initializing)return initializing;
    if(!options.createWorker){startLocal();return Promise.resolve();}
    try{worker=options.createWorker();}catch(_){worker=null;}
    if(!worker){startLocal();return Promise.resolve();}
    const activeWorker=worker;
    initializing=new Promise((resolve,reject)=>{
      readyResolve=resolve;readyReject=reject;
      startupTimer=setTimeout(workerUnavailable,options.startupTimeoutMs||10000);
      activeWorker.onerror=()=>{if(worker===activeWorker)workerUnavailable();};
      activeWorker.onmessage=event=>{
        if(closed||worker!==activeWorker)return;
        const message=event.data;
        if(message.type==='ready'){
          clearTimeout(startupTimer);ready=true;
          tickSeconds=message.tickSeconds;durationSeconds=message.durationSeconds;
          const done=readyResolve;readyResolve=null;readyReject=null;done?.();return;
        }
        if(message.type==='error'){
          const error=failure(message.code||'PLAYBACK_CALCULATION_FAILED',message.message,message.details);
          if(message.id===0&&readyReject){
            const reject=readyReject;readyResolve=null;readyReject=null;disposeWorker();reject(error);return;
          }
          if(pending&&message.id===pending.id){const request=pending;pending=null;request.reject(error);}
          return;
        }
        if(message.type==='frame'&&pending&&message.id===pending.id){
          const request=pending;pending=null;request.resolve(accept(message));
        }
      };
      try{activeWorker.postMessage({type:'init',id:0,input:modelInput});}catch(_){workerUnavailable();}
    }).catch(error=>{
      if(closed)throw failure('PLAYBACK_CLOSED');
      if(error.code!=='PLAYBACK_WORKER_UNAVAILABLE')throw error;
      startLocal();
    });
    return initializing;
  }
  async function advanceLocal(target,budgetMs){
    startLocal();
    const session=local;
    const goal=target>=durationSeconds-1e-8?durationSeconds:
      Math.floor((target+1e-8)/tickSeconds)*tickSeconds;
    const deadline=now()+budgetMs;
    let frame=session.snapshot();
    while(!session.finished&&session.time+1e-8<goal){
      if(closed)throw failure('PLAYBACK_CLOSED');
      const previous=session.time;
      frame=session.advanceTo(goal,{budgetMs:Math.min(8,Math.max(1,deadline-now())),maxTicks:2048});
      if(session.time<=previous+1e-10||session.finished||session.time+1e-8>=goal||now()>=deadline)break;
      await pause();
    }
    if(closed)throw failure('PLAYBACK_CLOSED');
    frame={...frame,chartSamples:session.drainChartSamples?.()||[]};
    return accept({frame,time:session.time,finished:session.finished,tickSeconds:session.tickSeconds,durationSeconds:session.durationSeconds});
  }
  async function advanceTo(target,settings={}){
    if(closed)throw failure('PLAYBACK_CLOSED');
    if(busy)throw failure('PLAYBACK_BUSY');
    if(!Number.isFinite(target)||target<0)throw failure('PLAYBACK_INVALID_TIME');
    if(target+1e-8<time)throw failure('PLAYBACK_REWIND_REQUIRED');
    const requested=Number(settings.budgetMs);
    const budgetMs=Number.isFinite(requested)?Math.max(1,Math.min(50,requested)):32;
    busy=true;
    try{
      await start();
      if(closed)throw failure('PLAYBACK_CLOSED');
      target=Math.min(target,durationSeconds);
      if(!worker)return await advanceLocal(target,budgetMs);
      try{
        return await new Promise((resolve,reject)=>{
          const id=++nextId;pending={id,resolve,reject};
          try{worker.postMessage({type:'advance',id,target,budgetMs});}catch(_){workerUnavailable();}
        });
      }catch(error){
        if(closed)throw failure('PLAYBACK_CLOSED');
        if(error.code!=='PLAYBACK_WORKER_UNAVAILABLE')throw error;
        return await advanceLocal(target,budgetMs);
      }
    }finally{busy=false;}
  }
  function close(){
    if(closed)return;
    closed=true;disposeWorker();
    const error=failure('PLAYBACK_CLOSED');
    if(readyReject){const reject=readyReject;readyResolve=null;readyReject=null;reject(error);}
    if(pending){const request=pending;pending=null;request.reject(error);}
    local=null;modelInput=null;lastFrame=null;
    options.onClose?.();
  }
  return {advanceTo,close,get time(){return time;},get finished(){return finished;},
    get tickSeconds(){return tickSeconds;},get durationSeconds(){return durationSeconds;},
    get backend(){return worker?'worker':local?'local':null;}};
}

// Serialized into an isolated model-only worker by the browser bundle builder.
// Keep helpers inside this function so the worker depends only on the numeric
// engine, not on UI, scenario planning or the optional Python runtime.
export function numericalPlaybackWorkerMain(scope=self,createSession=createLinePlaybackSession){
  let session=null,busy=false;
  const now=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const send=(type,id,frame)=>scope.postMessage({type,id,frame,time:session.time,
    finished:session.finished,tickSeconds:session.tickSeconds,durationSeconds:session.durationSeconds});
  scope.onmessage=async event=>{
    const task=event.data;
    try{
      if(task.type==='init'){
        session=createSession(task.input);send('ready',task.id);return;
      }
      if(task.type!=='advance')return;
      if(!session)throw Object.assign(new Error('PLAYBACK_NOT_READY'),{code:'PLAYBACK_NOT_READY'});
      if(busy)throw Object.assign(new Error('PLAYBACK_BUSY'),{code:'PLAYBACK_BUSY'});
      if(!Number.isFinite(task.target)||task.target<0)
        throw Object.assign(new Error('PLAYBACK_INVALID_TIME'),{code:'PLAYBACK_INVALID_TIME'});
      busy=true;
      const target=Math.min(task.target,session.durationSeconds);
      const goal=target>=session.durationSeconds-1e-8?session.durationSeconds:
        Math.floor((target+1e-8)/session.tickSeconds)*session.tickSeconds;
      const budget=Number.isFinite(task.budgetMs)?Math.max(1,Math.min(50,task.budgetMs)):32;
      const deadline=now()+budget;
      let frame=session.snapshot();
      while(!session.finished&&session.time+1e-8<goal){
        const previous=session.time;
        frame=session.advanceTo(goal,{budgetMs:Math.min(8,Math.max(1,deadline-now())),maxTicks:2048});
        if(session.time<=previous+1e-10||session.finished||session.time+1e-8>=goal||now()>=deadline)break;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      send('frame',task.id,{...frame,chartSamples:session.drainChartSamples?.()||[]});
    }catch(error){scope.postMessage({type:'error',id:task.id,message:error.message,code:error.code,details:error.details});}
    finally{busy=false;}
  };
}
