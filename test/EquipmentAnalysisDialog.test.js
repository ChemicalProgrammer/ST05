import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {equipmentReliabilityAssessment,analyzeEquipmentReliability} from '../src/analysis/ScenarioPlanner.js';

const read=name=>fs.readFileSync('apps-script/'+name+'.html','utf8');
const script=name=>read(name).match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(){
  const dom=new JSDOM(read('EquipmentAnalysis'),{runScripts:'outside-only'});
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.STScenarios={equipmentReliability:equipmentReliabilityAssessment,equipmentAnalysis:analyzeEquipmentReliability};
  w.eval(script('Subsection'));w.eval(script('EquipmentAnalysis'));
  const body=w.document.getElementById('equipment-analysis-body');
  const open=(bf,tr,config={})=>w.STEquipmentAnalysis.open({equipment:[{id:'e',name:'Test machine',type:'FILLER',nominalRatePerSecond:2,noiseProfile:{reliability:{mtbfMinutes:bf,mttrMinutes:tr}}}],dynamicConfig:config},'e');
  return {w,body,open,close:()=>w.close()};
}
test('equipment diagnosis uses Subsection B and places configured point in correct logarithmic quadrant without a run',()=>{
  const h=harness();
  try{
    for(const [bf,tr,left,above] of [[20,12,true,true],[240,12,false,true],[20,1,true,false],[240,1,false,false],[.001,1000000,true,true]]){
      h.open(bf,tr);
      const groups=[...h.body.querySelectorAll(':scope > .st-subsection')];
      assert(groups.length>=7);
      assert(groups.every(g=>g.dataset.subsectionVariant==='B'&&g.tagName==='DETAILS'&&g.open));
      const marker=h.body.querySelector('[data-equipment-marker]');
      assert(marker);
      assert(Math.abs(Number(marker.getAttribute('data-mtbf'))-bf)<=1e-10*Math.max(1,bf));
      assert(Math.abs(Number(marker.getAttribute('data-mttr'))-tr)<=1e-10*Math.max(1,tr));
      const x=Number(marker.getAttribute('cx')),y=Number(marker.getAttribute('cy'));
      assert.equal(x<390,left);assert.equal(y<169,above);
      assert(x>75&&x<705&&y>22&&y<316);
      assert.equal(Number(h.body.querySelector('[data-availability-target]').dataset.availabilityTarget),.95);
      assert.match(h.body.querySelector('[data-analysis-group="observed"]').textContent,/Not evaluated/);
    }
  }finally{h.close();}
});
test('missing or disabled inputs never create an equipment marker; language changes preserve folds',()=>{
  const h=harness();
  try{
    h.open(0,0);assert.equal(h.body.querySelector('[data-equipment-marker]'),null);
    h.open(20,12,{reliabilityEnabled:false});assert.equal(h.body.querySelector('[data-equipment-marker]'),null);
    const group=h.body.querySelector('[data-analysis-group="matrix"]');group.open=false;
    h.w.document.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
    const translated=h.body.querySelector('[data-analysis-group="matrix"]');
    assert.equal(translated.open,false);assert.match(translated.textContent,/Diagnóstico de intervención/);
  }finally{h.close();}
});
