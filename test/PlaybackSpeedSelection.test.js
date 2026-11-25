import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

test('2D and numerical playback expose the same speeds and restore the new saved choices',()=>{
  const dom=new JSDOM(renderAppsScript().html,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  try{
    const numerical=w.document.getElementById('run-playback-rate'),twoD=w.document.getElementById('simulation2d-speed');
    const values=select=>Array.from(select.options,option=>Number(option.value));
    assert.deepEqual(values(numerical),values(twoD));
    assert.equal(new Set(values(numerical)).size,numerical.options.length);
    w.eval(fs.readFileSync(new URL('../apps-script/ClientUtils.html',import.meta.url),'utf8'));
    assert.deepEqual(values(numerical).slice(0,5),[0.2,0.5,1,2,5]);
    assert.equal(numerical.value,'1');assert.equal(twoD.value,'1');
    for(const rate of values(numerical)){
      assert(values(numerical).includes(rate));
      for(const select of [numerical,twoD]){
        w.restorePlaybackSpeed(select,rate);assert.equal(Number(select.value),rate);
      }
    }
    w.restorePlaybackSpeed(numerical,1000000);
    assert.equal(numerical.value,'50000','Legacy saved speeds above the shared maximum select the maximum supported speed');
    for(const invalid of [null,0,-1,'bad']){
      w.restorePlaybackSpeed(numerical,invalid);assert.equal(numerical.value,'1');
    }
  }finally{w.close();}
});
