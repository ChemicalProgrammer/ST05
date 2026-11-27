import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {scenarioSignature} from '../src/analysis/ScenarioPlanner.js';
import {scenarioSearchSettingsSignature} from '../src/analysis/ScenarioSearch.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';
import {scenarioEvidenceInput} from './helpers/ScenarioEvidenceFixture.js';

const outcome='No tested configuration improved the matched baseline (50.00% OEE). Baseline retained; no better scenario is recommended.';

function savedCase(){
  const fixture=scenarioEvidenceInput();fixture.id='simulation-a';Object.assign(fixture.dynamicConfig,{durationSeconds:3600,rounds:3,seed:7});
  const sim=completeSyntheticScenarioSource(fixture);
  const steps=[
    {name:'Baseline',state:'Completed',percent:100,elapsedMs:3000,work:{primary:{label:'Baseline batches',done:1,total:1}}},
    {name:'Comparing finalists',state:'Completed',percent:100,elapsedMs:7000,work:{primary:{label:'Finalists',done:2,total:2}}}
  ];
  sim.whatIf={evaluations:[{cardId:JSON.stringify([sim.id,'CAPEX','ZERO']),sourceSimulationId:sim.id,
    sourceSignature:scenarioSignature(sim),status:'NO_DEMONSTRATED_IMPROVEMENT',message:outcome,
    updatedAt:'2026-11-24T20:00:00.000Z',searchSettings:{speedProfile:'BALANCED'},
    searchSettingsSignature:scenarioSearchSettingsSignature(),searchPolicyVersion:'MATCHED_CAPEX_V12',searchScope:'ZERO',tier:'ZERO',uiMode:'basic',
    methodologySignature:'{}',baseline:{oee:50,throughput:120},candidate:null,evaluatedChanges:[],
    run:{...sim.dynamicConfig},depth:'MEDIUM',progress:'Finished · 3 / up to 3 simulation batches · Elapsed 10s',
    progressTrace:{steps,percent:100,outcome:'Completed',summary:{candidateBatches:2,candidateMs:7000}}
  }]};
  return {simulations:[sim],metadata:{includeDOE:false}};
}

function browser(record,compact=false){
  const dom=new JSDOM('<!doctype html><html data-ui-mode="basic"><body></body></html>',{runScripts:'outside-only'}),w=dom.window;
  w.__ST_TEXT__=key=>key;
  w.STPreferences={read:()=>null,write:()=>true};w.STIcons={svg:()=>'<svg></svg>',button:el=>{if(!el.querySelector('svg'))el.insertAdjacentHTML('afterbegin','<svg></svg>');}};
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
  const sim=record.simulations[0],host=w.STWhatIf.card({compact,kind:'CUSTOM',tier:'ZERO',searchScope:'ZERO',explore:true,catalog:true,searchDerivedDOE:true,
    changes:[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360,unit:'mm/s'}]},()=>{creationCalls++;},sim.equipment,sim);
  w.document.body.append(host);
  return {w,sim,host,header:host.querySelector(':scope > .scenario-card-header'),simulationCalls:()=>simulationCalls,creationCalls:()=>creationCalls,close:()=>w.close()};
}

function openTrace(h){
  const activity=h.host.querySelector('.scenario-activity');
  assert.equal(activity.hidden,false,'Saved analysis remains inspectable.');
  activity.click();
  const panel=h.host.querySelector('.scenario-trace-panel');
  assert.equal(panel.hidden,false);
  assert.equal(h.host.querySelector(':scope > .scenario-card-header'),h.header,'Historical progress retains the original CAPEX header.');
  assert.equal(h.header.querySelector('.analysis-capex').dataset.tier,'ZERO');
  assert.equal(h.host.querySelectorAll('.analysis-capex').length,1);
  assert.equal(panel.querySelector('.scenario-trace-header'),null);
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
    assert.match(panel.textContent,/100\.00% · 0m 03s/);
    assert.match(panel.textContent,/100\.00% · 0m 07s/);
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
    const panel=openTrace(h);assert.match(panel.textContent,/Saved analysis\. Complete the current numerical simulation/);assert.equal(panel.querySelectorAll('.scenario-trace-row').length,2);
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
    assert.match(openTrace(h).textContent,/Saved result from previous inputs or search settings/);
    assert.equal(h.simulationCalls(),0);
  }finally{h.close();}
});

