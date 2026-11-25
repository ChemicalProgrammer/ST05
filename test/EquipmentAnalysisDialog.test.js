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

test('equipment analysis tables fill the subsection with shared column sizing and normal recommendation typography',()=>{
 const h=harness();try{
  h.open(20,12);
  const style=h.w.document.querySelector('style').textContent;
  assert.match(style,/#equipment-analysis-body table\s*\{\s*width:100%;\s*max-width:100%;\s*table-layout:fixed;/);
  assert.match(style,/#equipment-analysis-body \.table-scroll\s*\{[^}]*justify-self:stretch;[^}]*width:100%;[^}]*max-width:100%;[^}]*overflow-x:auto/);
  assert.match(style,/col\.analysis-table-parameter-col\s*\{width:42%;/);
  assert.match(style,/col\.analysis-table-value-col\s*\{width:46%;/);
  assert.match(style,/col\.analysis-table-unit-col\s*\{width:12%;/);
  assert.match(style,/\.analysis-table-value\s*\{[^}]*text-align:start/);
  assert.match(style,/\.analysis-table-value\.numeric\s*\{[^}]*text-align:right/);
  assert.match(style,/\.analysis-table-unit\s*\{[^}]*text-align:center/);
  assert.match(style,/--intervention-chart-width:735px/);
  assert.match(style,/\.intervention-current\s*\{[^}]*font-size:var\(--font-body\)[^}]*font-weight:var\(--weight-regular\)/);
  assert.equal(h.body.querySelector('.intervention-current').tagName,'P');
  const tables=[...h.body.querySelectorAll('table')];
  assert(tables.length>0);
  for(const table of tables){
   assert.deepEqual([...table.querySelectorAll('colgroup > col')].map(col=>col.className),
     ['analysis-table-parameter-col','analysis-table-value-col','analysis-table-unit-col']);
   const values=[...table.querySelectorAll('tbody td:nth-child(2)')];
   assert(values.length>0&&values.every(cell=>cell.classList.contains('analysis-table-value')));
   assert([...table.querySelectorAll('tbody td:last-child')].every(cell=>cell.classList.contains('analysis-table-unit')));
  }
 }finally{h.close();}
});

test('buffer coverage displays connected conveyor names instead of internal IDs in either language',()=>{
 const h=harness();try{
  const machine={id:'e',name:'Machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:20,mttrMinutes:.5}}};
  const upstream={id:'private-upstream-id',name:'Conveyor to filler',type:'CONVEYOR'};
  const downstream={id:'private-downstream-id',name:'Filler discharge conveyor',type:'CONVEYOR'};
  const unnamed={id:'private-unnamed-id',name:'  ',type:'CONVEYOR'};
  const simulation={equipment:[upstream,machine,downstream,unnamed]};
  const audits=[
    {equipmentId:upstream.id,downstreamId:'e',engineering:{calculated:{antiBlockSeconds:24}}},
    {equipmentId:downstream.id,upstreamId:'e',engineering:{calculated:{antiStarveSeconds:43}}},
    {equipmentId:unnamed.id,upstreamId:'e',engineering:{calculated:{antiStarveSeconds:45}}}
  ];
  h.w.STEquipmentAnalysis.open(simulation,'e',{audits});
  const readBuffer=()=>[...h.body.querySelectorAll('[data-analysis-group="buffer"] table')];
  let tables=readBuffer();
  assert.equal(tables.length,2);
  assert.equal(tables[0].querySelector('tbody tr:nth-child(2) td').textContent,upstream.name);
  assert.equal(tables[1].querySelector('tbody tr:nth-child(2) td').textContent,downstream.name+', Unnamed conveyor');
  assert(!tables.some(table=>table.textContent.includes('private-')));
  assert.equal(tables[0].querySelector('tbody tr:first-child td').textContent,'FAIL');
  assert.equal(tables[1].querySelector('tbody tr:first-child td').textContent,'PASS');
  h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
  tables=readBuffer();
  assert.equal(tables[0].querySelector('tbody tr:nth-child(2) td').textContent,upstream.name);
  assert.equal(tables[1].querySelector('tbody tr:nth-child(2) td').textContent,downstream.name+', Conveyor sin nombre');
 }finally{h.close();}
});

test('buffer coverage omits inapplicable tables but preserves completed technical FAIL results',()=>{
 const h=harness();try{
  const machine={id:'e',name:'Machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:20,mttrMinutes:12}}};
  const belt={id:'c',name:'Discharge conveyor',type:'CONVEYOR'};
  const simulation={equipment:[machine,belt]};
  const audits=[{equipmentId:'c',upstreamId:'e',engineering:{calculated:{antiStarveSeconds:28.21}}}];
  h.w.STEquipmentAnalysis.open(simulation,'e',{audits});
  const buffer=()=>h.body.querySelector('[data-analysis-group="buffer"]');
  assert.equal(buffer().dataset.completeness,'COMPLETE');
  assert.equal(buffer().querySelectorAll('table').length,1);
  assert.match(buffer().textContent,/Upstream — anti-block · Not applicable: No upstream conveyor connected/);
  assert.doesNotMatch(buffer().textContent,/Not evaluated/i);
  assert.match(buffer().querySelector('table').textContent,/FAIL/);
  assert.match(buffer().querySelector('table').textContent,/Discharge conveyor/);
  h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
  assert.match(buffer().textContent,/Aguas arriba — anti-block · No aplica/);
  assert.equal(buffer().querySelectorAll('table').length,1);
 }finally{h.close();}
});

test('buffer coverage differentiates unresolved geometry, missing MTTR and inapplicable directions',()=>{
 const h=harness();try{
  const machine={id:'e',name:'Machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:20,mttrMinutes:12}}};
  const upstream={id:'u',name:'Feed conveyor',type:'CONVEYOR'},downstream={id:'d',name:'Discharge conveyor',type:'CONVEYOR'};
  const simulation={equipment:[upstream,machine,downstream]};
  const api=h.w.STEquipmentAnalysis;
  const buffer=()=>h.body.querySelector('[data-analysis-group="buffer"]');
  const valid=[{equipmentId:'u',downstreamId:'e',engineering:{calculated:{antiBlockSeconds:800}}}];
  api.open(simulation,'e',{audits:valid});
  assert.equal(buffer().dataset.completeness,'PENDING');
  assert.equal(buffer().querySelectorAll('table').length,1);
  assert.match(buffer().textContent,/Downstream — anti-starve · Not evaluated: Connected conveyor geometry is unresolved. Connected conveyors: Discharge conveyor/);
  assert.doesNotMatch(buffer().textContent,/Downstream — anti-starve · Not applicable/);
  api.open(simulation,'e',{audits:[{equipmentId:'d',upstreamId:'e',engineering:null}]});
  assert.equal(buffer().dataset.completeness,'MISSING');
  assert.equal(buffer().querySelectorAll('table').length,0);
  assert.match(buffer().textContent,/Feed conveyor/);
  assert.match(buffer().textContent,/Discharge conveyor/);
  api.open({equipment:[upstream,{...machine,noiseProfile:{reliability:{mtbfMinutes:20}}},downstream]},'e',{audits:valid});
  assert.equal(buffer().dataset.completeness,'MISSING');
  assert.equal(buffer().querySelectorAll('table').length,0);
  assert.match(buffer().textContent,/Valid active MTBF and MTTR are required/);
  api.open({equipment:[machine]},'e',{audits:[]});
  assert.equal(buffer().dataset.completeness,'NOT_APPLICABLE');
  assert.equal(buffer().querySelectorAll('table').length,0);
  assert.match(buffer().textContent,/No upstream conveyor connected/);
  assert.match(buffer().textContent,/No downstream conveyor connected/);
  api.open({...simulation,dynamicConfig:{reliabilityEnabled:false}},'e',{audits:valid});
  assert.equal(buffer().dataset.completeness,'NOT_APPLICABLE');
  assert.equal(buffer().querySelectorAll('table').length,0);
  assert.match(buffer().textContent,/Not applicable: Reliability failures are disabled/);
 }finally{h.close();}
});

test('reliability quadrant and technical verdict are independent; export retains both',()=>{
 const h=harness();try{
  const makeMachine=(id,name,mttr)=>({id,name,type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:40,mttrMinutes:mttr}}});
  const a=makeMachine('a','A',1),b=makeMachine('b','B',5),belt={id:'c',name:'Connection',type:'CONVEYOR'};
  const simulation={id:'case-a',name:'Line A',equipment:[a,belt,b],dynamicConfig:{initialFormatId:'f'}};
  const audits=[{equipmentId:'c',upstreamId:'a',downstreamId:'b',engineering:{calculated:{antiStarveSeconds:90,antiBlockSeconds:120}}}];
  const evidence=(count,seconds)=>({basis:'NUMERICAL_FRAME',durationSeconds:600,failureCount:count,failureSeconds:seconds});
  const observationsByEquipmentId={a:evidence(1,20),b:evidence(3,120)};
  const api=h.w.STEquipmentAnalysis;
  api.open(simulation,'a',{audits,observed:observationsByEquipmentId.a,observationsByEquipmentId,origin:'NUMERICAL_FRAME'});
  b.noiseProfile.reliability.mttrMinutes=1;observationsByEquipmentId.b.failureCount=99;
  const single=api.buildEvaluationExport(),all=api.buildEvaluationExport('ALL');
  assert.equal(single.schema,'st-equipment-analysis-v1');assert.equal(single.scope,'SINGLE');
  assert.equal(single.evaluations.length,1);assert.equal(all.evaluations.length,2);
  assert.equal(all.source.origin,'NUMERICAL_FRAME');assert.equal(all.source.activeFormatId,'f');
  assert.deepEqual(JSON.parse(JSON.stringify(all.summary.statusCounts)),{PASS:0,REVIEW:1,FAIL:1,'NOT EVALUATED':0});
  assert.deepEqual(JSON.parse(JSON.stringify(single.evaluations[0])),JSON.parse(JSON.stringify(all.evaluations[0])));
  assert.equal(all.evaluations[0].interventionRegion,'RELIABILITY');assert.equal(all.evaluations[1].interventionRegion,'RELIABILITY');
  assert.equal(all.evaluations[0].report.observed.failureCount,1);assert.equal(all.evaluations[1].report.observed.failureCount,3);
  assert.equal(all.evaluations[1].report.mttrMinutes,5);
  assert.equal(all.evaluations[0].report.bufferCoverage[0].status,'NOT_APPLICABLE');
  assert.equal(all.evaluations[0].report.bufferCoverage[1].connectedConveyors[0].name,'Connection');
  assert.equal(all.evaluations[1].report.bufferCoverage[0].status,'FAIL');
  assert.equal(all.evaluations[1].completeness.buffer.status,'COMPLETE');
  assert.equal(all.policy.availabilityTarget,.95);
  api.open(simulation,'a',{audits,observed:evidence(1,20),origin:'NUMERICAL_FRAME'});
  assert.equal(api.buildEvaluationExport('ALL').evaluations[1].report.observed,null);
  api.open({...simulation,dynamicConfig:{reliabilityEnabled:false}},'a',{audits});
  assert.equal(api.buildEvaluationExport('ALL').summary.statusCounts['NOT EVALUATED'],2);
  h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
  assert.equal(h.w.document.getElementById('equipment-analysis-export-one').textContent,'Este equipo (JSON)');
  assert.equal(h.w.document.getElementById('equipment-analysis-export-all').textContent,'Todos los equipos (JSON)');
 }finally{h.close();}
});

test('equipment JSON menu downloads individual and all-machine reports',()=>{
 const h=harness();try{
  h.open(40,1);
  const downloads=[],blobs=[];
  h.w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:test';};
  h.w.URL.revokeObjectURL=()=>{};
  h.w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  const menu=h.w.document.getElementById('equipment-analysis-export-menu');
  menu.open=true;h.w.document.getElementById('equipment-analysis-export-one').click();
  assert.equal(menu.open,false);assert.equal(downloads[0],'equipment-analysis-Test-machine.json');
  menu.open=true;h.w.document.getElementById('equipment-analysis-export-all').click();
  assert.equal(menu.open,false);assert.equal(downloads[1],'equipment-analysis-all-equipment.json');
  assert.equal(blobs.length,2);assert(blobs.every(b=>b.type==='application/json'));
 }finally{h.close();}
});

test('direct editor export uses the current draft without opening or replacing the analysis dialog',()=>{
 const h=harness();try{
  const api=h.w.STEquipmentAnalysis,dialog=h.w.document.getElementById('equipment-analysis-dialog'),downloads=[];
  h.w.URL.createObjectURL=()=> 'blob:test';h.w.URL.revokeObjectURL=()=>{};
  h.w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download);};
  const equipment=[{id:'draft',name:'Draft machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:40,mttrMinutes:5}}},{id:'belt',type:'CONVEYOR'}];
  const simulation={equipment};
  let report=api.downloadLineEvaluation(simulation,{audits:[]});
  assert.equal(dialog.open,false);assert.equal(report.scope,'ALL');assert.equal(report.evaluations.length,1);
  assert.equal(report.evaluations[0].name,'Draft machine');assert.equal(report.evaluations[0].status,'FAIL');
  h.open(40,1);report=api.downloadLineEvaluation(simulation,{audits:[]});
  assert.equal(api.buildEvaluationExport().evaluations[0].name,'Test machine');
  assert.equal(report.evaluations[0].name,'Draft machine');assert.equal(downloads.length,2);
  assert.throws(()=>api.downloadLineEvaluation({equipment:[equipment[1]]}),/no machines/i);
 }finally{h.close();}
});

test('line matrix plots every valid machine on common axes and highlights only the selected equipment',()=>{
 const h=harness();try{
  const m=(id,name,bf,tr,type='CUSTOM')=>({id,name,type,nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:bf,mttrMinutes:tr}}});
  const equipment=[
   m('s','Scrambler',37.6,17.26),m('v','Virtual inlet',4.5,.5,'FEEDER'),
   m('f','Filler',13.6,.9,'FILLER'),m('p','Case Packer',10.5,1.11,'CASE_PACKER'),
   m('z','Palletizer',38.2,1.2,'PALLETIZER'),m('pass','Reliable machine',240,1),
   m('far','Outlier',.001,1000000),m('missing','Missing inputs',20,undefined),
   m('belt','Conveyor',20,1,'CONVEYOR'),{...m('role','Conveyor by role',20,1),processData:{role:'CONVEYOR'}}];
  const simulation={equipment},api=h.w.STEquipmentAnalysis;
  const markers=()=>[...h.body.querySelectorAll('[data-equipment-marker]')];
  const keys=()=>[...h.body.querySelectorAll('[data-matrix-equipment-id]')];
  const coords=()=>Object.fromEntries(markers().map(el=>[el.dataset.equipmentId,[el.getAttribute('cx'),el.getAttribute('cy')]]));
  api.open(simulation,'f',{audits:[]});
  assert.equal(markers().length,7);assert.equal(keys().length,8);
  assert.deepEqual(markers().filter(el=>el.dataset.currentEquipment==='true').map(el=>el.dataset.equipmentId),['f']);
  assert.equal(markers().at(-1).dataset.equipmentId,'f');
  assert.equal(markers().at(-1).dataset.evaluation,'FAIL');
  const palletizer=markers().find(el=>el.dataset.equipmentId==='z');
  assert.equal(palletizer.dataset.evaluation,'REVIEW');assert.match(palletizer.querySelector('title').textContent,/Palletizer · REVIEW · MTBF 38.2 min · MTTR 1.2 min · Ai 96.95%/);
  assert.equal(markers().find(el=>el.dataset.equipmentId==='pass').dataset.evaluation,'PASS');
  assert(Number(markers().at(-1).getAttribute('r'))>Number(palletizer.getAttribute('r')));
  assert.match(h.body.querySelector('[data-current-equipment-label]').textContent,/Filler/);
  assert.equal(keys().find(el=>el.dataset.matrixEquipmentId==='missing').dataset.evaluation,'NOT EVALUATED');
  assert(!markers().some(el=>['belt','role','missing'].includes(el.dataset.equipmentId)));
  for(const el of markers()){
   const x=Number(el.getAttribute('cx')),y=Number(el.getAttribute('cy'));
   assert(x>75&&x<705&&y>22&&y<316);
  }
  const original=coords();
  api.open(simulation,'z',{audits:[]});assert.deepEqual(coords(),original);
  assert.deepEqual(markers().filter(el=>el.dataset.currentEquipment==='true').map(el=>el.dataset.equipmentId),['z']);
  api.open(simulation,'missing',{audits:[]});assert.equal(markers().length,7);
  assert.equal(markers().filter(el=>el.dataset.currentEquipment==='true').length,0);
  assert.equal(keys().find(el=>el.dataset.currentEquipment==='true').dataset.matrixEquipmentId,'missing');
  assert.match(h.body.querySelector('[data-analysis-group="matrix"]').textContent,/not plotted/);
  api.open({...simulation,dynamicConfig:{reliabilityEnabled:false}},'f',{audits:[]});
  assert.equal(markers().length,0);assert(keys().every(el=>el.dataset.evaluation==='NOT EVALUATED'));
 }finally{h.close();}
});

test('line matrix applies the same custom screening policy and active failure categories to all points',()=>{
 const h=harness();try{
  const general={id:'a',name:'General machine',type:'FILLER',noiseProfile:{reliability:{mtbfMinutes:40,mttrMinutes:1}}};
  const split={id:'b',name:'Split machine',type:'CUSTOM',noiseProfile:{reliability:{mtbfMinutes:20,mttrMinutes:3}},processData:{equipment:{stopInputs:{minor:{mtbfMinutes:40,mttrMinutes:1},major:{mtbfMinutes:40,mttrMinutes:5}}}}};
  const policy={availabilityTarget:.98,mtbfTargetMinutes:30,mttrTargetMinutes:2};
  const simulation={equipment:[general,split],dynamicConfig:{reliabilityCategories:{minor:true,major:false}}};
  h.w.STEquipmentAnalysis.open(simulation,'a',{policy,audits:[]});
  const peer=h.body.querySelector('[data-equipment-marker][data-equipment-id="b"]');
  assert.equal(peer.dataset.evaluation,'FAIL');
  assert.equal(Number(peer.dataset.mtbf),40);assert.equal(Number(peer.dataset.mttr),1);
  assert.equal(Number(h.body.querySelector('[data-availability-target]').dataset.availabilityTarget),.98);
  h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
  assert.match(h.body.querySelector('[data-equipment-marker][data-equipment-id="b"] title').textContent,/NO CUMPLE/);
 }finally{h.close();}
});

test('matrix uses two vertical legend lists, passive markers and icons before every quadrant title',()=>{
 const h=harness();try{
  const machines=[{id:'a',name:'Scrambler',type:'CUSTOM',noiseProfile:{reliability:{mtbfMinutes:37.6,mttrMinutes:17.26}}},
    {id:'b',name:'Palletizer',type:'PALLETIZER',noiseProfile:{reliability:{mtbfMinutes:38.2,mttrMinutes:1.2}}},
    {id:'c',name:'Missing inputs',type:'CUSTOM'}];
  h.w.STEquipmentAnalysis.open({equipment:machines},'a',{audits:[]});
  const readMatrix=()=>h.body.querySelector('[data-analysis-group="matrix"]');
  let matrix=readMatrix(),columns=[...matrix.querySelectorAll('.intervention-keys > .intervention-key-column')];
  assert.equal(columns.length,2);
  assert.equal(columns[0].querySelector('.intervention-key-heading').textContent,'Legend');
  assert.equal(columns[1].querySelector('.intervention-key-heading').textContent,'Equipment');
  assert(columns.every(c=>c.querySelector('.intervention-key-heading > svg.icon')));
  const legend=columns[0].querySelector('ul.intervention-legend');
  const equipment=columns[1].querySelector('ul.intervention-equipment-key');
  assert.deepEqual([...legend.children].map(el=>el.textContent),['Ai target 95%','PASS','REVIEW','FAIL','NOT EVALUATED']);
  assert.deepEqual([...equipment.children].map(el=>el.textContent),['Scrambler · FAIL','Palletizer · REVIEW','Missing inputs · NOT EVALUATED']);
  const markers=[...matrix.querySelectorAll('[data-equipment-marker]')];
  assert.equal(markers.length,2);
  assert(markers.every(el=>!el.hasAttribute('tabindex')&&!el.hasAttribute('onclick')&&el.querySelector('title')));
  assert([...equipment.children].every(el=>!el.hasAttribute('tabindex')&&el.title));
  assert.equal(matrix.querySelector('[data-equipment-marker][data-current-equipment="true"]').dataset.equipmentId,'a');
  const zones=[...matrix.querySelectorAll('[data-zone-heading]')];
  assert.deepEqual(zones.map(el=>el.getAttribute('data-zone-heading')),['JOINT','MTTR','MTBF','KEEP']);
  assert.deepEqual(zones.map(el=>el.querySelector('.zone-title > span').textContent),['Joint intervention','Maintainability','Reliability','Keep / monitor']);
  for(const [i,icon] of ['warning','settings','pulse','check'].entries()){
   const holder=h.w.document.createElement('div');holder.innerHTML=h.w.STIcons.svg(icon);
   const title=zones[i].querySelector('.zone-title');
   assert.equal(title.firstElementChild.localName,'svg');
   assert.equal(title.firstElementChild.querySelector('path').getAttribute('d'),holder.querySelector('path').getAttribute('d'));
  }
  const style=h.w.document.querySelector('style').textContent;
  for(const [status,color] of [['pass','#22c55e'],['review','#f97316'],['fail','#ef4444']]){
   assert(style.includes('.matrix-status-'+status+' { --matrix-point-color:'+color+'; }'));
   assert(legend.querySelector('.matrix-status-'+status+' .intervention-dot'));
  }
  assert(matrix.querySelector('[data-current-equipment="true"].equipment-point').classList.contains('matrix-status-fail'));
  assert(matrix.querySelector('.equipment-point-ring'));
  assert(equipment.querySelector('[data-current-equipment="true"] .is-current'));
  assert.doesNotMatch(legend.textContent,/Current equipment/);
  assert.match(style,/\.intervention-keys\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\)/);
  assert.match(style,/\.intervention-legend,\.intervention-equipment-key\)\s*\{[^}]*display:grid/);
  h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
  matrix=readMatrix();
  assert.deepEqual([...matrix.querySelectorAll('.intervention-key-heading')].map(el=>el.textContent),['Leyenda','Equipos']);
  assert.deepEqual([...matrix.querySelectorAll('[data-zone-heading] .zone-title > span')].map(el=>el.textContent),['Intervención conjunta','Mantenibilidad','Confiabilidad','Conservar / monitorear']);
  assert.doesNotMatch(matrix.querySelector('.intervention-legend').textContent,/Equipo actual|Current equipment/);
  assert.equal(matrix.querySelector('.intervention-equipment-key .is-current').closest('li').dataset.matrixEquipmentId,'a');
 }finally{h.close();}
});
