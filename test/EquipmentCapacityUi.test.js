import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

test('internal capacity label follows the incoming unit and preserves the saved number',()=>{
 const dom=new JSDOM('<div class="equipment-grid"></div><input class="equipment-input-unit" value="BOTTLES"><input class="equipment-unit" value="CASES"><input class="equipment-process-data"><input class="equipment-characteristics">',{runScripts:'outside-only'});
 const w=dom.window;w.__ST_TEXT__=key=>key;
 w.eval(fs.readFileSync('apps-script/EquipmentRoles.html','utf8').replace(/<\/?script>/g,''));
 const fields=w.document.body,card={_fields:fields};
 w.STEquipmentRoles.attach(card,{type:'CASE_PACKER',processData:{equipment:{internalCapacityBottles:24}}});
 const capacity=fields.querySelector('.equipment-internal-capacity');
 assert.match(capacity.parentNode.textContent,/Internal capacity \(bottles\)/);
 fields.querySelector('.equipment-input-unit').value='CASES';
 fields.querySelector('.equipment-unit').dispatchEvent(new w.Event('change'));
 assert.match(capacity.parentNode.textContent,/Internal capacity \(cases\)/);
 assert.equal(capacity.value,'24');
 fields.querySelector('.equipment-residence-time').value='2.5';
 const data={};assert(w.STEquipmentRoles.readCapacity(fields,data));assert.equal(data.equipment.internalCapacityBottles,24);assert.equal(data.equipment.residenceTimeSeconds,2.5);
 dom.window.close();
});


test('machine occupancy mode selector round-trips positional slots and storage safely',()=>{
 const dom=new JSDOM('<div class="equipment-grid"></div>'+
   '<input class="equipment-input-unit" value="BOTTLES">'+
   '<input class="equipment-unit" value="BOTTLES">'+
   '<input class="equipment-process-data"><input class="equipment-characteristics">',
   {runScripts:'outside-only'});
 try{
  const w=dom.window;w.__ST_TEXT__=text=>text;
  w.eval(fs.readFileSync('apps-script/EquipmentRoles.html','utf8').replace(/<\/?script>/g,''));
  const fields=w.document.body,card={_fields:fields};
  const equipment={id:'blow',type:'BLOWMOLDER',processData:{equipment:{
    internalCapacityBottles:36,residenceTimeSeconds:3,occupancyMode:'POSITIONS'}}};
  w.STEquipmentRoles.attach(card,equipment);
  const input=fields.querySelector('.equipment-occupancy-mode');
  assert(input,'Physical machine design exposes reusable occupancy selector');
  assert.equal(input.value,'POSITIONS');
  assert.equal(fields.querySelector('.equipment-internal-capacity').value,'36');
  const stored={};assert(w.STEquipmentRoles.readCapacity(fields,stored));
  assert.equal(stored.equipment.occupancyMode,'POSITIONS');
  assert.equal(stored.equipment.internalCapacityBottles,36);
  input.value='STORAGE';
  const reverted={};assert(w.STEquipmentRoles.readCapacity(fields,reverted));
  assert.equal(reverted.equipment.occupancyMode,'STORAGE');
  assert.equal(reverted.equipment.residenceTimeSeconds,3);
 }finally{dom.window.close();}
});
