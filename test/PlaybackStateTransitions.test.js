import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const read=path=>fs.readFileSync(path,'utf8');
const source=read('apps-script/ClientPlayback.html');
function sourceFunction(name){
  const start=source.indexOf('    function '+name+'('),end=source.indexOf('\n    function ',start+10);
  assert.ok(start>=0&&end>start,'Missing '+name);
  return source.slice(start,end);
}

test('True equipment state changes survive the bounded full-sample recording limit',()=>{
  const engine=read('src/simulation/LineSimulationEngine.js');
  const start=engine.indexOf('function recordStateTransitions('),end=engine.indexOf('function addSampleIfDue(',start);
  assert.ok(start>0&&end>start);
  const context={round:value=>Number(value.toFixed(3))};
  vm.createContext(context);
  vm.runInContext('const MAX_STATE_TRANSITIONS=4000;\n'+engine.slice(start,end)+'\nthis.record=recordStateTransitions;',context);
  const runtime={virtualSecond:0,equipment:[{availabilityState:'RUNNING'},{availabilityState:'STARVED'}],captureStateTransitions:true,summaryOnly:false,lastRecordedStates:[],stateTransitions:[],omittedStateTransitions:0};
  context.record(runtime);context.record(runtime);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.stateTransitions)),[[0,0,'RUNNING'],[0,1,'STARVED']]);
  runtime.virtualSecond=.25;runtime.equipment[1].availabilityState='RUNNING';context.record(runtime);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.stateTransitions[2])),[.25,1,'RUNNING']);
  runtime.stateTransitions=Array.from({length:4000},()=>[0,0,'RUNNING']);
  runtime.virtualSecond=.5;runtime.equipment[0].availabilityState='FAULTED';context.record(runtime);
  assert.equal(runtime.stateTransitions.length,4000);
  assert.equal(runtime.omittedStateTransitions,1);
  assert.match(engine,/maximumSamples:1001/,'Full snapshots remain bounded');
  assert.match(engine,/stateTransitions:runtime.stateTransitions/,'Exact state changes are delivered separately');
  const bundle=read('apps-script/SimulationEngine.html');
  assert.match(bundle,/const MAX_STATE_TRANSITIONS=4000/,'Generated Apps Script engine was updated too');
  assert.match(bundle,/recordStateTransitions\(runtime\);/);
});

test('A 250ms render can show actual state transitions between coarse metric samples',()=>{
  const html='<div id="live-equipment">'+
    '<article class="live-equipment-card state-running" data-equipment-index="0" data-displayed-availability-state="RUNNING"><span class="live-state">RUNNING</span></article>'+
    '<article class="live-equipment-card state-starved" data-equipment-index="1" data-displayed-availability-state="STARVED"><span class="live-state">STARVED</span></article></div>';
  const dom=new JSDOM(html);
  try{
    const result={samples:[{virtualSecond:0},{virtualSecond:30}],stateTransitions:[[0,0,'RUNNING'],[0,1,'STARVED'],[.25,1,'RUNNING'],[.5,0,'RAMPING_UP'],[.75,0,'RUNNING']]};
    const context={document:dom.window.document,state:{run:{result}},playbackStateTimelineCache:{result:null,length:-1,byEquipment:[]}};
    vm.createContext(context);vm.runInContext(sourceFunction('updateLiveEquipmentStateBadges'),context);
    context.updateLiveEquipmentStateBadges(.5);
    const cards=dom.window.document.querySelectorAll('.live-equipment-card');
    assert.equal(cards[0].querySelector('.live-state').textContent,'RAMPING UP');
    assert.equal(cards[1].querySelector('.live-state').textContent,'RUNNING');
    assert.ok(cards[0].classList.contains('state-ramping-up'));
    context.updateLiveEquipmentStateBadges(.75);
    assert.equal(cards[0].querySelector('.live-state').textContent,'RUNNING');
    assert.ok(cards[0].classList.contains('state-running'));
    assert.equal(result.samples.length,2,'No intermediate full measurement samples are fabricated');
  }finally{dom.window.close();}
});

