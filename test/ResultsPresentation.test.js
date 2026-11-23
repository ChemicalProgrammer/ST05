import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {diagnoseLineEfficiency} from '../src/analysis/LinePerformanceAnalysis.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const scripts=[...page.window.document.querySelectorAll('script')].map(node=>node.textContent);
const servedModule=name=>{const script=scripts.find(source=>new RegExp('window\\.'+name+'\\s*=').test(source));assert.ok(script,'Missing served module '+name);return script;};
const client=scripts.find(source=>source.includes('function markCaseDirty('));
const utilities=client.slice(client.indexOf('    function sum('),client.lastIndexOf('\n  })();'));
const displayNoneSelectors=[];
for(const style of page.window.document.querySelectorAll('style'))postcss.parse(style.textContent).walkRules(rule=>{
  if(rule.nodes.some(node=>node.type==='decl'&&node.prop==='display'&&node.value==='none'))
    for(const selector of selectorParser().astSync(rule.selector).nodes)displayNoneSelectors.push(selector.toString());
});
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
  w.isFiniteNumber=Number.isFinite;
  w.SimulatorEngine={diagnoseLineEfficiency};
  w.STBasicMode={isBasic:()=>false};
  w.STLinePerformance={render(){}};
  w.STProducts={results(target){target.classList.add('hidden');target.replaceChildren();}};
  // Use the served unit, time, report-data and results renderers. The
  // independent V-Graph is outside this presentation check.
  w.eval(utilities);
  for(const name of ['Subsection','TimeControls','EquipmentEfficiency','Reports','PlantCalendar','Results'])
    w.eval(servedModule('ST'+name));
  assert.equal(typeof w.__ST_TEXT__,'undefined');
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
    assert.deepEqual([...throughput.querySelectorAll('.comparison-kpi-value .metric-number')].map(node=>node.textContent),['480','540']);
    assert.deepEqual([...throughput.querySelectorAll('.comparison-kpi-value .metric-unit')].map(node=>node.textContent),['bpm','bpm']);
    assert.match(throughput.querySelector('.comparison-kpi-delta').textContent,/60 bpm/);
    assert.doesNotMatch(target.textContent,/bottles\/min/);
  }finally{h.close();}
});

test('pending and rerun results keep empty summary cards visible and never retain old measurements',()=>{
  const h=harness(),data=fixture('cases'),d=h.w.document;
  try{
    d.documentElement.dataset.uiMode='advance';d.documentElement.dataset.headerView='results';
    h.render({...data,result:null});
    assert.equal(h.node('results-body').classList.contains('hidden'),false);
    assert.equal(h.node('results-empty').classList.contains('hidden'),true);
    const cards=[...h.node('results-kpis').children];assert.equal(cards.length,9);
    const lossCards=[...h.node('results-rate-loss-highlights').querySelectorAll('article')];
    assert.equal(lossCards.length,3,'Rate-loss summary cards remain visible while results are pending');
    lossCards.forEach(card=>assert.equal(card.querySelector('.metric-number').textContent,'—'));
    const numbers=cards.map(card=>card.querySelector('.metric-number,.st-time-output > b'));
    numbers.forEach(value=>assert.equal(value.textContent,'—','A missing result is not a measured zero'));
    assert.equal(cardMetric(h,'throughput').unit.textContent,'cpm');
    assert.equal(cardMetric(h,'production').unit.textContent,'cases');
    for(const selector of displayNoneSelectors){
      let matches=false;try{matches=h.node('results-overview').matches(selector);}catch{}
      assert.equal(matches,false,'Pending overview must not be hidden by '+selector);
    }
    ['export-ai','export-results-html','export-results-pdf'].forEach(id=>assert.equal(h.node(id).disabled,true));
    assert.equal(h.node('results-kpis').querySelector('.equipment-failure-kpi').getAttribute('aria-disabled'),'true');

    h.render(data);assert.equal(cardMetric(h,'production').value.textContent,'960');
    const unit=h.node('results-kpis').querySelector('[data-metric="rate-loss"] select');
    unit.value='s';unit.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(h.node('export-ai').disabled,false);
    assert.ok(h.node('results-table').children.length);
    const provisional={...copy(data.result),provisional:true};provisional.summary.outputCount=999999;
    h.render({...data,result:provisional});
    assert.equal(h.node('results-table').children.length,0,'A new run must clear the previous result table');
    assert.equal(h.node('results-reference').textContent,'');assert.equal(h.node('results-insight').textContent,'');
    cards.forEach((card,index)=>{
      assert.equal(h.node('results-kpis').children[index],card,'The pending run retains the mounted card');
      assert.equal(card.querySelector('.metric-number,.st-time-output > b'),numbers[index]);
      assert.equal(numbers[index].textContent,'—','Provisional totals must not be presented as final values');
    });
    assert.equal(unit.value,'s');assert.equal(h.node('export-ai').disabled,true);
    lossCards.forEach((card,index)=>{
      assert.equal(h.node('results-rate-loss-highlights').querySelectorAll('article')[index],card);
      assert.equal(card.querySelector('.metric-number').textContent,'—','Previous rate-loss totals are cleared on rerun');
    });
    h.render(data);assert.equal(cardMetric(h,'production').value.textContent,'960');assert.equal(unit.value,'s');
    cards.forEach((card,index)=>assert.equal(h.node('results-kpis').children[index],card));

    h.w.STBasicMode.isBasic=()=>true;h.render({...data,result:null});
    assert.deepEqual([...h.node('results-kpis').children].map(card=>card.dataset.metric),
      ['oee','throughput','production','failure-downtime','effective-runtime']);
    h.w.STBasicMode.isBasic=()=>false;h.render({...data,result:null});
    assert.deepEqual([...h.node('results-kpis').children].map(card=>card.dataset.metric),
      ['oee','throughput','production','rate-loss','equipment-downtime','starved','blocked','failure-downtime','effective-runtime']);
  }finally{h.close();}
});

