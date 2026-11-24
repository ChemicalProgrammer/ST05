import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {scenarioSignature} from '../src/analysis/ScenarioPlanner.js';
import {scenarioSearchSettingsSignature} from '../src/analysis/ScenarioSearch.js';
import {completeSyntheticScenarioSource} from './helpers/CompletedScenarioFixture.js';
import {scenarioEvidenceInput} from './helpers/ScenarioEvidenceFixture.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const sourceFiles=['DesignTokens.html','UiStandards.html','ClientUtils.html','Icons.html','Subsection.html','SimulationEngine.html','WhatIf.html','ScenarioExplorer.html'];
const sources=sourceFiles.map(name=>fs.readFileSync('apps-script/'+name,'utf8'));

function savedCase({history=true}={}){
  const sim=completeSyntheticScenarioSource(scenarioEvidenceInput());
  sim.whatIf={searchDepth:'LIGHT'};
  if(history)sim.whatIf.evaluations=[{
    cardId:JSON.stringify([sim.id,'CAPEX','ZERO']),sourceSimulationId:sim.id,sourceSignature:scenarioSignature(sim),
    searchSettings:{speedProfile:'BALANCED'},searchSettingsSignature:scenarioSearchSettingsSignature(),
    searchPolicyVersion:'MATCHED_CAPEX_V11',methodologySignature:'{}',depth:'LIGHT',run:{...sim.dynamicConfig},
    status:'NO_DEMONSTRATED_IMPROVEMENT',message:'No improvement demonstrated. Baseline retained.',
    updatedAt:'2026-11-24T20:00:00Z',baseline:{oee:50,throughput:120},candidate:null,evaluatedChanges:[],
    progressTrace:{percent:100,outcome:'Completed',summary:{elapsedMs:120000},steps:[
      {name:'Baseline',state:'Completed',percent:100,elapsedMs:3000,work:{primary:{label:'Batches',done:1,total:1}}},
      {name:'Comparing finalists',state:'Completed',percent:100,elapsedMs:7000,work:{primary:{label:'Finalists',done:2,total:2}}}
    ]}
  }];
  return {simulations:[sim],metadata:{includeDOE:false}};
}

function browser(record=savedCase(),{lang='en',holdBatch=false}={}){
  const dom=new JSDOM('<!doctype html><html data-ui-mode="basic"><head></head><body></body></html>',{runScripts:'outside-only'}),w=dom.window;
  w.document.documentElement.lang=lang;
  w.__ST_TEXT__=key=>key==='scenario.zero'?(lang==='es'?'CAPEX cero':'Zero CAPEX'):key;
  w.STPreferences={read:()=>null,write:()=>true};w.STErrors={register(){},capture(){}};w.STReports={bindWhatIf(){}};
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  // Drive the UI clock without waiting in real time or changing scenario logic.
  let now=1700000000000,nextInterval=0,pendingBatch,simulationCalls=0;
  const intervals=new Map();
  w.Date.now=()=>now;
  w.setInterval=callback=>{const id=++nextInterval;intervals.set(id,callback);return id;};
  w.clearInterval=id=>intervals.delete(id);
  for(const source of sources){
    for(const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)){
      const style=w.document.createElement('style');style.textContent=match[1];w.document.head.append(style);
    }
    const scripts=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    if(scripts.length)for(const match of scripts)w.eval(match[1]);
    else if(!source.includes('<style'))w.eval(source);
  }
  // Only the asynchronous transport boundary is held; fields, provenance,
  // validation, search orchestration, records, rendering and icons are real.
  w.SimulatorEngine.simulateBatch=(input,options)=>{
    simulationCalls++;
    if(!holdBatch)throw Error('Reading saved progress must not simulate.');
    return new Promise((resolve,reject)=>{pendingBatch={input,options,resolve,reject};});
  };
  w.STScenarioExplorer.connectCase(()=>record,()=>{});
  const sim=record.simulations[0],project={kind:'CUSTOM',tier:'ZERO',searchScope:'ZERO',title:'Conveyor operating adjustments',
    explore:true,catalog:true,searchDerivedDOE:true,changes:[
      {equipmentId:'belt',path:'processData.accumulation.conveyorSpeedMmPerSecond',before:300,after:360,unit:'mm/s'}
    ]};
  const host=w.STWhatIf.card(project,()=>{},sim.equipment,sim);w.document.body.append(host);
  return {w,host,record,sim,activity:host.querySelector('.scenario-activity'),panel:host.querySelector('.scenario-trace-panel'),
    pendingBatch:()=>pendingBatch,simulationCalls:()=>simulationCalls,intervals:()=>intervals.size,
    advance(ms){now+=ms;for(const callback of [...intervals.values()])callback();},close:()=>w.close()};
}

