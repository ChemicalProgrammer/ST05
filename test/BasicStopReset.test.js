import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const mode=fs.readFileSync('apps-script/MinimalMode.html','utf8'),client=fs.readFileSync('apps-script/ClientSimulation.html','utf8'),explorer=fs.readFileSync('apps-script/ScenarioExplorer.html','utf8');
const block=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length));
test('Basic run switches to Stop, keeps it enabled, then discards and saves before unlocking',async()=>{
 let resolveRun,resolveStop,sim={id:'a',equipment:[{},{}],results:{summary:{}},whatIf:{evaluations:[{tier:'ZERO'},{tier:'HIGH'}]}},calls=[];
 const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,replaceChildren(){calls.push('clear:'+id);}});return nodes.get(id);};
 const api=new Function('performance','owner','ownerKey','state','actions','el','busy','applyDuration','applyRounds','expandForAction','sync','clearScenarios','resetRoundView','show','progress',
   'var tiers=["ZERO","MEDIUM"],starting=false,runStopRequested=false,runStopTask=null,runStartedAt=null,runProgress=0,searchProgress=0,searchCompleted=0,searchMessage="",resultKey="",readinessCache=null;'+
   block(mode,'  function ownedScenarioResult(','  function clearScenarios(')+block(mode,'  function clearRunDisplay(','  // A terminal evaluated outcome')+
   '\nreturn {startRun,stopRun,starting:()=>starting,stopping:()=>runStopRequested};')(
   {now:()=>1000},()=>sim,()=>sim.id,{activeCase:{}},{run:()=>new Promise(resolve=>{resolveRun=resolve;}),stopRun:()=>{sim.results=null;resolveRun(false);return new Promise(resolve=>{resolveStop=resolve;});},markReset:()=>calls.push('dirty'),save:async()=>calls.push('save'),error:e=>{throw e;}},el,()=>false,()=>true,()=>true,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{});
 const run=api.startRun();assert(api.starting());const stopped=api.stopRun();await Promise.resolve();
 assert(api.stopping());assert(api.starting());assert.equal(sim.results,null);assert.equal(api.stopRun(),stopped);
 resolveStop();await stopped;await run;assert(!api.starting());assert(!api.stopping());assert.deepEqual(sim.whatIf.evaluations,[{tier:'HIGH'}]);assert(calls.includes('clear:minimal-result-cards'));assert.deepEqual(calls.slice(-2),['dirty','save']);
 assert.match(mode,/runButton\.disabled=starting\?runStopRequested:/);assert.match(mode,/runButton\.textContent=tr\(starting\?\(runStopRequested\?'Stopping…':'Stop'/);
});
test('numerical cancellation invalidates before awaiting worker settlement and scenario discard blocks late records',async()=>{
 let resolveCompletion,invalidated=false,completed=false;
 const stop=new Function('window','activePersistentSimulation','roundSession','invalidateActiveResult','state','markNumericalPlaybackAction','syncPlaybackRounds','syncRunControls','setStatus',
 block(client,'    async function stopCompactSimulation(','    async function runSimulation(')+'\nreturn stopCompactSimulation;')(
 {STMinimalMode:{isMinimal:()=>true}},()=>({}),{completion:new Promise(resolve=>{resolveCompletion=resolve;})},()=>{invalidated=true;},{run:{}},()=>{},()=>{},()=>{},()=>{});
 const pending=stop().then(()=>{completed=true;});assert(invalidated);assert(!completed);resolveCompletion();await pending;assert(completed);
 assert.match(explorer,/if\(discardMinimalSearch\)return;/);
 assert.match(explorer,/discardMinimalSearch=true;latest=null;lastMetricEntry=null;compactCheckpoint=null;/);
 assert.match(mode,/_cancelMinimalSearch\?\.\(\{discard:true\}\)/);
 assert.match(explorer,/if\(project\.compact\)\{window\.STMinimalMode\?\.stopSearch\?\.\(\);return;\}/);
});
