import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {analyzeLinePerformance} from '../src/analysis/LinePerformanceAnalysis.js';

// Exercise the exact resources sent by Apps Script, without inventing browser
// implementations for server-only translation helpers.
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const scripts=[...page.window.document.querySelectorAll('script')].map(node=>node.textContent);
const servedModule=name=>{
  const script=scripts.find(source=>new RegExp('window\\.'+name+'\\s*=').test(source));
  assert.ok(script,'Missing served module '+name);return script;
};
const client=scripts.find(source=>source.includes('function markCaseDirty('));
assert.ok(client);
const utilities=client.slice(client.indexOf('    function sum('),client.lastIndexOf('\n  })();'));
assert.ok(utilities.includes('globalThis.STFlowUnits'));
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const markup=page.window.document.body.innerHTML;
page.window.close();

function harness(){
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole}),w=dom.window;
  w.isFiniteNumber=Number.isFinite;w.SimulatorEngine={analyzeLinePerformance};
  // Only text measurement is unavailable in this DOM. SVG contents are built
  // by the shipped renderer, using its fallback width estimate for names.
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.eval(utilities);
  for(const name of ['STReports','STLinePerformance'])w.eval(servedModule(name));
  assert.equal(typeof w.__ST_TEXT__,'undefined');
  assert.equal(typeof w.__ST_HTML_TEXT__,'undefined');
  return {w,errors,node:id=>w.document.getElementById(id),close:()=>w.close()};
}
function loadClientFunctions(w,names){
  for(const name of names){
    const start=client.indexOf('    function '+name+'(');
    assert.ok(start>=0,'Missing compiled client function '+name);
    const source=client.slice(start),next=source.slice(10).search(/\n    (?:async )?function /);
    assert.ok(next>=0,'Missing function boundary for '+name);
    w.eval(source.slice(0,next+10));
  }
}
function data(unitOfFlow='bottles'){
  const equipment=[{id:'filler',name:'Filler',type:'FILLER',unitOfFlow,nominalRatePerSecond:8,
    processData:{flowUnits:{input:unitOfFlow,output:unitOfFlow},equipment:{maximumSpeedBpm:600}}}];
  const result={unitOfFlow,durationSeconds:120,summary:{outputCount:960},
    equipmentMetrics:{filler:{unitOfFlow,outputCount:960,stoppedSeconds:0}}};
  return {equipment,result};
}

