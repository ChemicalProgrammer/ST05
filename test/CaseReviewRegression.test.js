import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,fixture,calibration,row} from './helpers/RealDataHarness.js';
const source=name=>fs.readFileSync('apps-script/'+name+'.html','utf8').replace(/^<script>|<\/script>\s*$/g,'');

test('partial real data keeps unknown time dependencies and recalculates when a reported total is entered',()=>{
 const w=setup();try{
 const f=fixture(),record={...f.record,timeHierarchyEnabled:true,timeBreakdown:{external:{enabled:true},decision:{enabled:true}},timeOverrides:{unplanned:{enabled:true,valueSeconds:512*60}},aem:{scrapSeconds:0,reworkSeconds:0},effectiveRuntimeSeconds:600*60};
 let d=w.STRealData.compare(record,f.simulation,f.result,'average',{});
 assert(d.calibration.missing.some(x=>x.section==='external'));assert.equal(calibration(d,'adjusted'),null);
 assert.equal(w.STRealDataModel.timeHierarchy(w.STRealData.normalize(record),true).values.effective,null);
 record.timeOverrides.production={enabled:true,valueSeconds:86400};record.validation.reportedOeePercent=53.5;
 d=w.STRealData.compare(record,f.simulation,f.result,'average',{});
 assert(Math.abs(calibration(d,'adjusted')-55.635)<1e-8);
 assert(d.calibration.checks.some(x=>x.code==='REPORTED_EFFECTIVE_VS_TIME_BALANCE'));
 }finally{w.close();}
});
test('single product format exposes standard speed and converts bottle-equivalent output exactly once',()=>{
 const w=setup();try{const f=fixture(),result={...f.result,products:{rows:[{formatId:'s',bottlesPerCase:12}]},unitOfFlow:'cases'};
 const d=w.STRealData.compare(f.record,f.simulation,result,'average',{});
 assert.equal(row(d,'standard').simulated,220);assert.equal(row(d,'bottles').simulated,f.result.summary.outputCount);
 assert.equal(row(d,'cases').simulated,f.result.summary.outputCount/12);
 }finally{w.close();}
});
test('saved speed history restores a measured window independently of compact replay',()=>{
 const w={};new Function('window','STRunOptions',source('Charts'))(w,{windowSeconds:()=>60});
 const samples=Array.from({length:121},(_,i)=>({virtualSecond:i,equipment:[{id:'m',actualRatePerSecond:i%5,meanRatePerSecond:i%5}]}));
 const state={activeCase:{equipment:[{id:'m'}]},uiView:'simulation',run:{result:{samples,seed:17},sampleIndex:120,roundIndex:0,playing:false}};
 const charts=w.STCharts(state,String),history=charts.captureSpeedHistory();assert.equal(history.rows.length,61);
 state.run.result={samples:[samples[0],samples[120]],seed:17};state.run.sampleIndex=1;
 charts.restoreSpeedHistory(history);assert.deepEqual(charts.captureSpeedHistory().rows,history.rows);
 state.run.result={...state.run.result,seed:18};assert.notDeepEqual(charts.captureSpeedHistory().rows,history.rows);
});
test('case export includes only requested derived reports and keeps original record unchanged',()=>{
 const w={STEquipmentAnalysis:{buildLineEvaluation:s=>({id:s.id,evaluations:[{}]})},STConveyorAnalysis:{resolveProfiles:()=>({}),worksheetContext:()=>({}),buildEvaluationExport:()=>({evaluations:[{}]})},STRealDataModel:{build:()=>({rows:[]})}};
 new Function('window','document','__ST_TEXT__',source('Reports'))(w,{documentElement:{dataset:{uiMode:'advanced'}}},key=>key);
 const record={id:'case',activeSimulationId:'a',metadata:{realData:{records:[{id:'r'}]}},simulations:[{id:'a',equipment:[{id:'m',type:'FILLER'},{id:'c',type:'CONVEYOR'}]}]};
 const before=JSON.stringify(record),api=w.STReports,choices=api.caseExportSelection(record,'CURRENT');
 choices[0].conveyorAnalysis=false;
 const out=api.selectedCaseExport(record,choices,{realData:false,realComparisons:true,simulationComparisons:false});
 assert.equal(out.metadata.realData,undefined);assert(out.exportedAnalysis.simulations[0].equipment);assert.equal(out.exportedAnalysis.simulations[0].conveyors,undefined);assert.equal(out.exportedAnalysis.simulations[0].realComparisons.length,1);
 assert.equal(JSON.stringify(record),before);
 assert.deepEqual(api.caseExportExtras('COMPLETE',false),{realData:false,realComparisons:false,simulationComparisons:false});
});
