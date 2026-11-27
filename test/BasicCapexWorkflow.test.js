import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps-script/MinimalMode.html','utf8');
const section=source.slice(source.indexOf('  function completedOutcome('),source.indexOf('  function openImport('));
function fixture(outcomes,options={}){
 const tiers=['ZERO','MEDIUM','HIGH'],sim={id:'simulation-a'},r={summary:{}},state={saving:false},calls=[],percentages=[],paints=[];
 const cards=tiers.map((tier,i)=>({
  dataset:{motionKey:JSON.stringify([sim.id,'CAPEX',tier])},
  querySelector:()=>({textContent:tier+' CAPEX'}),
  _runMinimalSearch:async()=>{calls.push(tier);if(outcomes[i] instanceof Error)throw outcomes[i];return outcomes[i];}
 })).filter((_,i)=>i!==options.missing);
 const context={tiers,state,paints,owner:()=>sim,result:()=>r,busy:()=>false,ownerKey:()=>sim.id,sourceSignature:()=> 'current',
  window:{STScenarios:{readiness:()=>({ready:options.ready!==false,reason:options.ready===false?'NO_RESULTS':null})}},
  document:{visibilityState:'hidden'},setTimeout:fn=>fn(),
  scenarioCards:()=>cards,expandForAction:()=>{},isMinimal:()=>true,
  actions:{error:e=>calls.push('error:'+e.message),save:async()=>calls.push('save')},
  progress:(_id,value)=>percentages.push(value)};
 const run=new Function(...Object.keys(context),`
 var searching=false,stopRequested=false,searchSaving=false,searchProgress=0,searchCompleted=0,searchTotal=3,searchCard=null,searchMessage='';
 function sync(){paints.push({searching,searchSaving,searchMessage});}
 `+section+`
 return {startSearch,stopSearch,completedOutcome,status:()=>({searching,searchSaving,searchMessage,searchCompleted,searchProgress})};`)(...Object.values(context));
 return {run,calls,percentages,paints,cards};
}
const complete=status=>({started:true,status});
test('three blocked categories cannot report 100% or trigger a save',async()=>{
 const h=fixture([{started:false,reason:'invalid configuration'},undefined,{started:false,reason:'NO_RESULTS'}]);
 await h.run.startSearch();assert.deepEqual(h.percentages,[0,0,0]);assert.equal(h.run.status().searchCompleted,0);
 assert.match(h.run.status().searchMessage,/invalid configuration/);assert.match(h.run.status().searchMessage,/NO_RESULTS/);
 assert(!h.calls.includes('save'));
});
test('all terminal outcomes count, including negative results, and cards are published before saving',async()=>{
 const h=fixture([complete('IMPROVEMENT_REPRODUCED'),complete('NO_DEMONSTRATED_IMPROVEMENT'),complete('NO_ELIGIBLE_TARGETS')]);
 await h.run.startSearch();assert.equal(h.percentages.at(-1),100);assert.equal(h.run.status().searchCompleted,3);
 assert.equal(h.run.status().searchMessage,'');assert.deepEqual(h.calls,['ZERO','MEDIUM','HIGH','save']);
 assert(h.paints.some(p=>!p.searching&&p.searchSaving));
});
test('an error and an interrupted search cannot be counted as complete',async()=>{
 const h=fixture([complete('NO_DEMONSTRATED_IMPROVEMENT'),new Error('worker failed'),complete('INTERRUPTED')]);
 await h.run.startSearch();assert.equal(h.run.status().searchCompleted,1);assert(h.percentages.every(p=>p<100));assert.match(h.run.status().searchMessage,/worker failed/);
});
test('missing cards and stale baseline stop the search before invoking any category',async()=>{
 for(const options of [{missing:1},{ready:false}]){
  const h=fixture([],options);await h.run.startSearch();assert.equal(h.calls.length,0);assert.equal(h.percentages.length,0);assert(h.run.status().searchMessage);
 }
});
test('individual card search uses the same global progress and only runs that category',async()=>{
 const h=fixture([complete('NO_ELIGIBLE_TARGETS'),complete('NOT_REPRODUCED'),complete('INFEASIBLE')]);
 await h.run.startSearch(h.cards[1]);assert.deepEqual(h.calls,['MEDIUM','save']);assert.equal(h.percentages.at(-1),100);
});

test('a clear screening exit completes a category, but a time limit remains explicitly incomplete',async()=>{
 const h=fixture([complete('NO_PROMISING_CANDIDATE'),{started:true,status:'SEARCH_BUDGET_REACHED',reason:'Time limit reached'},complete('NO_ELIGIBLE_TARGETS')]);
 await h.run.startSearch();assert.equal(h.run.status().searchCompleted,2);assert(h.percentages.every(value=>value<100));assert.match(h.run.status().searchMessage,/Time limit reached/);assert(h.calls.includes('save'));
});
test('stop cancels the current category and retains completed categories without starting the next',async()=>{
 const h=fixture([complete('IMPROVEMENT_REPRODUCED'),complete('NO_ELIGIBLE_TARGETS'),complete('NO_ELIGIBLE_TARGETS')]);
 h.cards[1]._runMinimalSearch=async()=>{h.calls.push('MEDIUM');h.run.stopSearch();return {started:true,status:'CANCELLED'};};
 h.cards[1]._cancelMinimalSearch=()=>h.calls.push('cancel');
 await h.run.startSearch();assert.deepEqual(h.calls,['ZERO','MEDIUM','cancel','save']);assert.equal(h.run.status().searchCompleted,1);assert.match(h.run.status().searchMessage,/Search stopped/);
});
