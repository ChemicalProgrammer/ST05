import {readClientSource} from '../scripts/render-apps-script.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('1000x skips samples and 1x resumes from the paused virtual time without changing results',()=>{
 const code=readClientSource();
 const samples=Array.from({length:101},(_,i)=>({virtualSecond:i}));
 const state={run:{result:{samples,summary:{outputCount:77}},sampleIndex:0,playing:true}};
 const before=JSON.stringify(state.run.result);let callback,now=0,delay,finished=0,captured=0,saveChanges=0;
 const context={state,playbackClock:null,playbackMetricTimer:null,roundSession:null,captureSimulationView(){captured++;},autosave:{change(){saveChanges++;}},performance:{now:()=>now},document:{getElementById:()=>({value:'1000'})},window:{setTimeout:(fn,ms)=>{callback=fn;delay=ms;return 1;},clearTimeout(){}},renderPlaybackFrame(){},syncRunControls(){},setPlaybackStatus(){},finishRoundSession(){finished++;}};
 vm.createContext(context);
 for(const name of ['findSampleIndexAtOrBefore','schedulePlaybackStep','playbackElapsed','stopPlaybackTimer']){
  const start=code.indexOf('    function '+name+'('),end=code.indexOf('\n    function ',start+10);
  vm.runInContext(code.slice(start,end),context);
 }
 vm.runInContext('schedulePlaybackStep()',context);assert.equal(delay,35);
 now=35;callback();assert.equal(state.run.sampleIndex,35);
 now=105;callback();assert.equal(state.run.sampleIndex,100);assert.equal(state.run.playing,false);
 assert.equal(finished,1);assert.equal(captured,1);assert.equal(saveChanges,1);
 assert.equal(JSON.stringify(state.run.result),before);
 state.run.sampleIndex=0;state.run.playing=true;
 context.document.getElementById=()=>({value:'1'});
 vm.runInContext('schedulePlaybackStep()',context);
 assert.equal(delay,1000);
 now+=250;
 assert.equal(vm.runInContext('playbackElapsed(state.run.result.samples[0])',context),.25);
 vm.runInContext('stopPlaybackTimer(true)',context);
 now+=500;
 assert.equal(vm.runInContext('playbackElapsed(state.run.result.samples[0])',context),.25);
 state.run.playing=true;
 vm.runInContext('schedulePlaybackStep()',context);
 assert.equal(delay,750);

});


test('completing a batch keeps the final playback frame and saves that view',()=>{
 const code=readClientSource(),samples=[{virtualSecond:0,outputCount:0},{virtualSecond:42,outputCount:77}];
 const state={run:{result:{samples},sampleIndex:1,roundIndex:0}};
 const result={samples,batch:{representativeRound:2}};
 const tab={};
 const context={state,result,session:{run:{rounds:3,calculationMode:'LIVE'}},roundSessionActive:()=>true,
   syncPlaybackRounds(){},selectPlaybackRound(){assert.fail('completion switched the playback round');},
   toggle(){},renderResultJsonPreview(){},shell:{sync(){}},renderPlaybackFrame(){},
   activePersistentSimulation:()=>tab,cloneJson:value=>JSON.parse(JSON.stringify(value)),
   createStoredSimulationResult:()=>({}),captureSimulationView(){tab.results.view={virtualSecond:state.run.result.samples[state.run.sampleIndex].virtualSecond};},
   saveActiveCase(){}};
 vm.createContext(context);
 for(const name of ['findSampleIndexAtOrBefore','persistRoundResult']){
  const start=code.indexOf('    function '+name+'('),end=code.indexOf('\n    function ',start+10);
  vm.runInContext(code.slice(start,end),context);
 }
 vm.runInContext("persistRoundResult(session,result,'COMPLETE')",context);
 assert.equal(state.run.result.samples[state.run.sampleIndex].outputCount,77);
 assert.equal(tab.results.view.virtualSecond,42);
 state.run.sampleIndex=0;context.session.run.calculationMode='FAST';
 vm.runInContext("persistRoundResult(session,result,'COMPLETE')",context);
 assert.equal(state.run.sampleIndex,1);
 result.effectiveRuntimeStop={status:'REACHED'};
 context.session.run.calculationMode='LIVE';
 vm.runInContext("persistRoundResult(session,result,'COMPLETE')",context);
 assert.equal(state.run.sampleIndex,1);
});

