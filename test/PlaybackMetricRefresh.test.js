import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readClientSource} from '../scripts/render-apps-script.mjs';

const source=readClientSource();
function loadFunctions(context,names){
  vm.createContext(context);
  for(const name of names){
    const start=source.indexOf('    function '+name+'(');
    const end=source.indexOf('\n    function ',start+10);
    assert.ok(start>=0&&end>start,'Missing function '+name);
    vm.runInContext(source.slice(start,end),context);
  }
}

test('Playback numeric cards refresh within 500ms independently of recorded sample frames',()=>{
  const samples=[
    {virtualSecond:0,outputCount:10,runtimeLossSeconds:0,effectiveRuntimeSeconds:0,buffers:[5],equipment:[{backupStopSeconds:0}],accumulationZones:[]},
    {virtualSecond:10,outputCount:20,runtimeLossSeconds:1,effectiveRuntimeSeconds:9,buffers:[3],equipment:[{backupStopSeconds:2}],accumulationZones:[]}
  ];
  const result={samples,durationSeconds:10,summary:{outputCount:20}};
  const before=JSON.stringify(result);
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id);};
  let now=0,callback=null,delay=null,draws=0;
  const state={run:{result,sampleIndex:0,playing:true,timer:null}};
  const context={
    state,playbackClock:{frame:samples[0],offset:0,rate:1,started:0},playbackMetricTimer:null,
    PLAYBACK_METRIC_REFRESH_MS:250,
    window:{setTimeout(fn,ms){callback=fn;delay=ms;return 123;},clearTimeout(){}},
    performance:{now:()=>now},
    document:{getElementById:element},
    STTimeControls:{setOutput(node,seconds){node.seconds=seconds;}},
    formatNumber:value=>String(value),
    formatRatePerMinute:value=>value.toFixed(1)+' /min',
    formatInstantaneousOutputRate:()=> '—',
    formatLineOeeAtSample:()=> '—',
    sum:values=>values.reduce((a,b)=>a+Number(b||0),0),
    setPlaybackStatus:status=>{element('playback-status').textContent=status;},
    renderPlaybackFrame:()=>{draws++;}
  };
  loadFunctions(context,['playbackElapsed','playbackDisplaySecond','refreshPlaybackMetricCards','schedulePlaybackMetricTick','stopPlaybackTimer']);
  vm.runInContext('schedulePlaybackMetricTick()',context);
  assert.ok(delay<=500&&delay>0,'Numeric UI interval must not exceed 500 milliseconds');
  for(const elapsed of [250,500,750]){
    const next=callback;assert.equal(typeof next,'function');
    now=elapsed;next();
    assert.equal(element('metric-time').seconds,elapsed/1000,'Virtual clock updates independently of samples');
    assert.equal(element('playback-progress').textContent,(elapsed/100).toFixed(1)+'%');
    assert.equal(element('metric-output').textContent,'10','No synthetic output between samples');
    assert.equal(element('metric-buffer').textContent,'5');
    assert.equal(element('playback-status').textContent,'Playing');
  }
  assert.equal(draws,0,'Light indicator refresh must not redraw costly graphs');
  assert.equal(JSON.stringify(result),before,'Recorded samples remain untouched');
  state.run.sampleIndex=1;context.playbackClock={frame:samples[1],offset:0,rate:1,started:now};
  const last=callback;last();
  assert.equal(element('metric-output').textContent,'20','The next real sample updates the counters');
  assert.equal(element('metric-buffer').textContent,'3');
  state.run.playing=false;
  state.run.sampleIndex=0;
  context.playbackClock={frame:samples[0],offset:.75,rate:1,started:null};
  assert.equal(vm.runInContext('playbackDisplaySecond(state.run.result.samples[0])',context),.75,
    'The paused display retains the exact elapsed virtual time');
  let canceled=0;context.window.clearTimeout=()=>{canceled++};
  vm.runInContext('stopPlaybackTimer()',context);
  assert.ok(canceled>=1,'The display timer is canceled when playback stops');
});

