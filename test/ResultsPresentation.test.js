import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {diagnoseLineEfficiency} from '../src/analysis/LinePerformanceAnalysis.js';

const source=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const markup=page.window.document.body.innerHTML;
page.window.close();

function fixture(unitOfFlow='bottles'){
  const model={id:'machine',name:'Filler',type:'CUSTOM',unitOfFlow,nominalRatePerSecond:10,
    processData:{flowUnits:{input:unitOfFlow,output:unitOfFlow},equipment:{maximumSpeedBpm:600}},
    characteristics:{criticalMachine:true}};
  const metric={unitOfFlow,outputCount:960,runningSeconds:100,failureSeconds:10,microStopSeconds:0,
    starvedSeconds:5,blockedSeconds:5,pausedSeconds:0,stoppedSeconds:0,failureCount:1,
    reliabilityExposureSeconds:100,oeePercent:80,processingCapacityPercent:80};
  const result={unitOfFlow,durationSeconds:120,seed:7,summary:{outputCount:960,lineOeePercent:80,
    lineRunSeconds:100,lineRateLossSeconds:10,lineRateRecoverySeconds:0,lineNetRateBalanceSeconds:10,
    lineOeePacemakerRatePerSecond:10,lineOeePacemakerName:'Filler',totalStarvedSeconds:5,
    totalBlockedSeconds:5,qualityAssumption:'NO_REJECT_MODEL_ASSUMES_100_PERCENT'},
    equipmentMetrics:{machine:metric},accumulationZoneMetrics:{}};
  const simulation={id:'simulation',name:'Results fixture',equipment:[model],dynamicConfig:{reliabilityEnabled:false}};
  const activeCase={id:'case',name:'Results fixture',unitOfFlow,equipment:[model],simulations:[simulation]};
  return {result,simulation,activeCase};
}