test('starting a new run clears the previous round and replay before calculation',()=>{
 const code=readClientSource(),tab={results:{summary:{outputCount:77}}},preview={value:'old'};
 const state={run:{result:tab.results,representative:tab.results,configuration:{},sampleIndex:42,roundIndex:2}};
 const context={state,activePersistentSimulation:()=>tab,cancelRoundSession(){},stopPlaybackTimer(){},
   document:{getElementById:()=>preview},toggle(id,visible){assert.equal(id,'simulation-results');assert.equal(visible,false);}};
 vm.createContext(context);
 const start=code.indexOf('    function invalidateActiveResult('),end=code.indexOf('\n    function ',start+10);
 vm.runInContext(code.slice(start,end)+'\ninvalidateActiveResult();',context);
 assert.equal(tab.results,null);
 assert.equal(state.run.result,null);
 assert.equal(state.run.representative,null);
 assert.equal(state.run.sampleIndex,0);
 assert.equal(state.run.roundIndex,0);
 assert.equal(preview.value,'');
});

test('numerical playback throttles visual frames without changing the virtual sample sequence',()=>{
 const code=readClientSource();
 const samples=Array.from({length:101},(_,i)=>({virtualSecond:i}));
 const state={run:{result:{samples},sampleIndex:0,playing:true,active:true}};
 let callback=null,delay=0,clock=0,rendered=0,completed=0;
 const context={
   state,roundSession:null,playbackClock:null,
   playbackRenderStats:{lastPaintAt:-Infinity},
   playbackRefreshIntervalMs:()=>100,
   performance:{now:()=>clock},
   document:{getElementById:()=>({value:'100'})},
   window:{setTimeout(fn,ms){callback=fn;delay=ms;return 1;},clearTimeout(){}},
   renderPlaybackFrame(){rendered++;context.playbackRenderStats.lastPaintAt=clock;},
   syncRunControls(){},setPlaybackStatus(){},captureSimulationView(){},
   autosave:{change(){}},finishRoundSession(){completed++;}
 };
 vm.createContext(context);
 for(const name of ['findSampleIndexAtOrBefore','schedulePlaybackStep','playbackElapsed']){
   const start=code.indexOf('    function '+name+'('),end=code.indexOf('\n    function ',start+10);
   assert.ok(start>=0&&end>start,'missing '+name);
   vm.runInContext(code.slice(start,end),context);
 }
 vm.runInContext('schedulePlaybackStep()',context);
 let callbacks=0;
 while(callback&&state.run.playing&&callbacks<200){
   const next=callback;callback=null;clock+=delay;callbacks++;next();
 }
 assert.equal(state.run.sampleIndex,100);
 assert.equal(completed,1);
 assert.ok(rendered<callbacks,'visual rendering should skip intermediate playback callbacks');
 assert.ok(rendered>=2,'the first and final frames must be rendered');
});


test('Live sample replacement keeps virtual clock monotonic and updates the actual equipment frame',()=>{
 const code=readClientSource();
 const sample=(second,units)=>({virtualSecond:second,outputCount:units,
   equipment:[{id:'blow',processedUnits:units}]});
 const first=[sample(1200,6932),sample(2400,7200)];
 const state={run:{result:{samples:first,provisional:true},sampleIndex:0,
   playing:true,active:true,timer:null,_displayedVirtualSecond:1200}};
 let now=0,rendered=[],jobs=[],nextJob=0;
 const context={state,roundSession:{streaming:true},playbackClock:null,
   playbackRenderStats:{lastPaintAt:-Infinity},playbackRefreshIntervalMs:()=>100,
   performance:{now:()=>now},document:{getElementById:()=>({value:'1000'})},
   window:{setTimeout(fn,ms){const id=++nextJob;jobs.push({id,fn,ms});return id;},
     clearTimeout(id){jobs=jobs.filter(job=>job.id!==id);}},
   renderPlaybackFrame(){rendered.push(state.run.sampleIndex);context.playbackRenderStats.lastPaintAt=now;},
   syncRunControls(){},setPlaybackStatus(){},captureSimulationView(){},
   autosave:{change(){}},finishRoundSession(){},
   findSampleIndexAtOrBefore(samples,second){
     let i=0;while(i+1<samples.length&&samples[i+1].virtualSecond<=second)i++;
     return i;
   }};
 vm.createContext(context);
 const names=['schedulePlaybackStep','playbackElapsed','playbackDisplaySecond','advancePlaybackToRecordedFrame'];
 for(const name of names){
   const start=code.indexOf('    function '+name+'('),end=code.indexOf('\n    function ',start+10);
   assert.ok(start>=0&&end>start,'Missing '+name);
   vm.runInContext(code.slice(start,end),context);
 }
 vm.runInContext('schedulePlaybackStep()',context);
 now=400;
 const t400=vm.runInContext('playbackDisplaySecond(state.run.result.samples[0])',context);
 // Reproduce a worker sending a new cloned partial result during playback.
 state.run.result={...state.run.result,samples:[...first.map(item=>({...item})),sample(3000,7600)]};
 now=700;
 const t700=vm.runInContext('playbackDisplaySecond(state.run.result.samples[0])',context);
 now=1200;
 assert.equal(vm.runInContext('advancePlaybackToRecordedFrame()',context),true);
 assert.equal(state.run.sampleIndex,1,'Cursor must reach measured frame instead of leaving all counters frozen');
 const t1200=vm.runInContext('playbackDisplaySecond(state.run.result.samples[1])',context);
 state.run.result={...state.run.result,samples:state.run.result.samples.map(item=>({...item}))};
 now=1450;
 const t1450=vm.runInContext('playbackDisplaySecond(state.run.result.samples[1])',context);
 assert.deepEqual([t400,t700,t1200,t1450],[1600,1900,2400,2650],
   'Virtual clock must not jump backward across streamed object replacements');
 assert.equal(state.run.result.samples[state.run.sampleIndex].equipment[0].processedUnits,7200);
 assert.ok(rendered.includes(1),'Recorded equipment frame must be repainted');
});