test('comparison uses shared subsection toolbars, KPI cards and parameter tables with native units',()=>{
  const h=harness();
  try{
    h.w.eval(servedModule('STInputComparison'));
    const leftData=fixture('cases'),rightData=fixture('cases');
    const left={...leftData.simulation,id:'left',name:'Baseline',results:leftData.result};
    const right={...rightData.simulation,id:'right',name:'Proposed',results:rightData.result};
    left.dynamicConfig={durationSeconds:120,seed:7};right.dynamicConfig={durationSeconds:120,seed:8};
    right.equipment[0].nominalRatePerSecond=11;right.results.summary.outputCount=1080;
    const state={activeCase:{...leftData.activeCase,simulations:[left,right]}};
    for(const [id,value] of [['case-compare-a','left'],['case-compare-b','right']]){
      const select=h.node(id);select.innerHTML='<option value="left">Baseline</option><option value="right">Proposed</option>';select.value=value;
    }
    const before=JSON.stringify(state);const controller=h.w.STComparison(state,Number.isFinite);controller.render();
    const setup=h.node('comparison-setup');assert.ok(setup.matches('.fold-card'));
    assert.ok(setup.querySelector('.fold-heading .subsection-description'));
    assert.ok(setup.querySelector('.fold-heading .fold-tools .export-menu > summary.secondary.icon-button'));
    assert.ok(setup.querySelector('#comparison-setup-content.fold-content'));
    const target=h.node('case-comparison-content');
    for(const section of target.querySelectorAll('.comparison-section')){
      assert.ok(section.matches('details.fold-card.fold-native'));
      assert.ok(section.querySelector(':scope > summary .subsection-native-title'));
      assert.ok(section.querySelector(':scope > .fold-content'));
    }
    const highlights=[...target.querySelectorAll('.comparison-kpi')];assert.equal(highlights.length,2);
    highlights.forEach(card=>assert.ok(card.matches('.metric-card.metric-card--result')));
    assert.deepEqual([...highlights[1].querySelectorAll('.comparison-kpi-value .metric-unit')].map(node=>node.textContent),['cpm','cpm']);
    assert.match(highlights[1].querySelector('.comparison-kpi-delta').textContent,/60 cpm/);
    const throughput=[...target.querySelectorAll('.comparison-outcomes tbody tr')][1];
    assert.deepEqual([...throughput.querySelectorAll('.metric-number')].map(node=>node.textContent),['480','540','+60','+12.5']);
    assert.deepEqual([...throughput.querySelectorAll('.metric-unit')].map(node=>node.textContent),['cpm','cpm','cpm','%']);
    const oee=target.querySelector('.comparison-equipment-oee tbody tr');
    assert.deepEqual([...oee.querySelectorAll('.metric-unit')].map(node=>node.textContent),['%','%','pp']);
    assert.match(target.textContent,/Speed \(cpm\)/);assert.doesNotMatch(target.textContent,/bottles\/min|Speed \(BPM\)/);
    const parameters=target.querySelector('.comparison-values-table');assert.ok(parameters);
    assert.equal(parameters.tHead.rows[0].cells.length,3);
    assert.ok(parameters.querySelector('tbody tr.comparison-changed th[scope=row]'));
    assert.equal(JSON.stringify(state),before,'Comparison styling must not modify model or saved measurements');

    h.node('case-compare-b').value='left';controller.render();
    assert.ok(target.querySelector('.comparison-empty.metric-card[role=status]'));
    assert.equal(target.querySelector('.comparison-outcomes'),null);
  }finally{h.close();}
});

