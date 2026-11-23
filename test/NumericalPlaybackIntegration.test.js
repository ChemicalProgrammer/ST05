import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createNumericalPlayback} from '../src/simulation/NumericalPlayback.js';
import {createLinePlaybackSession,simulateLineAsync} from '../src/simulation/LineSimulationEngine.js';

const read=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
function load(context,source,names){
  for(const name of names){
    let start=source.indexOf('    function '+name+'(');
    if(start<0)start=source.indexOf('    async function '+name+'(');
    assert.ok(start>=0,'Missing production function '+name);
    const rest=source.slice(start),boundary=rest.slice(10).search(/\n    (?:async )?function /);
    vm.runInContext(boundary<0?rest:rest.slice(0,boundary+10),context);
  }
}
const copy=value=>JSON.parse(JSON.stringify(value));

function physicalInput(){
  const machine=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',
    nominalRatePerSecond:rate,processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},
      equipment:{internalCapacityBottles:36,residenceTimeSeconds:0,occupancyMode:'STORAGE'}}});
  return {case:{id:'live-day',unitOfFlow:'bottles',equipment:[machine('source',8),
    {id:'belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',nominalRatePerSecond:10,
      processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},accumulation:{
        speedMode:'MANUAL',usableLengthMm:1000,productLengthMm:20,movingGapMm:10,
        accumulatedGapMm:0,conveyorSpeedMmPerSecond:10000,primeSensorPositionMm:900,
        backupSensorPositionMm:100,backupRestartPositionMm:200,upstreamStopResponseSeconds:0,
        bottlesDischargedAtStop:0,downstreamRampUpSeconds:0,blockedTimeDelaySeconds:.5,
        clearTimeDelaySeconds:.5}}},machine('sink',10)]},
    run:{durationSeconds:86400,tickSeconds:.25,sampleEverySeconds:1,displayRefreshFps:20,
      seed:7,reliabilityEnabled:false,machineResidenceEnabled:true,calculationMode:'LIVE',
      rounds:1,commands:[]}};
}