function harness(){
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  w.__ST_TEXT__=key=>({'results.primary_kpi':' primary-kpi','client.min':' min'}[key]||key);
  w.__ST_HTML_TEXT__=w.__ST_TEXT__;
  w.isFiniteNumber=Number.isFinite;
  w.SimulatorEngine={diagnoseLineEfficiency};
  w.STBasicMode={isBasic:()=>false};
  w.STLinePerformance={render(){}};
  w.STProducts={results(target){target.classList.add('hidden');target.replaceChildren();}};
  // Use the shipped unit, time, report-data and results renderers. Export
  // bindings and the independent V-Graph are outside this presentation check.
  w.eval(source('ClientUtils'));
  for(const name of ['TimeControls','EquipmentEfficiency','Reports','PlantCalendar','Results'])
    w.eval(source(name).replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  w.STReports.bindResults=()=>{};
  const node=id=>w.document.getElementById(id);
  return {w,node,render(data){w.STResults.render(data.result,data.activeCase,data.simulation);},close:()=>w.close()};
}

function cardMetric(h,name){
  const card=h.node('results-kpis').querySelector('[data-metric="'+name+'"]');
  assert.ok(card,'The result exposes '+name);
  return {card,value:card.querySelector('.metric-number'),unit:card.querySelector('.metric-unit')};
}

test('all main workspaces share the layout parent that supplies margins and subsection surfaces',()=>{
  const dom=new JSDOM(markup),document=dom.window.document;
  try{
    const workspace=document.querySelector('.workspace-content');
    for(const id of ['editor-panel','run-panel','results-panel','realdata-panel','whatif-panel','comparison-panel']){
      const panel=document.getElementById(id);
      assert.ok(panel,id+' is part of the shipped page');
      assert.equal(panel.parentElement,workspace,id+' inherits the shared workspace gutter and panel reset');
      assert.ok(panel.matches('.workspace-content > section.card'));
    }
    const first=document.querySelector('#results-body > .fold-card');
    assert.ok(first.matches('.workspace-content .fold-card'),
      'Result subsections receive the same surface and spacing rules as Simulation');
  }finally{dom.window.close();}
});

test('result KPIs and rate-loss highlights use shared value/unit cards without changing measurements',()=>{
  const h=harness();
  try{
    for(const [unit,countLabel,rateLabel] of [['BOTTLES','bottles','bpm'],['cases','cases','cpm'],['units','units','units/min']]){
      const data=fixture(unit),before=JSON.stringify(data.result);
      const expectedLoss=h.w.STReports.rateLossHighlights(data.result);
      h.render(data);
      const throughput=cardMetric(h,'throughput'),production=cardMetric(h,'production');
      assert.equal(throughput.value.textContent,'480','Seconds convert to minutes exactly once');
      assert.equal(throughput.unit.textContent,rateLabel);
      assert.equal(production.value.textContent,'960');
      assert.equal(production.unit.textContent,countLabel);
      assert.ok(cardMetric(h,'oee').card.classList.contains('metric-card--featured'));
      const lossCards=[...h.node('results-rate-loss-highlights').querySelectorAll('article')];
      assert.equal(lossCards.length,3);
      lossCards.forEach((card,index)=>{
        assert.ok(card.matches('.metric-card.metric-card--result'),
          'Rate-loss highlights must use the standard result-card scale');
        assert.equal(card.querySelector('.metric-number').textContent,
          expectedLoss.cards[index].value.toLocaleString('es-MX',{maximumFractionDigits:expectedLoss.cards[index].digits}));
        assert.equal(card.querySelector('.metric-unit').textContent,expectedLoss.cards[index].unit.trim());
        assert.equal(card.getAttribute('aria-description'),expectedLoss.cards[index].help);
      });
      const failure=h.node('results-kpis').querySelector('.equipment-failure-kpi');
      assert.equal(failure.getAttribute('role'),'button');
      assert.equal(failure.querySelectorAll('select,button,input').length,0,
        'The breakdown action does not contain a second interactive control');
      assert.equal(failure.querySelector('.metric-unit').textContent,'min');
      assert.equal(JSON.stringify(data.result),before,'Presentation preserves the saved physical result');
      assert.doesNotMatch(h.node('results-panel').textContent,/bottles\/min|cases\/min/);
    }
  }finally{h.close();}
});

test('time result cards use the shared accessible control and preserve seconds when changing units',()=>{
  const h=harness(),data=fixture();
  try{
    h.render(data);
    const cards=[...h.node('results-kpis').querySelectorAll('[data-metric="rate-loss"], [data-metric="equipment-downtime"], [data-metric="starved"], [data-metric="blocked"], .effective-run-time-kpi')];
    assert.equal(cards.length,5);
    cards.forEach(card=>{
      const output=card.querySelector('.st-time-output'),select=output?.querySelector('select'),value=output?.querySelector('b');
      assert.ok(select?.getAttribute('aria-label'));
      assert.equal(select.value,'min');
      const seconds=output.dataset.seconds;
      select.value='s';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
      assert.equal(output.dataset.seconds,seconds);
      assert.equal(value.textContent,h.w.STTimeControls.format(Number(seconds)));
      assert.equal(card.querySelector('.st-time-output'),output);
    });
    assert.equal(data.result.summary.lineRateLossSeconds,10);
    assert.equal(h.node('results-kpis').querySelector('.effective-run-time-kpi .st-time-output').dataset.seconds,'90');
  }finally{h.close();}
});

test('equipment operation and efficiency retain native bottle/case rates and physical belt speed',()=>{
  const h=harness(),data=fixture();
  try{
    const bottle={...data.activeCase.equipment[0],id:'bottle',name:'Bottle machine',nominalRatePerSecond:20,
      processData:{flowUnits:{input:'bottles',output:'bottles'},equipment:{maximumSpeedBpm:1200}}};
    const packer={...bottle,id:'packer',name:'Packer',unitOfFlow:'CASES',nominalRatePerSecond:2,
      processData:{flowUnits:{input:'BOTTLES',output:'CASES'},equipment:{maximumSpeedBpm:120}}};
    const conveyor={...bottle,id:'belt',name:'Conveyor',type:'CONVEYOR'};
    data.activeCase.equipment=data.simulation.equipment=[bottle,packer,conveyor];
    const common={runningSeconds:100,failureSeconds:0,microStopSeconds:0,failureCount:0,
      pausedSeconds:0,stoppedSeconds:0,starvedSeconds:0,blockedSeconds:0};
    data.result.equipmentMetrics={bottle:{...common,unitOfFlow:'BOTTLES',outputCount:1200},
      packer:{...common,unitOfFlow:'cases',outputCount:100},belt:{...common,unitOfFlow:'BOTTLES',outputCount:1200}};
    data.result.accumulationZoneMetrics={belt:{ownerEquipmentId:'belt',conveyorSpeedMmPerSecond:1000,
      movingPitchMm:40,accumulatedPitchMm:30,averageInventoryUnits:10,maximumInventoryUnits:20}};
    const before=JSON.stringify(data.result);
    h.render(data);
    const tables=h.node('results-equipment-operation').querySelectorAll('table'),operation=[...tables[0].tBodies[0].rows];
    assert.equal(operation[0].cells[1].textContent,'720 bpm');
    assert.equal(operation[1].cells[1].textContent,'60 cpm');
    assert.equal(operation[2].cells[2].textContent,'60','A 1000 mm/s belt is still 60 m/min');
    const efficiency=[...tables[1].tBodies[0].rows];
    assert.equal(efficiency.length,2,'Conveyors do not receive equipment efficiency');
    assert.equal(efficiency[0].cells[4].textContent,'720 bpm');
    assert.equal(efficiency[1].cells[4].textContent,'60 cpm');
    assert.equal(JSON.stringify(data.result),before);
  }finally{h.close();}
});

test('comparison rates use the same abbreviations as Results without a second conversion',()=>{
  const h=harness();
  try{
    const first=fixture(),second=fixture();second.result.summary.outputCount=1080;
    const target=h.w.document.createElement('div');
    h.w.STResults.compare(target,{name:'A',results:first.result},{name:'B',results:second.result});
    const throughput=target.querySelectorAll('.comparison-kpi')[1];
    assert.deepEqual([...throughput.querySelectorAll('.metric-number')].map(node=>node.textContent),['480','540']);
    assert.deepEqual([...throughput.querySelectorAll('.metric-unit')].map(node=>node.textContent),['bpm','bpm']);
    assert.match(throughput.querySelector('.comparison-kpi-delta').textContent,/60 bpm/);
    assert.doesNotMatch(target.textContent,/bottles\/min/);
  }finally{h.close();}
});
