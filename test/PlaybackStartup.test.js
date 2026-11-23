import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {createLinePlaybackSession} from '../src/simulation/LineSimulationEngine.js';
import {createNumericalPlayback} from '../src/simulation/NumericalPlayback.js';

const read=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const numericIds=['metric-output','metric-instant-rate','metric-rate','metric-buffer','metric-overflow'];
const timeIds=['metric-time','metric-effective-runtime','metric-runtime-losses','metric-backup-stop'];
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const markup=page.window.document.body.innerHTML;
page.window.close();

function loadFunctions(w,file,names){
  const source=read(file);
  for(const name of names){
    const start=source.indexOf('    function '+name+'(');
    assert(start>=0,'Missing production function '+name);
    const rest=source.slice(start),boundary=rest.slice(10).search(/\n    (?:async )?function /);
    w.eval(boundary<0?rest:rest.slice(0,boundary+10));
  }
}

function harness(){
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole}),w=dom.window;
  const node=id=>w.document.getElementById(id);
  let clock=0,nextTimer=0,lastRun;
  const timers=new Map(),batches=[],controllers=[],observed=new Set();
  w.setTimeout=(callback,delay=0)=>{const id=++nextTimer;timers.set(id,{callback,at:clock+delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
  Object.defineProperty(w.performance,'now',{value:()=>clock});
  // The browser has not delivered any intersection notifications at first paint.
  // New cards must still contain their initial values before that notification.
  w.IntersectionObserver=class {
    observe(card){observed.add(card);}
    unobserve(card){observed.delete(card);}
  };
  const machine=(id,rate)=>({id,name:id,type:'CUSTOM',initialMode:'AUTO',unitOfFlow:'BOTTLES',
    nominalRatePerSecond:rate,processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},
      equipment:{internalCapacityBottles:36,residenceTimeSeconds:0,occupancyMode:'STORAGE'}}});
  const equipment=[machine('Source',8),{id:'Belt',name:'Belt',type:'CONVEYOR',initialMode:'AUTO',
    nominalRatePerSecond:10,processData:{flowUnits:{input:'BOTTLES',output:'BOTTLES'},
      accumulation:{speedMode:'MANUAL',usableLengthMm:1000,productLengthMm:20,movingGapMm:10,
        accumulatedGapMm:0,conveyorSpeedMmPerSecond:10000,primeSensorPositionMm:900,
        backupSensorPositionMm:100,backupRestartPositionMm:200,upstreamStopResponseSeconds:0,
        bottlesDischargedAtStop:0,downstreamRampUpSeconds:0,blockedTimeDelaySeconds:.5,
        clearTimeDelaySeconds:.5}}},machine('Sink',10)];
  const simulation={id:'simulation',name:'First simulation',equipment:copy(equipment),
    dynamicConfig:{reliabilityEnabled:false},results:null};
  w.state={uiView:'simulation',workspaceView:'simulation',activeSimulationId:simulation.id,
    activeCase:{id:'case',name:'Startup regression',unitOfFlow:'bottles',equipment,
      simulations:[simulation]},isDirty:false,liveZoneDetails:{},
    run:{result:null,representative:null,configuration:null,sampleIndex:0,roundIndex:0,
      active:false,playing:false,commands:[],liveTelemetry:[]}};
  Object.assign(w,{
    roundSession:null,runGeneration:0,__ST_TEXT__:key=>key,__ST_HTML_TEXT__:key=>key,
    isFiniteNumber:Number.isFinite,STIcons:{svg:()=>'<svg></svg>',equipment:()=>'<svg></svg>'},
    STReports:{bindChartExports(){}},STPreferences:{caseOptions:()=>({seedPolicy:'FIXED'}),read(){},write(){}},
    STProducts:{runFields:()=>({})},shell:{sync(){node('run-panel').classList.remove('hidden');}},
    autosave:{pending:()=>false,change(){}},collectCaseEditor:()=>w.state.activeCase,
    saveActiveCase(){},renderEditorMeta(){},refreshDesignGraph(){},renderSimulationAnalysis(){}
  });
  w.eval(read('ClientUtils'));
  for(const name of ['TimeControls','RunOptions','EquipmentEfficiency'])
    w.eval(read(name).replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  w.eval(read('ClientSimulation'));
  w.eval(read('ClientPlayback'));
  loadFunctions(w,'ClientCases',['invalidateActiveResult','markCaseDirty']);
  // Canvas and remote persistence are independent of mounting and updating cards.
  Object.assign(w,{drawSimulationChart(){},drawEquipmentSpeedChart(){},drawEquipmentSpeedSparkline(){},renderSimulationAnalysis(){},
    showError:error=>errors.push(error)});
  w.SimulatorEngine={
    createPlayback(input){const controller=createNumericalPlayback(input);controllers.push(controller);return controller;},
    simulateBatch(input,options){
      const physical=createLinePlaybackSession(input);
      let resolve;
      const promise=new Promise(done=>{resolve=done;});
      const batch={input,options,resolve,physical,publish(second=0){
        const frame=copy(physical.advanceTo(second));
        options.onFirstProgress({seed:input.run.seed,unitOfFlow:input.case.unitOfFlow,
          durationSeconds:input.run.durationSeconds,calculatedThroughSeconds:second,
          provisional:true,samples:[frame],stateTransitions:[],
          detailCoverage:{recordingMode:'BOUNDED'},summary:{outputCount:frame.outputCount}});
        return frame;
      }};
      batches.push(batch);return promise;
    }
  };
  // Execute the shipped event handlers and complete run orchestration. The
  // batch transport is held at its boundary so the first partial is inspectable.
  const run=w.runSimulation;
  w.runSimulation=function(){lastRun=run();lastRun.catch(error=>errors.push(error));return lastRun;};
  const core=read('ClientCore'),start=core.indexOf("document.getElementById('play-simulation').addEventListener"),
    end=core.indexOf("document.getElementById('playback-round').addEventListener",start);
  assert(start>=0&&end>start);w.eval(core.slice(start,end));
  const inputBinding=core.split('\n').find(line=>line.includes("['run-duration','run-effective-target'")&&line.includes('markCaseDirty'));
  assert(inputBinding);w.eval(inputBinding);
  node('duration-mode').value='FIXED';node('run-duration').value='1';node('run-duration-unit').value='HOURS';
  node('run-calculation-mode').value='LIVE';node('run-sample-interval').value='1';
  node('run-sample-interval-unit').value='SECONDS';node('run-display-fps').value='20';
  node('run-seed').value='7';node('run-rounds').value='1';node('run-shift-hours').value='8';
  node('run-shift-count').value='1';node('run-playback-rate').value='1';
  node('run-track-shifts').checked=false;node('run-events-enabled').checked=true;
  node('run-calendar-enabled').checked=false;node('run-reliability-enabled').checked=false;
  w.syncRunControls();w.updateNumericalEquipmentVisibility();
  async function settle(){for(let i=0;i<12;i++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));}
  async function tick(ms){
    const end=clock+ms;
    let steps=0;
    while(true){
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next||next[1].at>end)break;
      assert(++steps<1000,'Playback timer must make progress');
      timers.delete(next[0]);clock=next[1].at;await next[1].callback();await settle();
    }
    clock=end;await settle();
  }
  return {w,node,simulation,batches,observed,errors,settle,tick,timers,
    cards:()=>[...node('live-equipment').querySelectorAll('.live-equipment-card')],
    async play(){node('play-simulation').click();assert.equal(errors.length,0);return batches.at(-1);},
    ready:()=>lastRun,
    close(){w.cancelRoundSession();w.stopPlaybackTimer();for(const controller of controllers)controller.close();w.close();}
  };
}

