import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {scenarioSignature} from '../src/analysis/ScenarioPlanner.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const read=name=>fs.readFileSync(new URL('../apps-script/'+name,import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(predicate){
  for(let i=0;i<100;i++){if(predicate())return;await settle();}
  assert(predicate(),'UI did not settle');
}

function savedCase(){
  const simulation={id:'saved-simulation',name:'Saved run',equipment:[
    {id:'inlet',name:'Virtual inlet',type:'FEEDER',nominalRatePerSecond:2,initialMode:'AUTO',unitOfFlow:'bottles',
      characteristics:{isVirtualBoundary:true,isPacemaker:false},noiseProfile:{},processData:{role:'MACHINE',machineType:'FEEDER',
        flowUnits:{input:'BOTTLES',output:'BOTTLES'},equipment:{maximumSpeedBpm:120,occupancyMode:'STORAGE',mtbfMinutes:null,mttrMinutes:null,
          stopInputs:{minor:{mtbfMinutes:0,mttrMinutes:0},major:{mtbfMinutes:0,mttrMinutes:0}}}}},
    {id:'filler',name:'Filler',type:'FILLER',nominalRatePerSecond:1,initialMode:'AUTO',unitOfFlow:'bottles',
      characteristics:{isPacemaker:true},noiseProfile:{},processData:{role:'PACEMAKER',machineType:'FILLER',
        flowUnits:{input:'BOTTLES',output:'BOTTLES'},equipment:{maximumSpeedBpm:60,occupancyMode:'STORAGE',mtbfMinutes:null,mttrMinutes:null,
          stopInputs:{minor:{mtbfMinutes:0,mttrMinutes:0},major:{mtbfMinutes:0,mttrMinutes:0}}}}}
  ],dynamicConfig:{durationMode:'FIXED',durationSeconds:120,tickSeconds:.25,sampleEverySeconds:5,seed:51,commands:[],rounds:3,engineId:'ST_CURRENT'}};
  simulation.unitOfFlow='bottles';
  completeSyntheticScenarioSource(simulation);
  delete simulation.unitOfFlow;
  simulation.results.unitOfFlow='bottles';
  // The saved transport contract keeps the case-level unit and the output unit.
  // A simulation has no separate unit field in CaseService.normalizeSimulations_.
  const names=['Preparing','Baseline','Searching category','Refining candidates','Design of experiments','DOE analysis','Finalist ranking','Ranking analysis'];
  const entry={cardId:JSON.stringify([simulation.id,'CAPEX','ZERO']),sourceSimulationId:simulation.id,
    sourceSignature:scenarioSignature(simulation),tier:'ZERO',kind:'CUSTOM',searchScope:'ZERO',status:'NO_DEMONSTRATED_IMPROVEMENT',
    updatedAt:'2026-11-01T12:00:00Z',message:'No practical improvement demonstrated. Baseline retained.',
    baseline:{oee:50,throughput:120},candidate:null,evaluatedChanges:[],
    progress:'Finished · 9 simulation batches · Elapsed 2m 00s.',
    progressTrace:{percent:100,outcome:'Finished',summary:{elapsedMs:120000,batchCompleted:9,roundsCompleted:27},
      steps:names.map((name,index)=>({name,state:'Completed',percent:100,elapsedMs:(index+1)*1000,
        detail:'Saved detail '+(index+1),work:{primary:{label:'Checks',done:index+1,total:index+1}}}))}};
  simulation.whatIf={evaluations:[entry]};
  return {id:'roundtrip-case',name:'Saved scenario case',revision:1,unitOfFlow:'bottles',equipment:copy(simulation.equipment),
    metadata:{},engineConfig:{},activeSimulationId:simulation.id,simulations:[simulation],
    ownerEmail:'engineer@example.test',createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z'};
}

async function browser(record){
  let stored=copy(record);
  const errors=[],calls=[],server=vm.createContext({});
  for(const file of ['ApiResponse.gs','CaseService.gs'])vm.runInContext(read(file),server);
  const api={
    getBootstrap:()=>({uiMode:'BASIC',user:{email:record.ownerEmail},settings:{workspaceRootFolderId:'test',preferredPlaybackRate:10},
      gemini:{configured:false,prompts:[],promptOverrides:{}},cases:[{id:record.id,name:record.name,equipmentCount:record.equipment.length,isSimulationReady:true,updatedAt:record.updatedAt}]}),
    getCase:()=>copy(server.ensureCaseSimulations_(copy(stored))),
    saveCase:request=>{stored=copy(server.buildUpdatedCase_(copy(request),copy(stored),{email:record.ownerEmail}));return copy(stored);}
  };
  // Expose existing client functions only in this test, without changing runtime code.
  const html=renderAppsScript().html.replace('var roundSession=null;',
    'window.__roundtrip={state:state,open:openCase,save:saveActiveCase};var roundSession=null;');
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(html,{url:'https://st.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(w){
    w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.scrollBy=()=>{};
    w.HTMLElement.prototype.scrollIntoView=()=>{};
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:text=>({width:String(text).length*7}),
      getLineDash:()=>[],createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{})});
    function runner(success,failure){return new Proxy({withSuccessHandler:fn=>runner(fn,failure),withFailureHandler:fn=>runner(success,fn)},
      {get:(target,key)=>target[key]||((...args)=>{calls.push(key);w.setTimeout(()=>{
        try{assert(api[key],'Unexpected request '+key);success({ok:true,data:api[key](...args)});}
        catch(error){errors.push(error.stack);failure(error);}
      },0);})});}
    w.google={script:{run:runner()}};
  }});
  await new Promise(resolve=>dom.window.addEventListener('load',resolve));
  await settle();
  const w=dom.window,d=w.document;
  return {w,d,errors,calls,stored:()=>copy(stored),close:()=>w.close()};
}

