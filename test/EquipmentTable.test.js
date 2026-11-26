import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const source=fs.readFileSync('apps-script/EquipmentTable.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

function fixture(){
  const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window,d=w.document;
  const node=(tag,cls='',text='')=>{const n=d.createElement(tag);n.className=cls;n.textContent=text;return n;};
  const withId=(tag,id)=>{const n=node(tag);n.id=id;return n;};
  const section=withId('section','equipment-section'),tools=withId('div','equipment-view-tools');
  const cardsButton=withId('button','equipment-view-cards'),tableButton=withId('button','equipment-view-table');
  tools.append(cardsButton,tableButton);
  const list=withId('div','equipment-list'),host=withId('div','equipment-table-view');
  const content=withId('div','equipment-section-content');content.append(list,host);section.append(tools,content);d.body.append(section);
  const state={activeCase:{id:'c'},uiView:'editor',bootstrap:{uiMode:'ADVANCE'}};
  const preferences=new Map(),calls={dirty:0,evaluation:0,delete:0,reorder:0,releases:0};
  let view='equipment',split=false;
  w.STPreferences={read:key=>preferences.get(key),write:(key,value)=>preferences.set(key,value)};
  w.STIcons={button(){},equipment:()=>''};
  w.STEquipmentInspector={release(){calls.releases++;},hide(){}};
  w.STBasicMode={sync(){w.STEquipmentTable.sync(state,view,split);}};
  function field(parent,cls,value,options={}){
    const label=node('label','',options.label||cls),control=node(options.tag||'input',cls);
    if(control.tagName==='SELECT'){
      for(const v of options.options||[value]){const option=node('option','',v);option.value=v;control.append(option);}
    }else if(control.tagName==='INPUT')control.type=options.type||'text';
    if(control.type==='checkbox')control.checked=Boolean(value);
    else if(control.tagName==='OUTPUT')control.textContent=value;
    else control.value=String(value);
    if(options.min!=null)control.min=String(options.min);
    control.readOnly=Boolean(options.readOnly);control.disabled=Boolean(options.disabled);
    if(options.hidden)label.hidden=true;
    label.append(control);parent.append(label);
    return control;
  }
  function card(id,type,index){
    const c=node('article','equipment-card');c.dataset.equipmentId=id;c.dataset.index=String(index);
    const drag=node('button','equipment-drag'),remove=node('button','remove-equipment');
    drag.addEventListener('keydown',()=>calls.reorder++);remove.addEventListener('click',()=>calls.delete++);
    c._moveTableRow=(target,group)=>{calls.reorder++;calls.lastMove=[c.dataset.equipmentId,target.dataset.equipmentId,group];};
    const verdict=node('button','equipment-analysis-pill','PASS');verdict.addEventListener('click',()=>calls.evaluation++);
    const fields=node('div','equipment-fields');c.append(drag,remove,verdict,fields);c._fields=fields;
    c._equipmentReliabilityVerdict=type==='CONVEYOR'?null:verdict;c._editorConveyorVerdict=type==='CONVEYOR'?verdict:null;
    field(fields,'equipment-name',id,{label:'Name'});
    field(fields,'equipment-type',type,{tag:'select',options:['FILLER','CAPPER','CONVEYOR']});
    if(type!=='CONVEYOR'){
      field(fields,'equipment-rate',480,{type:'number',min:0,label:'Speed (bpm)'});
      field(fields,'equipment-maximum-speed',600,{type:'number',min:0});
      field(fields,'equipment-material-flow','BOTTLES/BOTTLES',{tag:'select',options:['BOTTLES/BOTTLES','CASES/CASES']});
      const pace=field(fields,'equipment-pacemaker',false,{type:'checkbox'});
      pace.addEventListener('change',()=>{if(pace.checked)list.querySelectorAll('.equipment-pacemaker').forEach(other=>{if(other!==pace)other.checked=false;});});
      field(fields,'equipment-internal-capacity',30,{type:'number'});
      field(fields,'equipment-occupancy-mode','STORAGE',{tag:'select',options:['STORAGE','POSITIONS']});
      field(fields,'equipment-macrostop-scrap',3,{type:'number'});
      const rel=node('section','reliability-controls');fields.append(rel);
      const mode=field(rel,'','general',{tag:'select',options:['general','split']});
      const general=['mtbfMinutes','mttrMinutes'].map((key,i)=>field(rel,'reliability-'+key,[5,2][i],{type:'number'}));
      const breakdown=[];for(const kind of ['minor','major'])for(const key of ['mtbfMinutes','mttrMinutes']){const input=field(rel,'',1,{type:'number',disabled:true,readOnly:true});input.dataset.stopClass=kind;input.dataset.parameterHelp='reliability-'+key;breakdown.push(input);}
      mode.addEventListener('change',()=>{general.forEach(input=>{input.disabled=input.readOnly=mode.value==='split';});breakdown.forEach(input=>{input.disabled=input.readOnly=mode.value!=='split';});});
    }else{
      field(fields,'equipment-transport-unit','Bottle',{tag:'output'});
      field(fields,'format-zone-lact',1000,{type:'number'});
      field(fields,'format-zone-belt-speed',500,{type:'number',readOnly:true});
      const toggle=field(fields,'format-zone-population-enabled',false,{type:'checkbox'});
      const target=field(fields,'format-zone-population',40,{type:'number',readOnly:true});
      const speed=fields.querySelector('.format-zone-belt-speed');
      toggle.addEventListener('change',()=>{target.readOnly=!toggle.checked;target.dataset.fieldRole=toggle.checked?'INPUT':'OUTPUT';});
      target.addEventListener('input',()=>{speed.value=String(Number(target.value)*10);});
      const mode=field(fields,'format-zone-speed-mode','AUTO',{tag:'select',options:['AUTO','MANUAL','DYNAMIC']});
      const dynamic=field(fields,'format-zone-dynamic-percent',120,{type:'number',hidden:true});
      mode.addEventListener('change',()=>{dynamic.parentElement.hidden=mode.value!=='DYNAMIC';});
    }
    fields.addEventListener('input',()=>calls.dirty++);
    fields.addEventListener('change',()=>calls.dirty++);
    list.append(c);return c;
  }
  const a=card('Filler','FILLER',0),b=card('Belt','CONVEYOR',1),c=card('Capper','CAPPER',2);
  w.eval(source);w.STBasicMode.sync(state);
  return {dom,w,d,state,calls,preferences,list,host,tools,content,a,b,c,card,cardsButton,tableButton,
    sync:(v='equipment',s=false)=>{view=v;split=s;w.STBasicMode.sync(state);},
    row:id=>host.querySelector('[data-table-equipment-id="'+id+'"]'),
    cell:(id,col)=>host.querySelector('[data-table-equipment-id="'+id+'"] td[data-column="'+col+'"]'),
    close:()=>dom.window.close()};
}
function emit(h,control,type='input'){control.dispatchEvent(new h.w.Event(type,{bubbles:true}));}

test('Advance tables share one header per input, keep original cards and edit through their events',()=>{
 const h=fixture();
 try{
   assert.equal(h.tools.hidden,false);assert.equal(h.host.hidden,true);
   h.tableButton.click();assert.equal(h.host.hidden,false);
   assert.equal(h.tableButton.getAttribute('aria-pressed'),'true');assert.equal(h.cardsButton.getAttribute('aria-pressed'),'false');
   assert.equal(h.host.querySelectorAll('table').length,2);
   assert.equal(h.host.querySelectorAll('tbody tr').length,3);
   assert.equal(h.host.querySelectorAll('th[data-column="rate"]').length,1);
   const original=h.a._fields.querySelector('.equipment-rate'),proxy=h.cell('Filler','rate').querySelector('input');
   assert.equal(proxy.value,'480');assert.equal(proxy.min,'0');assert.equal(h.list.querySelectorAll('.equipment-rate').length,2);
   assert.equal(h.d.querySelectorAll('.equipment-rate').length,2,'no duplicate canonical selectors');
   assert.equal(h.calls.dirty,0);
   proxy.value='525';emit(h,proxy);
   assert.equal(original.value,'525');assert.equal(h.calls.dirty,1);
   assert.equal(h.cell('Filler','rate').querySelector('input'),proxy,'value refresh does not replace the focused control');
   const next=h.cell('Filler','critical').querySelector('input');next.checked=true;emit(h,next,'change');
   const other=h.cell('Capper','critical').querySelector('input');other.checked=true;emit(h,other,'change');
   assert.equal(next.checked,false);assert.equal(h.c._fields.querySelector('.equipment-pacemaker').checked,true);
   h.row('Filler').querySelector('.equipment-table-verdict').click();assert.equal(h.calls.evaluation,1);
   h.row('Filler').querySelector('.equipment-table-symbol').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
   assert.equal(h.calls.reorder,1);assert.deepEqual(h.calls.lastMove,['Filler','Capper','equipment']);
   h.cardsButton.click();assert.equal(h.host.hidden,true);assert.equal(h.list.querySelectorAll('.equipment-card').length,3);
   assert.equal(h.a._fields.querySelector('.equipment-rate'),original);assert.equal(original.value,'525');
   assert.equal(h.calls.dirty,3,'view buttons do not dirty the case');
 }finally{h.close();}
});

test('conveyor table mirrors calculated values, manual switches and conditional columns',()=>{
 const h=fixture();
 try{
   h.tableButton.click();
   const population=h.cell('Belt','population'),manual=population.querySelector('input[type="checkbox"]'),value=population.querySelector('input[type="number"]');
   assert.equal(value.readOnly,true);
   value.value='99';emit(h,value);assert.equal(h.b._fields.querySelector('.format-zone-population').value,'40');
   assert.equal(value.value,'40');
   manual.checked=true;emit(h,manual,'change');assert.equal(value.readOnly,false);
   value.value='55';emit(h,value);
   assert.equal(h.b._fields.querySelector('.format-zone-population').value,'55');
   const speed=h.cell('Belt','belt-speed').querySelector('input');assert.equal(speed.value,'550');assert.equal(speed.readOnly,true);
   assert.equal(h.cell('Belt','dynamic-percent'),null);
   const mode=h.cell('Belt','speed-mode').querySelector('select');mode.value='DYNAMIC';emit(h,mode,'change');
   assert.equal(h.cell('Belt','dynamic-percent').querySelector('input').value,'120');
   const reliability=h.cell('Filler','stop-mode').querySelector('select');reliability.value='split';emit(h,reliability,'change');
   assert.equal(h.cell('Filler','minor-mtbf').querySelector('input').hidden,false);
   assert.equal(h.cell('Capper','minor-mtbf').querySelector('input').hidden,false);
   assert.equal(h.cell('Capper','minor-mtbf').querySelector('input').disabled,true);
   assert.equal(h.cell('Filler','mtbf').querySelector('input').hidden,false);
   assert.equal(h.cell('Filler','mtbf').querySelector('input').disabled,true);
 }finally{h.close();}
});

test('table preferences are separate by section, respect filters, Basic, language and replacement cards',()=>{
 const h=fixture();
 try{
   h.sync('equipment',true);h.b.classList.add('hidden');h.tableButton.click();
   assert.equal(h.host.querySelectorAll('tbody tr').length,2);
   assert.equal(h.preferences.get('equipmentView.equipment'),'table');
   h.a.classList.add('hidden');h.c.classList.add('hidden');h.b.classList.remove('hidden');
   h.sync('conveyors',true);assert.equal(h.host.hidden,true);
   h.tableButton.click();assert.equal(h.host.querySelectorAll('tbody tr').length,1);
   h.cardsButton.click();assert.equal(h.preferences.get('equipmentView.conveyors'),'cards');
   h.a.classList.remove('hidden');h.c.classList.remove('hidden');h.b.classList.add('hidden');
   h.sync('equipment',true);assert.equal(h.host.hidden,false);
   const original=h.a._fields.querySelector('.equipment-rate');
   h.state.bootstrap.uiMode='BASIC';h.sync('equipment',true);
   assert.equal(h.tools.hidden,true);assert.equal(h.host.hidden,true);
   assert.equal(h.a._fields.querySelector('.equipment-rate'),original);
   h.state.bootstrap.uiMode='ADVANCE';h.sync('equipment',true);assert.equal(h.host.hidden,false);
   h.d.documentElement.lang='es';h.w.dispatchEvent(new h.w.Event('st-language-change'));
   assert.equal(h.tableButton.title,'Vista de tablas');
   assert.equal(h.host.querySelector('th[data-column="rate"]').textContent,'Velocidad');
   assert.equal(h.host.querySelector('th[data-unit-for="rate"]').textContent,'bpm / cajas/min');
   h.a.remove();const replacement=h.card('Filler','FILLER',0);h.w.STEquipmentTable.refresh();
   const proxy=h.cell('Filler','rate').querySelector('input');proxy.value='700';emit(h,proxy);
   assert.equal(replacement._fields.querySelector('.equipment-rate').value,'700');
   assert.equal(original.value,'480','old draft control is not edited');
 }finally{h.close();}
});

test('group headings span their parameters, labels and units are separate, and resizable columns retain minimums',()=>{
 const h=fixture();
 try{
   h.tableButton.click();
   const table=h.row('Filler').closest('table'),head=table.querySelector('thead');
   assert.equal(head.querySelectorAll('tr').length,3);
   const headings=[...head.querySelectorAll('.equipment-table-group-heading')].filter(th=>th.textContent);
   assert.deepEqual(headings.map(th=>th.querySelector('button span').textContent),['General','Machine design','Reliability']);
   assert.equal(headings.reduce((sum,th)=>sum+th.colSpan,0),head.querySelectorAll('th[data-column]').length-3);
   const beltHead=h.row('Belt').closest('table').querySelector('thead');
   assert([...beltHead.querySelectorAll('.equipment-table-group-heading')].some(th=>th.querySelector('button span')?.textContent==='Geometry'));
   assert.equal(h.row('Filler').querySelector('.equipment-table-position'),null);
   assert.equal(h.row('Belt').querySelector('.equipment-table-position'),null);
   assert.equal(head.querySelectorAll('th[data-column="evaluation"]').length,1);
   assert.equal(head.querySelector('th[data-column="rate"]').textContent,'Speed');
   assert.equal(head.querySelector('th[data-unit-for="rate"]').textContent,'bpm / cases/min');
   assert.equal(h.row('Filler').lastElementChild.dataset.column,'delete');
   h.row('Filler').lastElementChild.querySelector('button').click();assert.equal(h.calls.delete,1);
   const handle=head.querySelector('th[data-column="rate"] .equipment-table-resize');
   const width=()=>Number(handle.getAttribute('aria-valuenow')),minimum=Number(handle.getAttribute('aria-valuemin'));
   const initial=width();assert(initial>=minimum&&minimum>=68);
   const press=key=>handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
   press('ArrowRight');assert.equal(width(),initial+8);
   for(let i=0;i<100;i++)press('ArrowLeft');assert.equal(width(),minimum);
   press('Home');assert.equal(width(),initial);
   // Pointer resize uses the exact same clamp and double-click resets.
   const send=(target,type,x)=>{
     const ev=new h.w.MouseEvent(type,{button:0,clientX:x,clientY:80,bubbles:true,cancelable:true});
     Object.defineProperty(ev,'pointerId',{value:2});target.dispatchEvent(ev);
   };
   send(handle,'pointerdown',100);send(h.w,'pointermove',140);send(h.w,'pointerup',140);assert.equal(width(),initial+40);
   handle.dispatchEvent(new h.w.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.equal(width(),initial);
   press('ArrowRight');const custom=width();h.cardsButton.click();h.tableButton.click();
   assert.equal(Number(h.row('Filler').closest('table').querySelector('th[data-column="rate"] .equipment-table-resize').getAttribute('aria-valuenow')),custom);
 }finally{h.close();}
});

test('rows visibly shift while dragging, reverse smoothly, and only commit on drop',()=>{
 const h=fixture();
 try{
   // Use three machines of unequal row heights to exercise real gaps.
   const thirdCard=h.card('Packer','FILLER',3);
   h.tableButton.click();
   const first=h.row('Filler'),middle=h.row('Capper'),last=h.row('Packer'),icon=first.querySelector('.equipment-table-symbol');
   const scroller=first.closest('.equipment-table-scroll'),table=first.closest('table');
   const rect=(top,height)=>({top,bottom:top+height,height,left:0,right:500,width:500});
   let tableTop=70;
   table.getBoundingClientRect=()=>rect(tableTop,180);
   first.getBoundingClientRect=()=>rect(100+tableTop-70,40);
   middle.getBoundingClientRect=()=>rect(140+tableTop-70,60);
   last.getBoundingClientRect=()=>rect(200+tableTop-70,35);
   scroller.getBoundingClientRect=()=>rect(70,165);
   const send=(target,type,x,y)=>{
     const ev=new h.w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});
     Object.defineProperty(ev,'pointerId',{value:1});target.dispatchEvent(ev);
   };
   const unchanged=()=>assert.deepEqual([...h.list.querySelectorAll('.equipment-card')].map(c=>c.dataset.equipmentId),['Filler','Belt','Capper','Packer']);
   const reset=()=>{
     for(const r of [first,middle,last])assert.equal(r.style.transform,'');
     assert(!table.classList.contains('equipment-table-row-drag-active'));
     assert(!first.classList.contains('equipment-table-dragging'));
   };
   send(icon,'pointerdown',10,120);send(h.w,'pointermove',10,170);
   assert(table.classList.contains('equipment-table-row-drag-active'));
   assert(first.classList.contains('equipment-table-dragging'));
   assert.equal(first.style.transform,'translateY(50px)');
   assert.equal(middle.style.transform,'translateY(-40px)');
   assert.equal(last.style.transform,'');
   assert.equal(h.calls.reorder,0);unchanged();
   send(h.w,'pointermove',10,220);
   assert.equal(middle.style.transform,'translateY(-40px)');
   assert.equal(last.style.transform,'translateY(-40px)');
   assert.equal(first.style.transform,'translateY(95px)');
   assert.equal(h.calls.reorder,0);
   send(h.w,'pointermove',10,170);
   assert.equal(last.style.transform,'','returning across a row closes the gap');
   assert.equal(middle.style.transform,'translateY(-40px)');
   tableTop=60;send(h.w,'pointermove',10,170);
   assert.equal(first.style.transform,'translateY(60px)','held row follows the cursor even as the page scrolls');
   h.w.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
   assert.equal(h.calls.reorder,0);reset();unchanged();
   tableTop=70;
   send(icon,'pointerdown',10,120);send(h.w,'pointermove',10,220);send(h.w,'pointerup',600,220);
   assert.equal(h.calls.reorder,0,'drop outside the table cancels');reset();unchanged();
   send(icon,'pointerdown',10,120);send(h.w,'pointermove',10,220);send(h.w,'pointerup',10,220);
   assert.equal(h.calls.reorder,1);assert.deepEqual(h.calls.lastMove,['Filler','Packer','equipment']);
   reset();unchanged();
   assert.equal(thirdCard._fields.querySelector('.equipment-name').value,'Packer');
 }finally{h.close();}
});

