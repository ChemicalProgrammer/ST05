import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const read=name=>fs.readFileSync('apps-script/'+name,'utf8');
const script=name=>read(name).replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');

async function filters(){
  const source=read('WebApp.html'),start=source.indexOf('<div class="equipment-filters"');
  const markup=source.slice(start,source.indexOf('</div>',start)+6);
  const dom=new JSDOM(markup+'<p id="equipment-filter-empty" class="hidden"></p><div id="equipment-list"></div><aside id="inspector"></aside>',{runScripts:'outside-only'});
  const w=dom.window,d=w.document,cards=[];
  for(const [id,type]of [['a','BLOWMOLDER'],['b','CONVEYOR'],['c','FILLER']]){
    const card=d.createElement('article');card.className='equipment-card';card.dataset.equipmentId=id;
    card.innerHTML='<button class="equipment-drag"></button><div class="equipment-fields"><select class="equipment-type"><option>'+type+'</option></select><input class="equipment-rate" value="480"></div>';
    card._fields=card.querySelector('.equipment-fields');d.getElementById('equipment-list').append(card);cards.push(card);
  }
  let closed=0,notified=0;
  w.__ST_TEXT__=key=>key;
  w.STEquipmentInspector={refreshTitle(){},hide(){closed++;},release(){
    for(const card of cards)if(card.classList.contains('equipment-selected')){card.append(card._fields);card.classList.remove('equipment-selected');}
  }};
  w.addEventListener('st:inspector',()=>notified++);
  w.eval(script('EquipmentFilter.html'));
  await new Promise(resolve=>w.setTimeout(resolve,0));
  w.STEquipmentFilter.apply();
  const get=id=>d.getElementById(id);
  return {w,d,cards,get,filter:w.STEquipmentFilter,
    visible:()=>cards.filter(card=>!card.classList.contains('hidden')).map(card=>card.dataset.equipmentId),
    closed:()=>closed,notified:()=>notified,close:()=>w.close()};
}

test('editor machine and conveyor icon filters toggle independently, including an empty view',async()=>{
  const h=await filters();
  try{
    const machines=h.get('toggle-editor-machines'),conveyors=h.get('toggle-editor-conveyors');
    assert.equal(h.d.querySelectorAll('[name="equipment-filter"]').length,0);
    assert.equal(machines.getAttribute('aria-pressed'),'true');assert.equal(conveyors.getAttribute('aria-pressed'),'true');
    assert.deepEqual(h.visible(),['a','b','c']);
    machines.click();assert.deepEqual(h.visible(),['b']);assert.equal(machines.title,'Show machines');
    assert.equal(conveyors.getAttribute('aria-pressed'),'true');assert.equal(h.filter.canReorder(),true);
    assert.equal(h.filter.reorderMode(),'conveyors');
    assert.equal(h.cards[1].querySelector('.equipment-drag').disabled,false);
    assert.ok([h.cards[0],h.cards[2]].every(card=>card.querySelector('.equipment-drag').disabled));
    conveyors.click();assert.deepEqual(h.visible(),[]);assert.ok(!h.get('equipment-filter-empty').classList.contains('hidden'));
    assert.equal(h.filter.canReorder(),false);assert.equal(h.filter.reorderMode(),'none');
    assert.ok(h.cards.every(card=>card.querySelector('.equipment-drag').disabled));
    machines.click();assert.deepEqual(h.visible(),['a','c']);assert.ok(h.get('equipment-filter-empty').classList.contains('hidden'));
    assert.equal(h.filter.reorderMode(),'equipment');assert.equal(h.filter.canReorder(),true);
    assert.ok([h.cards[0],h.cards[2]].every(card=>!card.querySelector('.equipment-drag').disabled));
    conveyors.click();assert.deepEqual(h.visible(),['a','b','c']);assert.equal(h.filter.canReorder(),true);
    assert.ok(h.cards.every(card=>!card.querySelector('.equipment-drag').disabled));
    assert.equal(machines.title,'Hide machines');assert.equal(conveyors.title,'Hide conveyors');
  }finally{h.close();}
});

