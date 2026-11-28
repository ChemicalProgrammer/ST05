import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const client=readFileSync(new URL('../apps-script/ScenarioExplorer.html',import.meta.url),'utf8');
const helper=client.slice(client.indexOf('  function bufferExperiments('),client.indexOf('  function unitLabel('));
const plan=new Function(helper+'return bufferExperiments;')();
const length='processData.geometry.lactMm',sensor='processData.accumulation.backupSensorPositionMm';
function pack(equipmentId){
  return {changes:[[length,10000,39876],[sensor,null,1083]].map(([path,before,after])=>({
    equipmentId,path,before,after,originTier:'MEDIUM',interventionType:'ACCUMULATION',
    packageId:'ACCUMULATION:'+equipmentId,packagePaths:[length,sensor]
  }))};
}
test('buffer screening covers lengths and sensors, with separate installed-length controls',()=>{
  const source=pack('A'),saved=JSON.stringify(source),trials=plan([source],48);
  const extensions=trials.filter(t=>!t.control),controls=trials.filter(t=>t.control);
  assert.deepEqual(new Set(extensions.flatMap(t=>t.changes.filter(c=>c.path===length).map(c=>c.after))),new Set([12500,15000,20000,39876]));
  assert.equal(controls.length,1);assert.equal(controls[0].changes[0].originTier,'ZERO');
  assert(extensions.some(t=>t.changes.length===1));
  assert(extensions.some(t=>t.changes.some(c=>c.path===sensor&&c.after!==1083)));
  for(const t of extensions)for(const c of t.changes)assert.deepEqual(c.packagePaths,t.changes.map(x=>x.path));
  assert.equal(JSON.stringify(source),saved);
});
test('candidate budget is shared across sites and duplicate levels are skipped',()=>{
  const sites=['A','B','C'].map(pack);
  assert.deepEqual(plan(sites,5).map(t=>t.changes[0].equipmentId),['A','B','C','A','B']);
  sites[0].changes[0].after=10001;
  const keys=plan(sites.slice(0,1),48).map(t=>JSON.stringify(t.changes.map(c=>[c.path,c.after])));
  assert.equal(keys.length,new Set(keys).size);
});