test('Machines and Conveyors are independent pressed filters and preserve case input',()=>{
  const html='<button id="toggle-performance-machines" aria-pressed="true"></button>'+
    '<button id="toggle-performance-conveyors" aria-pressed="true"></button>'+
    '<p id="performance-filter-empty" class="hidden"></p>'+
    '<div id="live-equipment"><article class="live-equipment-card" data-equipment-group="machines"></article>'+
    '<article class="live-equipment-card" data-equipment-group="conveyors"></article></div>';
  const dom=new JSDOM(html);
  try{
    const equipment=[{type:'FILLER',id:'filler'},{type:'CONVEYOR',id:'conveyor'}];
    const context={document:dom.window.document,state:{activeCase:{equipment},run:{result:null}}};
    vm.createContext(context);
    vm.runInContext(sourceFunction('equipmentPerformanceVisible')+'\n'+sourceFunction('setEquipmentPerformanceFilter'),context);
    const cards=dom.window.document.querySelectorAll('.live-equipment-card');
    context.setEquipmentPerformanceFilter('conveyors',false);
    assert.equal(cards[0].hidden,false);
    assert.equal(cards[1].hidden,true);
    assert.equal(dom.window.document.getElementById('toggle-performance-conveyors').getAttribute('aria-pressed'),'false');
    assert.equal(context.equipmentPerformanceVisible(equipment[1]),false);
    context.setEquipmentPerformanceFilter('machines',false);
    assert.equal(cards[0].hidden,true);
    assert.equal(dom.window.document.getElementById('performance-filter-empty').classList.contains('hidden'),false);
    context.setEquipmentPerformanceFilter('conveyors',true);
    assert.equal(cards[1].hidden,false);
    assert.equal(cards[0].hidden,true);
    assert.deepEqual(equipment,[{type:'FILLER',id:'filler'},{type:'CONVEYOR',id:'conveyor'}]);
    assert.match(read('apps-script/WebApp.html'),/id="toggle-performance-machines"[^>]*aria-pressed="true"/);
    assert.match(read('apps-script/WebApp.html'),/id="toggle-performance-conveyors"[^>]*aria-pressed="true"/);
    assert.match(read('apps-script/ClientCore.html'),/setEquipmentPerformanceFilter\(group,button.getAttribute\('aria-pressed'\)!=='true'\)/);
  }finally{dom.window.close();}
});