test('Subsection title is independent, while description and progress share row when space allows',()=>{
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  const styles=fs.readFileSync('apps-script/UiStandards.html','utf8');
  const start=web.indexOf('<section id="simulation-playback"');
  const heading=web.slice(start,web.indexOf('<div class="playback-toolbar',start));
  assert.match(heading,/class="subsection-heading-copy"/);
  assert.match(heading,/<h3 class="subsection-heading-title"/);
  assert.match(heading,/class="subsection-playback-meta"/);
  assert.match(heading,/<p class="subsection-description">[\s\S]*?<p id="simulation-playback-status">/);
  assert.match(styles,/#simulation-playback \.subsection-playback-meta \{[\s\S]*?display:flex;flex-wrap:wrap/);
  assert.match(styles,/#simulation-playback \.fold-heading \.subsection-playback-meta > \.subsection-description \{[\s\S]*?white-space:normal/);
  assert.match(styles,/#simulation-playback \.fold-heading #simulation-playback-status \{[\s\S]*?white-space:nowrap/);
});

test('Numerical Live, Fast and Summary cards distinguish completion from paused playback',()=>{
  const samples=[
    {virtualSecond:0,outputCount:0,runtimeLossSeconds:0,effectiveRuntimeSeconds:0,buffers:[],equipment:[{backupStopSeconds:0}],accumulationZones:[]},
    {virtualSecond:60,outputCount:120,runtimeLossSeconds:3,effectiveRuntimeSeconds:57,buffers:[],equipment:[{backupStopSeconds:0}],accumulationZones:[]}
  ];
  const result={samples,durationSeconds:60,summary:{outputCount:120},detailCoverage:{recordingMode:'BOUNDED'}};
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id);};
  const state={run:{result,sampleIndex:1,playing:false}};
  const context={state,
    document:{getElementById:element},
    playbackDisplaySecond:sample=>sample.virtualSecond,
    STTimeControls:{setOutput(node,seconds){node.seconds=seconds;}},
    formatNumber:value=>String(value),
    formatRatePerMinute:value=>String(value*60),
    formatLineOeeAtSample:()=> '—',
    sum:values=>values.reduce((a,b)=>a+Number(b||0),0),
    setPlaybackStatus:status=>{element('playback-status').textContent=status;}
  };
  loadFunctions(context,['formatInstantaneousOutputRate','refreshPlaybackMetricCards']);
  vm.runInContext('refreshPlaybackMetricCards()',context);
  assert.equal(element('playback-status').textContent,'Completed','Finished Fast calculation is not paused');
  assert.equal(element('metric-instant-rate').textContent,'120','Fast mode uses recorded consecutive samples');
  result.detailCoverage.recordingMode='SUMMARY';
  vm.runInContext('refreshPlaybackMetricCards()',context);
  assert.equal(element('playback-status').textContent,'Completed','Summary-only output remains visible at completion');
  assert.equal(element('metric-instant-rate').textContent,'—','Summary endpoints do not imply an instantaneous rate');
  result.provisional=true;
  vm.runInContext('refreshPlaybackMetricCards()',context);
  assert.equal(element('playback-status').textContent,'Paused','A provisional Live chunk is not marked completed');
  state.run.playing=true;
  vm.runInContext('refreshPlaybackMetricCards()',context);
  assert.equal(element('playback-status').textContent,'Playing');
});

test('Numerical card frames avoid repeated input locking when the playback state does not change',()=>{
  assert.match(source,/var playbackControlSignature=null,playbackBoundExportResult=null;/);
  assert.match(source,/if\(controlSignature!==playbackControlSignature\)\{[\s\S]*?syncRunControls\(\);[\s\S]*?playbackBoundExportResult=state\.run\.result;/);
  assert.match(source,/else if\(state\.run\.result!==playbackBoundExportResult&&!state\.run\.result\?\.provisional\)/);
});


test('Live equipment telemetry is selected by displayed time without overwriting recorded history',()=>{
 const history=[{virtualSecond:0,outputCount:0},{virtualSecond:60,outputCount:480}];
 const telemetry=[{virtualSecond:0,outputCount:0},
   {virtualSecond:10,outputCount:80},{virtualSecond:20,outputCount:160},
   {virtualSecond:30,outputCount:240}];
 const state={run:{result:{samples:history},sampleIndex:0,playing:true,liveTelemetry:telemetry}};
 const before=JSON.stringify(state.run.result);
 const context={state,playbackClock:null,playbackDisplaySecond:()=>25};
 loadFunctions(context,['playbackVisualSample']);
 assert.equal(vm.runInContext('playbackVisualSample().outputCount',context),160,
   'The newest measured point at or before 25 seconds is 160 bottles');
 context.playbackDisplaySecond=()=>35;
 assert.equal(vm.runInContext('playbackVisualSample().outputCount',context),240);
 state.run.playing=false;
 assert.equal(vm.runInContext('playbackVisualSample().outputCount',context),0,
   'Saved replay is the fallback outside running Live visualization');
 assert.equal(JSON.stringify(state.run.result),before,'Live telemetry never mutates the recorded samples');
});

test('Lightweight Live playback targets at least eight refresh opportunities per second',()=>{
 const code=fs.readFileSync('apps-script/ClientPlayback.html','utf8');
 assert.match(code,/PLAYBACK_METRIC_REFRESH_MS=125/);
 assert.match(code,/function playbackVisualSample\(/);
 assert.match(code,/refreshNumericalOverviewFromSample\(\)/);
 const batch=fs.readFileSync('apps-script/ClientSimulation.html','utf8');
 assert.match(batch,/state\.run\.liveTelemetry=stored\.concat\(partial\.liveTelemetry\)\.slice\(-5001\)/);
 assert.match(batch,/delete result\.liveTelemetry/,'Transient telemetry is not persisted with the case');
});
