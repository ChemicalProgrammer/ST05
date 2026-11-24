import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {scenarioSignature} from '../src/analysis/ScenarioPlanner.js';
import {scenarioSearchSettingsSignature} from '../src/analysis/ScenarioSearch.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';

const outcome='No tested configuration improved the matched baseline (50.00% OEE). Baseline retained; no better scenario is recommended.';

function savedCase(){
  const sim=completeSyntheticScenarioSource({id:'simulation-a',unitOfFlow:'bottles',
    equipment:[{id:'inlet',name:'Virtual inlet',type:'FEEDER',initialMode:'AUTO',nominalRatePerSecond:8,
      characteristics:{isVirtualBoundary:true},noiseProfile:{},
      processData:{equipment:{maximumSpeedBpm:600,mtbfMinutes:null,mttrMinutes:null}}}],
    dynamicConfig:{durationSeconds:3600,rounds:3,seed:7}});
  const steps=[
    {name:'Baseline',state:'Completed',percent:100,elapsedMs:3000,work:{primary:{label:'Baseline batches',done:1,total:1}}},
    {name:'Comparing finalists',state:'Completed',percent:100,elapsedMs:7000,work:{primary:{label:'Finalists',done:2,total:2}}}
  ];
  sim.whatIf={evaluations:[{cardId:JSON.stringify([sim.id,'CAPEX','ZERO']),sourceSimulationId:sim.id,
    sourceSignature:scenarioSignature(sim),status:'NO_DEMONSTRATED_IMPROVEMENT',message:outcome,
    updatedAt:'2026-11-24T20:00:00.000Z',searchSettings:{speedProfile:'BALANCED'},
    searchSettingsSignature:scenarioSearchSettingsSignature(),searchPolicyVersion:'MATCHED_CAPEX_V11',
    methodologySignature:'{}',baseline:{oee:50,throughput:120},candidate:null,evaluatedChanges:[],
    run:{...sim.dynamicConfig},depth:'MEDIUM',progress:'Finished · 3 / up to 3 simulation batches · Elapsed 10s',
    progressTrace:{steps,percent:100,outcome:'Completed',summary:{candidateBatches:2,candidateMs:7000}}
  }]};
  return {simulations:[sim],metadata:{includeDOE:false}};
}

function browser(record){
  const dom=new JSDOM('<!doctype html><html data-ui-mode="basic"><body><article class="analysis-recommendation"></article></body></html>',{runScripts:'outside-only'}),w=dom.window;
  w.__ST_TEXT__=key=>key;
  w.STPreferences={read:()=>null,write:()=>true};w.STIcons={svg:()=>'<svg></svg>'};
  w.STErrors={register(){},capture(){}};w.STReports={bindWhatIf(){}};
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const file of ['ClientUtils.html','Subsection.html','SimulationEngine.html','WhatIf.html','ScenarioExplorer.html']){
    const source=fs.readFileSync('apps-script/'+file,'utf8');
    const scripts=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    if(scripts.length)for(const match of scripts)w.eval(match[1]);else w.eval(source);
  }
  let simulationCalls=0,creationCalls=0;
  w.SimulatorEngine.simulateBatch=async()=>{simulationCalls++;throw new Error('Restoring history must not simulate.');};
  w.STScenarioExplorer.connectCase(()=>record,()=>{});
  const sim=record.simulations[0],host=w.document.querySelector('article');
  w.STScenarioExplorer.attach(host,{kind:'CUSTOM',tier:'ZERO',searchScope:'ZERO',explore:true,catalog:true,searchDerivedDOE:true,
    changes:[{equipmentId:'inlet',path:'nominalRatePerSecond',before:8,after:9,unit:'units/s'}]},()=>{creationCalls++;},sim);
  return {w,sim,host,simulationCalls:()=>simulationCalls,creationCalls:()=>creationCalls,close:()=>w.close()};
}

function openTrace(h){
  const activity=h.host.querySelector('.scenario-activity');
  assert.equal(activity.hidden,false,'Saved analysis remains inspectable.');
  activity.click();
  const panel=h.host.querySelector('.scenario-trace-panel');
  assert.equal(panel.hidden,false);
  return panel;
}

test('JSON save and reload preserves a completed negative outcome, steps, counters and elapsed time',()=>{
  const record=JSON.parse(JSON.stringify(savedCase())),before=JSON.stringify(record.simulations[0].whatIf),h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'rejected');
    assert.equal(h.host.querySelector('.scenario-result-notice').hidden,true);
    assert.equal(h.host.querySelector('.scenario-search').disabled,false);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(h.host.querySelector('.scenario-activity').getAttribute('aria-valuenow'),'100');
    const panel=openTrace(h);
    assert.equal(panel.querySelectorAll('.scenario-trace-row').length,2);
    assert.match(panel.textContent,/100\.0% · 0m 03s/);
    assert.match(panel.textContent,/100\.0% · 0m 07s/);
    assert.match(panel.textContent,/Finalists2 \/ 2/);
    assert.match(panel.textContent,/Elapsed 10s/);
    assert.match(panel.textContent,/Finished · 3 \/ up to 3 simulation batches/);
    h.host.querySelector('.scenario-results').click();
    assert.equal(h.host.querySelector('.scenario-saved-outcome').textContent,outcome);
    assert.equal(h.w.STScenarioExplorer.evaluations(h.sim).length,1);
    assert.equal(h.simulationCalls(),0);
    assert.equal(JSON.stringify(h.sim.whatIf),before,'Viewing the restored card must not rewrite saved evidence.');
  }finally{h.close();}
});

