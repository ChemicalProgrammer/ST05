import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';
import {scenarioEvidenceInput} from './helpers/ScenarioEvidenceFixture.js';

function browser({doe=false,depth='MEDIUM',lang='en'}={}){
  // A physical machine/conveyor/machine line, with real scenario fields and
  // complete synthetic provenance. These tests only edit configuration.
  const sim=scenarioEvidenceInput();
  sim.whatIf={searchDepth:depth};
  completeSyntheticScenarioSource(sim);
  const record={simulations:[sim],metadata:{includeDOE:doe}};
  const dom=new JSDOM('<!doctype html><html lang="en" data-ui-mode="basic"><body><article class="analysis-recommendation"></article></body></html>',{runScripts:'outside-only'}),w=dom.window;
  w.document.documentElement.lang=lang;
  w.__ST_TEXT__=key=>key;
  w.STPreferences={read:()=>null,write:()=>true};w.STIcons={svg:()=>'<svg></svg>',button:(el)=>{if(!el.querySelector('svg'))el.insertAdjacentHTML('afterbegin','<svg></svg>');}};
  w.STErrors={register(){},capture(){}};w.STReports={bindWhatIf(){}};
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const file of ['ClientUtils.html','Subsection.html','SimulationEngine.html','WhatIf.html','ScenarioExplorer.html']){
    const source=fs.readFileSync('apps-script/'+file,'utf8'),scripts=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    if(scripts.length)for(const match of scripts)w.eval(match[1]);else w.eval(source);
  }
  const validity=w.SimulatorEngine.validateSimulationInput({case:sim,run:sim.dynamicConfig});
  assert.equal(validity.ok,true,JSON.stringify(validity.error));
  assert.equal(w.STScenarios.readiness(sim).ready,true);
  w.STScenarioExplorer.connectCase(()=>record,()=>{});
  const machine={equipmentId:'upstream',path:'nominalRatePerSecond',before:2,after:2.2,unit:'units/s'};
  const conveyors=[
    {equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360,unit:'mm/s'},
    {equipmentId:'belt',path:'processData.accumulation.backupSensorPositionMm',before:300,after:250,unit:'mm'}
  ];
  const host=w.document.querySelector('article');
  w.STScenarioExplorer.attach(host,{kind:'CUSTOM',tier:'MEDIUM',searchScope:'MEDIUM',explore:true,catalog:true,searchDerivedDOE:true,
    changes:[machine],categoryChanges:{MEDIUM:[machine],ZERO:conveyors}},()=>{},sim);
  host.querySelector('.scenario-configure').click();
  const dialog=host.querySelector('.scenario-config-dialog'),pages=[...dialog.querySelectorAll('[role="tabpanel"]')],tabs=[...dialog.querySelectorAll('[role="tab"]')];
  return {w,sim,record,host,dialog,pages,tabs,table:dialog.querySelector('.scenario-conveyor-parameters'),close:()=>w.close()};
}

function change(h,input,value){
  input.value=value;
  input.dispatchEvent(new h.w.Event('change',{bubbles:true}));
}

function conveyorRow(h){return h.table.querySelector('tbody tr');}

function assertCompleteTable(h,showDOE=h.record.metadata.includeDOE&&h.dialog.querySelector('.scenario-search-depth').value!=='LIGHT'){
  h.tabs[2].click();
  assert.equal(h.pages[2].hidden,false);
  assert.equal(h.table.closest('[hidden]'),null);
  assert.deepEqual([...h.table.querySelectorAll('thead th')].map(cell=>cell.textContent.trim()),
    ['Use','Equipment','Parameter','Current','Target','Unit','Feasible limit','DOE','Low','High']);
  const rows=[...h.table.querySelectorAll('tbody tr')];
  assert.equal(rows.length,2);
  for(const row of rows){
    assert.equal(row.children.length,10);
    assert.equal(row.hidden,false);
    assert.equal(row.querySelector('.scenario-target').disabled,false,'Ordinary targets remain editable when DOE is unavailable.');
    assert(row.querySelector('.scenario-limit input'));
  }
  for(const cell of h.table.querySelectorAll('th,td'))assert.equal(cell.hidden,cell.hasAttribute('data-doe-column')&&!showDOE,'Only applicable columns are visible.');
}

test('conveyors hide only DOE columns when DOE is off or omitted at Light depth',()=>{
  for(const settings of [{doe:false,depth:'MEDIUM'},{doe:true,depth:'LIGHT'}]){
    const h=browser(settings);
    try{
      assertCompleteTable(h);
      for(const input of h.table.querySelectorAll('.scenario-doe-select,.scenario-doe-level,.scenario-conveyor-doe-all'))
        assert.equal(input.disabled,true);
      const toggle=h.dialog.querySelector('.scenario-doe-enabled'),suggest=h.dialog.querySelector('.scenario-doe-suggest');
      assert.equal(toggle.checked,settings.doe);
      assert.equal(toggle.disabled,settings.depth==='LIGHT');
      assert.equal(suggest.hidden,true);
      assert.equal(toggle.closest('label').hidden,settings.depth==='LIGHT');
      assert.equal(suggest.disabled,true);
      const note=h.pages[2].querySelector('.scenario-doe-state');
      assert.equal(note.hidden,true);
    }finally{h.close();}
  }
});

