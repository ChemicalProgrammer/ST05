import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=name=>fs.readFileSync('apps-script/'+name+'.html','utf8');
const script=name=>read(name).match(/<script>([\s\S]*?)<\/script>/)[1];

function fixture(name='Format A',options={}){
  const data={geometry:{lactMm:10000,lpPrimeMm:1000,actualDischargeMm:100,actualCodingMm:150},
    flowUnits:{input:options.unit||'BOTTLES',output:options.unit||'BOTTLES'},
    upstream:{dischargeVelocityMPerMinute:7.2},
    accumulation:{restartToFirstPackageSeconds:options.firstPackage===undefined?2:options.firstPackage,speedMode:'MANUAL'}};
  const input={packageLengthMm:30,upstreamDischargePitchMm:options.dischargePitch??50,downstreamInfeedPitchMm:options.infeedPitch??60,
    conveyorSpeedFactorPercent:0,codingSpeedFactorPercent:0,accumulationSpeedFactorPercent:0,
    blockedTimeDelaySeconds:.5,clearTimeDelaySeconds:.5,bottlesDischargedAtStop:1,insuranceFactorUnits:1,upstreamStartupTimeSeconds:1,downstreamRampUpSeconds:2};
  if(options.missingFirstPackage)delete data.accumulation.restartToFirstPackageSeconds;
  const zone={usableLengthMm:10000,primeSensorPositionMm:9000,backupSensorPositionMm:500,productLengthMm:30,productPitchMm:50,
    conveyorSpeedMmPerSecond:120,upstreamControlEquipmentId:'source',downstreamControlEquipmentId:'sink',engineering:{input}};
  return {models:[{id:'source',name:'Filler',nominalRatePerSecond:options.upstreamRate??2.4},{id:'belt',type:'CONVEYOR',processData:data},{id:'sink',name:'Capper',nominalRatePerSecond:options.downstreamRate??2}],
    zones:[null,zone,null],format:{id:name,name,bottlesPerCase:options.bottlesPerCase}};
}
function context(profiles){
  return {zone:profiles[0].zones[1],data:profiles[0].models[1].processData,index:1,designProfiles:profiles};
}
function harness(){
  const dom=new JSDOM(read('ConveyorAnalysis'),{runScripts:'outside-only'}),w=dom.window;
  w.SimulatorEngine={productPackSize:f=>f.bottlesPerCase};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.eval(script('Icons'));w.eval(script('Subsection'));w.eval(script('ConveyorAnalysis'));
  return {w,api:w.STConveyorAnalysis,body:w.document.getElementById('conveyor-analysis-body'),close:()=>w.close()};
}
test('each pending result has its own dependency trace and terminal input source',()=>{
  const h=harness();try{
    const ctx=context([fixture('Format A',{missingFirstPackage:true})]),worksheet=h.api.calculate(ctx);
    const trace=h.api.createPendingTrace(worksheet,ctx);
    assert.equal(trace.describe('L16',0),'');
    assert.match(trace.describe('L62',0),/Time to First Package After Restart.*Upstream/);
    assert.match(trace.describe('L66',0),/Time for Upstream Machine to Make Packages in Process/);
    assert.match(trace.describe('K8'),/Recovery Distance/);
    assert(!/\b[FLDEIK]\d+\b/.test(trace.describe('K8')),'no spreadsheet cell references in user help');
    assert.match(trace.describe('K8'),/Time to First Package After Restart/);
    h.api.open('belt',ctx);
    const cells=[...h.body.querySelectorAll('td.conveyor-value-pending')];
    assert(cells.length>0);
    assert(cells.every(cell=>cell.title&&cell.tabIndex===0&&cell.hasAttribute('aria-label')));
    assert.equal(h.body.querySelector('[data-cell="L62"] td').textContent,'Pending');
    assert.match(h.body.querySelector('[data-cell="L62"] td').title,/Time to First Package After Restart/);
    assert.match(h.api.createPendingTrace(worksheet,ctx,'es').describe('L62',0),/Captura Time to First Package After Restart/);
    const tables=[...h.body.querySelectorAll('table')];
    assert.equal(tables.length,10);
    assert(tables.every(table=>table.querySelectorAll('colgroup col').length===3));
  }finally{h.close();}
});
test('multi-format partial extrema identify the affected format and invalid physical conditions',()=>{
  const h=harness();try{
    const ctx=context([fixture('Format A'),fixture('Format B',{upstreamRate:4})]);
    const worksheet=h.api.calculate(ctx),trace=h.api.createPendingTrace(worksheet,ctx);
    assert(Number.isFinite(worksheet.geometry.overflow.value));
    assert.equal(worksheet.geometry.overflow.partial,true);
    assert.match(trace.describe('L58',1),/Format B/);
    assert.match(trace.describe('L58',1),/below 100%/);
    assert.match(trace.describe('F8'),/Partial result/);
    assert.match(trace.describe('F8'),/Format B/);
    assert.match(trace.describe('F8'),/below 100%/);
    h.api.open('belt',ctx);
    const cell=h.body.querySelector('[data-cell="F8"] td');
    assert(cell.classList.contains('conveyor-value-partial'));
    assert.match(cell.title,/Format B/);
    assert.equal(h.body.querySelector('[data-cell="L58"]').closest('table').querySelectorAll('colgroup col').length,4);
  }finally{h.close();}
});
test('recovery speed and missing case pack factor are distinguished from absent input rows',()=>{
  const h=harness();try{
    let ctx=context([fixture('No speed margin',{downstreamRate:4})]);
    let worksheet=h.api.calculate(ctx),trace=h.api.createPendingTrace(worksheet,ctx);
    assert.match(trace.describe('L68',0),/Conveyor Speed must exceed Machine Package Consumption Rate/);
    ctx=context([fixture('Case format',{unit:'CASES'})]);
    worksheet=h.api.calculate(ctx);trace=h.api.createPendingTrace(worksheet,ctx);
    assert.match(trace.describe('L22',0),/bottles-per-case/);
    assert.equal(trace.describe('L24',0),'','Native flow does not depend on bottle-equivalent conversion');
  }finally{h.close();}
});
test('zero-length sections do not create a false dependency on their conveyor speeds',()=>{
  const h=harness();try{
    const profile=fixture();
    profile.models[1].processData.geometry.actualDischargeMm=0;
    profile.models[1].processData.geometry.actualCodingMm=0;
    delete profile.zones[1].engineering.input.conveyorSpeedFactorPercent;
    delete profile.zones[1].engineering.input.codingSpeedFactorPercent;
    const ctx=context([profile]),worksheet=h.api.calculate(ctx),trace=h.api.createPendingTrace(worksheet,ctx);
    for(const ref of ['L53','L54','L63','L64'])assert.equal(trace.describe(ref,0),'',ref);
  }finally{h.close();}
});

