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
