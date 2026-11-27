import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps-script/MinimalMode.html','utf8');
const block=source.slice(source.indexOf('  function elapsedCalculationLabel('),source.indexOf('  function owner(){'));
test('Basic simulation progress contains only percentage and elapsed wall time; search remains unchanged',()=>{
 let now=1000;
 const progressNode={value:0},output={textContent:''},holder={querySelector:q=>q==='progress'?progressNode:output};
 const api=new Function('el','tr','performance','var runStartedAt=null;'+block+
  '\nreturn {progress,elapsedCalculationLabel,start(){runStartedAt=performance.now();},reset(){runStartedAt=null;}};')(()=>holder,v=>v,{now:()=>now});
 api.start();now+=75432;
 api.progress('minimal-run-progress',42.35,'Preparing results…');
 assert.equal(progressNode.value,42.35);assert.equal(output.textContent,'42.4% · 00:01:15');
 api.progress('minimal-run-progress',100,'Preparing results…');assert.equal(output.textContent,'100% · 00:01:15');
 api.reset();api.progress('minimal-run-progress',0);assert.equal(output.textContent,'0% · 00:00:00');
 assert.equal(api.elapsedCalculationLabel(3661000),'01:01:01');
 api.progress('minimal-search-progress',30,'OFAT');assert.equal(output.textContent,'30% · OFAT');
});
