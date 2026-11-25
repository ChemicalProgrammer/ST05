import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync('apps-script/'+name,'utf8');
const client=read('ClientPlayback.html');
function clientFunction(name){
  const start=client.indexOf('    function '+name+'(');
  assert(start>=0,'Missing '+name);
  return client.slice(start,client.indexOf('\n    }',start+10)+6);
}
const almost=(actual,expected,tolerance=1e-8)=>assert(Math.abs(actual-expected)<=tolerance,
  'Expected '+expected+', got '+actual);

test('Live numerical playback honors 0.2x and 0.5x in the real target clock',async()=>{
  const source=clientFunction('scheduleNumericalPlaybackStep');
  const run=new Function('rate',source+`
    let requested=[],next,clock=1000;
    const state={run:{playing:true}};
    const numericalPlaybackContext=()=>1;
    const performance={now:()=>clock};
    const document={getElementById:()=>({value:String(rate)})};
    const window={setTimeout(fn){next=fn;return 1;}};
    const playbackRefreshIntervalMs=()=>50;
    const renderPlaybackFrame=()=>{};
    const showError=error=>{throw error;};
    const syncRunControls=()=>{};
    const disposeNumericalPlayback=()=>{};
    const acceptNumericalPlaybackFrame=(session,frame)=>{session.frame=frame;};
    const numericalPlaybackSession={context:1,pending:false,timer:null,ready:true,
      targetSecond:0,lastWallAt:0,controller:{time:0,tickSeconds:1/120,durationSeconds:60,
      finished:false,async advanceTo(target){requested.push(target);this.time=target;return {virtualSecond:target};}}};
    scheduleNumericalPlaybackStep();
    return async()=>{await next();clock=2000;await next();return requested;};
  `);
  for(const rate of [0.2,0.5,1,2]){
    const values=await run(rate)();
    almost(values[0],rate);almost(values[1],2*rate);
  }
  const invalid=await run(-1)();almost(invalid[0],1);
});

test('saved numerical replay preserves sub-real-time clock and sample delay',()=>{
  const run=new Function('rate',clientFunction('schedulePlaybackStep')+'\n'+clientFunction('playbackElapsed')+`
    let now=0,delay;
    const state={run:{result:{samples:[{virtualSecond:0},{virtualSecond:1}]},sampleIndex:0,playing:true}};
    let playbackClock=null,roundSession=null;
    const performance={now:()=>now};
    const document={getElementById:()=>({value:String(rate)})};
    const window={setTimeout(fn,ms){delay=ms;return 1;}};
    const renderPlaybackFrame=()=>{};
    schedulePlaybackStep();now=1000;
    return {delay,elapsed:playbackElapsed(state.run.result.samples[0])};
  `);
  for(const rate of [0.2,0.5,1]){
    const result=run(rate);almost(result.delay,1000/rate);almost(result.elapsed,rate);
  }
});

test('2D slow motion uses the same fixed physics step at the same virtual horizon',()=>{
  const source=read('Simulation2D.html');
  const start=source.indexOf('  function animate(now){');
  const end=source.indexOf('  function markPlaybackAction(',start);
  assert(start>=0&&end>start);
  const run=new Function('rate',source.slice(start,end)+`
    let previous=1000,lag=0,frame,lastMetrics=0,lastSave=0,runState='Running';
    const step=1/120,limitSeconds=60,shiftOutput=[];
    const advances=[],output={produced:0};
    const model={time:0,line:[output],step(seconds){advances.push(seconds);this.time+=seconds;}};
    const performance={now:()=>0};
    const el=()=>({value:String(rate)});
    const status=()=>{},checkpoint=()=>{},draw=()=>{},syncControls=()=>{},cancelFrame=()=>{};
    const window={requestAnimationFrame(){return 1;}};
    // Advance one virtual second, regardless of wall-clock multiplier.
    animate(1000+1000/rate);
    return {advances,time:model.time,lag};
  `);
  const baseline=run(1);
  assert(baseline.advances.length>=119);
  for(const rate of [0.2,0.5]){
    const result=run(rate);
    assert.deepEqual(result.advances,baseline.advances);
    almost(result.time,baseline.time);
    assert(result.advances.every(seconds=>seconds===1/120));
  }
});

test('all shared selector rates, including fractions, survive server normalization and client restore',()=>{
  const markup=read('PlaybackSpeedOptions.html');
  const values=Array.from(markup.matchAll(/<option value="([^"]+)"/g),m=>Number(m[1]));
  assert.deepEqual(values.slice(0,5),[0.2,0.5,1,2,5]);
  assert(markup.includes('<option value="1" selected>'));
  const gs=read('CaseService.gs');
  const start=gs.indexOf('function normalizeSimulations_('),end=gs.indexOf('\n// Keep presentation nodes',start);
  assert(start>=0&&end>start);
  const normalize=new Function(gs.slice(start,end)+`
    const normalizeObject_=value=>value||{};
    const normalizeEquipmentList_=value=>value;
    const normalizeGeminiConversation_=()=>[];
    return rate=>normalizeSimulations_([{id:'s1',name:'Simulation A',playbackRate:rate}],[],{})[0].playbackRate;
  `)();
  const utils=read('ClientUtils.html');
  const a=utils.indexOf('    function restorePlaybackSpeed('),b=utils.indexOf('\n    }',a+10)+6;
  const restore=new Function(utils.slice(a,b)+';return restorePlaybackSpeed;')();
  let selected='1';
  const select={options:values.map(value=>({value:String(value)})),get value(){return selected;},
    set value(value){selected=values.includes(Number(value))?String(value):'';}};
  for(const rate of values){
    assert.equal(normalize(String(rate)),rate);
    restore(select,rate);assert.equal(Number(select.value),rate);
  }
  for(const rate of [null,0,-1,'bad',Infinity])assert.equal(normalize(rate),1);
  restore(select,normalize(1000000));assert.equal(Number(select.value),50000);
});
