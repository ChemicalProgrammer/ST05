import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import postcss from 'postcss';

const source=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
function functions(window,name,names){
  const code=source(name);
  for(const fn of names){
    const start=code.indexOf('    function '+fn+'('),end=code.indexOf('\n    }',start+10)+6;
    assert(start>=0&&end>start,'Missing production function '+fn);
    window.eval(code.slice(start,end));
  }
}
const copy=value=>JSON.parse(JSON.stringify(value));
const actions={play:'play-simulation',pause:'pause-simulation',stop:'stop-simulation',reset:'reset-playback'};
function harness(){
  const ids=['run-initial-format','duration-mode','run-duration','run-sample-interval','run-sample-interval-unit',
    'run-seed','run-rounds','run-shift-hours','run-shift-count','add-control-event','open-event-generator','run-playback-rate'];
  const dom=new JSDOM('<div class="playback-toolbar">'+Object.values(actions).map(id=>'<button id="'+id+'"></button>').join('')
    +'<button id="export-charts"></button></div>'+ids.map(id=>id==='run-playback-rate'
      ?'<select id="'+id+'">'+source('PlaybackSpeedOptions')+'</select>':'<input id="'+id+'">').join(''),{runScripts:'outside-only'});
  const w=dom.window,sample={virtualSecond:2,equipment:[]},result={seed:1,durationSeconds:60,samples:[sample],summary:{}};
  const simulation={id:'s1',name:'First',equipment:[],dynamicConfig:{durationSeconds:60},results:{replay:copy(result)}};
  w.state={activeSimulationId:'s1',activeCase:{id:'case',equipment:[],simulations:[simulation]},liveZoneDetails:{},
    run:{result,representative:result,sampleIndex:0,roundIndex:0,playing:false,active:false}};
  Object.assign(w,{
    roundSession:null,last2DLockState:null,cloneJson:copy,__ST_TEXT__:key=>key,
    activePersistentSimulation:()=>w.state.activeCase.simulations.find(s=>s.id===w.state.activeSimulationId),
    STReports:{bindChartExports(){}},STRunOptions:{sync(){}},syncEventSelection(){},isRunReady:()=>true,
    autosave:{change(){},pending:()=>false},finishRoundSession(){},cancelRoundSession(){w.roundSession=null;},
    syncPlaybackRounds(){},toggle(){},setStatus(){},shell:{sync(){}},renderEditor(){},renderResultJsonPreview(){},
    renderSimulationAnalysis(){},syncPersistentSimulation:()=>true,applyScenarioRunInputs(){},
    copyRunConfiguration:copy,expandStoredReplay:copy,playbackRoundFrame:()=>0,selectPlaybackRound:()=>false,
    playbackRoundPositions:()=>({}),playbackReplay:()=>null
  });
  w.eval(source('ClientPlayback'));
  functions(w,'ClientUtils',['restorePlaybackSpeed']);
  functions(w,'ClientSimulation',['runControlsLocked','syncRunControls','captureSimulationView','activatePersistentSimulation']);
  // The production controller returns early on this native playback branch.
  // Physics is covered separately; this checks the actual toolbar behavior.
  w.startNumericalPlayback=()=>true;
  w.renderPlaybackFrame=()=>w.syncRunControls();
  w.refreshPlaybackMetricCards=()=>{};
  w.playbackVisualSample=()=>w.state.run.result?.samples[w.state.run.sampleIndex];
  w.setPlaybackStatus=()=>{};
  return {w,simulation,close:()=>w.close()};
}
function selected(w,expected){
  for(const [action,id] of Object.entries(actions))
    assert.equal(w.document.getElementById(id).getAttribute('aria-pressed'),String(action===expected),id);
}

test('native playback keeps the last toolbar action highlighted through pause, stop, reset and completion',()=>{
  const h=harness(),{w}=h;
  try{
    w.startPlayback();selected(w,'play');
    assert.equal(w.document.getElementById('play-simulation').disabled,true);
    w.pausePlayback();selected(w,'pause');
    w.startPlayback();selected(w,'play');
    w.state.run.playing=false;w.state.run.active=false;w.syncRunControls();
    selected(w,'play'); // Completion is not a user click on Pause or Stop.
    w.stopSimulationPlayback();selected(w,'stop');
    w.resetPlayback();selected(w,'reset');
    assert.equal(w.document.getElementById('export-charts').hasAttribute('aria-pressed'),false);
  }finally{h.close();}
});