test('a real input edit retains negative result history while blocking stale simulation evidence',()=>{
  const record=savedCase(),sim=record.simulations[0];sim.equipment[0].nominalRatePerSecond+=.1;
  const before=JSON.stringify(sim.whatIf),h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
    const notice=h.host.querySelector('.scenario-result-notice');
    assert.equal(notice.hidden,false);assert.match(notice.textContent,/Saved analysis\. Complete the current numerical simulation/);
    assert.doesNotMatch(notice.textContent,/EQUIPMENT_CHANGED|nominalRatePerSecond/);
    assert.equal(h.w.STScenarios.readiness(sim).reason,'EQUIPMENT_CHANGED');
    assert.equal(h.host.querySelector('.scenario-search').disabled,true);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(h.w.STScenarioExplorer.evaluations(sim).length,0,'Historical results cannot become current recommendations.');
    const panel=openTrace(h);assert.match(panel.textContent,/Saved analysis progress/);assert.equal(panel.querySelectorAll('.scenario-trace-row').length,2);
    assert.match(panel.textContent,/Baseline retained/);
    h.host.querySelector('.scenario-search').onclick();
    assert.equal(h.simulationCalls(),0);
    assert.equal(JSON.stringify(sim.whatIf),before);
  }finally{h.close();}
});

test('a missing numerical result does not erase saved scenario history or enable a new search',()=>{
  const record=savedCase();record.simulations[0].results=null;const h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
    assert.match(h.host.querySelector('.scenario-result-notice').textContent,/Saved analysis\. Complete the current numerical simulation/);
    assert.equal(h.w.STScenarios.readiness(h.sim).reason,'NO_RESULTS');
    assert.equal(h.host.querySelector('.scenario-search').disabled,true);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(openTrace(h).querySelectorAll('.scenario-trace-row').length,2);
    assert.equal(h.simulationCalls(),0);
  }finally{h.close();}
});

test('a newly completed baseline enables search but keeps the old scenario result historical',()=>{
  const record=savedCase(),sim=record.simulations[0];sim.equipment[0].nominalRatePerSecond+=.1;completeSyntheticScenarioSource(sim);
  const h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
    assert.match(h.host.querySelector('.scenario-result-notice').textContent,/Saved result from previous inputs/);
    assert.equal(h.host.querySelector('.scenario-search').disabled,false);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(h.w.STScenarioExplorer.evaluations(sim).length,0);
    assert.match(openTrace(h).textContent,/Saved analysis progress/);
    assert.equal(h.simulationCalls(),0);
  }finally{h.close();}
});

test('a terminal no-improvement result never revives an older winning candidate',()=>{
  const record=savedCase(),sim=record.simulations[0],latest=sim.whatIf.evaluations[0];
  sim.whatIf.evaluations.unshift({...structuredClone(latest),updatedAt:'2026-11-23T20:00:00.000Z',status:'IMPROVEMENT_REPRODUCED',
    candidate:{oee:55,throughput:130},evaluatedChanges:[{equipmentId:'inlet',path:'nominalRatePerSecond',before:8,after:9}]});
  const before=JSON.stringify(sim.whatIf),h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'rejected');
    assert.equal(h.host.querySelector('.scenario-basic-metric'),null);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(openTrace(h).querySelectorAll('.scenario-trace-row').length,2);
    assert.equal(JSON.stringify(sim.whatIf),before);
  }finally{h.close();}
});

test('an old winning scenario remains inspectable but cannot be created after a new baseline',()=>{
  const record=savedCase(),sim=record.simulations[0],entry=sim.whatIf.evaluations[0];
  entry.status='IMPROVEMENT_REPRODUCED';entry.message='';entry.candidate={oee:55,throughput:130};
  entry.evaluatedChanges=[{equipmentId:'inlet',path:'nominalRatePerSecond',before:8,after:9}];
  entry.independentCheck={passed:true,baseline:entry.baseline,candidate:entry.candidate};
  sim.equipment[0].nominalRatePerSecond+=.1;completeSyntheticScenarioSource(sim);
  const before=JSON.stringify(sim.whatIf),h=browser(record);
  try{
    assert.equal(h.w.STScenarios.readiness(sim).ready,true);
    assert.equal(h.host.querySelector('.scenario-search').disabled,false);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
    assert.match(h.host.querySelector('.scenario-result-notice').textContent,/Saved result from previous inputs/);
    assert(h.host.querySelector('.scenario-basic-metric'),'Saved metrics remain visible for review.');
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,'Previous analysis completed.');
    assert.match(openTrace(h).textContent,/Saved analysis progress/);
    h.host.querySelector('.scenario-create').onclick();
    assert.equal(h.creationCalls(),0,'A disabled stale result cannot be applied even if its handler is called directly.');
    assert.equal(h.simulationCalls(),0);
    assert.equal(h.w.STScenarioExplorer.evaluations(sim).length,0);
    assert.equal(JSON.stringify(sim.whatIf),before);
  }finally{h.close();}
});

