import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

const html=renderAppsScript().html;
const source=name=>fs.readFileSync('apps-script/'+name,'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
function harness(mode='ADVANCE'){
  const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()}),w=dom.window,d=w.document;
  const get=id=>d.getElementById(id);
  d.documentElement.dataset.uiMode=mode.toLowerCase();
  w.__ST_TEXT__=key=>key;
  w.matchMedia=()=>({matches:true});
  w.STMotion={reduced:()=>true,reveal(){}};
  w.STErrors={capture(){}};
  w.STIcons={svg:()=>'<svg class="icon"></svg>'};
  w.STMarkdown={render:(text,node)=>{node.textContent=text;}};
  w.STPreferences={read:()=>null,write(){},caseOptions:()=>({equipmentLayout:'combined',seedPolicy:'FIXED',showRealData:true}),setCaseOptions(){}};
  w.STPlantCalendar={mount:()=>()=>{}};w.STRunOptions={sync(){}};w.STReports={rateLossCategories:[]};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  let editing=false;
  w.STBasicMode={isSplit:()=>false};
  w.STEquipmentInspector={sync:()=>editing,hide(){editing=false;},name:()=>editing?'Selected machine':''};
  const simulation={id:'simulation-a',name:'Baseline',geminiHistory:[{role:'model',text:'Saved answer',scope:'CASE'}]};
  const state={bootstrap:{uiMode:mode,gemini:{configured:true,generation:{displayMode:'IMMEDIATE'}}},activeCase:{id:'case-a',name:'Case',simulations:[simulation]},activeSimulationId:simulation.id,uiView:'editor',saving:false};
  const calls=[];let success;
  const runner={withFailureHandler(){return runner;},withSuccessHandler(fn){success=fn;return runner;},askGemini(request){calls.push(request);}};
  w.google={script:{run:runner}};
  const actions={flush:async()=>({}),saveChat:async()=>{},applyScenario:async()=>{}};
  return {dom,w,d,get,state,simulation,calls,actions,
    editing(value){editing=value;},mode(value){state.bootstrap.uiMode=value;d.documentElement.dataset.uiMode=value.toLowerCase();},
    answer(text){success({ok:true,data:{text}});},close:()=>w.close()};
}

test('Gemini settings hide in Basic and leave a selected tab without clearing saved configuration',()=>{
  const h=harness();
  try{
    h.w.eval(source('Settings.html'));const settings=h.w.STSettings;
    let modelReply,loads=0;settings.connectModels(reply=>{loads++;modelReply=reply;});
    settings.init();settings.configureGemini({configured:true,model:'saved-model',prompts:[{id:'engineering',label:'Engineering',defaultText:'Retained instructions'}]});
    settings.open();h.get('settings-tab-gemini').click();
    assert.equal(h.get('settings-page-gemini').classList.contains('hidden'),false);assert.equal(loads,1);
    h.get('gemini-api-key').value='Unsubmitted draft';h.get('gemini-prompt-engineering').querySelector('textarea').value='Edited instructions';
    h.get('gemini-api-key').focus();h.mode('BASIC');settings.syncMode();
    assert.equal(h.get('settings-tab-gemini').classList.contains('hidden'),true);
    assert.equal(h.get('settings-page-gemini').classList.contains('hidden'),true);assert.equal(h.get('settings-page-gemini').inert,true);
    assert.equal(h.get('settings-tab-appearance').getAttribute('aria-selected'),'true');
    assert.equal(h.d.activeElement,h.get('settings-tab-appearance'));
    h.get('settings-tab-gemini').click();h.get('gemini-refresh-models').click();
    assert.equal(h.get('settings-tab-appearance').getAttribute('aria-selected'),'true');assert.equal(loads,1);
    modelReply({ok:true,data:{models:[{id:'saved-model',label:'Saved model'}]}});
    assert.equal(h.get('settings-page-gemini').classList.contains('hidden'),true,'A late model-list response cannot reveal the page');
    assert.equal(h.get('gemini-api-key').value,'Unsubmitted draft');
    assert.equal(h.get('gemini-model').value,'saved-model');
    assert.equal(h.get('gemini-prompt-engineering').querySelector('textarea').value,'Edited instructions');
    h.mode('ADVANCE');settings.syncMode();h.get('settings-tab-gemini').click();
    assert.equal(h.get('settings-tab-gemini').classList.contains('hidden'),false);
    assert.equal(h.get('settings-page-gemini').classList.contains('hidden'),false);assert.equal(h.get('settings-page-gemini').inert,false);
  }finally{h.close();}
});