test('dragging a lower row upward opens a gap of its own height and cancellation restores the view',()=>{
 const h=fixture();
 try{
   h.tableButton.click();
   const first=h.row('Filler'),last=h.row('Capper'),icon=last.querySelector('.equipment-table-symbol'),table=last.closest('table');
   const rect=(top,height)=>({top,bottom:top+height,height,left:0,right:500,width:500});
   first.getBoundingClientRect=()=>rect(100,40);last.getBoundingClientRect=()=>rect(140,60);
   table.getBoundingClientRect=()=>rect(70,130);last.closest('.equipment-table-scroll').getBoundingClientRect=()=>rect(70,130);
   function send(target,type,y){const ev=new h.w.MouseEvent(type,{button:0,clientX:10,clientY:y,bubbles:true,cancelable:true});Object.defineProperty(ev,'pointerId',{value:3});target.dispatchEvent(ev);}
   send(icon,'pointerdown',170);send(h.w,'pointermove',120);
   assert.equal(last.style.transform,'translateY(-40px)');
   assert.equal(first.style.transform,'translateY(60px)');
   assert.equal(h.calls.reorder,0);
   send(h.w,'pointercancel',120);
   assert.equal(h.calls.reorder,0);assert.equal(first.style.transform,'');assert.equal(last.style.transform,'');
   assert(!table.classList.contains('equipment-table-row-drag-active'));
 }finally{h.close();}
});