function playbackHarness({factory=createNumericalPlayback,input=physicalInput()}={}){
  let clock=0,nextJob=0;
  const jobs=new Map(),delays=[],renders=[],equipmentFrames=[],controllers=[],errors=[];
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,checked:true,
      dataset:{},classList:{contains:()=>false,toggle(){},add(){},remove(){}},setAttribute(){},
      getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){}});
    return elements.get(id);
  };
  element('run-playback-rate').value='1';element('run-display-fps').value='20';
  element('run-sample-interval').value='1';element('run-sample-interval-unit').value='SECONDS';
  const first=createLinePlaybackSession(input).snapshot();
  // Deliberately sparse saved replay: the next recorded point is twenty minutes
  // away. Fresh values must come from the real calculation cursor.
  const result={durationSeconds:input.run.durationSeconds,seed:input.run.seed,
    samples:[first,{...copy(first),virtualSecond:1210}],summary:{lineOeePacemakerRatePerSecond:8,outputCount:0},
    detailCoverage:{recordingMode:'BOUNDED',savedReplaySampled:true}};
  const tab={id:'s1',equipment:input.case.equipment,dynamicConfig:copy(input.run),
    results:{replay:copy(result),summary:result.summary}};
  const state={uiView:'simulation',activeSimulationId:'s1',liveZoneDetails:{},activeCase:{...copy(input.case),simulations:[tab]},
    run:{result,representative:result,configuration:copy(input.run),roundIndex:0,sampleIndex:0,
      playing:false,active:false,commands:[],liveTelemetry:[]}};
  const host={
    setTimeout(fn,delay=0){const id=++nextJob;delays.push(delay);jobs.set(id,{fn,at:clock+Math.max(0,delay)});return id;},
    clearTimeout(id){jobs.delete(id);},
    SimulatorEngine:{createPlayback(value){const controller=factory(value);controllers.push(controller);return controller;}}
  };
  const timeHost={};
  vm.runInNewContext(read('TimeControls').match(/<script>([\s\S]*?)<\/script>/)[1],{window:timeHost,Intl});
  const context=vm.createContext({state,window:host,SimulatorEngine:host.SimulatorEngine,
    document:{getElementById:element,querySelectorAll:()=>[]},performance:{now:()=>clock},
    roundSession:null,runGeneration:0,cloneJson:copy,
    createStoredRunConfiguration:()=>copy(input.run),prepareCalendarRun:value=>copy(value),
    activePersistentSimulation:()=>tab,autosave:{change(){},pending:()=>false},
    STReports:{bindChartExports(){}},STTimeControls:{...timeHost.STTimeControls,setOutput:(node,seconds)=>node.seconds=seconds},
    formatNumber:String,formatRatePerMinute:value=>String(value*60),formatPercent:value=>String(value*100),
    isFiniteNumber:Number.isFinite,sum:values=>values.reduce((a,b)=>a+(Number(b)||0),0),
    syncRunControls(){},captureSimulationView(){},finishRoundSession(){},setStatus(){},
    showError:error=>errors.push(error),
    __ST_TEXT__:key=>key,__ST_HTML_TEXT__:key=>key
  });
  // All playback functions execute from the actual production source. Replace
  // only unrelated canvas/layout boundaries with observing test adapters.
  vm.runInContext(read('ClientPlayback'),context);
  load(context,read('ClientSimulation'),['copyRunConfiguration']);
  Object.assign(context,{
    updateNumericalEquipmentVisibility:()=>true,captureLiveEquipmentScrollAnchor:()=>null,
    restoreLiveEquipmentScrollAnchor(){},drawSimulationChart(){},drawEquipmentSpeedChart(){},
    renderLiveEquipment:sample=>equipmentFrames.push(sample),
    refreshNumericalOverviewFromSample(){},updateLiveEquipmentStateBadges(){},
    findSampleIndexAtOrBefore(samples,second){let index=0;while(index+1<samples.length&&samples[index+1].virtualSecond<=second+1e-8)index++;return index;}
  });
  const render=context.renderPlaybackFrame;
  context.renderPlaybackFrame=function(){render();renders.push({clock,
    frame:context.playbackVisualSample(),displaySecond:element('metric-time').seconds,
    output:element('metric-output').textContent});};
  async function settle(){for(let n=0;n<12;n++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));}
  async function tick(milliseconds){
    const end=clock+milliseconds;let iterations=0;
    while(true){
      const ordered=[...jobs].sort((a,b)=>a[1].at-b[1].at),next=ordered[0];
      if(!next||next[1].at>end)break;
      assert(++iterations<10000,'Playback scheduler must make forward progress');
      jobs.delete(next[0]);clock=next[1].at;next[1].fn();await settle();
    }
    clock=end;await settle();
  }
  return {context,state,input,element,tab,renders,equipmentFrames,delays,controllers,errors,tick,settle,
    pending:()=>jobs.size,close(){context.disposeNumericalPlayback?.();for(const controller of controllers)controller.close();
      assert.deepEqual(errors.map(error=>error.code||error.message),[],'Playback must not report a calculation failure');}};
}

test('the shown 1 s and 20 FPS choices reach the run configuration unchanged',()=>{
  const values={
    'run-sample-interval':{value:'1'},'run-sample-interval-unit':{value:'SECONDS'},
    'run-display-fps':{value:'20'},'run-seed':{value:'7'},
    'duration-mode':{value:'FIXED'},'run-shift-hours':{value:'8'},
    'run-shift-count':{value:'1'},'run-rounds':{value:'1'}
  };
  const host={};
  vm.runInNewContext(read('TimeControls').match(/<script>([\s\S]*?)<\/script>/)[1],{window:host,Intl});
  const context=vm.createContext({
    state:{run:{commands:[]}},document:{getElementById:id=>values[id]},
    STRunOptions:{read:()=>({durationSeconds:86400,calculationMode:'LIVE'})},
    STProducts:{runFields:()=>({})},STTimeControls:host.STTimeControls,
    activePersistentSimulation:()=>({dynamicConfig:{}}),cloneJson:copy,
    showError:error=>assert.fail(JSON.stringify(error))
  });
  load(context,read('ClientSimulation'),['readRunConfiguration']);
  const run=context.readRunConfiguration();
  assert.equal(run.durationSeconds,86400);
  assert.equal(run.sampleEverySeconds,1);
  assert.equal(run.displayRefreshFps,20);
  assert.equal(run.tickSeconds,.25,'The physical engine resolves its own effective tick');
});