test('pending result units prefer current result metadata and explicit case units over the last machine',()=>{
  const h=harness(),data=fixture('CASES');
  try{
    const packer=data.activeCase.equipment.at(-1);packer.processData.flowUnits.output='CASES';
    data.activeCase.unitOfFlow='BOTTLES';
    h.render({...data,result:null});
    const cards=[...h.node('results-kpis').children];
    function assertPending(count,rate){
      assert.equal(cardMetric(h,'production').unit.textContent,count);
      assert.equal(cardMetric(h,'throughput').unit.textContent,rate);
      cards.forEach((card,index)=>{
        assert.equal(h.node('results-kpis').children[index],card);
        assert.equal(card.querySelector('.metric-number,.st-time-output > b').textContent,'—');
      });
    }
    assertPending('bottles','bpm');
    data.activeCase.unitOfFlow='units';h.render({...data,result:null});
    assertPending('cases','cpm');
    data.activeCase.unitOfFlow='cases';
    const provisional={...copy(data.result),unitOfFlow:'BOTTLES',provisional:true};
    provisional.summary.outputCount=999999;
    h.render({...data,result:provisional});assertPending('bottles','bpm');
    delete provisional.unitOfFlow;provisional.replay={unitOfFlow:'BOTTLES'};
    h.render({...data,result:provisional});assertPending('bottles','bpm');
    const complete={...data.result,unitOfFlow:'bottles'};
    h.render({...data,result:complete});
    assert.equal(cardMetric(h,'production').unit.textContent,'bottles');
    assert.equal(cardMetric(h,'throughput').unit.textContent,'bpm');
    assert.equal(cardMetric(h,'production').value.textContent,'960');
    cards.forEach((card,index)=>assert.equal(h.node('results-kpis').children[index],card));
  }finally{h.close();}
});

test('real navigation and invalidation refresh Results without removing its summary cards',()=>{
  const h=harness(),{w}=h,data=fixture();
  try{
    w.STPreferences={read(){},caseOptions:()=>({showRealData:true})};
    w.STSettings={applyCaseCharts(){}};w.STIcons={decorate(){}};w.STMotion={reveal(){}};w.STBasicMode.sync=()=>{};
    w.eval(servedModule('STShell'));
    const state={activeCase:data.activeCase,activeSimulationId:data.simulation.id,uiView:'simulation',run:{result:null}};
    const shell=w.STShell(state,{assistant(){}});shell.sync();
    state.uiView='results';shell.sync();
    assert.equal(h.node('results-panel').classList.contains('hidden'),false);
    const cards=[...h.node('results-kpis').children];assert.equal(cards.length,9);
    assert.equal(cardMetric(h,'production').value.textContent,'—');
    state.run.result=data.simulation.results=data.result;shell.sync();
    assert.equal(cardMetric(h,'production').value.textContent,'960');
    cards.forEach((card,index)=>assert.equal(h.node('results-kpis').children[index],card));

    w.state=state;w.activePersistentSimulation=()=>data.simulation;
    w.cancelRoundSession=()=>{};w.stopPlaybackTimer=()=>{};w.updateNumericalEquipmentVisibility=()=>{};
    w.toggle=(id,visible)=>h.node(id).classList.toggle('hidden',!visible);
    const start=client.indexOf('    function invalidateActiveResult('),end=client.indexOf('\n    function markCaseDirty(',start);
    assert.ok(start>=0&&end>start);w.eval(client.slice(start,end));
    w.invalidateActiveResult();
    assert.equal(state.run.result,null);assert.equal(data.simulation.results,null);
    assert.equal(cardMetric(h,'production').value.textContent,'—','Invalidating from Settings must clear Results immediately');
    assert.equal(h.node('results-table').children.length,0);
    cards.forEach((card,index)=>assert.equal(h.node('results-kpis').children[index],card));
  }finally{h.close();}
});
