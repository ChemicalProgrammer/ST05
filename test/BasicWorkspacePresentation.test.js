import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const scenario=fs.readFileSync('apps-script/ScenarioExplorer.html','utf8');
const mode=fs.readFileSync('apps-script/MinimalMode.html','utf8');
const settings=fs.readFileSync('apps-script/Settings.html','utf8');
const web=fs.readFileSync('apps-script/WebApp.html','utf8');
const styles=fs.readFileSync('apps-script/MinimalModeStyles.html','utf8');
const block=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length));
const api=new Function('STWhatIf','STScenarios',block(scenario,'  function compactComparison(','  function savedEntries(')+
  '\nreturn {compactComparison,compactDifference,compactInputRows,compactPerformanceRows};')({changeInfo:(c)=>({equipment:c.equipmentId,parameter:c.path})},{fields:{}});
test('compact comparison uses actual original-horizon pair and absolute versus relative differences',()=>{
  const entry={baseline:{oee:55,throughput:100},candidate:{oee:80,throughput:200},independentCheck:{baseline:{oee:60,throughput:110},candidate:{oee:65,throughput:120},passed:true},
    originalVerification:{baseline:{oee:70,throughput:150,overflowUnits:0},candidate:{oee:72,throughput:160,overflowUnits:4},passed:false,durationSeconds:28800,rounds:3}};
  const before=JSON.stringify(entry),pair=api.compactComparison(entry),rows=api.compactPerformanceRows(pair,'bpm','bottles');
  assert.equal(pair.baseline.oee,70);assert.equal(pair.candidate.oee,72);assert.equal(pair.verified,false);
  assert.equal(rows[0].differenceUnit,'pp');assert.deepEqual(api.compactDifference(70,72),{delta:2,percent:100*2/70});
  assert.deepEqual(api.compactDifference(0,4),{delta:4,percent:null});
  assert.deepEqual(api.compactDifference(null,4),{delta:null,percent:null});
  assert.deepEqual(api.compactDifference(10,8),{delta:-2,percent:-20});
  assert.equal(rows[2].name,'Overflow');assert.equal(JSON.stringify(entry),before);
  assert.equal(api.compactComparison({baseline:{oee:65}}).candidate,null);
  assert.equal(api.compactComparison({...entry,originalVerification:undefined}).baseline.oee,60);
});
test('derived original sensor positions use recorded OFAT evidence, never the current edited model',()=>{
  const changes=[{equipmentId:'belt',path:'backup',before:null,after:4400,unit:'mm'},{equipmentId:'belt',path:'unknown',before:null,after:10,unit:'s'}];
  const entry={phaseAudit:{ofat:{groups:[{id:'belt:backup',baselineEffective:5400}]}}};
  const rows=api.compactInputRows(entry,changes,[]);
  assert.equal(rows[0].before,5400);assert(rows[0].derived);
  assert.equal(rows[1].before,null);assert.equal(api.compactDifference(rows[1].before,10).percent,null);
});
test('compact dialog and cards share the five-column table; detailed Standard and Advance content remains',()=>{
  assert.match(scenario,/\['Variable','Original value','Scenario value','Numerical difference','Percentage difference'\]/);
  assert.match(scenario,/if\(project\.compact\)\{\s*var tr=value=>window\.STLanguage/);
  assert.match(scenario,/appendCompactComparison\(resultsBody,comparisonRows\.concat\(inputRows\)/);
  assert.match(scenario,/appendCompactComparison\(metrics,compactPerformanceRows/);
  assert.match(scenario,/OFAT — Individual physical sensitivity/);
});
test('Settings is the sole statistical report action, gated by completed saved results and active work',()=>{
  const controls={button:{disabled:false}};let busy=false,locked=false,sim={results:{summary:{}}};
  const api=new Function('window','activeCase','performanceLocked','simulationProvider','el',block(settings,'  function statisticalReportAvailable(','  function syncPerformanceControls(')+'\nreturn {statisticalReportAvailable,syncStatisticalReport};')(
    {STMinimalMode:{busy:()=>busy},STStatExport:{canExport:s=>!!s?.results?.summary}},()=>({id:'case'}),()=>locked,()=>sim,()=>controls.button);
  api.syncStatisticalReport();assert.equal(controls.button.disabled,false);
  busy=true;api.syncStatisticalReport();assert(controls.button.disabled);
  busy=false;locked=true;api.syncStatisticalReport();assert(controls.button.disabled);
  locked=false;sim={};api.syncStatisticalReport();assert(controls.button.disabled);
  assert.equal((web.match(/id="settings-export-statistical-report"/g)||[]).length,1);
  assert(!mode.includes('minimal-export-minitab'));
});
test('Basic second row uses existing simulation controls and locks them during search or run',()=>{
  const ids=['simulation-selector','rename-simulation','clone-case','delete-simulation'],controls=Object.fromEntries(ids.map(id=>[id,{dataset:{},disabled:false}]));
  const state={activeCase:{simulations:[{}]}};
  const sync=new Function('el','state',block(mode,'  function syncSimulationManagement(','  function sync(current)')+'\nreturn syncSimulationManagement;')(id=>controls[id],state);
  sync(true,false);assert(controls['delete-simulation'].disabled);assert(!controls['clone-case'].disabled);
  state.activeCase.simulations.push({});sync(true,false);assert(ids.every(id=>!controls[id].disabled));
  sync(true,true);assert(ids.every(id=>controls[id].disabled));sync(false,false);assert(ids.every(id=>!controls[id].disabled));
  assert.match(styles,/#basic-section-row:not\(\.hidden\) \{display:flex;flex-basis:100%;justify-content:flex-end/);
  assert.doesNotMatch(styles,/#simulation-toolbar,\s*html/);
});