test('hiding selected equipment releases its inspector without discarding field values or line order',async()=>{
  const h=await filters();
  try{
    const selected=h.cards[0];selected.classList.add('equipment-selected');
    selected._fields.querySelector('.equipment-rate').value='615';h.get('inspector').append(selected._fields);
    h.get('toggle-editor-machines').click();
    assert.equal(selected._fields.parentElement,selected);assert.equal(h.closed(),1);assert.equal(h.notified(),1);
    assert.equal(selected._fields.querySelector('.equipment-rate').value,'615');
    assert.deepEqual([...h.get('equipment-list').children].map(card=>card.dataset.equipmentId),['a','b','c']);
    h.filter.apply();assert.equal(h.notified(),1,'Repeated rendering does not reopen or repeatedly close the inspector');
  }finally{h.close();}
});

test('separate tabs retain their group and reorder behavior; combined view starts with both groups',async()=>{
  const h=await filters();
  try{
    h.filter.set('conveyors',true);assert.deepEqual(h.visible(),['b']);assert.equal(h.filter.canReorder(),true);
    h.get('toggle-editor-machines').click();assert.deepEqual(h.visible(),['b'],'Hidden combined controls cannot change a separate tab');
    h.filter.set('equipment',true);assert.deepEqual(h.visible(),['a','c']);assert.equal(h.filter.canReorder(),true);
    h.filter.set('all');assert.deepEqual(h.visible(),['a','b','c']);
    assert.equal(h.get('toggle-editor-machines').getAttribute('aria-pressed'),'true');
    assert.equal(h.get('toggle-editor-conveyors').getAttribute('aria-pressed'),'true');
  }finally{h.close();}
});

test('the two layout choices normalize unset and legacy defaults to separate without losing other options',()=>{
  const dom=new JSDOM(read('WebApp.html'));
  try{
    const picker=dom.window.document.getElementById('settings-equipment-layout');
    assert.deepEqual([...picker.options].map(option=>option.value),['split','combined']);assert.equal(picker.value,'split');
    const source=read('UiPreferences.html'),start=source.indexOf('  function caseOptions()'),end=source.indexOf('  function initializeCaseOptions()',start);
    let record={metadata:{consoleOptions:{}}};
    const {caseOptions,setCaseOptions}=vm.runInNewContext(source.slice(start,end)+'\n({caseOptions,setCaseOptions})',{
      caseProvider:()=>record,read:()=>null,caseChanged(){},window:{dispatchEvent(){}},Event:class{}
    });
    for(const saved of [undefined,'','split','unknown','combined']){
      record.metadata.consoleOptions={equipmentLayout:saved,showRealData:false,seedPolicy:'FIXED'};
      assert.equal(caseOptions().equipmentLayout,saved==='combined'?'combined':'split');
    }
    const draft={equipmentLayout:'',showRealData:false,seedPolicy:'FIXED'};
    setCaseOptions(draft);assert.equal(record.metadata.consoleOptions.equipmentLayout,'split');
    assert.equal(record.metadata.consoleOptions.showRealData,false);assert.equal(record.metadata.consoleOptions.seedPolicy,'FIXED');
    assert.equal(draft.equipmentLayout,'','Saving normalized options does not mutate the caller');
  }finally{dom.window.close();}
});

test('critical machine is the first equipment control and retains its single-selection behavior',()=>{
  const dom=new JSDOM('<div id="equipment-list"></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
  try{
    w.__ST_TEXT__=key=>key;w.eval(script('EquipmentRoles.html'));
    const cards=[];
    for(const id of ['a','b']){
      const card=d.createElement('article');card.className='equipment-card';
      card.innerHTML='<div class="equipment-fields"><div class="equipment-grid"><label>Speed<input class="equipment-rate" value="480"></label><label>Flow<input class="equipment-unit"><input class="equipment-input-unit"></label></div><textarea class="equipment-process-data">{}</textarea><textarea class="equipment-characteristics">{}</textarea></div>';
      card._fields=card.firstElementChild;d.getElementById('equipment-list').append(card);
      w.STEquipmentRoles.attach(card,{id,type:'BLOWMOLDER'});cards.push(card);
      const first=card.querySelector('.equipment-grid').firstElementChild;
      assert.ok(first.classList.contains('equipment-critical-field'));
      assert.ok(first.firstElementChild.classList.contains('equipment-pacemaker'));
      assert.equal(first.nextElementSibling.querySelector('input').className,'equipment-rate');
    }
    const [first,second]=cards.map(card=>card.querySelector('.equipment-pacemaker'));
    first.click();assert.equal(first.checked,true);
    second.click();assert.equal(second.checked,true);assert.equal(first.checked,false);
    assert.ok(cards.every(card=>card.querySelector('.equipment-rate').value==='480'));
  }finally{w.close();}
});