test('Basic blocks chat entry and submission while retaining the combined equipment inspector',()=>{
  const h=harness('BASIC');
  try{
    h.w.eval(source('Assistant.html'));const assistant=h.w.STAssistant(h.state,h.actions);assistant.init();assistant.sync();
    h.get('toggle-gemini').click();h.get('gemini-question').value='Hidden request';
    h.get('gemini-form').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(h.calls.length,0);assert.equal(h.get('toggle-gemini').classList.contains('hidden'),true);
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),true);assert.equal(h.get('gemini-chat-view').inert,true);
    h.editing(true);assistant.sync();
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),false);
    assert.equal(h.get('equipment-inspector').classList.contains('hidden'),false);
    assert.equal(h.get('gemini-chat-view').classList.contains('hidden'),true);
    assert.equal(h.get('gemini-title').textContent,'inspector.equipment');
    h.get('close-gemini').click();
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),true);
    assert.equal(h.get('application').classList.contains('assistant-open'),false);
    assert.equal(h.d.activeElement,h.get('equipment-subsection-title'));
    assert.equal(h.simulation.geminiHistory[0].text,'Saved answer');
  }finally{h.close();}
});

test('switching to Basic closes the chat and a late answer is retained without reopening it',()=>{
  const h=harness();
  try{
    let cancelled=0;h.w.STMotion.reduced=()=>false;h.get('gemini-panel').animate=()=>{};
    h.w.STMotion.panel=()=>({cancel(){cancelled++;}});
    h.w.eval(source('Assistant.html'));const assistant=h.w.STAssistant(h.state,h.actions);assistant.init();assistant.sync();
    h.get('toggle-gemini').click();assert.equal(h.get('gemini-panel').classList.contains('hidden'),false);
    h.get('gemini-scope').checked=false;h.get('gemini-question').value='Question in Advance';
    h.get('gemini-form').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].uiMode,'ADVANCE');
    h.get('close-gemini').click();const closing=cancelled;
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),false,'The close animation has not finished');
    h.mode('BASIC');assistant.sync();
    assert.equal(cancelled,closing+1,'Basic immediately cancels an unfinished close animation');
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),true);
    assert.equal(h.get('application').classList.contains('assistant-open'),false);
    h.answer('Reply received after the mode changed');
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),true);
    assert.equal(h.get('gemini-chat-view').classList.contains('hidden'),true);
    assert.equal(h.simulation.geminiHistory.at(-1).text,'Reply received after the mode changed');
    h.mode('ADVANCE');assistant.sync();
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),true,'Changing modes alone does not reopen chat');
    h.get('toggle-gemini').click();
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),false);
    assert.match(h.get('gemini-messages').textContent,/Reply received after the mode changed/);
  }finally{h.close();}
});

test('a case save that finishes after entering Basic does not start a new Gemini request',async()=>{
  const h=harness();
  try{
    let finishSave;h.actions.flush=()=>new Promise(resolve=>{finishSave=resolve;});
    h.w.eval(source('Assistant.html'));const assistant=h.w.STAssistant(h.state,h.actions);assistant.init();assistant.sync();
    h.get('toggle-gemini').click();h.get('gemini-question').value='Pending case question';
    h.get('gemini-form').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
    h.mode('BASIC');assistant.sync();finishSave({});await new Promise(resolve=>h.w.setTimeout(resolve,0));
    assert.equal(h.calls.length,0);assert.equal(h.get('gemini-question').value,'Pending case question');
    assert.equal(h.get('gemini-panel').classList.contains('hidden'),true);
    assert.equal(h.get('send-gemini').disabled,true);
  }finally{h.close();}
});