function openTrace(h,key){
  if(key)h.activity.dispatchEvent(new h.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  else h.activity.click();
  assert.equal(h.panel.hidden,false);
  return h.panel;
}

function capsule(bar,{percent,time,state}){
  assert(bar?.classList.contains('scenario-progress-capsule'));
  const fill=bar.querySelector('.scenario-progress-fill'),base=bar.querySelector('.scenario-progress-text'),overlay=bar.querySelector('.scenario-progress-text-fill');
  assert.equal(bar.firstElementChild,fill);
  assert.equal(overlay.parentElement,fill,'White text shares the exact clipping area of the fill.');
  const text=(percent==null?'—':percent.toFixed(1)+'%')+' · '+time;
  assert.equal(base.textContent,text);assert.equal(overlay.textContent,text);
  assert.equal(base.getAttribute('aria-hidden'),'true');assert.equal(overlay.getAttribute('aria-hidden'),'true');
  assert.equal(bar.getAttribute('role'),'progressbar');
  assert.equal(bar.getAttribute('aria-valuenow'),percent==null?null:String(percent));
  assert(bar.getAttribute('aria-valuetext').includes(percent==null?'—':percent.toFixed(1)+'%'));
  assert(bar.getAttribute('aria-valuetext').includes(time));
  if(state)assert(bar.getAttribute('aria-valuetext').includes(state));
  if(percent!=null)assert.equal(bar.style.getPropertyValue('--scenario-progress'),percent+'%');
  return text;
}

async function until(predicate){
  for(let i=0;i<50&&!predicate();i++)await Promise.resolve();
  assert(predicate(),'The deferred search did not reach the expected state.');
}

test('restored capsules use the saved total ahead of step sums and keep one accessible value',()=>{
  const record=copy(savedCase()),before=JSON.stringify(record),h=browser(record);
  try{
    capsule(h.activity,{percent:100,time:'2m 00s',state:'Completed'});
    const panel=openTrace(h);
    assert.equal(panel.querySelector('.scenario-trace-overall'),null,'Step view must not duplicate the main progress bar.');
    const bars=[...panel.querySelectorAll('.scenario-trace-step-bar')];
    assert.equal(bars.length,2);
    capsule(bars[0],{percent:100,time:'0m 03s',state:'Completed'});
    capsule(bars[1],{percent:100,time:'0m 07s',state:'Completed'});
    assert(bars.every(bar=>bar.querySelector('.scenario-progress-text').classList.contains('scenario-trace-step-meta')));
    assert.equal(h.simulationCalls(),0);assert.equal(h.intervals(),0);
    h.advance(600000);h.host.querySelector('.scenario-trace-back').click();openTrace(h);
    capsule(h.activity,{percent:100,time:'2m 00s',state:'Completed'});
    assert.equal(JSON.stringify(record),before,'Reading and toggling restored progress must not rewrite history.');
  }finally{h.close();}
});

test('legacy elapsed totals sum only valid nonnegative step times and respect an explicit zero',()=>{
  for(const [total,time] of [[undefined,'0m 10s'],[-1,'0m 10s'],[null,'0m 10s'],[0,'0m 00s']]){
    const record=savedCase(),trace=record.simulations[0].whatIf.evaluations[0].progressTrace;
    if(total===undefined)delete trace.summary.elapsedMs;else trace.summary.elapsedMs=total;
    trace.steps.push({name:'Unknown duration',state:'Completed',percent:100,elapsedMs:-50000},
      {name:'Missing duration',state:'Completed',percent:100},{name:'Empty duration',state:'Completed',percent:100,elapsedMs:null});
    const before=JSON.stringify(record),h=browser(record);
    try{
      capsule(h.activity,{percent:100,time,state:'Completed'});
      assert.equal(openTrace(h).querySelector('.scenario-trace-overall'),null);
      assert.doesNotMatch(h.panel.textContent,/NaN|undefined|Infinity/);
      assert.equal(JSON.stringify(record),before);
    }finally{h.close();}
  }
});

test('restored cancellation, error and interrupted unknown progress preserve time without claiming completion',()=>{
  for(const [status,state,stepPercent] of [['CANCELLED','Cancelled',40],['ERROR','Failed',40],['RUNNING','Interrupted',null]]){
    const record=savedCase(),entry=record.simulations[0].whatIf.evaluations[0],trace=entry.progressTrace;
    entry.status=status;entry.message=status==='ERROR'?'Cannot evaluate: test transport failed.':'Previous search stopped.';
    trace.percent=42;trace.outcome=status==='RUNNING'?'':state;trace.summary.elapsedMs=65000;
    trace.steps[1]={...trace.steps[1],state:status==='RUNNING'?'Running':state,percent:stepPercent,elapsedMs:9000};
    const before=JSON.stringify(record),h=browser(record);
    try{
      capsule(h.activity,{percent:42,time:'1m 05s',state});
      const panel=openTrace(h),row=panel.querySelectorAll('.scenario-trace-row')[1],bar=row.querySelector('.scenario-trace-step-bar');
      assert.equal(row.dataset.traceState,state);
      capsule(bar,{percent:stepPercent,time:'0m 09s',state});
      assert.equal(bar.dataset.indeterminate,'false','Interrupted work is static, not a still-running animation.');
      assert.equal(h.host.querySelector('.scenario-create').disabled,true);
      h.advance(3600000);h.host.querySelector('.scenario-trace-back').click();openTrace(h);
      capsule(h.activity,{percent:42,time:'1m 05s',state});
      assert.equal(JSON.stringify(record),before);assert.equal(h.simulationCalls(),0);
    }finally{h.close();}
  }
});

test('trace navigation preserves the original CAPEX tag and uses a translated icon with focus return',()=>{
  for(const [lang,label] of [['en','Back'],['es','Regresar']]){
    const h=browser(savedCase(),{lang});
    try{
      const header=h.host.querySelector(':scope > .scenario-card-header'),badge=header.querySelector('.analysis-capex');
      const back=header.querySelector('button.secondary.icon-button.scenario-trace-back'),originalText=badge.textContent;
      badge.id='original-capex-tag';
      assert.equal(back.hidden,true);assert.equal(back.dataset.icon,'back');assert.equal(back.getAttribute('aria-label'),label);
      assert(back.querySelector('svg.icon'));assert.equal(back.textContent.trim(),'');
      for(const key of ['Enter',' ']){
        openTrace(h,key);
        assert.equal(back.hidden,false);assert.equal(h.w.document.activeElement,back);
        assert.equal(h.host.querySelector(':scope > .scenario-card-header'),header);
        assert.equal(header.querySelector('.analysis-capex'),badge);assert.equal(badge.textContent,originalText);
        assert.equal(badge.dataset.tier,'ZERO');assert.equal(h.host.querySelectorAll('.analysis-capex').length,1);
        assert.equal(h.w.document.querySelectorAll('#original-capex-tag').length,1);
        assert.notEqual(h.w.getComputedStyle(header).display,'none');
        assert.equal(h.panel.querySelector('.scenario-trace-header'),null);
        assert.equal(h.panel.querySelector('.analysis-capex'),null);
        assert.doesNotMatch(h.panel.textContent,/Analysis progress|Saved analysis progress|Avance del análisis/);
        back.click();
        assert.equal(h.panel.hidden,true);assert.equal(back.hidden,true);assert.equal(h.w.document.activeElement,h.activity);
        assert.equal(h.host.querySelector(':scope > .scenario-card-header'),header);
      }
    }finally{h.close();}
  }
});

test('deleting and undoing a result restores the same saved progress total without restarting its clock',()=>{
  const record=savedCase(),before=JSON.stringify(record.simulations[0].whatIf.evaluations),h=browser(record);
  try{
    const header=h.host.querySelector(':scope > .scenario-card-header');
    openTrace(h);h.host.querySelector('.scenario-clear-result').click();
    assert.equal(h.panel.hidden,true);assert.equal(h.activity.hidden,true);
    assert.equal(h.sim.whatIf.evaluations.length,0);
    h.advance(1800000);h.host.querySelector('.scenario-clear-notice button').click();
    assert.equal(JSON.stringify(h.sim.whatIf.evaluations),before);
    assert.equal(h.activity.hidden,false);capsule(h.activity,{percent:100,time:'2m 00s',state:'Completed'});
    assert.equal(openTrace(h).querySelector('.scenario-trace-overall'),null);
    assert.equal(h.host.querySelector(':scope > .scenario-card-header'),header);
    assert.equal(h.intervals(),0);assert.equal(h.simulationCalls(),0);
  }finally{h.close();}
});

test('a live stalled batch advances elapsed time and freezes the saved clock on cancel or error',async()=>{
  for(const [status,state] of [['CANCELLED','Cancelled'],['ERROR','Failed']]){
    const h=browser(savedCase({history:false}),{holdBatch:true});let restored;
    try{
      const run=h.host.querySelector('.scenario-search');run.click();await until(()=>h.pendingBatch());
      assert.equal(h.host.getAttribute('aria-busy'),'true');assert.equal(h.simulationCalls(),1);
      const percent=Number(h.activity.getAttribute('aria-valuenow'));
      h.advance(5000);capsule(h.activity,{percent,time:'0m 05s'});
      const panel=openTrace(h),row=panel.querySelector('[data-trace-state="Running"]'),stepBar=row.querySelector('.scenario-trace-step-bar');
      const stepPercent=Number(stepBar.getAttribute('aria-valuenow'));
      h.advance(60000);
      capsule(h.activity,{percent,time:'1m 05s'});capsule(stepBar,{percent:stepPercent,time:'1m 05s',state:'Running'});
      assert.equal(panel.querySelector('[data-trace-state="Running"]'),row,'Clock ticks retain the expanded step and its controls.');
      assert.equal(h.host.querySelector('.scenario-trace-back').disabled,false);
      if(status==='CANCELLED'){run.click();run.click();}
      h.pendingBatch().reject(Error(status==='CANCELLED'?'BATCH_CANCELLED':'test transport failed'));
      await until(()=>!h.host.hasAttribute('aria-busy'));
      const entry=h.sim.whatIf.evaluations.at(-1);
      assert.equal(entry.status,status);assert.equal(entry.progressTrace.outcome,state);
      assert.equal(entry.progressTrace.summary.elapsedMs,65000);
      assert.equal(h.intervals(),0);
      const terminalPercent=Number(h.activity.getAttribute('aria-valuenow'));
      assert(terminalPercent<100);const frozen=capsule(h.activity,{percent:terminalPercent,time:'1m 05s',state});
      h.advance(120000);h.host.querySelector('.scenario-trace-back').click();openTrace(h);
      assert.equal(capsule(h.activity,{percent:terminalPercent,time:'1m 05s',state}),frozen);
      restored=browser(copy(h.record));
      capsule(restored.activity,{percent:terminalPercent,time:'1m 05s',state});
      assert.equal(restored.simulationCalls(),0);
    }finally{restored?.close();h.close();}
  }
});

test('scenario progress stays flat and scrollable cards have room for the shared hover effect',()=>{
  const explorer=fs.readFileSync('apps-script/ScenarioExplorer.html','utf8');
  const css=explorer.match(/\.analysis-recommendation \.scenario-progress-capsule\{([^}]+)\}/)[1];
  assert.match(css,/(?:^|;)border:0;/);
  assert.match(css,/box-shadow:none!important/);
  assert.match(css,/border-radius:var\(--radius-pill/);
  const standards=fs.readFileSync('apps-script/UiStandards.html','utf8');
  const grid=standards.match(/html\[data-ui-mode=basic\] \.scenario-tier-grid \{[^}]*overflow-x:auto;[^}]*\}/)[0];
  assert.match(grid,/padding:var\(--space-3\)/);
  assert.match(grid,/margin-inline:calc\(-1 \* var\(--space-3\)\)/);
});