test('recording controls explain chart sampling separately from live screen refresh in both languages',()=>{
  const markup=read('WebApp'),language=read('Language');
  assert.match(markup,/>Chart sample interval<span/);
  const note='Chart sampling uses simulated time. Live values update from the current calculated state; FPS sets the maximum screen refresh rate. Saved history may be summarized.';
  assert(markup.includes(note));
  assert(language.includes(JSON.stringify(note)));
  assert(language.includes('Intervalo de muestreo de gráficas'));
  const resources=fs.readFileSync(new URL('../apps-script/TextResources.gs',import.meta.url),'utf8');
  assert(!resources.includes('The engine integrates at 0.25 s;'));
});

test('live chart samples use measured playback frames while Results retains saved history',()=>{
  const saved=[{virtualSecond:0,equipment:[]},{virtualSecond:1210,equipment:[]}];
  const live=[{virtualSecond:0,equipment:[]},{virtualSecond:1,equipment:[]},{virtualSecond:1.05,equipment:[]}];
  const state={uiView:'simulation',run:{result:{samples:saved},sampleIndex:0,configuration:{}}};
  const context=vm.createContext({state,rollingCache:null,
    playbackView:()=>({samples:live,index:live.length-1}),
    STRunOptions:{windowSeconds:()=>60}
  });
  load(context,read('Charts'),['getRollingSpeedSamples']);
  const first=context.getRollingSpeedSamples();
  assert.deepEqual(copy(first),live);
  assert.equal(context.getRollingSpeedSamples(),first,'All visible cards share the same chart selection');
  live.shift();live.push({virtualSecond:1.1,equipment:[]});
  const next=context.getRollingSpeedSamples();
  assert.notEqual(next,first,'A same-length rolling window must invalidate the cache');
  assert.equal(next.at(-1).virtualSecond,1.1);
  state.uiView='results';
  assert.deepEqual(copy(context.getRollingSpeedSamples()),saved);
  assert.deepEqual(saved,[{virtualSecond:0,equipment:[]},{virtualSecond:1210,equipment:[]}]);
});

test('a day-long saved replay at 1 s and 20 FPS shows newly calculated values before its next saved sample',async()=>{
  const h=playbackHarness();
  try{
    const storedBefore=JSON.stringify(h.state.run.result.samples);
    h.context.startPlayback();await h.settle();await h.tick(2200);
    assert.equal(h.controllers.length,1,'Replay reconstructs one calculation cursor from its saved inputs');
    assert(h.renders.length>=20,'20 FPS must schedule frequent measured frames');
    const last=h.renders.at(-1);
    assert(last.frame.virtualSecond>=2&&last.frame.virtualSecond<3);
    assert(Number(last.output)>8,'Real production advances while the next saved sample is twenty minutes away');
    assert(new Set(h.renders.map(row=>row.output)).size>8,'Timers must produce fresh numeric values, not only repaint');
    assert(h.renders.every(row=>Math.abs(row.displaySecond-row.frame.virtualSecond)<1e-8),
      'The displayed clock and displayed numbers must belong to the same calculated state');
    assert.equal(h.equipmentFrames.at(-1),last.frame,'Equipment cards consume the same full frame as global metrics');
    assert.equal(JSON.stringify(h.state.run.result.samples),storedBefore,'Live playback does not enlarge persisted replay');
    const chart=h.context.playbackChartView();
    assert(chart.samples.some(frame=>Math.abs(frame.virtualSecond-1)<1e-8),
      'One-second chart recording must remain one second despite the one-day horizon');
    assert(h.delays.some(delay=>delay===50),'The selected 20 FPS supplies a 50 ms refresh period');
  }finally{h.close();}
});

test('streamed result replacement does not restart the active numerical calculation cursor',async()=>{
  const h=playbackHarness();
  try{
    h.state.run.result.provisional=true;
    h.context.roundSession={streaming:true,pending:true};
    h.context.startPlayback();await h.settle();await h.tick(1000);
    const before=h.context.playbackVisualSample();
    h.state.run.result={...h.state.run.result,samples:h.state.run.result.samples.map(copy)};
    h.state.run.representative=h.state.run.result;
    await h.tick(1000);
    const after=h.context.playbackVisualSample();
    assert.equal(h.controllers.length,1,'Partial results are metadata updates for the same physical trajectory');
    assert(after.virtualSecond>before.virtualSecond);
    assert(after.outputCount>before.outputCount);
  }finally{h.close();}
});