test('the served application contains no calls to server-only translation helpers',()=>{
  assert.ok(scripts.length,'Expected scripts in the complete served application');
  scripts.forEach((source,index)=>assert.doesNotMatch(source,/\b__ST_(?:HTML_)?TEXT__\s*\(/,
    'Unresolved server-only translation helper in served script '+index));
});

test('changing the duration unit through the real listener refreshes the design graph without client translation helpers',()=>{
  const h=harness(),{w}=h,input=data('bottles');
  try{
    for(const name of ['STRunOptions','STTimeControls'])w.eval(servedModule(name));
    const simulation={id:'simulation',name:'Duration regression',equipment:input.equipment,results:input.result};
    w.state={activeCase:{id:'case',name:'Line',equipment:input.equipment,simulations:[simulation]},
      activeSimulationId:simulation.id,run:{active:false,playing:false,roundIndex:0,commands:[],plannedStops:[]}};
    w.roundSession=null;w.selectedControlEvents=new w.Set();
    w.controlEventAnchor=null;w.controlEventSelectionOwner='';
    let changes=0;
    // Persistence, editor metadata and idle playback scheduling are outside
    // this path. Keep the actual invalidation, units, locks and graph rendering.
    w.autosave={change:()=>changes++};w.renderEditorMeta=()=>{};
    w.cancelRoundSession=()=>{};w.stopPlaybackTimer=()=>{};
    loadClientFunctions(w,['activePersistentSimulation','runControlsLocked','isRunReady','syncRunControls',
      'allEditableControlEvents','syncEventSelection','markNumericalPlaybackAction','cloneJson',
      'invalidateActiveResult','basicEquipmentPreview','refreshDesignGraph','markCaseDirty']);
    const bindingStart=client.indexOf("['run-duration-unit','run-sample-interval-unit'].forEach");
    const bindingEnd=client.indexOf("['run-start-at','run-end-at'",bindingStart);
    assert.ok(bindingStart>=0&&bindingEnd>bindingStart);
    w.eval(client.slice(bindingStart,bindingEnd));

    h.node('duration-mode').value='FIXED';
    const amount=h.node('run-duration'),unit=h.node('run-duration-unit'),wrapper=unit.parentElement;
    amount.value='1';unit.value='HOURS';
    h.node('run-calculation-mode').value='LIVE';
    h.node('run-track-shifts').checked=false;h.node('run-events-enabled').checked=false;
    const metrics=[...w.document.querySelectorAll('#simulation-playback-metrics b[id],#simulation-playback-metrics .playback-metric-unit')];
    const equipmentBefore=JSON.stringify(input.equipment);
    assert.equal(w.STRunOptions.read().durationSeconds,3600);
    const units=[['DAYS',86400,'d'],['SECONDS',1,'s'],['MINUTES',60,'min'],['HOURS',3600,'h'],['WEEKS',604800,'wk']];
    for(const [selected,seconds,label] of units){
      simulation.results=input.result;w.state.run.result=input.result;
      w.state.run.configuration={durationSeconds:3600};w.state.run.representative=input.result;
      h.node('performance-rows').replaceChildren();
      unit.value=selected;unit.dispatchEvent(new w.Event('change',{bubbles:true}));
      assert.deepEqual(h.errors.map(error=>error.message),[],'The select change must not raise an application error');
      assert.equal(amount.value,'1','Selecting a unit retains the entered number');
      assert.equal(w.STRunOptions.read().durationSeconds,seconds);
      assert.equal(w.STRunOptions.durationSeconds(),seconds);
      assert.equal(unit.selectedOptions[0].textContent,label);
      assert.equal(h.node('performance-rows').rows.length,input.equipment.length,
        'The change event must reach the real design renderer');
      assert.equal(h.node('performance-rows').rows[0].cells[1].textContent,'480');
      assert.ok(h.node('performance-rows').closest('table').querySelectorAll('thead th')[1].textContent.endsWith(' · bpm'));
      assert.equal(w.state.run.result,null);assert.equal(simulation.results,null);
      assert.equal(w.state.run.configuration,null);assert.equal(w.state.run.representative,null);
      assert.equal(h.node('run-duration'),amount);assert.equal(h.node('run-duration-unit'),unit);
      assert.equal(unit.parentElement,wrapper);assert.equal(unit.disabled,false);
      const currentMetrics=[...w.document.querySelectorAll('#simulation-playback-metrics b[id],#simulation-playback-metrics .playback-metric-unit')];
      assert.equal(currentMetrics.length,metrics.length);
      metrics.forEach((node,index)=>assert.equal(currentMetrics[index],node,
        'Invalidating a result preserves metric values and unit nodes'));
      assert.equal(JSON.stringify(input.equipment),equipmentBefore);
      assert.equal(typeof w.__ST_TEXT__,'undefined');assert.equal(typeof w.__ST_HTML_TEXT__,'undefined');
    }
    assert.equal(changes,units.length);
  }finally{h.close();}
});

test('V-Graph rates use the native abbreviation in SVG, headers and throughput text, including after resize',()=>{
  const h=harness();
  try{
    for(const [unit,rate] of [['BOTTLES','bpm'],['cases','cpm'],['units','units/min']]){
      const input=data(unit),before=JSON.stringify(input);
      h.w.STLinePerformance.render(input.result,input.equipment);
      const assertLabels=()=>{
        const plot=h.node('vgraph-plot');
        assert.equal(plot._vgraphRateUnit,rate);
        assert.match(plot.querySelector('.vgraph-normal-dot title').textContent,new RegExp('480 '+rate+'$'));
        assert.match(plot.querySelector('.vgraph-recommended-dot title').textContent,new RegExp('480 '+rate+'$'));
        const axis=[...plot.querySelectorAll('text.vgraph-label')].filter(node=>!node.querySelector('tspan'));
        assert.equal(axis.length,3);axis.forEach(label=>assert.ok(label.textContent.endsWith(' '+rate)));
      };
      assertLabels();
      const row=h.node('performance-rows').rows[0];
      assert.equal(row.cells[1].textContent,'480');
      assert.equal(row.cells[2].textContent,'600');
      assert.equal(row.cells[7].textContent,'480','Per-minute analysis values are not converted again');
      const headers=[...h.node('performance-rows').closest('table').querySelectorAll('thead th')];
      for(const index of [1,2,3,7])assert.ok(headers[index].textContent.endsWith(' · '+rate));
      assert.ok(h.node('throughput-method').textContent.includes('= 480 '+rate+'.'));
      h.w.innerHeight+=100;h.w.dispatchEvent(new h.w.Event('resize'));assertLabels();
      assert.equal(JSON.stringify(input),before);
      assert.doesNotMatch(h.node('line-performance').textContent,/bottles\/min|cases\/min/);
    }
  }finally{h.close();}
});

test('V-Graph preserves each machine unit when bottle and case machines share the same line',()=>{
  const h=harness(),input=data('BOTTLES');
  try{
    input.equipment.push({id:'packer',name:'Packer',type:'CUSTOM',unitOfFlow:'CASES',nominalRatePerSecond:1,
      processData:{flowUnits:{input:'BOTTLES',output:'CASES'},equipment:{maximumSpeedBpm:120}}});
    input.result.unitOfFlow='CASES';input.result.summary.outputCount=120;
    input.result.equipmentMetrics.packer={unitOfFlow:'CASES',outputCount:120,stoppedSeconds:0};
    const before=JSON.stringify(input);
    h.w.STLinePerformance.render(input.result,input.equipment);
    const rows=[...h.node('performance-rows').rows];
    assert.equal(rows[0].cells[1].textContent,'480 bpm');
    assert.equal(rows[1].cells[1].textContent,'60 cpm');
    assert.equal(rows[0].cells[7].textContent,'480 bpm');
    assert.equal(rows[1].cells[7].textContent,'60 cpm');
    const titles=[...h.node('vgraph-plot').querySelectorAll('.vgraph-normal-dot title')].map(node=>node.textContent);
    assert.ok(titles[0].endsWith('480 bpm'));assert.ok(titles[1].endsWith('60 cpm'));
    assert.equal(h.node('vgraph-plot')._vgraphRateUnit,'units/min',
      'A mixed native-unit axis must not label case values as bottles');
    assert.ok(h.node('throughput-method').textContent.includes('= 60 cpm.'));
    assert.equal(JSON.stringify(input),before);
  }finally{h.close();}
});

test('batch shift rates accept bpm/cpm labels while standalone exports retain their legacy call contract',()=>{
  const h=harness(),batch={statistics:{throughputPerMinute:{mean:480,standardDeviation:0,min:480,max:480}},
    rows:[{round:1,seed:7,shifts:[{shift:1,outputCount:960,throughputPerMinute:480,lineOeePercent:80,
      starvedSeconds:2,blockedSeconds:3,failureSeconds:4}]}]};
  try{
    const before=JSON.stringify(batch),target=h.w.document.createElement('div');
    for(const rate of ['bpm','cpm','units/min',undefined]){
      target.innerHTML=h.w.STReports.batchHtml(batch,rate);
      const shifts=target.querySelectorAll('table')[1];
      assert.equal(shifts.tHead.rows[0].cells[4].textContent,rate?'Throughput ('+rate+')':'Throughput / min');
      assert.equal(shifts.tBodies[0].rows[0].cells[4].textContent,'480',
        'The optional parameter labels the stored rate without recalculating it');
    }
    assert.equal(h.w.STReports.batchHtml(null,'bpm'),'');
    assert.equal(JSON.stringify(batch),before);
    // The optional label remains plain text in an exported HTML document.
    target.innerHTML=h.w.STReports.batchHtml(batch,'<b>custom</b>');
    assert.equal(target.querySelectorAll('table')[1].tHead.rows[0].cells[4].textContent,'Throughput (<b>custom</b>)');
    assert.equal(target.querySelectorAll('b').length,0);
  }finally{h.close();}
});

test('separate rate labels preserve Spanish headings and batch throughput labels',()=>{
  const h=harness(),input=data('bottles');
  try{
    h.w.STLinePerformance.render(input.result,input.equipment);
    const batch={statistics:{},rows:[]};
    h.node('batch-results').innerHTML=h.w.STReports.batchHtml(batch,'bpm');
    h.w.eval(servedModule('STLanguage'));
    h.w.STLanguage.setLanguage('es');
    const headers=h.node('performance-rows').closest('table').querySelectorAll('thead th');
    assert.equal(headers[7].textContent,'Efectivo · bpm');
    assert.equal(h.node('batch-results').querySelectorAll('table')[1].tHead.rows[0].cells[4].textContent,
      'Producción efectiva (bpm)');
    h.w.STLanguage.setLanguage('en');
    assert.equal(headers[7].textContent,'Effective · bpm');
    assert.equal(h.node('batch-results').querySelectorAll('table')[1].tHead.rows[0].cells[4].textContent,
      'Throughput (bpm)');
  }finally{h.close();}
});
