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
  return {models:[{id:'source',name:'Filler',nominalRatePerSecond:2.4},{id:'belt',type:'CONVEYOR',processData:data},{id:'sink',name:'Capper',nominalRatePerSecond:2}],
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
  w.eval(script('Subsection'));w.eval(script('ConveyorAnalysis'));
  return {w,api:w.STConveyorAnalysis,body:w.document.getElementById('conveyor-analysis-body'),close:()=>w.close()};
}
test('each pending result has its own dependency trace and terminal input source',()=>{
  const h=harness();try{
    const ctx=context([fixture('Format A',{missingFirstPackage:true})]),worksheet=h.api.calculate(ctx);
    const trace=h.api.createPendingTrace(worksheet,ctx);
    assert.equal(trace.describe('L16',0),'');
    assert.match(trace.describe('L62',0),/Time to First Package After Restart.*Upstream/);
    assert.match(trace.describe('L66',0),/\(L62\)/);
    assert.match(trace.describe('K8'),/\(L70\)/);
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
    const ctx=context([fixture('Format A'),fixture('Format B',{dischargePitch:30})]);
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
    let ctx=context([fixture('No speed margin',{infeedPitch:30})]);
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