test('pause holds the measured timestamp and resume continues with the same trajectory',async()=>{
  const h=playbackHarness();
  try{
    h.context.startPlayback();await h.settle();await h.tick(1500);
    h.context.pausePlayback();
    const paused=h.context.playbackVisualSample();
    const displayed=h.element('metric-time').seconds;
    await h.tick(3000);
    assert.equal(h.context.playbackVisualSample().virtualSecond,paused.virtualSecond);
    assert.equal(h.element('metric-time').seconds,displayed);
    assert.equal(h.context.playbackVisualSample().outputCount,paused.outputCount);
    h.context.startPlayback();await h.settle();await h.tick(1000);
    const resumed=h.context.playbackVisualSample();
    assert(resumed.virtualSecond>paused.virtualSecond);
    assert(resumed.virtualSecond<paused.virtualSecond+1.2,'Paused wall time must not become simulated time');
    assert(resumed.outputCount>paused.outputCount);
  }finally{h.close();}
});

test('changing visual FPS changes refresh scheduling without restarting or changing the physical inputs',async()=>{
  const received=[];
  const h=playbackHarness({factory:input=>{received.push(copy(input));return createNumericalPlayback(input);}});
  try{
    h.context.startPlayback();await h.settle();await h.tick(1000);
    const before=h.context.playbackVisualSample();
    h.element('run-display-fps').value='5';
    h.context.resetPlaybackPerformance();
    const earlierDelays=h.delays.length;
    await h.tick(1000);
    const after=h.context.playbackVisualSample();
    assert.equal(h.controllers.length,1,'FPS is a presentation choice, not a new simulation');
    assert.equal(received.length,1);
    assert.equal(received[0].run.sampleEverySeconds,1);
    assert.deepEqual(received[0].case.equipment,h.input.case.equipment);
    assert(h.delays.slice(earlierDelays).some(delay=>delay===200),'5 FPS uses a 200 ms visual period');
    assert(after.virtualSecond>before.virtualSecond);
    assert(after.outputCount>before.outputCount);
  }finally{h.close();}
});

test('reopening a saved view reconstructs its precise time even when the compact history has no matching frame',async()=>{
  const h=playbackHarness();
  try{
    h.tab.results.view={virtualSecond:3.725,roundIndex:0,roundTimes:{0:3.725}};
    h.state.run.result=null;h.state.run.representative=null;
    Object.assign(h.context,{cancelRoundSession(){},toggle(){},applyScenarioRunInputs(){},
      syncPlaybackRounds(){},renderEditor(){},renderResultJsonPreview(){},renderSimulationAnalysis(){},shell:{sync(){}}});
    load(h.context,read('ClientSimulation'),['activatePersistentSimulation','expandStoredReplay',
      'copyRunConfiguration','playbackRoundFrame','playbackRoundPositions','captureSimulationView']);
    h.context.activatePersistentSimulation('s1',true);
    assert.equal(h.state.run.sampleIndex,0,'Saved history has no frame at the exact view time');
    assert.equal(h.state.run._resumeVirtualSecond,3.725);
    h.context.startPlayback();await h.settle();await h.tick(0);
    const restored=h.context.playbackVisualSample();
    assert(Math.abs(restored.virtualSecond-3.725)<1e-8);
    assert.equal(h.element('metric-time').seconds,restored.virtualSecond);
    assert(restored.outputCount>0);
    h.context.pausePlayback();
    assert.equal(h.tab.results.view.virtualSecond,restored.virtualSecond,
      'Saving the view uses the measured time, not the earlier compact-history index');
  }finally{h.close();}
});

test('a pending calculated response cannot move the paused display or add paused wall time on resume',async()=>{
  let defer=false,held=null;
  const h=playbackHarness({factory:input=>{
    const real=createNumericalPlayback(input);
    const wrapper=Object.create(real);
    wrapper.advanceTo=async(...args)=>{
      const frame=await real.advanceTo(...args);
      if(!defer)return frame;
      return new Promise((resolve,reject)=>{held={frame,resolve,reject};});
    };
    wrapper.close=()=>{held?.reject(Object.assign(new Error('PLAYBACK_CLOSED'),{code:'PLAYBACK_CLOSED'}));held=null;real.close();};
    return wrapper;
  }});
  try{
    h.context.startPlayback();await h.settle();await h.tick(1000);
    defer=true;await h.tick(50);assert(held);
    h.context.pausePlayback();const paused=h.context.playbackVisualSample();
    const response=held;held=null;response.resolve(response.frame);await h.settle();
    await h.tick(3000);
    assert.equal(h.context.playbackVisualSample().virtualSecond,paused.virtualSecond);
    assert.equal(h.element('metric-time').seconds,paused.virtualSecond);
    defer=false;h.context.startPlayback();await h.settle();await h.tick(500);
    const resumed=h.context.playbackVisualSample();
    assert(resumed.virtualSecond>paused.virtualSecond);
    assert(resumed.virtualSecond<paused.virtualSecond+.7);
  }finally{h.close();}
});