test('enabling DOE permits choosing a conveyor factor and saving its editable levels',()=>{
  const h=browser();
  try{
    assertCompleteTable(h);
    const row=conveyorRow(h),factor=row.querySelector('.scenario-doe-select'),levels=[...row.querySelectorAll('.scenario-doe-level')];
    const toggle=h.dialog.querySelector('.scenario-doe-enabled');
    toggle.click();
    assert.equal(h.record.metadata.includeDOE,true);
    assert.equal(factor.disabled,false);
    assert.equal(h.table.querySelector('.scenario-conveyor-doe-all').disabled,false);
    assert.equal(h.dialog.querySelector('.scenario-doe-suggest').disabled,false);
    assert(levels.every(input=>input.disabled),'Levels require explicit factor selection.');
    factor.click();
    assert.equal(factor.checked,true);
    assert.equal(row.querySelector('td input[type="checkbox"]').checked,true);
    assert(levels.every(input=>!input.disabled));
    change(h,levels[0],'19.5');change(h,levels[1],'23.25');
    const saved=h.sim.whatIf.evaluations.at(-1).controls.find(control=>control.path==='processData.accumulation.conveyorSpeedMmPerSecond');
    assert.equal(saved.doe.selected,true);
    assert.deepEqual([saved.doe.low,saved.doe.high],['19.5','23.25']);
    assert.match(h.pages[2].querySelector('.scenario-factor-count').textContent,/1 \/ \d+ factors selected/);
  }finally{h.close();}
});

test('conveyor selections and level values survive depth changes without replacing controls',()=>{
  const h=browser({doe:true});
  try{
    const row=conveyorRow(h),factor=row.querySelector('.scenario-doe-select'),levels=[...row.querySelectorAll('.scenario-doe-level')];
    const depth=h.dialog.querySelector('.scenario-search-depth'),toggle=h.dialog.querySelector('.scenario-doe-enabled');
    factor.click();change(h,levels[0],'19.5');change(h,levels[1],'23.25');
    for(const value of ['HIGH','LIGHT','MEDIUM']){
      change(h,depth,value);
      assert.equal(h.sim.whatIf.searchDepth,value);
      assertCompleteTable(h);
      assert.equal(conveyorRow(h),row);
      assert.equal(row.querySelector('.scenario-doe-select'),factor);
      assert.deepEqual([...row.querySelectorAll('.scenario-doe-level')],levels);
      assert.equal(factor.checked,true,'Light depth suspends DOE without erasing the selection.');
      assert.equal(factor.disabled,value==='LIGHT');
      assert(levels.every(input=>input.disabled===(value==='LIGHT')));
      assert.deepEqual(levels.map(input=>input.value),['19.5','23.25']);
      assert.equal(toggle.checked,true);
      const saved=h.sim.whatIf.evaluations.at(-1).controls.find(control=>control.path==='processData.accumulation.conveyorSpeedMmPerSecond');
      assert.equal(saved.doe.selected,true);
      assert.deepEqual([saved.doe.low,saved.doe.high],['19.5','23.25']);
    }
  }finally{h.close();}
});

test('DOE tools follow the active conveyor scope and keep the same live nodes in Search',()=>{
  const h=browser({doe:true});
  try{
    const toggle=h.dialog.querySelector('.scenario-doe-enabled'),content=h.dialog.querySelector('.scenario-config-doe-content');
    const suggest=h.dialog.querySelector('.scenario-doe-suggest'),count=h.dialog.querySelector('.scenario-factor-count'),percent=h.dialog.querySelector('.scenario-suggestion-percent');
    const scope=h.dialog.querySelector('.scenario-include-category[data-tier="ZERO"]'),table=h.table;
    assert.equal(scope.checked,true);
    function assertTools(page){
      for(const [selector,node] of [['.scenario-doe-enabled',toggle],['.scenario-config-doe-content',content],['.scenario-doe-suggest',suggest],['.scenario-factor-count',count],['.scenario-suggestion-percent',percent]]){
        assert.equal(page.querySelector(selector),node);
        assert.equal(h.dialog.querySelectorAll(selector).length,1,'Moving a control must not clone it.');
      }
      assert.equal(toggle.closest('.st-subsection-header').parentElement,content.closest('.scenario-config-group'));
      assert.equal(suggest.nextElementSibling,count);
      assert.equal(count.nextElementSibling,percent);
    }
    assertTools(h.pages[2]);
    h.tabs[0].click();scope.click();
    assert.equal(h.tabs[2].hidden,true,'A scope without conveyor variables does not retain an empty tab.');
    assert.equal(h.pages[0].hidden,false);
    assertTools(h.pages[0]);
    assert.equal(content.closest('[hidden]'),null,'DOE remains reachable for the machine-only scope.');
    toggle.click();
    assert.equal(h.record.metadata.includeDOE,false,'The moved toggle retains its original change handler.');
    assert.equal(suggest.disabled,true);
    toggle.click();
    assert.equal(h.record.metadata.includeDOE,true);
    assert.equal(suggest.disabled,false);
    scope.click();
    assert.equal(h.tabs[2].hidden,false);
    assertTools(h.pages[2]);
    assert.equal(h.dialog.querySelector('.scenario-conveyor-parameters'),table);
    assertCompleteTable(h);
    const factor=conveyorRow(h).querySelector('.scenario-doe-select');factor.click();
    assert.equal(factor.checked,true);
    assert.match(count.textContent,/1 \/ \d+ factors selected/,'The moved status still reflects the live factor selection.');
  }finally{h.close();}
});

