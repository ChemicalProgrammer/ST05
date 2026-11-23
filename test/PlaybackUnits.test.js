import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

const source=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
const metricIds=['metric-output','metric-instant-rate','metric-rate','metric-buffer','metric-overflow'];
const format=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:2});

// Use the shipped WebApp markup, while keeping unrelated application startup,
// remote services and charts outside this focused DOM integration fixture.
const rendered=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const markup=['simulation-playback-metrics','playback-progress','playback-status',
  'run-events-enabled','run-reliability-enabled'].map(id=>{
  const element=rendered.window.document.getElementById(id);
  assert.ok(element,'WebApp must include '+id);
  return element.outerHTML;
}).join('');
rendered.window.close();

function sample(virtualSecond,outputCount,buffers=[],overflow=[]){
  return {virtualSecond,outputCount,buffers,
    accumulationZones:overflow.map((overflowUnits,index)=>({id:'zone-'+index,overflowUnits})),
    equipment:[{id:'machine',backupStopSeconds:0}],
    effectiveRuntimeSeconds:virtualSecond,runtimeLossSeconds:0,lineOeePercent:95};
}

function harness(unitOfFlow='bottles'){
  const dom=new JSDOM(markup,{runScripts:'outside-only'}),w=dom.window;
  const samples=[sample(0,0),sample(60,480,[12,3],[2,1]),sample(120,1050,[2,3],[7,2])];
  w.state={uiView:'cases',activeCase:{unitOfFlow:'cases',equipment:[]},run:{
    configuration:{durationSeconds:86400},sampleIndex:0,roundIndex:0,playing:false,
    result:{unitOfFlow,durationSeconds:86400,samples,summary:{},detailCoverage:{recordingMode:'BOUNDED'}}
  }};
  w.__ST_TEXT__=key=>key;
  w.__ST_HTML_TEXT__=key=>key;
  w.isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);
  w.roundSession=null;
  w.eval(source('ClientUtils'));
  w.eval(source('TimeControls').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  w.eval(source('ClientPlayback'));
  const node=id=>w.document.getElementById(id);
  return {w,samples,node,close:()=>w.close(),refresh(index){
    w.state.run.sampleIndex=index;
    w.refreshPlaybackMetricCards(samples[index],samples[index].virtualSecond);
  }};
}

function metricParts(h){
  return new Map(metricIds.map(id=>{
    const value=h.node(id),unit=h.node(id+'-unit');
    assert.equal(value?.tagName,'B',id+' keeps the numeric value in its own bold element');
    assert.equal(unit?.tagName,'SPAN',id+' has a separate unit label');
    assert.ok(value.parentElement.matches('strong.playback-metric-value'));
    assert.equal(unit.parentElement,value.parentElement,'The unit and number share their result wrapper');
    assert.ok(unit.classList.contains('playback-metric-unit'));
    return [id,{value,unit,wrapper:value.parentElement}];
  }));
}

function assertSameMetricParts(h,original){
  for(const [id,parts] of metricParts(h)){
    for(const key of ['value','unit','wrapper'])assert.equal(parts[key],original.get(id)[key],id+' retains its '+key+' node');
  }
}

test('playback values and units survive repeated updates in the shipped metric markup',()=>{
  const h=harness(),original=metricParts(h),before=JSON.stringify(h.w.state.run.result);
  try{
    const expected=[
      ['0','—','—','0','0'],
      [format(480),format(480),format(480),'15','3'],
      [format(1050),format(570),format(525),'5','9']
    ];
    for(const index of [0,1,2,1,2]){
      h.refresh(index);
      assertSameMetricParts(h,original);
      metricIds.forEach((id,position)=>assert.equal(h.node(id).textContent,expected[index][position],
        id+' contains only its actual recorded number'));
      assert.equal(h.node('metric-output-unit').textContent,'bottles',
        'The recorded result unit takes precedence over the current case unit');
      for(const id of ['metric-instant-rate','metric-rate'])assert.equal(h.node(id+'-unit').textContent,'bpm');
      for(const id of ['metric-buffer','metric-overflow'])assert.equal(h.node(id+'-unit').textContent,'units',
        'Native zone item totals are not labeled as bottle equivalents');
    }
    assert.equal(JSON.stringify(h.w.state.run.result),before,'Presentation updates leave recorded quantities unchanged');
  }finally{h.close();}
});