test('a live equipment control uses the displayed measured timestamp instead of the compact-history timestamp',async()=>{
  const h=playbackHarness();let recalculation;
  try{
    h.context.startPlayback();await h.settle();await h.tick(1500);
    const current=h.context.playbackVisualSample();
    assert(current.virtualSecond>h.state.run.result.samples[h.state.run.sampleIndex].virtualSecond);
    h.context.calculateSimulation=async(run,resumeAt)=>{recalculation={run,resumeAt};return false;};
    await h.context.applyLiveScenarioControl('source','PAUSE');
    assert(recalculation);
    assert.equal(recalculation.run.commands.at(-1).atVirtualSecond,current.virtualSecond);
    assert.equal(recalculation.resumeAt,current.virtualSecond);
  }finally{h.close();}
});

test('resuming before a pending frame arrives never asks the physical cursor to rewind',async()=>{
  let defer=false,held=null;
  const h=playbackHarness({factory:input=>{
    const real=createNumericalPlayback(input),wrapper=Object.create(real);
    wrapper.advanceTo=async(...args)=>{
      const frame=await real.advanceTo(...args);
      if(!defer)return frame;
      return new Promise((resolve,reject)=>{held={frame,resolve,reject};});
    };
    wrapper.close=()=>{held?.reject(Object.assign(new Error('PLAYBACK_CLOSED'),{code:'PLAYBACK_CLOSED'}));held=null;real.close();};
    return wrapper;
  }});
  try{
    h.context.startPlayback();await h.settle();await h.tick(1000);
    defer=true;await h.tick(50);assert(held);
    h.context.pausePlayback();const paused=h.context.playbackVisualSample();
    await h.tick(3000);
    h.context.startPlayback();
    assert.equal(h.context.playbackVisualSample().virtualSecond,paused.virtualSecond);
    const response=held;held=null;defer=false;
    response.resolve(response.frame);await h.settle();await h.tick(500);
    const resumed=h.context.playbackVisualSample();
    assert.equal(h.controllers.length,1);
    assert.equal(h.state.run.playing,true);
    assert(resumed.virtualSecond>=response.frame.virtualSecond);
    assert(resumed.virtualSecond<paused.virtualSecond+.7,'Time spent paused is excluded even with a request in flight');
  }finally{h.close();}
});

test('pause during saved-position reconstruction retains the restoration target on resume',async()=>{
  let defer=true,held=null;
  const requested=[];
  const h=playbackHarness({factory:input=>{
    const real=createNumericalPlayback(input),wrapper=Object.create(real);
    wrapper.advanceTo=async(target,options)=>{
      requested.push(target);
      const frame=await real.advanceTo(Math.min(target,real.time+.5),options);
      if(!defer)return frame;
      return new Promise((resolve,reject)=>{held={frame,resolve,reject};});
    };
    wrapper.close=()=>{held?.reject(Object.assign(new Error('PLAYBACK_CLOSED'),{code:'PLAYBACK_CLOSED'}));held=null;real.close();};
    return wrapper;
  }});
  try{
    h.state.run._resumeVirtualSecond=3.725;
    h.context.startPlayback();await h.settle();await h.tick(0);
    assert(held&&held.frame.virtualSecond<3.725,'The worker has only reconstructed part of the saved position');
    assert.equal(h.context.numericalPlaybackSession.ready,false);
    h.context.pausePlayback();const paused=h.context.playbackVisualSample();
    const response=held;held=null;response.resolve(response.frame);await h.settle();
    await h.tick(3000);
    assert.equal(h.context.playbackVisualSample().virtualSecond,paused.virtualSecond);
    defer=false;h.context.startPlayback();await h.settle();await h.tick(0);
    const restored=h.context.playbackVisualSample();
    assert.equal(h.context.numericalPlaybackSession.ready,true);
    assert(Math.abs(restored.virtualSecond-3.725)<1e-8,'The original saved target survives the pause');
    assert(requested.every(target=>target>=3.725-1e-8));
    assert.equal(h.element('metric-time').seconds,restored.virtualSecond);
    assert.equal(h.controllers.length,1);
  }finally{h.close();}
});

