import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

function browser(record){
  const dom=new JSDOM('<main id="what-if"></main>',{runScripts:'outside-only'});
  const w=dom.window;
  w.__ST_TEXT__=key=>key;
  w.STIcons={svg:()=>'<svg></svg>'};
  w.STPreferences={read:()=>null,write:()=>true};
  w.STErrors={register(){},capture(){}};
  w.STReports={bindWhatIf(){}};
  for(const file of ['SimulationEngine.html','WhatIf.html','ScenarioExplorer.html']){
    w.eval(fs.readFileSync('apps-script/'+file,'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, ''));
  }
  w.STScenarioExplorer.connectCase(()=>record,()=>{});
  return {dom,w,target:w.document.getElementById('what-if'),close:()=>w.close()};
}

function machine(id='machine'){
  return {id,name:'Existing machine',type:'CUSTOM',initialMode:'AUTO',nominalRatePerSecond:8,
    processData:{equipment:{maximumSpeedBpm:600}},noiseProfile:{}};
}
function simulation(){
  return {id:'simulation-a',unitOfFlow:'bottles',equipment:[machine()],
    dynamicConfig:{durationSeconds:3600,tickSeconds:.25,sampleEverySeconds:1,seed:7,reliabilityEnabled:false}};
}
function proposal(equipmentId='machine'){
  return {id:'speed-target',kind:'CUSTOM',catalog:true,tier:'ZERO',basis:'STATIC',
    changes:[{equipmentId,path:'nominalRatePerSecond',before:8,after:9,unit:'units/s'}]};
}
function zeroCard(target){return target.querySelector('.analysis-capex[data-tier="ZERO"]').closest('article');}
function targetFor(card,change,sim,w){
  const info=w.STWhatIf.changeInfo(change,sim.equipment);
  const label=info.equipment+' · '+info.parameter+' · Target (';
  return [...card.querySelectorAll('.scenario-target')].find(input=>input.getAttribute('aria-label').startsWith(label));
}

test('valid scenario speed targets retain their installed maximum and selected state',()=>{
  const sim=simulation(),h=browser({simulations:[sim]});
  try{
    const card=h.w.STWhatIf.card(proposal(),()=>{},sim.equipment,sim);
    h.target.append(card);
    const target=card.querySelector('.scenario-target');
    assert.equal(target.value,'540');
    assert.equal(target.max,'600');
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
  sim.dynamicConfig.durationMode='FIXED';sim.dynamicConfig.durationSeconds=3600;
  const h=browser(record);
  try{
    assert.doesNotThrow(()=>h.w.STWhatIf.render(sim,h.target,()=>{}));
    assert(h.target.querySelectorAll('.scenario-target').length>0);
    // Equipment imports/edits can replace an ID while stored demo scenarios still
    // refer to the previous equipment. A later duration edit rebuilds these cards.
    const oldId=sim.equipment[0].id;
    sim.equipment[0].id='imported-'+oldId;
    sim.dynamicConfig.durationSeconds=86400;
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

test('a valid linked demo retains its selected target after changing the horizon',()=>{
  const record=JSON.parse(fs.readFileSync('test/fixtures/ui-demo-case.json','utf8'));
  const sim=record.simulations[0];
  sim.dynamicConfig.durationMode='FIXED';sim.dynamicConfig.durationSeconds=3600;
  const h=browser(record);
  try{
    const linked=record.simulations.find(s=>s.scenario?.tier==='ZERO');
    const change=linked.scenario.changes.find(c=>c.path==='nominalRatePerSecond');
    assert.doesNotThrow(()=>h.w.STScenarios.apply(sim,linked.scenario.changes));
    for(const duration of [3600,86400]){
      sim.dynamicConfig.durationSeconds=duration;
      assert.doesNotThrow(()=>h.w.STWhatIf.render(sim,h.target,()=>{}));
      const target=targetFor(zeroCard(h.target),change,sim,h.w);
      assert(target&&!target.disabled);
      assert.equal(Number(target.value),change.after*60);
      assert.equal(Number(target.max),sim.equipment.find(e=>e.id===change.equipmentId).processData.equipment.maximumSpeedBpm);
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