test('case output uses cpm while mixed native inventory and overflow remain units',()=>{
  const h=harness('cases'),original=metricParts(h);
  try{
    h.w.state.activeCase.unitOfFlow='bottles';
    h.samples[1].buffers=[1200,8];
    h.samples[1].accumulationZones=[
      {id:'bottle-zone',unitOfFlow:'bottles',overflowUnits:2},
      {id:'case-zone',unitOfFlow:'cases',overflowUnits:3}
    ];
    for(const unit of ['cases','CASES']){
      h.w.state.run.result.unitOfFlow=unit;
      h.refresh(1);
      assertSameMetricParts(h,original);
      assert.equal(h.node('metric-output').textContent,format(480));
      assert.equal(h.node('metric-output-unit').textContent,'cases');
      assert.equal(h.node('metric-instant-rate').textContent,format(480));
      assert.equal(h.node('metric-instant-rate-unit').textContent,'cpm');
      assert.equal(h.node('metric-rate').textContent,format(480));
      assert.equal(h.node('metric-rate-unit').textContent,'cpm');
      assert.equal(h.node('metric-buffer').textContent,format(1208));
      assert.equal(h.node('metric-overflow').textContent,'5');
      assert.equal(h.node('metric-buffer-unit').textContent,'units');
      assert.equal(h.node('metric-overflow-unit').textContent,'units');
    }
    delete h.w.state.run.result.unitOfFlow;
    h.refresh(2);
    assert.equal(h.node('metric-output-unit').textContent,'bottles','Legacy results fall back to the case unit');
    assert.equal(h.node('metric-rate-unit').textContent,'bpm');
    assertSameMetricParts(h,original);
  }finally{h.close();}
});

