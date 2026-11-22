import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
const load=()=>{const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('apps-script/RunOptions.html','utf8').replace(/<\/?script>/g,''));return dom.window.STRunOptions;};
test('duration units and shift counts resolve to elapsed seconds without stop events',()=>{const api=load();assert.equal(api.resolve({method:'FIXED',amount:30,unit:'DAYS'}),2592000);assert.equal(api.resolve({method:'FIXED',amount:.3,unit:'SECONDS'}),.5);assert.equal(api.resolve({method:'FIXED',amount:2,unit:'WEEKS'}),1209600);assert.equal(api.resolve({method:'SHIFTS',shiftCount:90,shiftHours:8}),2592000);assert.throws(()=>api.resolve({method:'FIXED',amount:0,unit:'DAYS'}),/positive/);});
test('date ranges use the requested timezone, reject invalid local dates and require positive ranges',()=>{const api=load();const start='2026-10-01T00:00',end='2026-10-31T00:00';assert.equal(new Date(api.zonedTimestamp(start,'America/Mexico_City')).toISOString(),'2026-10-01T06:00:00.000Z');assert.equal(api.resolve({method:'DATES',start,end,timeZone:'America/Mexico_City'}),2592000);assert.throws(()=>api.resolve({method:'DATES',start:end,end:start,timeZone:'UTC'}),/follow/);assert.throws(()=>api.zonedTimestamp('2026-02-30T00:00','UTC'),/Invalid date/);assert.throws(()=>api.zonedTimestamp('2026-03-08T02:30','America/New_York'),/does not exist/);});



test('simulation failure toggle restores independent run values and locks during execution',()=>{
 const dom=new JSDOM(fs.readFileSync('apps-script/WebApp.html','utf8'),{runScripts:'outside-only'}),w=dom.window;
 try{
  w.eval(fs.readFileSync('apps-script/RunOptions.html','utf8').replace(/<\/?script>/g,''));
  const toggle=w.document.getElementById('run-reliability-enabled');
  assert(toggle.closest('#run-panel'));assert(!toggle.closest('#settings-dialog'));
  assert.equal(w.document.getElementById('settings-reliability-enabled'),null);
  const a={durationSeconds:600,durationMode:'FIXED',reliabilityEnabled:false},b={durationSeconds:600,durationMode:'FIXED'};
  w.STRunOptions.apply(a);assert.equal(toggle.checked,false);
  w.STRunOptions.apply(b);assert.equal(toggle.checked,true);
  w.STRunOptions.apply(a);assert.equal(toggle.checked,false);
  w.STRunOptions.sync(true);assert.equal(toggle.disabled,true);
  w.STRunOptions.sync(false);assert.equal(toggle.disabled,false);
  assert.equal(a.reliabilityEnabled,false);assert.equal(b.reliabilityEnabled,undefined);
 }finally{w.close();}
});

test('automatic long batches stream round one while explicit calculation modes are honored',()=>{
 const dom=new JSDOM(fs.readFileSync('apps-script/WebApp.html','utf8'),{runScripts:'outside-only'}),w=dom.window;
 try{
  w.eval(fs.readFileSync('apps-script/RunOptions.html','utf8').replace(/<\/?script>/g,''));
  const el=id=>w.document.getElementById(id);
  el('duration-mode').value='FIXED';el('run-duration').value='24';el('run-duration-unit').value='HOURS';
  el('run-calculation-mode').value='AUTO';el('run-rounds').value='1';
  assert.equal(w.STRunOptions.read().calculationMode,'FAST');
  el('run-rounds').value='20';
  assert.equal(w.STRunOptions.read().calculationMode,'LIVE');
  el('run-calculation-mode').value='SUMMARY';
  assert.equal(w.STRunOptions.read().calculationMode,'SUMMARY');
 }finally{w.close();}
});


test('Simulation setup owns event and calendar switches without changing saved calendar data',()=>{
 const dom=new JSDOM(fs.readFileSync('apps-script/WebApp.html','utf8'),{runScripts:'outside-only'}),w=dom.window;
 try{
  w.eval(fs.readFileSync('apps-script/RunOptions.html','utf8').replace('<script>','').replace('</script>',''));
  const event=w.document.getElementById('run-events-enabled');
  const calendar=w.document.getElementById('run-calendar-enabled');
  assert.ok(event.closest('#simulation-duration-content'));
  assert.ok(calendar.closest('#simulation-duration-content'));
  assert.equal(w.document.querySelectorAll('#run-events-enabled').length,1);
  const saved={durationMode:'FIXED',durationSeconds:3600,
   durationOptions:{method:'FIXED',amount:1,unit:'HOURS'},
   plantCalendar:{enabled:true,mode:'SCHEDULED',cleaningMinutes:25},
   eventsEnabled:false,includePlantCalendar:false};
  const before=JSON.stringify(saved.plantCalendar);
  w.STRunOptions.apply(saved);
  assert.equal(event.checked,false);
  assert.equal(calendar.checked,false);
  assert.equal(w.STRunOptions.read().includePlantCalendar,false);
  event.checked=true;calendar.checked=true;
  assert.equal(w.STRunOptions.read().eventsEnabled,true);
  assert.equal(w.STRunOptions.read().includePlantCalendar,true);
  assert.equal(JSON.stringify(saved.plantCalendar),before);
  w.STRunOptions.sync(true);
  assert.equal(event.disabled,true);
  assert.equal(calendar.disabled,true);
 }finally{dom.window.close();}
});


test('disabling control events or calendar excludes them only from execution',()=>{
 const client=fs.readFileSync('apps-script/ClientSimulation.html','utf8');
 const start=client.indexOf('    function prepareCalendarRun(run){');
 const end=client.indexOf('\n    function createControlEventRow(',start);
 assert.ok(start>=0&&end>start);
 const calendar={calculate:()=>({errors:[]})};
 const engine={
  plantCalendarSchedule:()=>({events:[{startSeconds:600,endSeconds:660}],restartPolicy:'RESTART'}),
  resolvePlannedStops:run=>({plannedStopSeconds:run.plannedStops.reduce((sum,e)=>sum+(e.endSeconds-e.startSeconds),0)})
 };
 const prepare=new Function('STPlantCalendar','SimulatorEngine',client.slice(start,end)+';return prepareCalendarRun;')(calendar,engine);
 const original={plantCalendar:{enabled:true,mode:'SCHEDULED'},eventsEnabled:false,includePlantCalendar:true,
  plannedStops:[{source:'MANUAL',startSeconds:100,endSeconds:140}],commands:[{action:'PAUSE'}],
  durationSeconds:3600,tickSeconds:0.25};
 const scheduled=prepare(original);
 assert.equal(scheduled.plannedStops.length,1);
 assert.equal(scheduled.plannedStops[0].source,'PLANT_CALENDAR');
 assert.equal(scheduled.commands.length,0);
 const neither=prepare({...original,includePlantCalendar:false});
 assert.equal(neither.plantCalendar.enabled,false);
 assert.equal(neither.plannedStops.length,0);
 assert.equal(neither.commands.length,0);
 const eventsOnly=prepare({...original,includePlantCalendar:false,eventsEnabled:true});
 assert.equal(eventsOnly.commands.length,1);
 assert.equal(eventsOnly.plannedStops.length,1);
 assert.equal(original.plantCalendar.enabled,true);
});