test('equal package length and discharge pitch do not imply 100% belt population',()=>{
  const h=harness();try{
    const profile=fixture('Case conveyor',{unit:'CASES',bottlesPerCase:12,dischargePitch:30,upstreamRate:.5,downstreamRate:.5});
    delete profile.models[1].processData.upstream.dischargeVelocityMPerMinute;
    const ctx=context([profile]),worksheet=h.api.calculate(ctx),p=worksheet.profiles[0];
    assert(Math.abs(p.population-.125)<1e-12);
    assert.equal(p.rate,30);
    assert.equal(p.highRate,30);
    assert.equal(p.dischargeBpm,360);
    assert.equal(p.highSpeedBpm,360);
    assert.equal(p.dischargeVelocitySource,'NOMINAL_RATE_AND_PITCH');
    assert.equal(p.dischargeVelocity,.9);
    assert.equal(p.beltCapacityAtDischargePitchPackagesPerMinute,240);
    assert(Number.isFinite(p.overflow));
    assert.equal(worksheet.geometry.status,'PASS');
    h.api.open('Case conveyor',ctx);
    assert.match(h.body.querySelector('[data-cell="L41"] td').title,/AF not configured/);
    assert.match(h.body.querySelector('[data-cell="L23"] td').title,/Configured upstream machine rate/);
  }finally{h.close();}
});
test('measured AF is a local speed, and real nominal-flow saturation remains unresolved',()=>{
  const h=harness();try{
    const profile=fixture('Saturated',{unit:'CASES',bottlesPerCase:12,dischargePitch:30,upstreamRate:4});
    const ctx=context([profile]),worksheet=h.api.calculate(ctx),p=worksheet.profiles[0];
    assert.equal(p.rate,240);
    assert.equal(p.population,1);
    assert.equal(p.dischargeVelocity,7.2);
    assert.equal(p.dischargeVelocitySource,'CONFIGURED_AF');
    assert.equal(worksheet.geometry.status,'NOT EVALUATED');
    assert(!Number.isFinite(p.overflow));
    assert.match(h.api.createPendingTrace(worksheet,ctx).describe('L58',0),/below 100%/);
    assert.match(h.api.profilePopulationHelp(p),/not a missing Overflow input/);
  }finally{h.close();}
});
test('resolved machine input/output rates, not conveyor speed, determine physical flow and infeed recommendation',()=>{
  const h=harness();try{
    const profile=fixture('Bottles entering packer',{dischargePitch:80,infeedPitch:100});
    const input=profile.zones[1].engineering.input;
    input.upstreamNominalSpeedBpm=120;input.downstreamHighSpeedBpm=144;
    const downstream=profile.models[2];downstream.nominalRatePerSecond=.2;downstream.processData={productInputRatePerSecond:2.4,flowUnits:{input:'BOTTLES',output:'CASES'}};
    profile.models[1].processData.upstream.dischargeVelocityMPerMinute=9.6;
    const p=h.api.calculate(context([profile])).profiles[0];
    assert.equal(p.rate,120);assert.equal(p.highRate,144);
    assert.equal(p.flow,60);assert.equal(p.consumption,72);
    assert.equal(p.population,.5);
    assert.equal(p.infeedVelocity,14.4);
    assert(Math.abs(h.api.recommendedSpeed(p)-15.12)<1e-10);
    delete input.upstreamNominalSpeedBpm;delete input.downstreamHighSpeedBpm;
    const fallback=h.api.calculate(context([profile])).profiles[0];
    assert.equal(fallback.rate,144);assert.equal(fallback.highRate,144);
    delete profile.models[0].nominalRatePerSecond;
    const ctx=context([profile]),missing=h.api.calculate(ctx);
    assert(!Number.isFinite(missing.profiles[0].population));
    assert.match(h.api.createPendingTrace(missing,ctx).describe('L41',0),/nominal output rate/);
  }finally{h.close();}
});
test('JSON includes exact configuration, intermediate calculations and pending diagnostics for one or all conveyors',()=>{
  const h=harness();try{
    const first=fixture('Format A',{missingFirstPackage:true});
    const second={...first.models[1],id:'belt2',name:'Second belt'};
    const sink2={...first.models[2],id:'sink2',name:'Palletizer'};
    const models=[...first.models,second,sink2];
    const zones=[...first.zones,{...first.zones[1],upstreamControlEquipmentId:'sink',downstreamControlEquipmentId:'sink2'},null];
    const profile={...first,models,zones};
    const configuration={equipment:models,activeFormat:first.format,formats:[first.format]};
    const resolved={...profile,configuration,designProfiles:[profile]};
    const ctx=h.api.worksheetContext(resolved,1,{origin:'EQUIPMENT_EDITOR_DRAFT'});
    const single=JSON.parse(JSON.stringify(h.api.buildEvaluationExport(ctx,{scope:'SINGLE'})));
    assert.equal(single.schema,'st-conveyor-analysis-v1');
    assert.equal(single.evaluations.length,1);
    const e=single.evaluations[0];
    assert.equal(e.equipmentId,'belt');
    assert.equal(e.configuration.upstream.id,'source');
    assert.equal(e.configuration.downstream.id,'sink');
    assert.equal(e.configuration.activeResolved.zone.conveyorSpeedMmPerSecond,120);
    const row=e.formats[0].sections.flatMap(s=>s.rows).find(r=>r.ref==='L62');
    assert.equal(row.value,null);
    assert.equal(row.status,'PENDING');
    assert.match(row.diagnostic,/Time to First Package After Restart/);
    const all=h.api.buildEvaluationExport(ctx,{scope:'ALL'});
    assert.equal(all.summary.conveyors,2);
    assert.deepEqual(Array.from(all.evaluations,e=>e.equipmentId),['belt','belt2']);
    assert.equal(all.evaluations[1].configuration.downstream.id,'sink2');
    assert.equal(all.configuration.equipment.length,5);
    assert.equal(all.source.origin,'EQUIPMENT_EDITOR_DRAFT');
    assert.equal(models[1].processData.accumulation.restartToFirstPackageSeconds,undefined);
    h.api.open('belt',ctx);
    assert.equal(h.w.document.getElementById('conveyor-analysis-export-all').disabled,false);
  }finally{h.close();}
});

