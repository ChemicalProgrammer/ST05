import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps-script/MinimalMode.html','utf8');
const block=source.slice(source.indexOf('  function elapsedCalculationLabel('),source.indexOf('  function owner(){'));
test('Simulation and scenario progress use independent clocks and show only percentage and elapsed time',()=>{
 let now=1000;
 const progressNode={value:0},output={textContent:''},holder={querySelector:q=>q==='progress'?progressNode:output};
 const api=new Function('el','tr','performance','var runStartedAt=null,searchStartedAt=null;'+block+
  '\nreturn {progress,elapsedCalculationLabel,start(){runStartedAt=performance.now();},reset(){runStartedAt=null;},search(){searchStartedAt=performance.now();}};')(()=>holder,v=>v,{now:()=>now});
 api.start();now+=75432;
 api.progress('minimal-run-progress',42.35,'Preparing results…');
 assert.equal(progressNode.value,42.35);assert.equal(output.textContent,'42.4% · 00:01:15');
 api.progress('minimal-run-progress',100,'Preparing results…');assert.equal(output.textContent,'100% · 00:01:15');
 api.reset();api.progress('minimal-run-progress',0);assert.equal(output.textContent,'0% · 00:00:00');
 assert.equal(api.elapsedCalculationLabel(3661000),'01:01:01');
 api.search();now+=61042;api.progress('minimal-search-progress',30,'OFAT');assert.equal(output.textContent,'30% · 00:01:01');
});

test('case and simulation restoration defer Basic rendering until the selected owner is ready',()=>{
 const simulations=[{id:'a',equipment:[{id:'filler'}]},{id:'b',equipment:[{id:'packer'}]}];
 const current={activeCase:{simulations},activeSimulationId:'a',restoringCaseView:true};
 const observed=[];
 const syncBody=source.slice(source.indexOf('  function sync(current)'),source.indexOf('    var workspace='));
 const sync=new Function('owner','ownerKey','observe','var state,initialized=true;function isMinimal(){return true;}'+syncBody+'observe(sim,k);}return sync;')(
   ()=>simulations.find(s=>s.id===current.activeSimulationId),()=>current.activeSimulationId,(sim,k)=>observed.push([sim.equipment[0].id,k]));
 sync(current);
 current.activeSimulationId='b';current.restoringSimulation=true;sync(current);
 current.restoringCaseView=false;sync(current);
 current.restoringSimulation=false;sync(current);
 assert.deepEqual(observed,[['packer','b']]);
});
