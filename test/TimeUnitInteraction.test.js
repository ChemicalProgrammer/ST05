import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

const page=new JSDOM(renderAppsScript().html,{virtualConsole:new VirtualConsole()});
const scripts=[...page.window.document.querySelectorAll('script')].map(node=>node.textContent);
function moduleSource(name){
  const script=scripts.find(source=>new RegExp('window\\.'+name+'\\s*=').test(source));
  assert.ok(script,'Expected served module '+name);return script;
}
page.window.close();
const fixture='<label>Duration<span class="time-value-control"><input type="number" value="1">'
  +'<select aria-label="Duration time unit"><option value="SECONDS">s</option><option value="MINUTES">min</option>'
  +'<option value="HOURS">h</option><option value="DAYS">d</option><option value="WEEKS">wk</option></select></span></label>';
function harness(){
  const errors=[],console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(fixture,{runScripts:'outside-only',virtualConsole:console}),w=dom.window,d=w.document;
  w.eval(moduleSource('STTimeControls'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
  return {w,d,errors,select:d.querySelector('select'),input:d.querySelector('input'),close:()=>w.close()};
}
function key(h,key){h.d.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));}
function clickUnit(h,select=h.select){select.dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,cancelable:true}));}
function choose(h,label){
  const row=[...h.d.querySelectorAll('.st-unit-menu-option')].find(node=>node.querySelector('.st-unit-menu-abbreviation').textContent===label);
  assert.ok(row,'Missing unit option '+label);row.click();
}
function animateSpy(h){
  const calls=[];
  h.w.Element.prototype.animate=function(frames,options){
    const record={node:this,frames,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.();}};
    calls.push(record);return record;
  };
  return calls;
}