test('manual geometry sources keep the required overflow independent and report inadequate installed reserve',()=>{
  const h=harness();try{
    const profile=fixture(),ctx=context([profile]),data=profile.models[1].processData;
    const initial=h.api.calculate(ctx);
    assert(initial.geometry.overflow.value>0);
    const required=initial.geometry.overflow.value;
    data.accumulation.manualLbaMm=7000;
    const manual=h.api.calculate(ctx);
    assert.equal(manual.geometry.geometryMode,'MANUAL_LBA');
    assert.equal(manual.geometry.lbu,2000);assert.equal(manual.geometry.lba,7000);
    delete data.accumulation.manualLbaMm;data.accumulation.backupSensorPositionMm=2000;
    const installed=h.api.calculate(ctx);
    assert.equal(installed.geometry.geometryMode,'MANUAL_BACKUP');
    assert.equal(installed.geometry.lba,7000);
    assert.equal(installed.geometry.overflow.value,required);
    assert.equal(installed.geometry.recovery.value,manual.geometry.recovery.value);
    data.accumulation.backupSensorPositionMm=251;
    const insufficient=h.api.calculate(ctx);
    assert.equal(insufficient.geometry.status,'FAIL');
    assert.match(insufficient.geometry.statusReason,/Overflow disponible/);
    h.api.open('belt',ctx);
    const all=[...h.body.querySelectorAll('tbody th[scope=row]')];
    assert(all.length>40&&all.every(row=>row.title));
    assert(all.every(row=>!/\b[FLDEIK]\d+\b/.test(row.title)));
    const badge=h.body.querySelector('.conveyor-analysis-verdict');
    assert(badge.classList.contains('is-fail'));assert.equal(badge.style.backgroundColor,'');
  }finally{h.close();}
});

