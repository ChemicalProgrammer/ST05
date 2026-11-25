import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {equipmentReliabilityAssessment,analyzeEquipmentReliability} from '../src/analysis/ScenarioPlanner.js';

const read=name=>fs.readFileSync('apps-script/'+name+'.html','utf8');
const script=name=>read(name).match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(){
  const dom=new JSDOM(read('EquipmentAnalysis'),{runScripts:'outside-only'});
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.STScenarios={equipmentReliability:equipmentReliabilityAssessment,equipmentAnalysis:analyzeEquipmentReliability};
  w.eval(script('Icons'));w.eval(script('Subsection'));w.eval(script('EquipmentAnalysis'));
  const body=w.document.getElementById('equipment-analysis-body');
  const open=(bf,tr,config={})=>w.STEquipmentAnalysis.open({equipment:[{id:'e',name:'Test machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:bf,mttrMinutes:tr}}}],dynamicConfig:config},'e');
  return {w,body,open,close:()=>w.close()};
}
test('equipment diagnosis uses Subsection B and places configured point in correct logarithmic quadrant without a run',()=>{
  const h=harness();
  try{
    for(const [bf,tr,left,above] of [[20,12,true,true],[240,12,false,true],[20,1,true,false],[240,1,false,false],[.001,1000000,true,true]]){
      h.open(bf,tr);
      const groups=[...h.body.querySelectorAll(':scope > .st-subsection')];
      assert.equal(groups.length,8);
      assert(groups.every(g=>g.querySelector('summary .analysis-section-status .sheet-import-row-status svg')));
      assert.equal(groups[0].dataset.completeness,'COMPLETE');
      assert.equal(h.body.querySelector('[data-analysis-group="observed"]').dataset.completeness,'MISSING');
      assert.equal(h.body.querySelector('[data-analysis-group="impact"]').dataset.completeness,'MISSING');
      assert(groups.every(g=>g.dataset.subsectionVariant==='B'&&g.tagName==='DETAILS'&&g.open));
      const marker=h.body.querySelector('[data-equipment-marker]');
      assert(marker);
      assert(Math.abs(Number(marker.getAttribute('data-mtbf'))-bf)<=1e-10*Math.max(1,bf));
      assert(Math.abs(Number(marker.getAttribute('data-mttr'))-tr)<=1e-10*Math.max(1,tr));
      const x=Number(marker.getAttribute('cx')),y=Number(marker.getAttribute('cy'));
      assert.equal(x<390,left);assert.equal(y<169,above);
      assert(x>75&&x<705&&y>22&&y<316);
      assert.equal(Number(h.body.querySelector('[data-availability-target]').dataset.availabilityTarget),.95);
      assert.match(h.body.querySelector('[data-analysis-group="observed"]').textContent,/Not evaluated/);
    }
  }finally{h.close();}
});
test('missing or disabled inputs never create an equipment marker; language changes preserve folds',()=>{
  const h=harness();
  try{
    h.open(0,0);assert.equal(h.body.querySelector('[data-equipment-marker]'),null);
    assert.equal(h.body.querySelector('[data-analysis-group="matrix"]').dataset.completeness,'NOT_APPLICABLE');
    h.open(20,undefined);assert.equal(h.body.querySelector('[data-equipment-marker]'),null);
    assert.equal(h.body.querySelector('[data-analysis-group="matrix"]').dataset.completeness,'PENDING');
    assert.match(h.body.querySelector('[data-analysis-group="matrix"] .analysis-section-status').title,/MTTR/);
    h.open(undefined,undefined);assert.equal(h.body.querySelector('[data-analysis-group="matrix"]').dataset.completeness,'MISSING');
    assert.equal(h.body.querySelector('[data-analysis-group="classes"]').dataset.completeness,'MISSING');
    h.open(20,12,{reliabilityEnabled:false});assert.equal(h.body.querySelector('[data-equipment-marker]'),null);
    assert.equal(h.body.querySelector('[data-analysis-group="matrix"]').dataset.completeness,'NOT_APPLICABLE');
    const group=h.body.querySelector('[data-analysis-group="matrix"]');group.open=false;
    h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
    const translated=h.body.querySelector('[data-analysis-group="matrix"]');
    assert.equal(translated.open,false);assert.match(translated.textContent,/Diagnóstico de intervención/);
    assert.match(translated.querySelector('.analysis-section-status').textContent,/No aplica/);
  }finally{h.close();}
});

test('equipment section status uses actual evidence and distinguishes a technical FAIL from missing data',()=>{
 const h=harness();try{
  const machine={id:'e',name:'Machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:20,mttrMinutes:12}}};
  const belt={id:'c',type:'CONVEYOR'},simulation={equipment:[machine,belt]};
  const audits=[{equipmentId:'c',upstreamId:'e',engineering:{calculated:{antiStarveSeconds:60}}}];
  const observed={durationSeconds:600,failureCount:0,failureSeconds:0,reliabilityExposureSeconds:600,microStopSeconds:0,starvedSeconds:0,blockedSeconds:0,waitingForPrimeSeconds:0,backupStopSeconds:0};
  const r=analyzeEquipmentReliability(simulation,'e',{audits,observed});
  const api=h.w.STEquipmentAnalysis;
  let progress=api.sectionProgress(r,machine,simulation);
  assert.equal(r.status,'FAIL');assert.equal(progress.matrix.status,'COMPLETE');
  assert.equal(progress.buffer.status,'COMPLETE');assert(progress.buffer.notApplicable>0);
  assert.equal(progress.observed.status,'COMPLETE');assert.equal(progress.observed.notApplicable,2);
  assert.equal(progress.impact.status,'MISSING');
  r.observed.microStopSeconds=null;
  progress=api.sectionProgress(r,machine,simulation);assert.equal(progress.observed.status,'PENDING');
  r.counterfactual={deltaOeePp:-1,deltaThroughput:0,run:{durationSeconds:3600,rounds:3}};
  assert.equal(api.sectionProgress(r,machine,simulation).impact.status,'COMPLETE');
  r.counterfactual.run.rounds=undefined;
  assert.equal(api.sectionProgress(r,machine,simulation).impact.status,'PENDING');
  const unknown=analyzeEquipmentReliability(simulation,'e',{audits:[],observed:null});
  assert.equal(api.sectionProgress(unknown,machine,simulation).buffer.status,'MISSING');
  h.open(20,12);
  const fills=[...h.body.querySelectorAll('[data-intervention-zone]')].map(el=>el.getAttribute('fill'));
  assert.deepEqual(fills,['var(--matrix-joint-fill)','var(--matrix-mttr-fill)','var(--matrix-mtbf-fill)','var(--matrix-keep-fill)']);
 }finally{h.close();}
});

test('equipment analysis tables use intrinsic column widths and normal recommendation typography',()=>{
 const h=harness();try{
  h.open(20,12);
  const style=h.w.document.querySelector('style').textContent;
  assert.match(style,/#equipment-analysis-body table\s*\{\s*width:auto;\s*max-width:100%;\s*table-layout:auto;/);
  assert.match(style,/\.table-scroll\s*\{[^}]*width:fit-content/);
  assert.match(style,/--intervention-chart-width:735px/);
  assert.match(style,/\.intervention-current\s*\{[^}]*font-size:var\(--font-body\)[^}]*font-weight:var\(--weight-regular\)/);
  assert.equal(h.body.querySelector('.intervention-current').tagName,'P');
  const tables=[...h.body.querySelectorAll('table')];
  assert(tables.length>0);
  for(const table of tables){
   const values=[...table.querySelectorAll('tbody td:nth-child(2)')];
   assert(values.length>0&&values.every(cell=>cell.classList.contains('analysis-table-value')));
   assert([...table.querySelectorAll('tbody td:last-child')].every(cell=>cell.classList.contains('analysis-table-unit')));
  }
 }finally{h.close();}
});