test('Subsection description aligns with the text after the disclosure chevron',()=>{
  const css=read('apps-script/UiStandards.html');
  assert.match(css,/\.subsection-heading-copy > \.subsection-description,[\s\S]*?padding-inline-start:calc\(\.45em \+ var\(--space-1\) \+ var\(--space-2\)\)/);
  assert.match(css,/\.subsection-heading-copy > \.subsection-playback-meta \{[\s\S]*?padding-inline-start:calc\(\.45em \+ var\(--space-1\) \+ var\(--space-2\)\)/);
});

test('Deleting equipment keeps numerical performance heading visible without stale cards',()=>{
  const web=read('apps-script/WebApp.html');
  const sectionStart=web.indexOf('<section id="simulation-equipment"');
  const resultStart=web.indexOf('<div id="simulation-results"',sectionStart);
  const sectionEnd=web.indexOf('</section>',sectionStart);
  assert.ok(sectionStart>0&&sectionStart<resultStart&&resultStart<sectionEnd,
    'Equipment heading must be outside the conditional replay container');
  const dom=new JSDOM('<section id="simulation-equipment"><h3>Equipment performance</h3>'+
    '<p id="simulation-equipment-empty" class="chart-note hidden"></p>'+
    '<div id="simulation-results"><div id="live-equipment"></div></div></section>');
  try{
    const models=[{id:'F',type:'FILLER'},{id:'C',type:'CONVEYOR'}];
    const context={document:dom.window.document,window:{STLanguage:{current:()=> 'en',translate:text=>text}},
      state:{activeCase:{equipment:models},run:{result:null,sampleIndex:0}}};
    const start=source.indexOf('    function updateNumericalEquipmentVisibility(');
    const end=source.indexOf('\n    var playbackControlSignature=',start);
    assert.ok(start>0&&end>start);
    vm.createContext(context);
    vm.runInContext(source.slice(start,end),context);
    const panel=dom.window.document.getElementById('simulation-results');
    const empty=dom.window.document.getElementById('simulation-equipment-empty');
    assert.equal(context.updateNumericalEquipmentVisibility(),false);
    assert.equal(panel.classList.contains('hidden'),true);
    assert.equal(empty.classList.contains('hidden'),false);
    assert.match(empty.textContent,/Run a numerical simulation/);
    assert.ok(dom.window.document.querySelector('#simulation-equipment h3'));
    const sample={virtualSecond:1,equipment:[{id:'F'},{id:'C'}]};
    context.state.run.result={samples:[sample],detailCoverage:{recordingMode:'BOUNDED'}};
    assert.equal(context.updateNumericalEquipmentVisibility(),true);
    assert.equal(panel.classList.contains('hidden'),false);
    assert.equal(empty.classList.contains('hidden'),true);
    // A previously saved three-equipment replay must not label current equipment incorrectly.
    context.state.run.result={samples:[{virtualSecond:1,equipment:[{id:'F'},{id:'X'},{id:'C'}]}]};
    assert.equal(context.updateNumericalEquipmentVisibility(),false);
    assert.match(empty.textContent,/do not match/);
    context.state.run.result={samples:[],detailCoverage:{recordingMode:'SUMMARY'}};
    assert.equal(context.updateNumericalEquipmentVisibility(),false);
    assert.match(empty.textContent,/Summary only/);
    context.state.run.result=null;
    models.splice(1,1);
    context.updateNumericalEquipmentVisibility();
    assert.match(empty.textContent,/Add at least two/);
  }finally{dom.window.close();}
});


test('Numerical Overview updates Flow, Processed and Inside from successive measured samples',()=>{
  const dom=new JSDOM('<article><section class="live-equipment-2d-summary">'+
    '<div class="live-equipment-2d-rows"></div></section></article>');
  try{
    const card=dom.window.document.querySelector('article');
    const context={document:dom.window.document,formatNumber:n=>String(n)};
    vm.createContext(context);
    vm.runInContext(sourceFunction('updateNumerical2DRows')+
      '\n'+sourceFunction('updateNumericalSummaryRows'),context);
    const model={id:'blow',type:'BLOWMOLDER',nominalRatePerSecond:10,
      processData:{equipment:{internalCapacityBottles:36}}};
    const rows=()=>Array.from(card.querySelectorAll('.live-equipment-2d-row'))
      .map(el=>[el.querySelector('.live-equipment-2d-label').textContent,
        el.querySelector('.live-equipment-2d-value').textContent]);
    const first={id:'blow',actualRatePerSecond:10,processedUnits:100,
      internalInventoryBottles:24,internalCapacityBottles:36,internalInputBottleFactor:1};
    context.updateNumericalSummaryRows(card,first,model,null,null,'RUNNING');
    const start=rows();
    assert.deepEqual(start.slice(1,5),[
      ['Design speed','600bpm'],['Flow','600bpm'],
      ['Processed','100bottles'],['Inside','24 / 36bottles']
    ]);
    const next={...first,actualRatePerSecond:7,processedUnits:340,internalInventoryBottles:10};
    context.updateNumericalSummaryRows(card,next,model,null,null,'RUNNING');
    const updated=rows();
    assert.deepEqual(updated.slice(1,5),[
      ['Design speed','600bpm'],['Flow','420bpm'],
      ['Processed','340bottles'],['Inside','10 / 36bottles']
    ]);
    assert.notDeepEqual(updated,start,'Measured sample changes must update all dependent metrics');
    assert.equal(card.querySelectorAll('.live-equipment-2d-row').length,8,
      'Rendering must reuse rows rather than add duplicate metrics');
  }finally{dom.window.close();}
});

test('Light playback refreshes visible equipment summary only for a new recorded sample',()=>{
  const dom=new JSDOM('<div id="live-equipment"><article class="live-equipment-card"'+
    ' data-equipment-id="blow" data-equipment-index="0">'+
    '<section class="live-equipment-2d-summary"></section><b class="live-oee"></b>'+
    '</article></div>');
  try{
    const model={id:'blow',type:'BLOWMOLDER',nominalRatePerSecond:10};
    const sample1={virtualSecond:20,equipment:[{id:'blow',actualRatePerSecond:4,oeePercent:40}],accumulationZones:[]};
    const sample2={virtualSecond:40,equipment:[{id:'blow',actualRatePerSecond:7,oeePercent:70}],accumulationZones:[]};
    const state={run:{result:{samples:[sample1,sample2]},sampleIndex:0},
      activeCase:{equipment:[model]},uiView:'simulation'};
    const updates=[];
    const context={document:dom.window.document,state,
      window:{STNumericCardDiagnostics:{overview:true}},
      conveyorCardRates:()=>null,formatPercent:n=>String(n*100)+'%',
      updateNumericalSummaryRows:(card,unit)=>updates.push(unit.actualRatePerSecond)};
    vm.createContext(context);
    vm.runInContext(sourceFunction('refreshNumericalOverviewFromSample'),context);
    context.refreshNumericalOverviewFromSample();
    context.refreshNumericalOverviewFromSample();
    assert.deepEqual(updates,[4],'Unchanged recording frame must not cause duplicate Overview work');
    state.run.sampleIndex=1;
    context.refreshNumericalOverviewFromSample();
    assert.deepEqual(updates,[4,7],'A new measured frame must update the Overview even without a full repaint');
    assert.equal(dom.window.document.querySelector('.live-oee').textContent,'70%');
    assert.equal(state.run.result.samples.length,2,'UI refresh cannot mutate engine samples');
  }finally{dom.window.close();}
});

test('Live state elapsed indicator advances on exact transitions without inventing output',()=>{
  const dom=new JSDOM('<div id="live-equipment">'+
    '<article class="live-equipment-card state-running" data-equipment-index="0" '+
    'data-displayed-availability-state="RUNNING"><span class="live-state">RUNNING</span>'+
    '<span class="numeric-state-elapsed" hidden></span></article></div>');
  try{
    const result={stateTransitions:[[0,0,'RUNNING'],[12,0,'BACKUP_STOP']],
      detailCoverage:{stateTransitionsOmitted:0}};
    const context={state:{run:{result}},document:dom.window.document,
      playbackStateTimelineCache:{result:null,length:-1,byEquipment:[]},
      window:{STLanguage:{translate:s=>s}},formatNumber:n=>String(n)};
    vm.createContext(context);
    vm.runInContext(sourceFunction('updateLiveEquipmentStateBadges'),context);
    context.updateLiveEquipmentStateBadges(12.5);
    const marker=dom.window.document.querySelector('.numeric-state-elapsed');
    assert.equal(marker.hidden,false);
    assert.equal(marker.textContent,'Time in state: 0.5 s');
    context.updateLiveEquipmentStateBadges(15);
    assert.equal(marker.textContent,'Time in state: 3 s');
    assert.equal(dom.window.document.querySelector('.live-state').textContent,'BACKUP STOP');
    result.detailCoverage.stateTransitionsOmitted=1;
    context.updateLiveEquipmentStateBadges(16);
    assert.equal(marker.hidden,true,'Truncated transitions must not show an unreliable state timer');
  }finally{dom.window.close();}
});
