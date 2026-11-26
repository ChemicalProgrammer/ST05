import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps-script/ClientSimulation.html','utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));
const code=extract('    function roundSessionActive(','    function finishRoundSession(');

function fixture(){
 const calls=[],raf=[],timers=[],tab={id:'sim'},state={activeCase:{id:'case',simulations:[tab]},activeSimulationId:'sim',run:{active:true,playing:false,sampleIndex:0,roundIndex:0}};
 const run={rounds:3,seed:17,calculationMode:'FAST',durationSeconds:10};
 const session={caseId:'case',simulationId:'sim',caseModel:{equipment:[]},run,compact:true,generation:0,version:0};
 const ready=new Promise(resolve=>session.resolveFirst=resolve);
 let finishBatch,options;
 const result={inputSignature:'test',samples:[{virtualSecond:0},{virtualSecond:10}],summary:{outputCount:10}};
 const context={
  state,roundSession:session,performance:{now:()=>0},window:{dispatchEvent(){},requestAnimationFrame:fn=>raf.push(fn)},CustomEvent:function(){},
  document:{visibilityState:'visible',getElementById(){return {value:'',textContent:''};}},
  setTimeout:fn=>timers.push(fn),SimulatorEngine:{simulateBatch(input,o){options=o;return new Promise(resolve=>finishBatch=resolve);}},
  cloneJson:x=>JSON.parse(JSON.stringify(x)),prepareCalendarRun:r=>r,syncRunControls:()=>calls.push('controls'),
  syncBatchProgress:()=>calls.push('progress'),syncPlaybackRounds:()=>calls.push('rounds'),toggle:()=>{},
  shell:{sync(){calls.push('shell');}},renderPlaybackFrame:()=>calls.push('hiddenPlayback'),activePersistentSimulation:()=>tab,
  createStoredSimulationResult:r=>{calls.push('archive');return {summary:r.summary,replicationStatus:r.replicationStatus};},
  captureSimulationView:()=>calls.push('view'),saveActiveCase:()=>calls.push('legacySave'),autosave:{change(){calls.push('dirty');}},
  flushCase:async()=>{calls.push('save');},showError:e=>calls.push('error:'+e.message),renderSimulationAnalysis:()=>calls.push('hiddenAnalysis'),
  updatePlaybackPerformanceLabel:()=>{},setStatus:()=>{},stopPlaybackTimer:()=>{},findSampleIndexAtOrBefore:()=>0,runGeneration:0,__ST_TEXT__:x=>x
 };
 const start=new Function(...Object.keys(context),code+'\nreturn computeRoundSession;')(...Object.values(context));
 start(session,undefined,run);
 return {state,tab,session,calls,raf,timers,options,ready,complete:()=>finishBatch({ok:true,result}),fail:()=>finishBatch({ok:false,error:{message:'validation'}})};
}

test('Basic publishes completed KPIs, archives once, and defers the save until a paint opportunity',async()=>{
 const h=fixture();
 assert(h.session.pending);assert.equal(h.options.onFirstRound,undefined);assert.equal(h.options.representativeReplay,false);
 assert.equal(h.tab.results,undefined);
 h.complete();assert.equal(await h.ready,true);
 assert.equal(h.tab.results.replicationStatus.state,'COMPLETE');assert.equal(h.tab.results.summary.outputCount,10);
 assert(!h.session.pending&&!h.state.run.active);
 assert.equal(h.calls.filter(x=>x==='archive').length,1);
 assert(!h.calls.some(x=>['save','legacySave','hiddenPlayback','hiddenAnalysis'].includes(x)));
 assert.equal(h.raf.length,1);h.raf[0]();assert.equal(h.timers.length,1);assert(!h.calls.includes('save'));
 h.timers[0]();await Promise.resolve();assert.equal(h.calls.filter(x=>x==='save').length,1);
});

test('Basic delayed save does not persist a replaced result',async()=>{
 const h=fixture();h.complete();assert.equal(await h.ready,true);
 h.tab.results=null;h.raf[0]();h.timers[0]();await Promise.resolve();assert(!h.calls.includes('save'));
});

test('Basic validation failure releases the run without archiving or scheduling a save',async()=>{
 const h=fixture();h.fail();assert.equal(await h.ready,false);
 assert(!h.session.pending&&!h.state.run.active);assert.equal(h.tab.results,undefined);assert.equal(h.raf.length,0);
 assert(h.calls.includes('error:validation'));assert(!h.calls.includes('archive'));
});