test('opening, saving and reopening a completed negative CAPEX search preserves inputs and all steps',async()=>{
  const record=savedCase(),original=copy(record.simulations[0]),h=await browser(record);
  try{
    h.d.getElementById('sign-in-button').click();await until(()=>h.d.querySelector('.open-case'));
    await h.w.__roundtrip.open(record.id,'whatif');
    await until(()=>h.w.__roundtrip.state.activeCase&&h.w.__roundtrip.state.uiView==='whatif');
    function check(){
      const state=h.w.__roundtrip.state,sim=state.activeCase.simulations[0];
      assert.equal(state.isDirty,false,'Read-only restoration must not create unsaved changes');
      assert.deepEqual(copy(sim.equipment),original.equipment);
      assert.deepEqual(copy(sim.dynamicConfig),original.dynamicConfig);
      assert.equal(sim.equipment[0].processData.equipment.mtbfMinutes,null);
      assert.equal(sim.equipment[0].processData.equipment.mttrMinutes,null);
      assert.equal(h.w.STScenarios.signature(sim),original.whatIf.evaluations[0].sourceSignature);
      assert.equal(sim.results.inputSignature,original.results.inputSignature);
      assert.equal(h.w.STScenarios.readiness(sim).ready,true);
      assert.deepEqual(copy(sim.whatIf.evaluations),original.whatIf.evaluations);
      const card=h.d.querySelector('.analysis-capex[data-tier="ZERO"]').closest('article');
      const header=card.querySelector(':scope > .scenario-card-header'),badge=header.querySelector('.analysis-capex');
      assert(card.textContent.includes(original.whatIf.evaluations[0].message));
      assert.equal(card.querySelector('.scenario-activity .scenario-progress-text').textContent,'100.0% · 2m 00s','The saved total takes priority over the sum of recorded step times.');
      card.querySelector('.scenario-activity').click();
      assert.equal(card.querySelector(':scope > .scenario-card-header'),header);
      assert.equal(header.querySelector('.analysis-capex'),badge);
      assert.equal(card.querySelectorAll('.analysis-capex').length,1);
      assert.equal(card.querySelector('.scenario-trace-overall .scenario-progress-text').textContent,'100.0% · 2m 00s');
      const steps=[...card.querySelectorAll('.scenario-trace-step')];assert.equal(steps.length,8);
      assert.deepEqual(steps.map(step=>step.querySelector('.scenario-trace-step-name').textContent),original.whatIf.evaluations[0].progressTrace.steps.map(step=>step.name));
      assert(steps.every(step=>step.querySelector('[role=progressbar]').getAttribute('aria-valuenow')==='100'));
      assert.equal(h.d.getElementById('status').classList.contains('error'),false);
    }
    check();
    await h.w.__roundtrip.save();await until(()=>h.stored().revision===2);
    assert.deepEqual(h.stored().simulations[0].whatIf.evaluations,original.whatIf.evaluations);
    assert.equal(h.stored().simulations[0].results.inputSignature,original.results.inputSignature);
    h.d.getElementById('home-cases').click();await until(()=>h.w.__roundtrip.state.activeCase===null);
    await h.w.__roundtrip.open(record.id,'whatif');await until(()=>h.w.__roundtrip.state.activeCase&&h.w.__roundtrip.state.uiView==='whatif');
    check();assert.equal(h.calls.filter(name=>name==='saveCase').length,1);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});