test('a terminal no-improvement result never revives an older winning candidate',()=>{
  const record=savedCase(),sim=record.simulations[0],latest=sim.whatIf.evaluations[0];
  sim.whatIf.evaluations.unshift({...structuredClone(latest),updatedAt:'2026-11-23T20:00:00.000Z',status:'IMPROVEMENT_REPRODUCED',
    candidate:{oee:55,throughput:130},evaluatedChanges:[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360}]});
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
  entry.evaluatedChanges=[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360}];
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
    assert.ok(h.host.querySelector('.scenario-preview-status').classList.contains('scenario-completion-note'),'Historical completion is a removable Basic-only note.');
    const ui=fs.readFileSync('apps-script/UiStandards.html','utf8');
    assert.match(ui,/html\[data-ui-mode=basic\] \.scenario-tier-grid \.scenario-baseline-note,[\s\S]*?\.scenario-preview-status\.scenario-completion-note\[data-state=stale\][\s\S]*?display:none!important/);
    assert.match(openTrace(h).textContent,/Saved result from previous inputs or search settings/);
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

function savedTargetCase(target=270,limit=''){
  const record=savedCase(),entry=record.simulations[0].whatIf.evaluations[0];
  entry.proposedChanges=[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:270,unit:'mm/s'}];
  entry.controls=[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',target,limit,checked:true,
    doe:{selected:true,low:'16.2',high:'18'}}];
  entry.searchVariables=[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',low:270,high:300}];
  return record;
}