test('Play is selected immediately while its first simulation calculation is still pending',()=>{
  const h=harness(),{w}=h;
  try{
    w.state.run.result=null;let calculations=0;
    w.runSimulation=()=>{calculations++;return new Promise(()=>{});};
    const code=source('ClientCore'),start=code.indexOf("document.getElementById('play-simulation').addEventListener"),
      end=code.indexOf("document.getElementById('pause-simulation').addEventListener",start);
    assert(start>=0&&end>start);w.eval(code.slice(start,end));
    w.document.getElementById('play-simulation').click();
    assert.equal(calculations,1);selected(w,'play');
  }finally{h.close();}
});

test('saved control selections restore per simulation without leaking into another simulation',()=>{
  const h=harness(),{w,simulation}=h;
  try{
    w.markNumericalPlaybackAction('reset');
    w.state.run.equipmentControlActions={machine:'RESET_AND_RUN',belt:'EMERGENCY_STOP'};
    w.captureSimulationView();
    assert.equal(simulation.results.view.playbackAction,'reset');
    assert.deepEqual(copy(simulation.results.view.equipmentControlActions),{machine:'RESET_AND_RUN',belt:'EMERGENCY_STOP'});
    const other={id:'s2',name:'Second',equipment:[],dynamicConfig:{durationSeconds:60},results:{replay:copy(w.state.run.result)}};
    w.state.activeCase.simulations.push(other);
    w.activatePersistentSimulation('s2',true);selected(w,null);
    assert.deepEqual(copy(w.state.run.equipmentControlActions),{});
    w.activatePersistentSimulation('s1',true);selected(w,'reset');
    assert.deepEqual(copy(w.state.run.equipmentControlActions),{machine:'RESET_AND_RUN',belt:'EMERGENCY_STOP'});
  }finally{h.close();}
});

test('individual controls retain the clicked action including reset and emergency stop',()=>{
  const h=harness(),{w}=h;
  try{
    const names=['RUN','PAUSE','STOP','EMERGENCY_STOP','RESET_AND_RUN'];
    Object.assign(w,{
      __ST_HTML_TEXT__:key=>key,STEquipmentEfficiency:{basis:'',fields:[]},
      STIcons:{svg:()=>'<svg></svg>'},matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>fn()
    });
    const card=w.createLiveEquipmentCard('machine');
    const dock=card.querySelector('.numeric-equipment-control-dock');
    assert.equal(dock.parentElement,card.querySelector('.numeric-equipment-header'));
    assert.ok(dock.parentElement.contains(card.querySelector('.live-state')));
    assert.ok(dock.parentElement.contains(card.querySelector('.live-oee')));
    w.document.body.append(card);
    const calls=[];w.applyLiveScenarioControl=(id,action)=>calls.push([id,action]);
    const buttons=[...dock.querySelectorAll('button[data-scenario-action]')];
    assert.equal(buttons.length,5);
    const selectedRules=[];
    postcss.parse(source('UiStandards').replace(/<\/?style>/g,'')).walkRules(rule=>{
      if(rule.selector.includes('.numeric-equipment-control-dock')&&rule.selector.includes('button[aria-pressed=true]')
        &&rule.nodes.some(node=>node.prop==='background'&&node.value==='var(--accent)'))selectedRules.push(rule);
    });
    assert.ok(selectedRules.length);
    for(let index=0;index<buttons.length;index++){
      buttons[index].click();
      assert.equal(w.state.run.equipmentControlActions.machine,names[index]);
      buttons.forEach((button,i)=>assert.equal(button.getAttribute('aria-pressed'),String(i===index)));
      assert.ok(selectedRules.some(rule=>buttons[index].matches(rule.selector)),'The selected CSS rule must match the actual production card');
    }
    card.querySelector('.numeric-card-name-toggle').click();
    assert.equal(card.dataset.cardCollapsed,'true');
    assert.equal(dock.parentElement,card.querySelector('.numeric-equipment-header'));
    buttons.at(-1).disabled=true;
    assert.ok(selectedRules.some(rule=>buttons.at(-1).matches(rule.selector)),'Disabled active controls retain their selected style');
    buttons[0].disabled=true;buttons[0].click();
    assert.equal(calls.length,5);
    assert.equal(w.state.run.equipmentControlActions.machine,'RESET_AND_RUN');
  }finally{h.close();}
});
