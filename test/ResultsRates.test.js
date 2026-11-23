import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';
import {analyzeLinePerformance} from '../src/analysis/LinePerformanceAnalysis.js';

const source=name=>fs.readFileSync(new URL('../apps-script/'+name+'.html',import.meta.url),'utf8');
const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
page.window.document.querySelectorAll('script,style,link').forEach(node=>node.remove());
const markup=page.window.document.body.innerHTML;
page.window.close();

function harness(){
  const dom=new JSDOM(markup,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  const labels={'performance.normal_bpm':'Normal · /min','performance.maximum_bpm':'Maximum · /min',
    'performance.recommended_bpm':'Recommended · /min','performance.effective_bpm':'Effective · /min',
    'performance.normal':'Current','performance.recommended':'Recommended','results.throughput':'Throughput'};
  w.__ST_TEXT__=key=>labels[key]||key;w.__ST_HTML_TEXT__=w.__ST_TEXT__;
  w.isFiniteNumber=Number.isFinite;w.SimulatorEngine={analyzeLinePerformance};
  // Only text measurement is unavailable in this DOM. SVG contents are built
  // by the shipped renderer, using its fallback width estimate for names.
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.eval(source('ClientUtils'));
  for(const name of ['Reports','LinePerformance'])w.eval(source(name).replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
  return {w,node:id=>w.document.getElementById(id),close:()=>w.close()};
}
function data(unitOfFlow='bottles'){
  const equipment=[{id:'filler',name:'Filler',type:'FILLER',unitOfFlow,nominalRatePerSecond:8,
    processData:{flowUnits:{input:unitOfFlow,output:unitOfFlow},equipment:{maximumSpeedBpm:600}}}];
  const result={unitOfFlow,durationSeconds:120,summary:{outputCount:960},
    equipmentMetrics:{filler:{unitOfFlow,outputCount:960,stoppedSeconds:0}}};
  return {equipment,result};
}

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
    h.w.eval(source('Language').replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
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
