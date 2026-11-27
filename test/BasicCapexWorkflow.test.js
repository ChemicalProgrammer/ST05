import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps-script/MinimalMode.html','utf8');
const section=source.slice(source.indexOf('  function completedOutcome('),source.indexOf('  function openImport('));
const helpers=source.slice(source.indexOf('  function ownedScenarioResult('),source.indexOf('  function clearScenarios('));
const cardTier=source.slice(source.indexOf('  function cardTier('),source.indexOf('  function el('));
function fixture(outcome,options={}){
 const sim={id:'simulation-a',whatIf:{evaluations:[{tier:'ZERO',sourceSimulationId:'simulation-a'},{tier:'HIGH'},{tier:'ZERO',sourceSimulationId:'other'}],methodology:{keep:true}}},r={summary:{outputCount:123}},state={saving:false},calls=[],percentages=[],paints=[];
 const executionPolicy='ZERO_V6_MEDIUM_BUFFER_V1',cards=options.missing?[]:['ZERO',options.tier||'MEDIUM'].map(tier=>({
  dataset:{motionKey:JSON.stringify([sim.id,'CAPEX',tier]),capexExecutionPolicy:executionPolicy},
  querySelector:()=>({textContent:'Zero CAPEX'}),
  _prepareMinimalRestart:()=>{calls.push('prepare '+tier);return true;},
  _runMinimalSearch:async()=>{calls.push(tier);if(outcome instanceof Error)throw outcome;return outcome;},
  _cancelMinimalSearch:({discard})=>{assert.equal(discard,true);calls.push('cancel');}
 }));
 const context={executionPolicy,sim,state,paints,owner:()=>sim,result:()=>r,busy:()=>false,ownerKey:()=>sim.id,sourceSignature:()=> 'current',
  window:{STScenarioExplorer:{executionPolicy},STScenarios:{readiness:()=>({ready:options.ready!==false,reason:options.ready===false?'NO_RESULTS':null})}},
  document:{visibilityState:'hidden',documentElement:{lang:'en'}},setTimeout:fn=>fn(),scenarioCards:()=>cards,expandForAction:()=>{},isMinimal:()=>true,
  actions:{error:e=>calls.push('error:'+e.message),markReset:()=>calls.push('dirty'),save:async()=>calls.push('save')},
  progress:(_id,value)=>percentages.push(value),clearScenarios:()=>calls.push('clear'),show:()=>{}};
 const run=new Function(...Object.keys(context),`
 var tiers=["ZERO","MEDIUM"],searchTiers=[],searchStartedAt=null,searching=false,stopRequested=false,searchSaving=false,searchProgress=0,searchCompleted=0,searchTotal=1,searchCard=null,searchMessage='';
 function sync(){paints.push({searching,searchSaving,searchMessage});}
 `+cardTier+helpers+section+`
 return {startSearch,stopSearch,completedOutcome,status:()=>({searching,searchSaving,searchMessage,searchCompleted,searchProgress})};`)(...Object.values(context));
 return {run,calls,percentages,paints,cards,sim,r};
}
const complete=status=>({started:true,status});
test('Global dispatch publishes terminal outcomes and saves once',async()=>{
 for(const status of ['IMPROVEMENT_REPRODUCED','NO_DEMONSTRATED_IMPROVEMENT','NO_ELIGIBLE_TARGETS','NO_PROMISING_CANDIDATE']){
  const h=fixture(complete(status));await h.run.startSearch();assert.equal(h.percentages.at(-1),100);
  assert.deepEqual(h.calls,['prepare ZERO','prepare MEDIUM','ZERO','MEDIUM','save']);assert(h.paints.some(p=>!p.searching&&p.searchSaving));
 }
});
test('failed, blocked or budget-limited Zero evaluation never reports 100 percent',async()=>{
 for(const outcome of [new Error('worker failed'),{started:false,reason:'invalid configuration'},complete('INTERRUPTED'),complete('SEARCH_BUDGET_REACHED')]){
  const h=fixture(outcome);await h.run.startSearch();assert.equal(h.run.status().searchCompleted,0);assert(h.percentages.every(p=>p<100));assert(h.run.status().searchMessage);
 }
});
test('missing cards, stale baseline and duplicate or High cards cannot run',async()=>{
 for(const options of [{missing:true},{ready:false},{tier:'ZERO'},{tier:'HIGH'}]){
  const h=fixture(complete('IMPROVEMENT_REPRODUCED'),options);await h.run.startSearch();assert.equal(h.calls.length,0);assert(h.run.status().searchMessage);
 }
});
test('Stop discards current Zero evidence, clears progress, retains baseline and rejects a late success',async()=>{
 const h=fixture(complete('IMPROVEMENT_REPRODUCED'));let finish;
 h.cards[0]._runMinimalSearch=()=>{h.calls.push('ZERO');return new Promise(resolve=>{finish=resolve;});};
 const pending=h.run.startSearch();assert(h.run.status().searching);h.run.stopSearch();
 assert.deepEqual(h.sim.whatIf.evaluations,[{tier:'HIGH'},{tier:'ZERO',sourceSimulationId:'other'}]);
 // Simulate a late cancelled worker callback attempting to repopulate the record.
 h.sim.whatIf.evaluations.push({tier:'ZERO',sourceSimulationId:'simulation-a',candidate:{oee:80}});
 finish(complete('IMPROVEMENT_REPRODUCED'));await pending;
 assert.equal(h.run.status().searchProgress,0);assert.equal(h.run.status().searchCompleted,0);
 assert.equal(h.run.status().searchMessage,'');assert(!h.run.status().searching);
 assert.deepEqual(h.sim.whatIf.evaluations,[{tier:'HIGH'},{tier:'ZERO',sourceSimulationId:'other'}]);
 assert.deepEqual(h.sim.whatIf.methodology,{keep:true});assert.equal(h.r.summary.outputCount,123);
 assert.equal(h.calls.filter(x=>x==='cancel').length,1);assert.equal(h.calls.filter(x=>x==='save').length,1);
 assert(h.percentages.every(p=>p===0));
});

test('individual Medium restart preserves saved Zero evidence, including after cancellation',async()=>{
 for(const cancel of [false,true]){
  const h=fixture(complete('NO_ELIGIBLE_TARGETS'));
  const saved=h.sim.whatIf.evaluations[0];saved.candidate={throughput:87};
  h.sim.whatIf.evaluations.push({tier:'MEDIUM',sourceSimulationId:h.sim.id});
  let finish;
  if(cancel)h.cards[1]._runMinimalSearch=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.run.startSearch(h.cards[1]);
  if(cancel){h.run.stopSearch();finish(complete('IMPROVEMENT_REPRODUCED'));}
  await pending;
  assert(h.sim.whatIf.evaluations.includes(saved));assert.equal(saved.candidate.throughput,87);
  assert(!h.calls.includes('prepare ZERO'));assert(!h.calls.includes('ZERO'));
  assert(h.calls.includes('prepare MEDIUM'));assert(h.calls.includes('save'));
 }
});
test('individual Zero restart leaves Medium out of the queue',async()=>{
 const h=fixture(complete('NO_DEMONSTRATED_IMPROVEMENT'));
 await h.run.startSearch(h.cards[0]);assert.deepEqual(h.calls,['prepare ZERO','ZERO','save']);
});