test('interrupted historical steps stay inspectable without claiming completion',()=>{
  const record=savedCase(),sim=record.simulations[0],entry=sim.whatIf.evaluations[0];
  entry.status='RUNNING';entry.progressTrace.percent=42;entry.progressTrace.outcome='';entry.progressTrace.steps[1].state='Running';entry.progressTrace.steps[1].percent=40;
  sim.equipment[0].nominalRatePerSecond+=.1;
  const before=JSON.stringify(sim.whatIf),h=browser(record);
  try{
    assert.match(h.host.querySelector('.scenario-preview-status').textContent,/Previous search interrupted/);
    assert.equal(h.host.querySelector('.scenario-activity').getAttribute('aria-valuenow'),'42');
    const panel=openTrace(h);assert.equal(panel.querySelectorAll('[data-trace-state="Interrupted"]').length,1);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(JSON.stringify(sim.whatIf),before);
  }finally{h.close();}
});

function savedTargetCase(target=7,limit=''){
  const record=savedCase(),entry=record.simulations[0].whatIf.evaluations[0];
  entry.proposedChanges=[{equipmentId:'inlet',path:'nominalRatePerSecond',before:8,after:7,unit:'units/s'}];
  entry.controls=[{equipmentId:'inlet',path:'nominalRatePerSecond',target,limit,checked:true,
    doe:{selected:true,low:'420',high:'480'}}];
  entry.searchVariables=[{equipmentId:'inlet',path:'nominalRatePerSecond',low:7,high:8}];
  return record;
}

test('a corrected planner default replaces only an untouched saved target with no explicit limit',()=>{
  const record=savedTargetCase(),before=JSON.stringify(record.simulations[0].whatIf),h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-target').value,'540','Use the new 9 units/s default, instead of the old 7 units/s default.');
    const row=h.host.querySelector('.scenario-change'),limit=row.querySelector('.scenario-limit input');
    assert.equal(limit.value,'');assert.equal(limit.parentElement.firstChild.textContent,'Max');assert.match(limit.getAttribute('aria-label'),/ · Max \(/);
    assert.equal(row.querySelector('td input[type="checkbox"]').checked,true);
    assert.equal(row.querySelector('.scenario-doe-select').checked,true);
    assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')].map(input=>input.value),['420','480'],'Saved DOE levels are not assumed to be automatic.');
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
    assert.match(h.host.querySelector('.scenario-result-notice').textContent,/Search targets updated/);
    assert.equal(h.host.querySelector('.scenario-search').disabled,false);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(openTrace(h).querySelectorAll('.scenario-trace-row').length,2);
    assert.equal(JSON.stringify(h.sim.whatIf),before);
  }finally{h.close();}
});

for(const [label,target,limit] of [['manual target',7.5,''],['explicit physical limit',7,'450']]){
  test('planner changes preserve a saved '+label,()=>{
    const record=savedTargetCase(target,limit),before=JSON.stringify(record.simulations[0].whatIf),h=browser(record);
    try{
      const row=h.host.querySelector('.scenario-change'),input=row.querySelector('.scenario-limit input');
      assert.equal(row.querySelector('.scenario-target').value,String(target*60));
      assert.equal(input.value,limit);
      assert.equal(input.parentElement.firstChild.textContent,'Min','The restored direction replaces the new default direction.');
      assert.match(input.getAttribute('aria-label'),/ · Min \(/);
      assert.equal(row.querySelector('td input[type="checkbox"]').checked,true);
      assert.equal(row.querySelector('.scenario-doe-select').checked,true);
      assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')].map(input=>input.value),['420','480']);
      assert.equal(h.host.querySelector('.scenario-result-notice').hidden,true);
      assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
      assert.equal(JSON.stringify(h.sim.whatIf),before);
    }finally{h.close();}
  });
}

test('refreshing a planner default preserves an explicit deselection',()=>{
  const record=savedTargetCase(),control=record.simulations[0].whatIf.evaluations[0].controls[0];
  control.checked=false;control.doe.selected=false;
  const before=JSON.stringify(record.simulations[0].whatIf),h=browser(record);
  try{
    const row=h.host.querySelector('.scenario-change');
    assert.equal(row.querySelector('.scenario-target').value,'540');
    assert.equal(row.querySelector('td input[type="checkbox"]').checked,false);
    assert.equal(row.querySelector('.scenario-doe-select').checked,false);
    assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')].map(input=>input.value),['420','480']);
    assert.equal(JSON.stringify(h.sim.whatIf),before);
  }finally{h.close();}
});