test('switching cards and tables animates the new view and section height, but not data refreshes',()=>{
 const h=fixture();
 try{
   const animations=[];
   function animator(node){node.animate=(frames,options)=>{const a={node,frames,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.();}};animations.push(a);return a;};}
   animator(h.content);animator(h.host);animator(h.list);
   h.content.getBoundingClientRect=()=>({height:h.host.hidden?520:210});
   h.tableButton.click();
   assert.equal(h.host.hidden,false);
   assert.equal(animations.length,2);
   assert.equal(animations[0].node,h.host);assert.equal(animations[0].frames[0].opacity,.3);
   assert.deepEqual(Array.from(animations[1].frames,x=>x.height),['520px','210px']);
   assert(h.content.classList.contains('equipment-view-transition'));
   h.w.STEquipmentTable.refresh();h.sync();
   assert.equal(animations.length,2,'normal updates do not restart the transition');
   const rate=h.cell('Filler','rate').querySelector('input');rate.value='575';emit(h,rate);
   assert.equal(h.a._fields.querySelector('.equipment-rate').value,'575');
   h.cardsButton.click();
   assert(animations[0].cancelled&&animations[1].cancelled,'rapid toggles cancel the previous motion');
   assert.equal(animations[2].node,h.list);
   assert.deepEqual(Array.from(animations[3].frames,x=>x.height),['210px','520px']);
   animations[3].onfinish();
   assert(!h.content.classList.contains('equipment-view-transition'));
   assert.equal(h.calls.dirty,1);
   assert.equal(h.a._fields.querySelector('.equipment-rate').value,'575');
   h.w.matchMedia=()=>({matches:true});h.tableButton.click();
   assert.equal(h.host.hidden,false);assert.equal(animations.length,4,'reduced-motion preference suppresses animation');
 }finally{h.close();}
});

