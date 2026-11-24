import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {resolveLineFlowUnits} from '../src/simulation/ProductProfiles.js';
import {resolvePackingFormats} from '../src/simulation/FormatCatalog.js';
const m=(id,input,output=input)=>({id,name:id,type:input!==output?'CASE_PACKER':'FILLER',processData:{flowUnits:{input,output}}});
const c=id=>({id,name:id,type:'CONVEYOR',processData:{}});
test('editor derives read-only conveyor units from current machine fields without a simulation',()=>{
 const line=[m('US','BOTTLES'),c('US-LAB'),m('LAB','BOTTLES'),c('LAB-PAC'),m('PAC','BOTTLES','CASES'),c('PAC-PAL'),m('PAL','CASES')];
 const dom=new JSDOM('<div id="equipment-list"></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
 try{
  for(const item of line){const card=d.createElement('article');card.className='equipment-card';card.dataset.equipmentId=item.id;card.innerHTML='<input class="equipment-type"><input class="equipment-name"><input class="equipment-input-unit"><input class="equipment-unit"><output class="equipment-transport-unit"></output>';
   card.querySelector('.equipment-type').value=item.type;card.querySelector('.equipment-name').value=item.name;
   card.querySelector('.equipment-input-unit').value=item.processData.flowUnits?.input||'';card.querySelector('.equipment-unit').value=item.processData.flowUnits?.output||'';d.getElementById('equipment-list').append(card);}
  w.SimulatorEngine={resolveLineFlowUnits};w.state={activeCase:{equipment:line}};w.equipmentField=(card,selector)=>card.querySelector(selector);
  const js=fs.readFileSync('apps-script/ClientEquipment.html','utf8');w.eval(js.slice(js.indexOf('    function refreshEditorTransportUnits('),js.indexOf('    function basicEquipmentPreview(')));
  w.refreshEditorTransportUnits();
  const cards=[...d.querySelectorAll('.equipment-card')],unit=i=>cards[i].querySelector('.equipment-unit').value;
  assert.equal(unit(1),'BOTTLES');assert.equal(unit(3),'BOTTLES');assert.equal(unit(5),'CASES');
  assert.equal(cards[5].querySelector('output').textContent,'Case');
  cards[6].querySelector('.equipment-input-unit').value='BOTTLES';w.refreshEditorTransportUnits();
  assert.equal(unit(5),'');assert.equal(cards[5].querySelector('output').dataset.flowStatus,'CONFLICT');assert.match(cards[5].querySelector('output').title,/PAC outputs CASES.*PAL receives BOTTLES/);
 }finally{w.close();}
});
test('format resolution derives conveyor transport before choosing the material-specific behavior owner',()=>{
 const line=[m('US','BOTTLES'),c('before'),m('PAC','BOTTLES','CASES'),c('after'),m('PAL','CASES')];
 const catalog={version:3,products:[{id:'p',name:'P',equipment:{after:{movingGapMm:999},before:{movingGapMm:5}}}],formats:[{id:'f',name:'F',productId:'p',bottlesPerCase:12,case:{lengthMm:100},equipment:{after:{inputUnit:'BOTTLES',outputUnit:'BOTTLES',speedMmPerSecond:200}}}]};
 const before=JSON.stringify(catalog),format=resolvePackingFormats(catalog,line)[0];
 assert.equal(format.equipment.before.outputUnit,'BOTTLES');assert.equal(format.equipment.before.movingGapMm,5);
 assert.equal(format.equipment.after.outputUnit,'CASES');assert.equal(format.equipment.after.movingGapMm,undefined);assert.equal(format.equipment.after.speedMmPerSecond,200);
 assert.equal(JSON.stringify(catalog),before);
});