test('a recalculated live control remains in playback inputs when the result has no input signature',async()=>{
  const input=physicalInput();input.run.durationSeconds=12;
  const received=[];
  const h=playbackHarness({input,factory:value=>{received.push(copy(value));return createNumericalPlayback(value);}});
  try{
    Object.assign(h.context,{toggle(){},syncPlaybackRounds(){},renderResultJsonPreview(){},
      shell:{sync(){}},renderControlEvents(){},saveActiveCase(){},
      createStoredSimulationResult:result=>({replay:copy(result),summary:copy(result.summary)})});
    h.context.window.SimulatorEngine.simulateLineAsync=simulateLineAsync;
    load(h.context,read('ClientSimulation'),['calculateSimulation']);
    h.context.startPlayback();await h.settle();await h.tick(1500);
    const before=h.context.playbackVisualSample();
    await h.context.applyLiveScenarioControl('source','PAUSE');
    assert.equal(h.state.run.result.inputSignature,undefined,'This is the regular asynchronous result contract');
    await h.settle();await h.tick(2000);
    const after=h.context.playbackVisualSample();
    assert.equal(h.controllers.length,2,'The changed scenario needs its own physical cursor');
    assert.deepEqual(received[1].run.commands,[{atVirtualSecond:before.virtualSecond,equipmentId:'source',action:'PAUSE'}]);
    assert.equal(after.equipment.find(unit=>unit.id==='source').outputCount,
      before.equipment.find(unit=>unit.id==='source').outputCount,'The paused source must stop producing after recalculation');
    assert(after.virtualSecond>before.virtualSecond);
    assert.equal(h.state.run.playing,true);
  }finally{h.close();}
});

test('editing the equipment model closes an active cursor and discards its pending response',async()=>{
  let defer=false,held=null,closed=0;
  const h=playbackHarness({factory:input=>{
    const real=createNumericalPlayback(input,{onClose:()=>closed++}),wrapper=Object.create(real);
    wrapper.advanceTo=async(...args)=>{
      const frame=await real.advanceTo(...args);
      if(!defer)return frame;
      return new Promise((resolve,reject)=>{held={frame,resolve,reject};});
    };
    wrapper.close=()=>{held?.reject(Object.assign(new Error('PLAYBACK_CLOSED'),{code:'PLAYBACK_CLOSED'}));held=null;real.close();};
    return wrapper;
  }});
  try{
    h.context.toggle=()=>{};
    load(h.context,read('ClientSimulation'),['cancelRoundSession']);
    load(h.context,read('ClientCases'),['invalidateActiveResult']);
    h.context.startPlayback();await h.settle();await h.tick(1000);
    defer=true;await h.tick(50);assert(held);
    const count=h.renders.length;
    h.context.invalidateActiveResult();await h.settle();await h.tick(1000);
    assert.equal(closed,1);
    assert.equal(h.context.numericalPlaybackSession,null);
    assert.equal(h.state.run.result,null);
    assert.equal(h.state.run.playing,false);
    assert.equal(h.renders.length,count,'An obsolete response cannot redraw an edited scenario');
    assert.equal(h.pending(),0);
  }finally{h.close();}
});

test('cancelling background calculation does not invalidate an otherwise current playback cursor',async()=>{
  const h=playbackHarness();
  try{
    h.context.startPlayback();await h.settle();await h.tick(1000);
    const before=h.context.playbackVisualSample();
    // Background round cancellation changes runGeneration while preserving the
    // selected case, simulation, round and physical result.
    h.context.runGeneration++;
    await h.tick(1000);
    const after=h.context.playbackVisualSample();
    assert.equal(h.controllers.length,1);
    assert(after.virtualSecond>before.virtualSecond);
    assert(after.outputCount>before.outputCount);
    assert.equal(h.state.run.playing,true);
  }finally{h.close();}
});