test('Minimal mounts the same editable and resizable table as a mixed physical line',()=>{
 const h=fixture();try{
  const compact=h.d.createElement('div');compact.id='minimal-equipment-table-host';h.d.body.append(compact);
  h.state.bootstrap.uiMode='MINIMAL';h.state.uiView='simulation';h.sync('simulation',false);
  assert.equal(h.host.parentElement,compact);assert.equal(h.host.hidden,false);assert.equal(h.tools.hidden,true);
  assert.equal(h.host.querySelectorAll('table.equipment-editor-table').length,1);
  assert.deepEqual(Array.from(h.host.querySelectorAll('tbody tr'),r=>r.dataset.tableEquipmentId),['Filler','Belt','Capper']);
  const rate=h.cell('Filler','rate').querySelector('input');rate.value='350';emit(h,rate);
  assert.equal(h.a._fields.querySelector('.equipment-rate').value,'350');assert.equal(h.calls.dirty,1);
  assert(!h.cell('Belt','rate').querySelector('input'));
  const length=h.cell('Belt','lact').querySelector('input');length.value='2500';emit(h,length);
  assert.equal(h.b._fields.querySelector('.format-zone-lact').value,'2500');assert.equal(h.calls.dirty,2);
  assert(h.host.querySelector('th[data-column="lact"] .equipment-table-resize'));
  h.state.bootstrap.uiMode='ADVANCE';h.state.uiView='editor';h.sync();
  assert.equal(h.host.parentElement,h.content);
 }finally{h.close();}
});

