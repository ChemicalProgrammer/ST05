import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {scenarioEvidenceInput} from './helpers/ScenarioEvidenceFixture.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';

function browser(record){
  const dom=new JSDOM('<main id="what-if"></main>',{runScripts:'outside-only'});
  const w=dom.window;
  w.__ST_TEXT__=key=>key;
  w.STIcons={svg:()=>'<svg></svg>',button:el=>{if(!el.querySelector('svg'))el.insertAdjacentHTML('afterbegin','<svg></svg>');}};
  w.STPreferences={read:()=>null,write:()=>true};
  w.STErrors={register(){},capture(){}};
  w.STReports={bindWhatIf(){}};
  for(const file of ['ClientUtils.html','Subsection.html','SimulationEngine.html','WhatIf.html','ScenarioExplorer.html']){
    const source=fs.readFileSync('apps-script/'+file,'utf8'),scripts=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    if(scripts.length)for(const script of scripts)w.eval(script[1]);else w.eval(source);
  }
  w.STScenarioExplorer.connectCase(()=>record,()=>{});
  return {dom,w,target:w.document.getElementById('what-if'),close:()=>w.close()};
}

function simulation(){
  const sim=scenarioEvidenceInput();sim.id='simulation-a';sim.dynamicConfig.reliabilityEnabled=false;
  return completeSyntheticScenarioSource(sim);
}
function proposal(equipmentId='belt'){
  return {id:'speed-target',kind:'CUSTOM',catalog:true,tier:'ZERO',basis:'STATIC',
    changes:[{equipmentId,path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360,unit:'mm/s'}]};
}
function zeroCard(target){return target.querySelector('.analysis-capex[data-tier="ZERO"]').closest('article');}
function targetFor(card,change,sim,w){
  const info=w.STWhatIf.changeInfo(change,sim.equipment);
  const label=info.equipment+' · '+info.parameter+' · Target (';
  return [...card.querySelectorAll('.scenario-target')].find(input=>input.getAttribute('aria-label').startsWith(label));
}

test('valid conveyor speed targets retain physical bounds and selected state',()=>{
  const sim=simulation(),h=browser({simulations:[sim]});
  try{
    const card=h.w.STWhatIf.card(proposal(),()=>{},sim.equipment,sim);
    h.target.append(card);
    const target=card.querySelector('.scenario-target');
    assert.equal(target.value,'21.6');
    assert.equal(Number(target.max),h.w.STScenarios.fields['processData.accumulation.conveyorSpeedMmPerSecond'][1]*.06);
    assert.equal(target.disabled,false);
    const use=card.querySelector('.scenario-change input[type="checkbox"]');
    assert.equal(use.checked,true);
    assert.equal(use.disabled,false);
  }finally{h.close();}
});

test('a proposal for an absent equipment cannot crash card rendering or remain selectable',()=>{
  const sim=simulation(),h=browser({simulations:[sim]});
  try{
    let card;
    assert.doesNotThrow(()=>{card=h.w.STWhatIf.card(proposal('removed-machine'),()=>{},sim.equipment,sim);});
    h.target.append(card);
    const row=card.querySelector('.scenario-change');
    if(row){
      const use=row.querySelector('input[type="checkbox"]');
      assert.equal(use.disabled,true,'An orphan proposal must not be offered as an applicable change');
      assert.equal(use.checked,false);
      const target=row.querySelector('.scenario-target');
      if(target)assert.equal(target.disabled,true);
    }
  }finally{h.close();}
});

test('changing a saved demo from one hour to one day tolerates a stale linked equipment target',()=>{
  const record=JSON.parse(fs.readFileSync('test/fixtures/ui-demo-case.json','utf8'));
  const sim=record.simulations[0];
  sim.dynamicConfig.durationMode='FIXED';sim.dynamicConfig.durationSeconds=3600;completeSyntheticScenarioSource(sim);
  const h=browser(record);
  try{
    assert.doesNotThrow(()=>h.w.STWhatIf.render(sim,h.target,()=>{}));
    assert(h.target.querySelectorAll('.scenario-target').length>0);
    // Equipment imports/edits can replace an ID while stored demo scenarios still
    // refer to the previous equipment. A later duration edit rebuilds these cards.
    const oldId=sim.equipment[0].id;
    sim.equipment[0].id='imported-'+oldId;
    sim.dynamicConfig.durationSeconds=86400;completeSyntheticScenarioSource(sim);
    const storedChanges=JSON.stringify(record.simulations.slice(1).map(s=>s.scenario.changes));
    const current=h.w.STScenarios.plan(sim).candidates.find(p=>p.canApply&&p.tier==='ZERO'
      &&p.changes.length===1&&p.changes[0].path==='processData.accumulation.conveyorSpeedFactorPercent').changes[0];
    assert.doesNotThrow(()=>h.w.STWhatIf.render(sim,h.target,()=>{}));
    assert(h.target.querySelectorAll('.scenario-configure').length>=3);
    const target=targetFor(zeroCard(h.target),current,sim,h.w);
    assert(target&&!target.disabled,'Valid current targets must remain available');
    assert.equal(Number(target.value),current.after,
      'A stale linked demo must not overwrite the current engineering proposal');
    assert.equal(JSON.stringify(record.simulations.slice(1).map(s=>s.scenario.changes)),storedChanges,
      'Rendering must not delete or rewrite the stored scenario evidence');
  }finally{h.close();}
});

test('a valid conveyor-only linked demo retains its target after changing the horizon',()=>{
  const sim=simulation(),change=proposal().changes[0],record={simulations:[sim,{id:'linked',name:'Supported conveyor hypothesis',scenario:{origin:'DEMO',sourceSimulationId:sim.id,tier:'ZERO',changes:[change]}}]};
  const h=browser(record);
  try{
    assert.doesNotThrow(()=>h.w.STScenarios.apply(sim,[change]));
    for(const duration of [3600,86400]){
      sim.dynamicConfig.durationSeconds=duration;completeSyntheticScenarioSource(sim);
      assert.doesNotThrow(()=>h.w.STWhatIf.render(sim,h.target,()=>{}));
      const target=targetFor(zeroCard(h.target),change,sim,h.w);
      assert(target&&!target.disabled);assert.equal(Number(target.value),Number((change.after*.06).toPrecision(8)));
      assert.equal(Number(target.max),h.w.STScenarios.fields[change.path][1]*.06);
    }
  }finally{h.close();}
});

test('an unsupported saved scenario field renders as unavailable',()=>{
  const sim=simulation(),h=browser({simulations:[sim]});
  try{
    const project=proposal();project.changes[0].path='processData.retiredParameter';
    let card;
    assert.doesNotThrow(()=>{card=h.w.STWhatIf.card(project,()=>{},sim.equipment,sim);});
    h.target.append(card);
    const row=card.querySelector('.scenario-change');
    if(row){
      const use=row.querySelector('input[type="checkbox"]');
      assert.equal(use.disabled,true);assert.equal(use.checked,false);
      const target=row.querySelector('.scenario-target');
      if(target){assert.equal(target.disabled,true);assert.notEqual(target.max,'NaN');}
    }
  }finally{h.close();}
});