test('subsection completeness is independent of the engineering verdict and visible when collapsed',()=>{
  const h=harness();try{
    const profile=fixture('Complete format');
    profile.models[1].processData.geometry.lactMm=500;
    profile.zones[1].primeSensorPositionMm=-500;
    const ctx=context([profile]),worksheet=h.api.calculate(ctx);
    assert.equal(worksheet.geometry.status,'FAIL');
    const specs=h.api.sectionProgress(worksheet,ctx);
    assert.equal(specs.find(s=>s.key==='geometry').progress.status,'COMPLETE');
    h.api.open('belt',ctx);
    const groups=[...h.body.querySelectorAll('details[data-analysis-group]')];
    assert.equal(groups.length,11);
    assert(groups.every(group=>group.querySelector('summary .analysis-section-status .sheet-import-row-status svg')));
    assert.equal(groups[0].querySelector('.conveyor-analysis-verdict').textContent,'FAIL');
    assert.equal(groups[0].dataset.completeness,'COMPLETE');
    groups[0].open=false;
    assert.equal(groups[0].querySelector('summary .analysis-section-status').dataset.completeness,'COMPLETE');
    assert(groups.every(group=>group.querySelector('.subsection-description').textContent.length>15));
    assert(groups.every(group=>!group.querySelector('.subsection-description').textContent.startsWith('Format:')));
    assert.equal(h.body.querySelector('[data-analysis-group="package"] .worksheet-format-name').textContent,'Complete format');
    const report=h.api.buildEvaluationExport(ctx);
    assert.equal(report.evaluations[0].sectionProgress.find(s=>s.section==='geometry').status,'COMPLETE');
  }finally{h.close();}
});
test('pending and missing sections identify their unresolved parameters and formats',()=>{
  const h=harness();try{
    const full=fixture('Format A'),partial=fixture('Format B',{missingFirstPackage:true});
    const ctx=context([full,partial]);
    h.api.open('belt',ctx);
    const recovery=h.body.querySelector('[data-analysis-group="recovery"]');
    assert.equal(recovery.dataset.completeness,'PENDING');
    const indicator=recovery.querySelector('.analysis-section-status');
    assert.match(indicator.title,/Format B/);
    assert.match(indicator.title,/Time for Upstream Machine to Make Packages in Process/);
    assert.equal(indicator.querySelector('.sheet-import-row-status').dataset.status,'warning');
    const missing=fixture('Missing package length');
    delete missing.zones[1].engineering.input.packageLengthMm;delete missing.zones[1].productLengthMm;
    h.api.open('belt',context([missing]));
    assert.equal(h.body.querySelector('[data-analysis-group="package"]').dataset.completeness,'MISSING');
    assert.equal(h.body.querySelector('[data-analysis-group="package"] .sheet-import-row-status').dataset.status,'error');
    h.api.open('belt',{...context([full]),designProfiles:[]});
    assert.equal(h.body.querySelectorAll('details[data-analysis-group]').length,11);
    assert.equal(h.body.querySelector('[data-analysis-group="package"]').dataset.completeness,'MISSING');
    const excluded=fixture('Excluded');excluded.models[1].processData.productApplies=false;
    h.api.open('belt',context([excluded]));
    assert.equal(h.body.querySelector('[data-analysis-group="package"]').dataset.completeness,'NOT_APPLICABLE');
  }finally{h.close();}
});
test('unused segments do not demand additional inputs and labels are bilingual',()=>{
  const h=harness();try{
    const profile=fixture();
    profile.models[1].processData.geometry.actualDischargeMm=0;
    profile.models[1].processData.geometry.actualCodingMm=0;
    delete profile.zones[1].engineering.input.conveyorSpeedFactorPercent;
    delete profile.zones[1].engineering.input.codingSpeedFactorPercent;
    const ctx=context([profile]),worksheet=h.api.calculate(ctx);
    const speed=h.api.sectionProgress(worksheet,ctx).find(s=>s.key==='speed');
    assert.equal(speed.progress.status,'COMPLETE');
    assert(speed.progress.notApplicable>0);
    h.w.document.documentElement.lang='es';
    h.api.open('belt',ctx);
    const group=h.body.querySelector('[data-analysis-group="speed"]');
    assert.match(group.querySelector('.subsection-description').textContent,/Velocidad de banda/);
    assert.match(group.querySelector('.analysis-section-status').textContent,/Completo/);
    assert.equal(group.querySelector('[data-cell="L33"] td').textContent,'No aplica');
  }finally{h.close();}
});