test('Spanish localization translates dynamic unit labels without replacing numeric or unit elements',async()=>{
  const h=harness(),original=metricParts(h),{w}=h;
  try{
    w.eval(source('Language').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
    w.STLanguage.setLanguage('es');
    let localizedUnitText;
    for(const index of [1,2,1]){
      h.refresh(index);
      if(localizedUnitText)for(const [id,textNode] of localizedUnitText){
        assert.equal(h.node(id+'-unit').firstChild,textNode,'An unchanged unit does not rewrite its translated text');
        assert.equal(h.node(id+'-unit').textContent,id==='metric-output'?'botellas':
          ['metric-buffer','metric-overflow'].includes(id)?'unidades':'bpm');
      }
      await new Promise(resolve=>w.setTimeout(resolve,0));
      assert.equal(h.node('metric-output-unit').textContent,'botellas');
      assert.equal(h.node('metric-instant-rate-unit').textContent,'bpm');
      assert.equal(h.node('metric-rate-unit').textContent,'bpm');
      assert.equal(h.node('metric-buffer-unit').textContent,'unidades');
      assert.equal(h.node('metric-overflow-unit').textContent,'unidades');
      assert.equal(h.node('metric-output').textContent,format(h.samples[index].outputCount));
      assertSameMetricParts(h,original);
      localizedUnitText=new Map(metricIds.map(id=>[id,h.node(id+'-unit').firstChild]));
    }
    w.state.run.result.unitOfFlow='cases';
    h.refresh(2);
    await new Promise(resolve=>w.setTimeout(resolve,0));
    assert.equal(h.node('metric-output-unit').textContent,'cajas');
    assert.equal(h.node('metric-rate-unit').textContent,'cpm');
    assert.equal(h.node('metric-buffer-unit').textContent,'unidades');
    assertSameMetricParts(h,original);
    w.STLanguage.setLanguage('en');
    assert.equal(h.node('metric-output-unit').textContent,'cases');
    assert.equal(h.node('metric-buffer-unit').textContent,'units');
    assertSameMetricParts(h,original);
    w.STLanguage.setLanguage('es');
    w.state.run.result.unitOfFlow='units';
    h.refresh(1);
    await new Promise(resolve=>w.setTimeout(resolve,0));
    assert.equal(h.node('metric-output-unit').textContent,'unidades');
    assert.equal(h.node('metric-instant-rate-unit').textContent,'unid/min');
    assert.equal(h.node('metric-rate-unit').textContent,'unid/min');
    assertSameMetricParts(h,original);
  }finally{h.close();}
});

function equipmentCard(h){
  const {w}=h;
  w.eval(source('EquipmentEfficiency').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  // Icons and the chart-window description are unrelated to unit formatting.
  w.STIcons={svg:()=>'<svg></svg>',equipment:()=>'<svg></svg>'};
  w.STRunOptions={windowLabel:()=> 'Last 5 minutes'};
  const card=w.createLiveEquipmentCard('machine');
  w.document.body.append(card);
  return card;
}

function summaryRow(card,label){
  return [...card.querySelectorAll('.live-equipment-2d-summary .live-equipment-2d-row')]
    .find(row=>row.querySelector('.live-equipment-2d-label').textContent===label);
}

test('equipment summary uses native lowercase cases for counts and cpm for design speed and flow',()=>{
  const h=harness(),card=equipmentCard(h);
  try{
    const model={id:'machine',type:'CASE_PACKER',unitOfFlow:'BOTTLES',nominalRatePerSecond:2,
      processData:{flowUnits:{output:'BOTTLES'},equipment:{internalCapacityBottles:24}}};
    const unit={id:'machine',unitOfFlow:'cases',actualRatePerSecond:1.25,designSpeedPerSecond:2,
      processedUnits:7.5,outputCount:6,internalInputUnit:'cases',internalInventoryBottles:12,
      internalCapacityBottles:24,internalInputBottleFactor:6};
    let originalRows;
    for(const processed of [7.5,15,7.5]){
      unit.processedUnits=processed;
      h.w.updateNumericalSummaryRows(card,unit,model,null,null,'RUNNING');
      const rows=['Design speed','Flow','Processed'].map(label=>summaryRow(card,label));
      assert.ok(rows.every(Boolean));
      if(originalRows)rows.forEach((row,index)=>assert.equal(row,originalRows[index],'Metric rows are reused'));
      else originalRows=rows;
      assert.equal(rows[0].querySelector('b').textContent,format(120));
      assert.equal(rows[0].querySelector('.live-equipment-2d-unit').textContent,'cpm');
      assert.equal(rows[1].querySelector('b').textContent,format(75));
      assert.equal(rows[1].querySelector('.live-equipment-2d-unit').textContent,'cpm');
      assert.equal(rows[2].querySelector('b').textContent,format(processed));
      assert.equal(rows[2].querySelector('.live-equipment-2d-unit').textContent,'cases');
      assert.equal(summaryRow(card,'Inside').querySelector('b').textContent,'2 / 4');
      assert.equal(summaryRow(card,'Inside').querySelector('.live-equipment-2d-unit').textContent,'cases');
    }
  }finally{h.close();}
});

test('equipment throughput keeps separate, stable numbers and native units through updates and localization',async()=>{
  const h=harness(),card=equipmentCard(h),{w}=h;
  try{
    const model={id:'machine',name:'Machine',type:'FILLER',unitOfFlow:'BOTTLES',nominalRatePerSecond:10};
    const unit={id:'machine',unitOfFlow:'bottles',mode:'AUTO',availabilityState:'RUNNING',
      actualRatePerSecond:8,designSpeedPerSecond:10,runningSeconds:6000,
      failureSeconds:0,microStopSeconds:0,outputCount:43790,processedUnits:43790};
    const measured={...sample(6000,43790),equipment:[unit]};
    w.state.activeCase.equipment=[model];
    w.state.run.result.samples=[measured];
    w.state.run.sampleIndex=0;
    const throughput=card.querySelector('[data-efficiency="throughput"]');
    let numberNode,unitNode;
    for(const [flowUnit,rateUnit,produced] of [['bottles','bpm',43790],['cases','cpm',43200],['bottles','bpm',60000]]){
      unit.unitOfFlow=flowUnit;
      unit.outputCount=produced;
      const stored=JSON.stringify(w.state.run.result);
      w.updateLiveEquipmentCard(card,unit,model,0,measured);
      assert.equal(card.querySelector('[data-efficiency="throughput"]'),throughput);
      const number=throughput.querySelector('.live-equipment-2d-number'),suffix=throughput.querySelector('.live-equipment-2d-unit');
      assert.ok(number&&suffix,'Throughput exposes its value and unit separately, like Overview');
      if(numberNode){
        assert.equal(number,numberNode,'Updating production retains the numeric element');
        assert.equal(suffix,unitNode,'Switching native unit retains the unit element');
      }else {numberNode=number;unitNode=suffix;}
      assert.equal(number.textContent,format(produced/6000*60),'Physical rate converts seconds to minutes exactly once');
      assert.equal(suffix.textContent,rateUnit);
      assert.equal(throughput.textContent,format(produced/6000*60)+' '+rateUnit);
      assert.equal(summaryRow(card,'Flow').querySelector('.live-equipment-2d-unit').textContent,rateUnit);
      assert.equal(summaryRow(card,'Processed').querySelector('.live-equipment-2d-unit').textContent,flowUnit);
      assert.equal(card.querySelector('.live-rate').textContent,format(480)+' '+rateUnit);
      assert.doesNotMatch(throughput.textContent,/bottles\/min|cases\/min/);
      assert.equal(JSON.stringify(w.state.run.result),stored,'Rendering cannot change the physical result');
    }
    unit.runningSeconds=0;
    w.updateLiveEquipmentCard(card,unit,model,0,measured);
    assert.equal(numberNode.textContent,'—','Unavailable throughput keeps its explicit unit and stable nodes');
    assert.equal(unitNode.textContent,'bpm');
    unit.runningSeconds=6000;unit.outputCount=0;unit.unitOfFlow='units';
    w.eval(source('Language').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
    w.STLanguage.setLanguage('es');
    w.updateLiveEquipmentCard(card,unit,model,0,measured);
    await new Promise(resolve=>w.setTimeout(resolve,0));
    assert.equal(numberNode.textContent,'0','A measured zero stays distinct from unavailable throughput');
    assert.equal(unitNode.textContent,'unid/min');
    const translated=unitNode.firstChild;
    unit.outputCount=120;
    w.updateLiveEquipmentCard(card,unit,model,0,measured);
    assert.equal(numberNode.textContent,format(1.2));
    assert.equal(unitNode.firstChild,translated,'A new numeric frame cannot rewrite an unchanged translated unit');
    assert.equal(unitNode.textContent,'unid/min');
    assert.equal(throughput.querySelector('.live-equipment-2d-number'),numberNode);
    assert.equal(throughput.querySelector('.live-equipment-2d-unit'),unitNode);
  }finally{h.close();}
});