test('Spanish conveyor DOE levels use Bajo/Alto while search depth and guidance retain their context',()=>{
  const h=browser({lang:'es'});
  try{
    h.tabs[2].click();
    const depth=h.dialog.querySelector('.scenario-search-depth'),count=h.dialog.querySelector('.scenario-factor-count'),note=h.dialog.querySelector('.scenario-doe-state');
    const headings=[...h.table.querySelectorAll('thead th[data-doe-column]')];
    assert.deepEqual(headings.map(cell=>cell.textContent.trim()),['DOE','Bajo','Alto']);
    assert.equal(depth.querySelector('option[value="HIGH"]').textContent,'Alta');
    assert.equal(depth.querySelector('option[value="LIGHT"]').textContent,'Ligera');
    assert.match(count.textContent,/0 \/ \d+ factores seleccionados · 3 variables elegibles/);
    assert.equal(note.hidden,true);
    assert(headings.every(cell=>cell.hidden),'Inactive DOE columns are hidden.');
    h.dialog.querySelector('.scenario-doe-enabled').click();
    conveyorRow(h).querySelector('.scenario-doe-select').click();
    assert.match(count.textContent,/1 \/ \d+ factores seleccionados · 3 variables elegibles/);
    change(h,depth,'HIGH');
    assert.equal(depth.selectedOptions[0].textContent,'Alta');
    assert.deepEqual(headings.map(cell=>cell.textContent.trim()),['DOE','Bajo','Alto']);
    change(h,depth,'LIGHT');
    assert.equal(depth.selectedOptions[0].textContent,'Ligera');
    assert.equal(count.textContent,'DOE no está disponible en profundidad Ligera.');
    assert.equal(note.hidden,true);
    assert(headings.every(cell=>cell.hidden),'DOE columns are hidden at Light depth.');
  }finally{h.close();}
});

test('Light still enforces physical limits, focuses the invalid conveyor, and does not start a new search',()=>{
  const h=browser({depth:'LIGHT',doe:true});
  try{
    h.tabs[2].click();
    const row=conveyorRow(h),limit=row.querySelector('.scenario-limit input'),target=row.querySelector('.scenario-target');
    // Current speed is 18 m/min; the target increases it to 21.6 m/min.
    limit.value='17';limit.dispatchEvent(new h.w.Event('input',{bubbles:true}));
    assert.equal(limit.getAttribute('aria-invalid'),'true');
    assert.match(row.querySelector('.scenario-limit-error').textContent,/Maximum cannot be below the current value 18 m\/min/);
    const oldEntry=JSON.stringify(h.sim.whatIf.evaluations.at(-1));
    h.dialog.close();h.host.querySelector('.scenario-search').click();
    assert.equal(h.dialog.open,true);assert.equal(h.pages[2].hidden,false);
    assert.equal(h.w.document.activeElement,limit);
    assert.match(h.dialog.querySelector('.scenario-config-validation').textContent,/18 m\/min/);
    assert.notEqual(h.host.getAttribute('aria-busy'),'true');
    assert.equal(JSON.stringify(h.sim.whatIf.evaluations.at(-1)),oldEntry);
    // A blank limit imposes no additional bound; the reset also restores
    // the planner target and DOE defaults in this group.
    target.value='23';target.dispatchEvent(new h.w.Event('input',{bubbles:true}));
    const reset=[...h.pages[2].querySelectorAll('button')].find(b=>b.title==='Restore default targets and limits');
    assert(reset);reset.click();
    assert.equal(limit.value,'');assert.equal(target.value,'21.6');assert.equal(limit.getAttribute('aria-invalid'),'false');
    assert.equal(h.dialog.querySelector('.scenario-config-validation').hidden,true);
  }finally{h.close();}
});
