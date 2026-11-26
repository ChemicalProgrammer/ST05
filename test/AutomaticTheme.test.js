import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function preferences(hour, minute = 0, savedTheme) {
  let now = new Date(2026, 9, 8, hour, minute).getTime(), timerId = 0;
  const storage = {}, timers = new Map(), events = {}, documentEvents = {};
  if (savedTheme) storage['st.ui.v1.theme'] = savedTheme;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const root = {dataset:{},classList:{add(){},remove(){}},style:{setProperty(){}}};
  const context = {
    Date:Clock, Event,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout(id){timers.delete(id);},
    localStorage:storage,
    document:{documentElement:root,hidden:false,getElementById(){return null;},querySelectorAll(){return [];},addEventListener(name,fn){documentEvents[name]=fn;}},
    addEventListener(name,fn){events[name]=fn;}, dispatchEvent(){}
  };
  Object.defineProperties(storage,{
    getItem:{value:key=>storage[key]??null},setItem:{value:(key,value)=>{storage[key]=value;}},removeItem:{value:key=>{delete storage[key];}}
  });
  context.window=context;vm.createContext(context);
  for(const file of ['ThemeResources','UiPreferences'])vm.runInContext(fs.readFileSync(new URL('../apps-script/'+file+'.html',import.meta.url),'utf8').replace(/<\/?script>/g,''),context);
  return {context,root,timers,storage,events,documentEvents,setTime(hour,minute=0){now=new Date(2026,9,8,hour,minute).getTime();}};
}

test('automatic theme defaults to local day and night, with exact 07:00 and 19:00 boundaries',()=>{
  for(const [hour,minute,expected] of [[0,0,'dark'],[6,59,'dark'],[7,0,'light'],[18,59,'light'],[19,0,'dark'],[23,59,'dark']]){
    const p=preferences(hour,minute);
    assert.equal(p.root.dataset.theme,expected);
    assert.equal(p.timers.size,1);
  }
});

test('an open app schedules and applies the next local boundary',()=>{
  const p=preferences(6,59),pending=[...p.timers.values()][0];
  assert.equal(pending.delay,60050);
  p.setTime(7);pending.fn();
  assert.equal(p.root.dataset.theme,'light');
  assert.equal(p.timers.size,1);
  assert.equal([...p.timers.values()][0].delay,12*60*60*1000+50);
});

test('manual theme cancels automatic switching and resetting returns to automatic defaults',()=>{
  const p=preferences(20);
  p.context.STPreferences.setTheme('light');
  assert.equal(p.root.dataset.theme,'light');assert.equal(p.timers.size,0);
  p.context.STPreferences.reset();
  assert.equal(p.root.dataset.theme,'dark');assert.equal(p.storage['st.ui.v1.theme'],'auto');assert.equal(p.timers.size,1);
  const manual=preferences(12,0,'dark');assert.equal(manual.root.dataset.theme,'dark');assert.equal(manual.timers.size,0);
});

test('focus and visibility changes recover automatic appearance after a suspended tab',()=>{
  const p=preferences(12);p.setTime(20);p.events.focus();assert.equal(p.root.dataset.theme,'dark');
  p.setTime(8);p.documentEvents.visibilitychange();assert.equal(p.root.dataset.theme,'light');
});


test('separate case colors default off, isolate both palette IDs and never store a theme',()=>{
  const p=preferences(12,0,'dark'),api=p.context.STPreferences;
  const palette=(accent,secondaryAccent)=>({accent,secondaryAccent});
  const plain=value=>JSON.parse(JSON.stringify(value));
  let record=null,edits=0;
  api.connectCase(()=>record,()=>{},()=>edits++);
  assert.equal(api.separateCaseColors(),false);
  api.setAccent('amparo-blue');api.setSecondaryAccent('astronomicon-grey');
  const general=palette('amparo-blue','astronomicon-grey');
  const previous=palette('boat-house','redcurrant');
  record={id:'case-a',metadata:{caseAppearance:previous}};
  api.loadCaseColors();
  assert.deepEqual(plain(api.currentColors()),general);
  assert.deepEqual(plain(api.captureCaseColors(plain(record)).metadata.caseAppearance),previous);
  assert.equal(edits,0);
  api.setSeparateCaseColors(true);
  assert.deepEqual(plain(api.currentColors()),previous);
  api.setAccent('aviator');api.setSecondaryAccent('blues');
  const current=palette('aviator','blues');
  assert.equal(edits,2);assert.equal(api.caseColorsNeedSave(),true);
  const captured=api.captureCaseColors(plain(record));
  assert.deepEqual(plain(captured.metadata.caseAppearance),current);
  assert.deepEqual(record.metadata.caseAppearance,previous);
  assert.deepEqual(Object.keys(captured.metadata.caseAppearance).sort(),['accent','secondaryAccent']);
  assert.equal(p.storage['st.ui.v1.accent'],general.accent);
  assert.equal(p.storage['st.ui.v1.secondaryAccent'],general.secondaryAccent);
  record.metadata.caseAppearance=plain(captured.metadata.caseAppearance);
  assert.equal(api.caseColorsNeedSave(),false);
  record={id:'case-b',metadata:{caseAppearance:palette('blues','adamite-green')}};
  api.loadCaseColors();
  assert.deepEqual(plain(api.currentColors()),record.metadata.caseAppearance);
  assert.equal(p.root.dataset.theme,'dark');
  api.setTheme('light');
  assert.equal(api.caseColorsNeedSave(),false);
  assert.equal(p.root.dataset.theme,'light');
  record=null;api.loadCaseColors();
  assert.deepEqual(plain(api.currentColors()),general);
  record={id:'case-c',metadata:{}};api.loadCaseColors();
  assert.deepEqual(plain(api.currentColors()),general);
  assert.equal(api.caseColorsNeedSave(),true);
  assert.deepEqual(record.metadata,{});
  api.setSeparateCaseColors(false);
  assert.equal(api.caseColorsNeedSave(),false);
  assert.deepEqual(plain(api.captureCaseColors(plain(record)).metadata),{});
  record={id:'case-a',metadata:{caseAppearance:current}};api.loadCaseColors();
  assert.deepEqual(plain(api.currentColors()),general);
  api.setAccent('boat-house');
  assert.deepEqual(plain(api.captureCaseColors(plain(record)).metadata.caseAppearance),current);
  api.setSeparateCaseColors(true);
  assert.deepEqual(plain(api.currentColors()),current);
  assert.equal(p.root.dataset.accent,current.accent);
  assert.equal(p.root.dataset.secondaryAccent,current.secondaryAccent);
  api.reset();assert.equal(api.separateCaseColors(),false);
  assert.equal(p.storage['st.ui.v1.separateCaseColors'],undefined);
  assert.deepEqual(record.metadata.caseAppearance,current);
});
