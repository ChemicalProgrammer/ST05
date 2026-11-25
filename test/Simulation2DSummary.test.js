import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync('apps-script/Simulation2D.html','utf8');
const code=src.slice(src.indexOf('  function summarize2DRun('),src.indexOf('  function capture(){',src.indexOf('  function summarize2DRun(')));
const summarize=new Function(code+';return summarize2DRun;')();
test('2D run summaries preserve physical counts, units, time counters and source',()=>{
 const run={time:86400,line:[
  {id:'f',name:'Filler',kind:'machine',unit:'BOTTLES',bottlesPerUnit:1,produced:170400,state:'Running',failureCount:5,durations:{running:80000,failure:6400,starving:0},resident:[1,2]},
  {id:'b',name:'Conveyor',kind:'belt',unit:'BOTTLES',bottlesPerUnit:1,produced:170388,durations:{flowing:80000,accumulating:6400},items:[{x:1}]},
  {id:'p',name:'Palletizer',kind:'machine',unit:'CASES',bottlesPerUnit:12,produced:14198,failureCount:2,durations:{running:80000,starving:6000,failure:400},resident:[]}
 ]};
 const before=JSON.stringify(run),d=summarize(run,'Completed',7,'INDEPENDENT',null,86400,[4000,5000,5198]);
 assert.equal(d.outputBottles,170376);assert.equal(d.outputUnits,14198);assert.equal(d.outputUnit,'CASES');assert.equal(d.throughputBpm,170376/1440);assert.equal(d.complete,true);
 assert.equal(d.equipment[0].failureCount,5);assert.equal(d.equipment[1].failureCount,null);assert.equal(d.equipment[2].durationsSeconds.starving,6000);
 assert.equal(JSON.stringify(run),before);
 const partial=summarize({...run,time:100},'Paused',8,'REPRESENTATIVE_SEED',2,86400,[]);
 assert.equal(partial.complete,false);assert.equal(partial.round,2);assert.equal(partial.seed,8);assert.equal(partial.source,'REPRESENTATIVE_SEED');
 assert.equal(summarize(null,'Ready',7,'INDEPENDENT',null,86400,[]),null);
 const missing=summarize({time:10,line:[{id:'p',kind:'machine',unit:'CASES',produced:5}]},'Paused',7,'INDEPENDENT',null,86400,[]);
 assert.equal(missing.outputBottles,null);assert.equal(missing.throughputBpm,null);
});
