import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('apps-script/MinimalMode.html','utf8');
const html=fs.readFileSync('apps-script/MinimalWorkspace.html','utf8');
const section=source.slice(source.indexOf("  var roundsKey="),source.indexOf("  function productionLabel("));
function harness(){
  const nodes=new Map(),calls=[];
  const make=(text='')=>({textContent:text,value:'',children:[],hidden:false,disabled:false,
    append(n){this.children.push(n);},replaceChildren(){this.children=[];},reportValidity(){return this.value!=='';}});
  const el=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  let owner='A',locked=false;
  const actions={setRounds(value){calls.push(value);el('run-rounds').value=String(value);},error(error){calls.push(error.message);}};
  const api=new Function('el','ownerKey','busy','actions','tr','sync','state','window','node',section+
    '\nreturn {readRounds,syncRounds,applyRounds,syncRoundView,resultValues,resetRoundView,select(value){roundView=value;},selection(){return roundView;}};')(
    el,()=>owner,()=>locked,actions,x=>x,()=>{}, {activeCase:{unitOfFlow:'bottles'}},{},(_tag,text)=>make(text));
  return {api,el,calls,owner(v){owner=v;},lock(v){locked=v;}};
}
function result(){
  const rows=[{round:1,seed:7,durationSeconds:60,summary:{outputCount:100,lineOeePercent:50}},
    {round:2,seed:8,durationSeconds:120,summary:{outputCount:201,lineOeePercent:75}},
    {round:3,seed:9,durationSeconds:60,summary:{outputCount:300,lineOeePercent:90}}];
  return {seed:7,durationSeconds:60,summary:rows[0].summary,replicationStatus:{state:'COMPLETE',rounds:3},batch:{rounds:3,representativeRound:2,rows,statistics:{lineOeePercent:{mean:215/3},outputCount:{mean:601/3},throughputPerMinute:{mean:500.5/3}}}};
}
test('Basic rounds follow duration, default to three, and mirror the canonical run field',()=>{
  assert.match(html,/<input id="minimal-rounds" type="number" min="1" max="100" step="1" required value="3"/);
  assert(html.indexOf('id="minimal-duration-unit"')<html.indexOf('id="minimal-rounds"'));
  const h=harness();h.el('run-rounds').value='3';h.api.syncRounds(false);
  assert.equal(h.el('minimal-rounds').value,'3');
  h.el('minimal-rounds').value='5';assert(h.api.applyRounds());assert.deepEqual(h.calls,[5]);assert.equal(h.el('run-rounds').value,'5');
  h.el('minimal-rounds').value='2.5';assert.equal(h.api.applyRounds(),false);assert.equal(h.el('run-rounds').value,'5');
  h.lock(true);assert.equal(h.api.applyRounds(),false);h.api.syncRounds(true);assert(h.el('minimal-rounds').disabled);
  h.lock(false);h.owner('B');h.el('run-rounds').value='1';h.api.syncRounds(false);assert.equal(h.el('minimal-rounds').value,'1');
});
test('average, representative and individual cards use the completed saved replications',()=>{
  const h=harness(),r=result(),original=JSON.stringify(r);h.api.syncRoundView(r,false);
  const select=h.el('minimal-round-view');
  assert.equal(select.value,'average');assert.deepEqual(select.children.map(o=>o.value),['average','representative','1','2','3']);
  assert.equal(h.api.resultValues(r).output,601/3);assert.equal(h.api.resultValues(r).throughput,500.5/3);
  assert.equal(h.api.resultValues(r).oee,215/3);
  assert.equal(h.api.resultValues(r,'representative').output,201);
  assert.equal(h.api.resultValues(r,'representative').throughput,100.5);
  assert.equal(h.api.resultValues(r,'3').output,300);assert.equal(h.api.resultValues(r,'3').oee,90);
  h.api.select('3');h.api.syncRoundView(r,false);assert.equal(select.value,'3');
  h.api.syncRoundView(result(),false);assert.equal(select.value,'average');
  assert.equal(JSON.stringify(r),original);
});
test('single round and missing archival measurements do not invent replications',()=>{
  const h=harness(),single={durationSeconds:60,summary:{outputCount:33,lineOeePercent:40},replicationStatus:{rounds:1,state:'COMPLETE'}};
  h.api.syncRoundView(single,false);assert.deepEqual(h.el('minimal-round-view').children.map(o=>o.value),['average','representative','1']);
  assert.equal(h.api.resultValues(single,'representative').output,33);
  const r=result();r.batch.rows.pop();h.api.syncRoundView(r,false);assert(h.el('minimal-round-view').hidden);
  assert.equal(h.api.resultValues(r).output,601/3);
  delete r.batch.statistics;assert.equal(h.api.resultValues(r).output,null);
  h.api.syncRoundView(null,false);assert(h.el('minimal-round-view').disabled);
});