test('mixed table combines material flow and transport, and groups collapse without changing original values',()=>{
 const h=fixture();try{
  const compact=h.d.createElement('div');compact.id='minimal-equipment-table-host';h.d.body.append(compact);
  h.state.bootstrap.uiMode='MINIMAL';h.state.uiView='simulation';h.sync('simulation',false);
  assert.equal(h.host.querySelectorAll('th[data-column=flow]').length,1);assert(!h.host.querySelector('th[data-column=transport]'));
  assert(h.cell('Filler','flow').querySelector('select'));assert.equal(h.cell('Belt','flow').querySelector('output').textContent,'Bottle');
  assert.equal(h.host.querySelector('th[data-column=critical]').textContent,'Critical machine');
  assert(!h.host.querySelector('th[data-column=failure-enabled]'));
  assert.equal(h.cell('Belt','mtbf').textContent,'—');
  const toggle=()=>h.host.querySelector('button[data-group-id="mixed:Reliability"]');
  const original=h.a._fields.querySelector('.reliability-mtbfMinutes');
  assert.equal(toggle().getAttribute('aria-expanded'),'true');toggle().click();
  assert.equal(toggle().getAttribute('aria-expanded'),'false');assert.equal(h.cell('Filler','mtbf'),null);
  assert.equal(original.value,'5');assert.equal(h.calls.dirty,0);toggle().click();
  assert.equal(toggle().getAttribute('aria-expanded'),'true');assert.equal(h.cell('Filler','mtbf').querySelector('input').value,'5');
 }finally{h.close();}
});
