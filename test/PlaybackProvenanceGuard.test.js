import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {canonicalSimulationInputSignature} from '../src/simulation/SimulationProvenance.js';

const script=fs.readFileSync(new URL('../apps-script/ClientPlayback.html',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));

function harness(){
 const input={case:{id:'line',unitOfFlow:'cases',equipment:[]},run:{durationSeconds:60,tickSeconds:.25,sampleEverySeconds:1,seed:7,rounds:3,machineResidenceEnabled:true,machineDesignEnabled:false}};
 const result={seed:7,durationSeconds:60,inputSignature:canonicalSimulationInputSignature(input),engineId:'ST_CURRENT',samples:[{virtualSecond:0,outputCount:0,equipment:[]}],summary:{outputCount:17}};
 const status={textContent:''};let creations=0,closures=0;
 const window={SimulatorEngine:{inputSignature:canonicalSimulationInputSignature,createPlayback:()=>{
  creations++;return {tickSeconds:1/120,time:0,durationSeconds:60,finished:false,close(){closures++;}};
 }},clearTimeout(){}};
 const context=vm.createContext({window,document:{documentElement:{lang:'en'},getElementById:id=>id==='playback-status'?status:null},performance,
  state:{activeCase:input.case,activeSimulationId:'s1',run:{result,sampleIndex:0,roundIndex:0,playing:false}},
  cloneJson:copy,activePersistentSimulation:()=>({dynamicConfig:input.run}),prepareCalendarRun:run=>run,
  renderPlaybackFrame(){},roundSession:null});
 vm.runInContext(script,context);
 // The full renderer depends on the page DOM. It is irrelevant to the guard;
 // retain the real session creation and provenance/fallback functions.
 context.renderPlaybackFrame=()=>{};
 return {context,input,result,status,get creations(){return creations;},get closures(){return closures;}};
}

test('current provenance allows the numerical cursor despite replication/display adjustments',()=>{
 const h=harness(),{context,result}=h,before=JSON.stringify(result);
 assert.equal(context.startNumericalPlayback(),true);
 assert.equal(h.creations,1);
 assert.equal(context.numericalPlaybackSession.controller.tickSeconds,1/120);
 assert.equal(context.numericalPlaybackInput().run.rounds,1);
 assert.equal(JSON.stringify(result),before,'playback does not rewrite the completed archive');
 assert.equal(context.startNumericalPlayback(),true);
 assert.equal(h.creations,1,'pause/resume reuses a cursor with the same input signature');
});

test('historical provenance preserves the archive and never creates a current-engine cursor',()=>{
 const h=harness(),{context,result,status}=h;
 const recorded=JSON.parse(result.inputSignature);
 recorded.version='ST_CURRENT:0.20.7/DES:0.5.0/cache:35';
 result.inputSignature=JSON.stringify(recorded);
 const before=JSON.stringify(result);
 assert.equal(context.startNumericalPlayback(),false);
 assert.equal(h.creations,0);
 assert.equal(context.numericalPlaybackSession,null);
 assert.equal(JSON.stringify(result),before);
 context.setPlaybackStatus('Playing');
 assert.match(status.textContent,/Historical playback; recalculate/);
 context.document.documentElement.lang='es';
 context.setPlaybackStatus('Paused');
 assert.match(status.textContent,/Reproducción histórica; recalcula/);
});

test('unsigned or malformed saved evidence falls back to archive playback',()=>{
 const valid=JSON.parse(harness().result.inputSignature);
 const malformed=[{version:valid.version},{...valid,equipment:null},{...valid,unitOfFlow:undefined},
  {...valid,run:null},{...valid,run:[]}];
 for(const signature of [undefined,'not-json',JSON.stringify({run:{}}),...malformed.map(value=>JSON.stringify(value))]){
  const h=harness();h.result.inputSignature=signature;
  assert.equal(h.context.startNumericalPlayback(),false);
  assert.equal(h.creations,0);
  assert.equal(h.result.summary.outputCount,17);
 }
});

test('a live partial without provenance remains recorded telemetry, not a historical warning',()=>{
 const h=harness();delete h.result.inputSignature;h.result.provisional=true;
 assert.equal(h.context.startNumericalPlayback(),false);
 assert.equal(h.creations,0);
 h.context.setPlaybackStatus('Playing');
 assert.equal(h.status.textContent,'Playing');
});

test('the real Live progress callback stamps its exact execution input before playback',()=>{
 const source=fs.readFileSync(new URL('../apps-script/ClientSimulation.html',import.meta.url),'utf8');
 const start=source.indexOf('function(partial){',source.indexOf('onFirstProgress:'));
 const end=source.indexOf('},onFirstRound:',start);
 assert(start>=0&&end>start);
 const h=harness(),{context,input}=h;
 const session={streaming:false,run:{rounds:3,seed:7},first:null};
 Object.assign(context,{session,generation:2,roundSessionActive:value=>value===session,
  input,SimulatorEngine:context.window.SimulatorEngine,syncPlaybackRounds(){},toggle(){},
  playbackRenderStats:{lastPaintAt:0},performance:{now:()=>0}});
 session.generation=2;
 context.state.run.result=null;context.state.run.representative=null;
 const callback=vm.runInContext('('+source.slice(start,end+1)+')',context);
 const partial={samples:[{virtualSecond:0,equipment:[]}],stateTransitions:[],calculatedThroughSeconds:0,provisional:true};
 callback(partial);
 assert.equal(partial.inputSignature,canonicalSimulationInputSignature(input));
 assert.equal(context.state.run.result,partial);
 assert.equal(context.numericalPlaybackProvenanceMatches(context.numericalPlaybackInput()),true);
 const originalContext=context.numericalPlaybackContext();
 context.state.run.result={...partial,provisional:false};
 assert.equal(context.numericalPlaybackContext(),originalContext,'completion preserves the cursor identity');
});

test('changing recorded inputs at the same seed replaces the cursor and historical inputs close it',()=>{
 const h=harness(),{context,input,result}=h;
 assert.equal(context.startNumericalPlayback(),true);
 result.inputSignature=canonicalSimulationInputSignature({...input,run:{...input.run,tickSeconds:.1}});
 assert.equal(context.startNumericalPlayback(),true);
 assert.equal(h.creations,2);assert.equal(h.closures,1);
 const old=JSON.parse(result.inputSignature);old.version='historical';result.inputSignature=JSON.stringify(old);
 assert.equal(context.startNumericalPlayback(),false);
 assert.equal(h.creations,2);assert.equal(h.closures,2);
 assert.equal(context.numericalPlaybackSession,null);
});