test('unit picker shows full names and current selection, keeps input values and closes on outside click',()=>{
  const h=harness();
  try{
    const original=h.select,input=h.input;
    h.select.value='MINUTES';h.w.STTimeControls.syncInputs();
    clickUnit(h);
    const menu=h.d.querySelector('[role=listbox]');assert.ok(menu);
    assert.equal(h.select.getAttribute('aria-expanded'),'true');
    assert.equal(h.select.getAttribute('aria-controls'),menu.id);
    const rows=[...menu.querySelectorAll('[role=option]')];assert.equal(rows.length,5);
    assert.deepEqual(rows.map(row=>row.querySelector('.st-unit-menu-name').textContent),['Seconds','Minutes','Hours','Days','Weeks']);
    assert.equal(rows[1].getAttribute('aria-selected'),'true');assert.equal(rows[1].querySelector('.st-unit-menu-check').textContent,'✓');
    let changes=0;h.select.addEventListener('change',()=>changes++);
    choose(h,'d');
    assert.equal(h.d.querySelector('[role=listbox]'),null);assert.equal(h.select.getAttribute('aria-expanded'),'false');
    assert.equal(h.select.value,'DAYS');assert.equal(input.value,'1');assert.equal(changes,1);
    assert.equal(h.w.STTimeControls.inputSeconds(input.value,h.select.value),86400);
    assert.equal(h.d.querySelector('select'),original);assert.equal(h.d.querySelector('input'),input);
    assert.equal(h.d.activeElement,original);
    clickUnit(h);h.d.body.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(h.d.querySelector('[role=listbox]'),null);assert.equal(changes,1);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('keyboard navigation, Escape, Tab and disabled units preserve native select semantics',()=>{
  const h=harness();
  try{
    h.select.focus();key(h,'Enter');assert.ok(h.d.querySelector('[role=listbox]'));
    key(h,'ArrowDown');key(h,'Enter');assert.equal(h.select.value,'MINUTES');assert.equal(h.input.value,'1');
    assert.equal(h.d.activeElement,h.select);
    key(h,' ');key(h,'End');key(h,'Enter');assert.equal(h.select.value,'WEEKS');
    key(h,'ArrowDown');key(h,'Home');key(h,'Escape');assert.equal(h.select.value,'WEEKS','Escape cancels highlight without changing the unit');
    assert.equal(h.select.getAttribute('aria-expanded'),'false');assert.equal(h.select.hasAttribute('aria-activedescendant'),false);
    key(h,'Enter');key(h,'Tab');assert.equal(h.d.querySelector('[role=listbox]'),null);
    h.select.disabled=true;clickUnit(h);assert.equal(h.d.querySelector('[role=listbox]'),null);
    h.select.disabled=false;h.select.options[1].disabled=true;h.select.value='SECONDS';h.select.focus();
    key(h,'Enter');key(h,'ArrowDown');key(h,'Enter');assert.equal(h.select.value,'HOURS','Keyboard skips disabled options');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('pointer activation suppresses the native popup without double toggles and clamps the themed menu to the viewport',()=>{
  const h=harness();
  try{
    h.w.innerWidth=360;h.w.innerHeight=160;
    h.select.getBoundingClientRect=()=>({left:330,right:355,top:132,bottom:154,width:25,height:22});
    const down=()=>{
      const event=new h.w.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0});
      h.select.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
    };
    down();const menu=h.d.querySelector('[role=listbox]');assert.ok(menu);assert.equal(h.d.activeElement,h.select);
    clickUnit(h);assert.equal(h.d.querySelector('[role=listbox]'),menu,'The following click must not toggle the same pointer activation again');
    assert.ok(parseFloat(menu.style.left)>=8);
    assert.ok(parseFloat(menu.style.left)+parseFloat(menu.style.width)<=352);
    assert.ok(parseFloat(menu.style.top)>=8);assert.ok(parseFloat(menu.style.maxHeight)<=144);
    down();clickUnit(h);assert.equal(h.d.querySelector('[role=listbox]'),null,'Clicking an expanded unit closes it once');
    down();h.select.dispatchEvent(new h.w.MouseEvent('pointercancel',{bubbles:true}));
    assert.equal(h.d.querySelector('[role=listbox]'),null);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('unit menu uses the owning modal and translates full names without changing abbreviations',()=>{
  const h=harness();
  try{
    const dialog=h.d.createElement('dialog');dialog.open=true;h.d.body.append(dialog);dialog.append(h.select.parentElement);
    h.w.HTMLElement.prototype.showPopover=function(){this._shown=true;};
    h.w.eval(moduleSource('STLanguage'));h.w.STLanguage.setLanguage('es');
    clickUnit(h);
    const menu=h.d.querySelector('[role=listbox]');assert.equal(menu.parentElement,dialog);assert.equal(menu._shown,true);
    assert.equal(menu.getAttribute('popover'),'manual');
    assert.deepEqual([...menu.querySelectorAll('.st-unit-menu-abbreviation')].map(node=>node.textContent),['s','min','h','d','wk']);
    assert.deepEqual([...menu.querySelectorAll('.st-unit-menu-name')].map(node=>node.textContent),['Segundos','Minutos','Horas','Días','Semanas']);
    assert.ok(parseFloat(menu.style.left)>=8);assert.ok(parseFloat(menu.style.top)>=8);
    h.w.dispatchEvent(new h.w.Event('resize'));assert.equal(h.d.querySelector('[role=listbox]'),null);
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('output picker converts a state group while retaining physical seconds and unrelated controls',()=>{
  const h=harness();
  try{
    const scope=h.d.createElement('section'),first=h.w.STTimeControls.output(3600,{unit:'s',scope}),second=h.w.STTimeControls.output(7200,{unit:'s',scope});
    scope.append(first,second);h.d.body.append(scope);
    const untouched=h.w.STTimeControls.output(60,{unit:'s'});h.d.body.append(untouched);
    const original=[first,second].map(node=>({value:node.querySelector('b'),select:node.querySelector('select')}));
    clickUnit(h,original[0].select);choose(h,'h');
    assert.equal(first.dataset.seconds,'3600');assert.equal(second.dataset.seconds,'7200');
    assert.equal(first.querySelector('b').textContent,'1');assert.equal(second.querySelector('b').textContent,'2');
    [first,second].forEach((node,i)=>{assert.equal(node.dataset.unit,'h');assert.equal(node.querySelector('b'),original[i].value);assert.equal(node.querySelector('select'),original[i].select);});
    assert.equal(untouched.querySelector('select').value,'s');assert.equal(untouched.querySelector('b').textContent,'60');
    assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('only deliberate input unit changes animate grid widths; restoration and reduced motion are immediate',()=>{
  const h=harness();
  try{
    const calls=animateSpy(h),wrapper=h.select.parentElement,mirror=wrapper.querySelector('.time-input-unit-measure');
    // JSDOM has no layout. Deterministic bounds let this test verify that the
    // real event path uses before/after geometry, not assert browser pixels.
    const sizes={s:8,min:25,h:9,d:9,wk:18};
    mirror.getBoundingClientRect=()=>({width:sizes[mirror.textContent]});
    h.input.getBoundingClientRect=()=>({width:300-8-sizes[mirror.textContent]});
    h.select.value='MINUTES';h.select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(calls.length,1);assert.equal(calls[0].node,wrapper);assert.equal(calls[0].options.duration,180);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].frames)),[{gridTemplateColumns:'284px 8px'},{gridTemplateColumns:'267px 25px'}]);
    assert.equal(h.input.value,'1');
    h.select.value='HOURS';h.select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(calls.length,2);assert.equal(calls[0].cancelled,true,'Rapid changes replace the previous animation');
    h.select.value='DAYS';h.w.STTimeControls.syncInputs();assert.equal(calls.length,2,'Restoring configuration does not animate');
    assert.equal(calls[1].cancelled,true,'Restoration removes the previous animated columns immediately');
    h.w.matchMedia=()=>({matches:true});h.select.value='WEEKS';h.select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(calls.length,2);assert.equal(mirror.textContent,'wk');assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});

test('output unit changes ease values once while live updates retain stable reservations and reduced motion',()=>{
  const h=harness();
  try{
    const calls=animateSpy(h),host=h.d.createElement('span');h.d.body.append(host);
    h.w.STTimeControls.setOutput(host,9000,{unit:'s'});
    const output=host.querySelector('.st-time-output'),value=output.querySelector('b'),select=output.querySelector('select');
    value.getBoundingClientRect=()=>({width:value.textContent.length*8});
    select.value='min';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(value.textContent,'150');assert.equal(output.dataset.seconds,'9000');assert.equal(calls.length,1);
    assert.equal(calls[0].frames[0].width,'40px');assert.equal(calls[0].frames[1].width,'24px');
    for(let seconds=9001;seconds<9020;seconds++)h.w.STTimeControls.setOutput(host,seconds,{unit:'s'});
    assert.equal(calls.length,1,'Streaming values do not start new animations');
    const live=h.w.STTimeControls.output(3600,{unit:'s',variant:'metric',reserveSeconds:86400});h.d.body.append(live);
    const fixed=live.style.getPropertyValue('--st-time-value-width');live.querySelector('b').getBoundingClientRect=()=>({width:100});
    live.querySelector('select').value='h';live.querySelector('select').dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(calls.length,2);assert.equal('width' in calls[1].frames[0],false);assert.equal(calls[1].frames[0].opacity,.55);
    assert.equal(live.style.getPropertyValue('--st-time-value-width'),fixed);
    h.w.matchMedia=()=>({matches:true});select.value='h';select.dispatchEvent(new h.w.Event('change',{bubbles:true}));
    assert.equal(calls.length,2);assert.equal(calls[0].cancelled,true,'Reduced motion cancels a previous value transition');
    assert.equal(output.dataset.seconds,'9019');assert.deepEqual(h.errors,[]);
  }finally{h.close();}
});
