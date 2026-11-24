import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const read=name=>fs.readFileSync('apps-script/'+name,'utf8');
function harness(){
  const dom=new JSDOM('<div id="equipment-list"></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
  const line=[{id:'m1',type:'FILLER'},{id:'c1',type:'CONVEYOR'},{id:'m2',type:'CAPPER'},{id:'c2',type:'CONVEYOR'},{id:'new',type:'CUSTOM'}];
  const list=d.getElementById('equipment-list');
  for(const unit of line){
    const card=d.createElement('article');card.className='equipment-card';card.dataset.equipmentId=unit.id;
    card.innerHTML='<div class="equipment-header"><button class="equipment-drag"></button></div><div class="equipment-fields"><select class="equipment-type"><option>FILLER</option><option>CONVEYOR</option><option>CAPPER</option><option>CUSTOM</option></select><input class="equipment-name"><input class="reliability-mtbfMinutes"></div>';
    card._fields=card.lastElementChild;card.querySelector('.equipment-name').value=unit.id;card.querySelector('.equipment-type').value=unit.type;list.append(card);
  }
  const calls={invalidated:0,save:0};
  Object.assign(w,{state:{activeCase:{equipment:line}},equipmentField:(card,selector)=>card.querySelector(selector)||card._fields.querySelector(selector),
    STEquipmentFilter:{canReorder:()=>true,reorderMode:()=> 'all'},STEquipmentDrag:{positions:()=>new Map(),animate(){}},
    STBasicMode:{sync(){}},showError:err=>{throw Error(err.message)},
    syncEquipmentFromEditor(){throw Error('Structural edits must not validate incomplete draft inputs');},
    invalidateActiveResult(){calls.invalidated++;},autosave:{change(){calls.save++;}},
    renderRunWorkspace(){},refreshDesignGraph(){},renderRawJson(){}});
  const src=read('ClientEquipment.html');
  w.eval(src.slice(src.indexOf('    function equipmentDraftCards()'),src.indexOf('    async function removeEquipment(')));
  w.refreshEquipmentPositions();
  return {w,d,list,line,calls,ids:()=>[...list.children].map(card=>card.dataset.equipmentId),close:()=>w.close()};
}
test('reorder keeps incomplete input nodes and the relative physical order of other units',()=>{
  const h=harness();
  try{
    const card=h.list.lastElementChild,blank=card.querySelector('.reliability-mtbfMinutes');
    blank.value='';const edited=h.list.firstElementChild.querySelector('.equipment-name');edited.value='Unsaved filler name';
    h.w.moveEquipment(4,2);
    assert.deepEqual(h.ids(),['m1','c1','new','m2','c2']);
    assert.deepEqual(h.line.map(e=>e.id),h.ids());
    assert.equal(h.list.children[2],card);
    assert.equal(card.querySelector('.reliability-mtbfMinutes'),blank);
    assert.equal(h.list.firstElementChild.querySelector('.equipment-name'),edited);
    assert.equal(edited.value,'Unsaved filler name');
    assert.equal(card.dataset.index,'2');
    h.w.moveEquipment(2,1);
    assert.deepEqual(h.ids(),['m1','new','c1','m2','c2']);
    assert.equal(h.calls.invalidated,2);assert.equal(h.calls.save,2);
  }finally{h.close();}
});
test('machine-only reorder interleaves machines and conveyors, preserving live draft fields',()=>{
  const h=harness();
  try{
    h.w.STEquipmentFilter.reorderMode=()=> 'equipment';
    const card=h.list.lastElementChild,blank=card.querySelector('.reliability-mtbfMinutes');
    h.w.moveEquipment(4,0);
    assert.deepEqual(h.ids(),['new','c1','m1','c2','m2']);
    assert.deepEqual(h.line.map(e=>e.id),h.ids());
    assert.equal(h.list.firstElementChild,card);
    assert.equal(card.querySelector('.reliability-mtbfMinutes'),blank);
    assert.equal(blank.value,'');
    assert.equal(card.dataset.index,'0');
    h.w.moveEquipment(0,4);
    assert.deepEqual(h.ids(),['m1','c1','m2','c2','new']);
  }finally{h.close();}
});
test('conveyor-only reorder preserves the relative order of machines',()=>{
  const h=harness();
  try{
    h.w.STEquipmentFilter.reorderMode=()=> 'conveyors';
    h.w.moveEquipment(3,1);
    assert.deepEqual(h.ids(),['m1','c2','m2','c1','new']);
    assert.deepEqual(h.line.map(e=>e.id),h.ids());
    h.w.moveEquipment(1,2); // A destination in the other group is invalid.
    assert.deepEqual(h.ids(),['m1','c2','m2','c1','new']);
    assert.equal(h.calls.invalidated,1);
  }finally{h.close();}
});
test('interleaving uses edited Type fields and retains surplus units',()=>{
  const h=harness();
  try{
    h.w.STEquipmentFilter.reorderMode=()=> 'conveyors';
    h.list.firstElementChild.querySelector('.equipment-type').value='CONVEYOR';
    h.w.moveEquipment(3,0);
    assert.deepEqual(h.ids(),['m2','c2','new','m1','c1']);
    assert.deepEqual(h.line.map(e=>e.id),h.ids());
    assert.equal(h.list.children[3].querySelector('.equipment-type').value,'CONVEYOR');
  }finally{h.close();}
});
test('a hidden-all view cannot reorder and the position combobox is removed',()=>{
  const h=harness();
  try{
    h.w.STEquipmentFilter.canReorder=()=>false;
    h.w.STEquipmentFilter.reorderMode=()=> 'none';
    h.w.moveEquipment(4,0);
    assert.deepEqual(h.ids(),['m1','c1','m2','c2','new']);
    assert.doesNotMatch(read('ClientEquipment.html'),/equipment-line-position/);
    assert.doesNotMatch(read('EditorStyles.html'),/equipment-line-position/);
  }finally{h.close();}
});
test('conveyor evaluation pills expose the worksheet verdict and reason',()=>{
  const dom=new JSDOM(read('ConveyorAnalysis.html'),{runScripts:'outside-only'}),w=dom.window;
  try{
    w.eval(read('ConveyorAnalysis.html').match(/<script>([\s\S]*?)<\/script>/)[1]);
    let opens=0;const button=w.STConveyorAnalysis.createEvaluationButton(()=>opens++);
    assert.equal(button.textContent,'NOT EVALUATED');
    for(const status of ['PASS','FAIL','AT LIMIT','NOT EVALUATED']){
      w.STConveyorAnalysis.paintEvaluationButton(button,{status,statusReason:'Worksheet reason'});
      assert.equal(button.dataset.evaluation,status);assert.match(button.title,/Worksheet reason/);
      assert.equal(button.classList.contains('is-pass'),status==='PASS');assert.equal(button.classList.contains('is-fail'),status==='FAIL');assert.equal(button.classList.contains('is-review'),status==='AT LIMIT');
    }
    button.click();assert.equal(opens,1);
  }finally{w.close();}
});
test('separate layouts explicitly expose the existing equipment type and name fields',()=>{
  const css=read('BasicModeStyles.html');
  assert.match(css,/\.basic-machine \.equipment-grid:not\(\.reliability-controls\) > label:not\(:has\(> \.equipment-type, > \.equipment-name,/);
  assert.match(css,/#basic-conveyor-panel \.equipment-grid:not\(\.reliability-controls\) > label:not\(:has\(> \.equipment-type, > \.equipment-name,/);
});