test('Paused numerical replay resumes the exact virtual offset with an advancing clock',()=>{
 const code=readClientSource();
 const samples=[{virtualSecond:0},{virtualSecond:1},{virtualSecond:2}];
 const state={run:{result:{samples},sampleIndex:0,playing:true,timer:null}};
 let now=100,delay=0;
 const context={state,roundSession:null,playbackClock:null,playbackMetricTimer:null,
   playbackRenderStats:{lastPaintAt:-Infinity},playbackRefreshIntervalMs:()=>100,
   performance:{now:()=>now},document:{getElementById:()=>({value:'1'})},
   window:{setTimeout(fn,ms){delay=ms;return 1;},clearTimeout(){}},
   renderPlaybackFrame(){context.playbackRenderStats.lastPaintAt=now;},
   syncRunControls(){},setPlaybackStatus(){},captureSimulationView(){},
   autosave:{change(){}},finishRoundSession(){}};
 vm.createContext(context);
 for(const name of ['schedulePlaybackStep','playbackElapsed','stopPlaybackTimer']){
   const start=code.indexOf('    function '+name+'('),end=code.indexOf('\n    function ',start+10);
   vm.runInContext(code.slice(start,end),context);
 }
 vm.runInContext('schedulePlaybackStep()',context);
 assert.equal(delay,1000);
 now=350;
 vm.runInContext('stopPlaybackTimer(true)',context);
 now=850;
 assert.equal(vm.runInContext('playbackElapsed(state.run.result.samples[0])',context),.25);
 state.run.playing=true;
 vm.runInContext('schedulePlaybackStep()',context);
 assert.equal(delay,750,'Resume should not restart the full sample delay');
 now=1100;
 assert.equal(vm.runInContext('playbackElapsed(state.run.result.samples[0])',context),.5);
});


test('Recorded numeric samples refresh between expensive chart frames during high-speed playback',()=>{
 const code=readClientSource();
 const samples=Array.from({length:101},(_,i)=>({virtualSecond:i,outputCount:i}));
 const state={run:{result:{samples},sampleIndex:0,playing:true,active:true}};
 let now=0,callback,delay,charts=0,light=[];
 const stats={lastPaintAt:-Infinity};
 const context={state,roundSession:null,playbackClock:null,playbackRenderStats:stats,
   playbackRefreshIntervalMs:()=>100,performance:{now:()=>now},
   document:{getElementById:()=>({value:'1000'})},
   window:{setTimeout(fn,ms){callback=fn;delay=ms;return 1;},clearTimeout(){}},
   renderPlaybackFrame(){charts++;stats.lastPaintAt=now;stats.lastNumericPaintAt=now;},
   refreshPlaybackMetricCards(frame){light.push(['kpi',frame.virtualSecond]);},
   refreshNumericalOverviewFromSample(){light.push(['equipment',state.run.sampleIndex]);},
   syncRunControls(){},setPlaybackStatus(){},captureSimulationView(){},
   autosave:{change(){}},finishRoundSession(){},};
 state.uiView='simulation';
 vm.createContext(context);
 for(const name of ['findSampleIndexAtOrBefore','schedulePlaybackStep','playbackElapsed']){
   const start=code.indexOf('    function '+name+'('),end=code.indexOf('\n    function ',start+10);
   assert.ok(start>=0&&end>start);
   vm.runInContext(code.slice(start,end),context);
 }
 vm.runInContext('schedulePlaybackStep()',context);
 assert.equal(charts,1);
 now=35;callback();
 assert.equal(state.run.sampleIndex,35);
 assert.equal(charts,1,'Full chart render remains FPS-limited');
 now=70;callback();
 assert.equal(state.run.sampleIndex,70);
 assert.deepEqual(light,[['kpi',35],['equipment',35]],
   'Equipment data must change from the actual new sample before the next chart redraw');
 assert.equal(charts,1);
 now=105;callback();
 assert.equal(charts,2,'Heavy frame refresh retains its original configured cadence');
});