function metricNodes(h){
  return new Map(numericIds.map(id=>[id,{value:h.node(id),unit:h.node(id+'-unit'),wrapper:h.node(id).parentNode}]));
}
function sameMetricNodes(h,before){
  for(const [id,nodes] of before){
    assert.equal(h.node(id),nodes.value,id+' retains its numeric node');
    assert.equal(h.node(id+'-unit'),nodes.unit,id+' retains its unit node');
    assert.equal(h.node(id).parentNode,nodes.wrapper,id+' retains its wrapper');
  }
}

test('fresh Play paints equipment on the first partial without navigation or an intersection callback',async()=>{
  const h=harness(),original=metricNodes(h);
  try{
    assert.equal(h.cards().length,0);
    const batch=await h.play();
    assert.equal(batch.input.run.durationSeconds,3600);
    assert.equal(h.node('play-simulation').getAttribute('aria-pressed'),'true');
    batch.publish();
    // These assertions run immediately after the first streamed update,
    // before starting playback, completing calculation or leaving this view.
    assert.equal(h.cards().length,3);
    assert.equal(h.observed.size,3);
    assert.equal(h.node('simulation-results').classList.contains('hidden'),false);
    assert.equal(h.node('simulation-equipment-empty').classList.contains('hidden'),true);
    h.cards().forEach((card,index)=>{
      assert.equal(card.querySelector('.live-equipment-identity strong').textContent,batch.input.case.equipment[index].name);
      assert.equal(card.querySelector('.live-processed').textContent,'0');
      assert.ok(card.querySelector('.live-equipment-state-grid .live-equipment-2d-row'));
      if(batch.input.case.equipment[index].type!=='CONVEYOR')
        assert.ok(card.querySelector('.live-equipment-state-grid .st-time-output b'));
    });
    sameMetricNodes(h,original);
    await h.ready();
    assert.equal(h.w.state.run.playing,true);
    const archived=JSON.stringify(h.w.state.run.result),cards=h.cards();
    await h.tick(250);
    assert(h.w.playbackVisualSample().virtualSecond>0,'Fresh physical time advances within the first quarter second');
    assert(h.cards()[0].querySelector('.live-processed').textContent!=='0','Card numbers update immediately');
    h.cards().forEach((card,index)=>assert.equal(card,cards[index],'Frames reuse mounted cards'));
    assert.equal(JSON.stringify(h.w.state.run.result),archived,'Live painting does not rewrite recorded history');
    assert.equal(h.w.state.uiView,'simulation');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('invalidating and rerunning one hour as one day preserves metric nodes, selected time units and translations',async()=>{
  const h=harness(),original=metricNodes(h);
  try{
    h.w.eval(read('Language').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
    h.w.STLanguage.setLanguage('es');
    const first=await h.play();first.publish();await h.ready();await h.tick(250);
    const archived=h.w.state.run.result,before=JSON.stringify(archived),timeNodes=new Map();
    timeIds.forEach((id,index)=>{
      const output=h.node(id).querySelector('.st-time-output'),select=output.querySelector('.st-time-unit');
      select.value=['s','h','d','min'][index];select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
      timeNodes.set(id,{output,select,unit:select.value});
    });
    h.w.invalidateActiveResult();
    assert.equal(h.w.state.run.result,null);assert.equal(h.w.state.run.playing,false);
    assert.equal(h.timers.size,0);assert.equal(h.cards().length,0);
    sameMetricNodes(h,original);
    numericIds.forEach(id=>assert.equal(h.node(id).textContent,'—'));
    for(const [id,parts] of timeNodes){
      assert.equal(h.node(id).querySelector('.st-time-output'),parts.output);
      assert.equal(parts.output.querySelector('b').textContent,'—');
      assert.equal(parts.select.value,parts.unit);
      parts.select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
      assert.equal(parts.output.querySelector('b').textContent,'—','Unit changes cannot restore an invalidated value');
    }
    h.node('run-duration-unit').value='DAYS';
    h.node('run-duration').dispatchEvent(new h.w.Event('input',{bubbles:true}));
    const second=await h.play();assert.notEqual(second,first);
    assert.equal(second.input.run.durationSeconds,86400);
    second.publish();assert.equal(h.cards().length,3);await h.ready();await h.tick(250);
    sameMetricNodes(h,original);
    for(const [id,parts] of timeNodes){
      assert.equal(h.node(id).querySelector('.st-time-output'),parts.output);
      assert.equal(parts.select.value,parts.unit);
      assert.notEqual(parts.output.querySelector('b').textContent,'—');
    }
    assert.equal(h.node('metric-output-unit').textContent,'botellas');
    assert.equal(h.node('metric-rate-unit').textContent,'bpm');
    assert.equal(h.node('metric-buffer-unit').textContent,'botellas');
    h.w.STLanguage.setLanguage('en');
    assert.equal(h.node('metric-output-unit').textContent,'bottles');
    assert.equal(h.node('metric-buffer-unit').textContent,'bottles');
    assert.equal(JSON.stringify(archived),before,'Invalidation leaves the previous history object unchanged');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('Reset and calculation cancellation ignore stale partials and allow immediate Play again',async()=>{
  const h=harness(),original=metricNodes(h);
  try{
    for(const action of ['reset-playback','batch-cancel']){
      const batch=await h.play();batch.publish();await h.ready();await h.tick(100);
      const archived=h.w.state.run.result,before=JSON.stringify(archived);
      h.node(action).click();
      assert.equal(h.w.state.run.result,null);assert.equal(h.w.state.run.playing,false);
      assert.equal(h.timers.size,0);
      batch.publish(1);await h.settle();
      assert.equal(h.w.state.run.result,null,'A cancelled calculation cannot repopulate the view');
      assert.equal(JSON.stringify(archived),before,'Control actions leave archived frames unchanged');
      sameMetricNodes(h,original);
    }
    const restarted=await h.play();restarted.publish();await h.ready();
    assert.equal(h.cards().length,3);
    assert.equal(h.node('simulation-results').classList.contains('hidden'),false);
    assert.equal(h.w.state.uiView,'simulation');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});