test('a corrected planner default replaces only an untouched saved target with no explicit limit',()=>{
  const record=savedTargetCase(),before=JSON.stringify(record.simulations[0].whatIf),h=browser(record);
  try{
    assert.equal(h.host.querySelector('.scenario-target').value,'21.6','Use the new 360 mm/s default instead of the old 270 mm/s default.');
    const row=h.host.querySelector('.scenario-change'),limit=row.querySelector('.scenario-limit input');
    assert.equal(limit.value,'');assert.equal(limit.parentElement.firstChild.textContent,'Max');assert.match(limit.getAttribute('aria-label'),/ · Max \(/);
    assert.equal(row.querySelector('td input[type="checkbox"]').checked,true);
    assert.equal(row.querySelector('.scenario-doe-select').checked,true);
    assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')].map(input=>input.value),['16.2','18'],'Saved DOE levels are not assumed to be automatic.');
    assert.equal(h.host.querySelector('.scenario-preview-status').textContent,outcome);
    assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
    assert.match(h.host.querySelector('.scenario-result-notice').textContent,/Search targets updated/);
    assert.equal(h.host.querySelector('.scenario-search').disabled,false);
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(openTrace(h).querySelectorAll('.scenario-trace-row').length,2);
    assert.equal(JSON.stringify(h.sim.whatIf),before);
  }finally{h.close();}
});

for(const [label,target,limit] of [['manual target',285,''],['explicit physical limit',270,'17.1']]){
  test('planner changes preserve a saved '+label,()=>{
    const record=savedTargetCase(target,limit),before=JSON.stringify(record.simulations[0].whatIf),h=browser(record);
    try{
      const row=h.host.querySelector('.scenario-change'),input=row.querySelector('.scenario-limit input');
      assert.equal(row.querySelector('.scenario-target').value,String(Number((target*.06).toPrecision(8))));
      assert.equal(input.value,limit);
      assert.equal(input.parentElement.firstChild.textContent,'Min','The restored direction replaces the new default direction.');
      assert.match(input.getAttribute('aria-label'),/ · Min \(/);
      assert.equal(row.querySelector('td input[type="checkbox"]').checked,true);
      assert.equal(row.querySelector('.scenario-doe-select').checked,true);
      assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')].map(input=>input.value),['16.2','18']);
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
    assert.equal(row.querySelector('.scenario-target').value,'21.6');
    assert.equal(row.querySelector('td input[type="checkbox"]').checked,false);
    assert.equal(row.querySelector('.scenario-doe-select').checked,false);
    assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')].map(input=>input.value),['16.2','18']);
    assert.equal(JSON.stringify(h.sim.whatIf),before);
  }finally{h.close();}
});

test('adding a machine and conveyor preserves the old CAPEX result with a visible historical warning until reevaluation',()=>{
  const record=savedCase(),sim=record.simulations[0],entry=sim.whatIf.evaluations[0];
  entry.status='IMPROVEMENT_REPRODUCED';entry.message='';entry.candidate={oee:55,throughput:130};
  entry.independentCheck={passed:true,baseline:entry.baseline,candidate:entry.candidate};
  entry.evaluatedChanges=[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360,unit:'mm/s'}];
  sim.equipment.push({id:'added-belt',name:'Added conveyor',type:'CONVEYOR',nominalRatePerSecond:8,initialMode:'AUTO',characteristics:{},noiseProfile:{},processData:{}},
    {id:'added-machine',name:'Added equipment',type:'CUSTOM',nominalRatePerSecond:8,initialMode:'AUTO',characteristics:{},noiseProfile:{},processData:{equipment:{maximumSpeedBpm:600}}});
  sim.results=null;
  const history=JSON.stringify(sim.whatIf);
  for(const ready of [false,true]){
    if(ready)completeSyntheticScenarioSource(sim);
    const h=browser(record);
    try{
      const badge=h.header.querySelector('.scenario-source-warning');
      assert.equal(badge.hidden,false);assert.equal(badge.textContent,'Inputs changed');
      assert.equal(h.host.dataset.sourceEvidence,'STALE');
      assert.match(badge.title,/Historical result: the source simulation inputs changed/);
      assert.equal(h.host.querySelector('.scenario-search').disabled,!ready);
      assert.equal(h.host.querySelector('.scenario-create').disabled,true);
      assert(h.host.querySelector('.scenario-basic-metric'));
      assert.match(h.host.querySelector('.scenario-baseline-note').textContent,/Historical/);
      openTrace(h);assert.equal(badge.hidden,false);
      h.host.querySelector('.scenario-results').click();
      assert.match(h.host.querySelector('.scenario-results-dialog .scenario-history-notice').textContent,/Historical result/);
      assert.equal(h.w.STScenarioExplorer.evaluations(sim).length,0);
      assert.equal(JSON.stringify(sim.whatIf),history);
      assert.equal(h.simulationCalls(),0);
    }finally{h.close();}
  }
});

test('current settings cannot relabel a nested previous-source result as current',()=>{
  const record=savedCase(),sim=record.simulations[0],old=structuredClone(sim.whatIf.evaluations[0]);
  old.status='IMPROVEMENT_REPRODUCED';old.message='Old outcome';old.candidate={oee:55,throughput:130};
  old.independentCheck={passed:true,baseline:old.baseline,candidate:old.candidate};
  old.evaluatedChanges=[{equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360,unit:'mm/s'}];
  sim.equipment[0].nominalRatePerSecond+=.1;completeSyntheticScenarioSource(sim);
  sim.whatIf.evaluations=[{...sim.whatIf.evaluations[0],sourceSignature:scenarioSignature(sim),status:'NOT_EVALUATED',baseline:null,candidate:null,evaluatedChanges:undefined,lastResult:old,progressTrace:undefined}];
  const before=JSON.stringify(sim.whatIf),h=browser(record);
  try{
    assert.equal(h.header.querySelector('.scenario-source-warning').hidden,false);
    assert.equal(h.host.dataset.sourceEvidence,'STALE');
    assert.equal(h.host.querySelector('.scenario-create').disabled,true);
    assert.equal(h.host.querySelector('.scenario-search').disabled,false);
    assert.equal(h.w.STScenarioExplorer.evaluations(sim).length,0);
    h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
    assert.equal(h.header.querySelector('.scenario-source-warning').textContent,'Datos modificados');
    assert.equal(JSON.stringify(sim.whatIf),before);
  }finally{h.close();}
});

test('a fresh source-compatible result has no source-change warning',()=>{
  const record=savedCase(),h=browser(record);
  try{
    assert.equal(h.header.querySelector('.scenario-source-warning').hidden,true);
    assert.equal(h.host.dataset.sourceEvidence,'CURRENT');
    assert.equal(h.w.STScenarioExplorer.evaluations(h.sim).length,1);
  }finally{h.close();}
});

 test('Basic shared card shows retained baseline and the same results dialog, without inventing a candidate',async()=>{
 const h=browser(savedCase(),true);try{
  assert.equal(h.host.dataset.compactCapex,'true');
  assert.match(h.host.querySelector('.scenario-metrics').textContent,/50\.00/);
  assert.match(h.host.querySelector('.scenario-metrics').textContent,/120\.00/);
  assert.match(h.host.querySelector('.scenario-metrics').textContent,/Baseline retained/);
  assert(h.host.querySelector('.scenario-create').disabled);
  h.host.querySelector('.scenario-results').click();
  assert.match(h.host.querySelector('.scenario-results-dialog').textContent,/No input changes retained/);
  h.sim.results=null;
  const blocked=await h.host._runMinimalSearch();
  assert.equal(blocked.started,false);assert.match(blocked.reason,/NO_RESULTS/);
  assert.equal(h.simulationCalls(),0);
 }finally{h.close();}
});


test('legacy mixed-category policy and old machine-speed targets remain historical, without restoring forbidden controls',()=>{
 const record=savedTargetCase(),sim=record.simulations[0],entry=sim.whatIf.evaluations[0];
 entry.searchPolicyVersion='MATCHED_CAPEX_V11';entry.categoryInclusions={ZERO:true,MEDIUM:true};
 entry.status='IMPROVEMENT_REPRODUCED';entry.message='';entry.candidate={oee:55,throughput:130};entry.independentCheck={passed:true,baseline:entry.baseline,candidate:entry.candidate};
 entry.evaluatedChanges=[{equipmentId:'upstream',path:'nominalRatePerSecond',before:2,after:2.2,originTier:'ZERO'}];
 entry.controls.push({equipmentId:'upstream',path:'nominalRatePerSecond',target:2.2,checked:true});
 const before=JSON.stringify(sim.whatIf),h=browser(record);
 try{
  assert.equal(h.host.querySelector('.scenario-create').disabled,true);
  assert.equal(h.host.querySelector('.scenario-preview-status').dataset.state,'stale');
  assert.match(h.host.querySelector('.scenario-result-notice').textContent,/current full-horizon comparison policy/);
  assert.equal(h.host.querySelector('.scenario-include-category'),null);
  assert.equal(h.host.querySelectorAll('.scenario-target').length,1);
  assert.equal(h.host.querySelector('.scenario-target').value,'21.6','The current category supplies a fresh valid conveyor target.');
  assert(h.host.querySelector('.scenario-basic-metric'),'Historical metrics remain inspectable.');
  assert.equal(openTrace(h).querySelectorAll('.scenario-trace-row').length,2);
  assert.equal(h.simulationCalls(),0);assert.equal(JSON.stringify(sim.whatIf),before);
 }finally{h.close();}
});

test('Basic ignores saved manual factor and target controls without rewriting Standard history',()=>{
 const record=savedTargetCase(285,'17.1'),sim=record.simulations[0],before=JSON.stringify(sim.whatIf),h=browser(record,true);
 try{
  assert.equal(h.host.querySelector('.scenario-target').value,'21.6');
  assert.equal(h.host.querySelector('.scenario-limit input').value,'');
  assert.equal(h.host.querySelector('.scenario-doe-select').checked,false);
  assert.equal(h.host.querySelector('.scenario-create').disabled,true);
  assert.equal(h.simulationCalls(),0);assert.equal(JSON.stringify(sim.whatIf),before);
 }finally{h.close();}
});
