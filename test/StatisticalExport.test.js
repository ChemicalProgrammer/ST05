import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('apps-script/StatisticalExport.html','utf8');
const context={window:{},TextEncoder};
vm.runInNewContext(source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>')),context);
const api=context.window.STStatExport;
const rr=(seed,q)=>({seed,durationSeconds:120,oee:q/2,throughput:q,outputCount:2*q});
const metric=(q,fidelity='PHYSICAL_FAST_V1')=>({durationSeconds:120,unitOfFlow:'bottles',scenarioFidelity:fidelity,oee:q/2,throughput:q,roundMetrics:[rr(1,q),rr(2,q)]});
function fixture(){
  const equipment=[{id:'m1',name:'Filler, "A"',type:'FILLER',unitOfFlow:'bottles',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:10,mttrMinutes:1}}},{id:'m2',name:'=SUM(1,2)',type:'PALLETIZER',unitOfFlow:'cases',nominalRatePerSecond:1}];
  const summary={lineOeePercent:50,outputCount:120};
  const equipmentMetrics={m1:{unitOfFlow:'bottles',outputCount:150,oeePercent:75,stateAccounting:{stateSeconds:{RUNNING:100,FAILURE:20}},failureCount:1,failureHistory:{fields:['startSecond','endSecond','endReason'],complete:true,episodes:[[20,40,'REPAIRED']]}}};
  const samples=[{virtualSecond:0,outputCount:0,equipment:[{id:'m1',outputCount:0}],accumulationZones:[]},{virtualSecond:30,outputCount:24,equipment:[{id:'m1',outputCount:30}],accumulationZones:[]},{virtualSecond:120,outputCount:120,equipment:[{id:'m1',outputCount:150}],accumulationZones:[]}];
  return {id:'s',name:'Simulación',equipment,dynamicConfig:{durationSeconds:180},results:{seed:1,durationSeconds:120,unitOfFlow:'bottles',replicationStatus:{state:'COMPLETE',rounds:2},summary,equipmentMetrics,inputSignature:JSON.stringify({run:{durationSeconds:120},equipment}),batch:{rounds:2,rows:[{round:1,seed:1,summary,equipmentMetrics},{round:2,seed:2,summary:{...summary,outputCount:150},equipmentMetrics}]},replay:{seed:1,samples,stateTransitions:[[0,0,'READY']],events:[],detailCoverage:{savedReplaySampled:true,omittedEvents:10}}},whatIf:{evaluations:[{tier:'ZERO',status:'IMPROVEMENT_REPRODUCED',independentCheck:{baseline:metric(100),candidate:metric(104)},doe:{factors:[{label:'MTBF',path:'noiseProfile.reliability.mtbfMinutes',low:10,high:20}],run:{durationSeconds:120,scenarioFidelity:'PHYSICAL_FAST_V1'},observations:[{index:0,levels:[-1],roundMetrics:[rr(1,100),rr(2,110)]},{index:1,levels:[1],roundMetrics:[rr(1,110),rr(2,125)]}]}}]}};
}
const table=(d,n)=>d.tables.find(t=>t.name===n);
test('Statistical export preserves actual rounds, executed inputs, failure records and irregular retained time intervals',()=>{
  const sim=fixture(),before=JSON.stringify(sim),d=api.buildTables(sim);
  assert.equal(JSON.stringify(sim),before);
  assert.equal(table(d,'01_metadata.csv').rows[0].Input_basis,'EXECUTED_INPUT_SIGNATURE');
  assert.equal(table(d,'02_run_inputs.csv').rows.find(r=>r.Path==='durationSeconds').Value_numeric,120);
  assert.equal(table(d,'04_line_rounds.csv').rows.length,2);
  const series=table(d,'13_line_intervals.csv').rows;
  assert.equal(series.length,3);assert.equal(series[0].Interval_output,null);
  assert.equal(series[1].Interval_throughput_per_min,48);assert.equal(series[2].Interval_s,90);
  assert.equal(table(d,'07_failure_episodes.csv').rows.length,2);
  const coverage=table(d,'12_recording_coverage.csv').rows.filter(r=>r.Recording==='EVENTS');
  assert.equal(coverage.length,2);assert.equal(coverage[0]['Coverage.omittedEvents'],10);
  assert.equal(coverage[1].Available,false);
  assert.match(api.csv(table(d,'03_equipment_inputs.csv')),/'=SUM/);
  assert.match(api.csv(table(d,'03_equipment_inputs.csv')),/Filler, ""A""/);
});
test('DOE files use actual replicates and per-seed contrasts; unmatched evidence cannot produce a paired delta',()=>{
  const sim=fixture(),d=api.buildTables(sim);
  assert.equal(table(d,'DOE_ZERO_S001.csv').rows.length,4);
  assert.equal(table(d,'23_CAPEX_paired_deltas.csv').rows.length,2);
  assert.equal(table(d,'30_DOE_seed_contrasts.csv').rows.filter(r=>r.Response==='throughput').map(r=>r.Effect_value).join(','),'10,15');
  const ev=sim.whatIf.evaluations[0];
  ev.independentCheck.candidate.scenarioFidelity='FLUID_SCREEN_V1';
  ev.doe.observations[1].roundMetrics.pop();
  const incomplete=api.buildTables(sim);
  assert.equal(table(incomplete,'23_CAPEX_paired_deltas.csv').rows.length,0);
  assert.equal(table(incomplete,'DOE_ZERO_S001.csv').rows.length,3);
  assert.equal(table(incomplete,'30_DOE_seed_contrasts.csv').rows.length,2);
});
test('partial saved history and summary-only results do not manufacture replicates',()=>{
  const sim=fixture();delete sim.results.batch.rows;delete sim.results.replay.samples;
  const d=api.buildTables(sim);
  assert.equal(table(d,'01_metadata.csv').rows[0].Expected_rounds,2);
  assert.equal(table(d,'04_line_rounds.csv').rows.length,1);
  assert.equal(table(d,'13_line_intervals.csv').rows.length,0);
  sim.results.replicationStatus.state='RUNNING';
  assert.equal(api.canExport(sim),false);
  assert.throws(()=>api.buildTables(sim),/Complete the numerical simulation/);
});
test('ZIP directory, UTF-8 names and CRC are valid for stored files',()=>{
  const files=api.entries(api.buildTables(fixture()));
  files.push({name:'crc-á.txt',text:'123456789'});
  const archive=Buffer.concat(Array.from(api.archiveParts(files),b=>Buffer.from(b)));
  const end=archive.length-22;
  assert.equal(archive.readUInt32LE(end),0x06054b50);
  assert.equal(archive.readUInt16LE(end+10),files.length);
  let central=archive.readUInt32LE(end+16);
  for(const file of files){
    assert.equal(archive.readUInt32LE(central),0x02014b50);
    const nameLen=archive.readUInt16LE(central+28),offset=archive.readUInt32LE(central+42),size=archive.readUInt32LE(central+24);
    assert.equal(archive.readUInt32LE(offset),0x04034b50);
    assert.equal(archive.subarray(central+46,central+46+nameLen).toString('utf8'),file.name);
    assert.equal(archive.subarray(offset+30+nameLen,offset+30+nameLen+size).toString('utf8'),file.text);
    assert.equal(archive.readUInt32LE(offset+14),archive.readUInt32LE(central+16));
    if(file.name==='crc-á.txt')assert.equal(archive.readUInt32LE(offset+14),0xcbf43926);
    central+=46+nameLen;
  }
  assert.equal(central,end);
});


test('statistical report is software-neutral in all workspaces and exported instructions',()=>{
  for(const [path,count] of [['MinimalWorkspace.html',1],['WebApp.html',2]]){
    const html=fs.readFileSync('apps-script/'+path,'utf8');
    const buttons=[...html.matchAll(/<button\b[^>]*id="(?:minimal-export-minitab|export-minitab-results|export-minitab-whatif)"[^>]*>[^<]*<\/button>/g)].map(m=>m[0]);
    assert.equal(buttons.length,count);
    for(const button of buttons){assert.match(button,/>Statistical Report<\/button>/);assert.match(button,/title="Export statistical report"/);assert.match(button,/aria-label="Export statistical report"/);assert.doesNotMatch(button.replace(/id="[^"]*"/g,''),/minitab/i);}
  }
  const language=fs.readFileSync('apps-script/Language.html','utf8');
  assert(language.includes("'Statistical Report':'Reporte estadístico'"));
  assert(language.includes("'Export statistical report':'Exportar reporte estadístico'"));
  const files=api.entries(api.buildTables(fixture()));
  assert.doesNotMatch(files.find(f=>f.name==='00_README.txt').text,/minitab/i);
  assert.doesNotMatch(files.find(f=>f.name==='00_index.csv').text,/minitab/i);
  assert(source.includes("title+'-Statistical-Report.zip'"));
});
