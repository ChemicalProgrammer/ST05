import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=name=>fs.readFileSync('apps-script/'+name+'.html','utf8');
test('icon button owns shared normal, menu, disabled, active and destructive styles',()=>{
 const css=read('Styles');
 assert.match(css,/:is\(button,summary\)\.icon-button\s*\{[\s\S]*?border:var\(--border-width\) solid var\(--line-strong\)[\s\S]*?background:var\(--surface\)/);
 assert.match(css,/button\.secondary:not\(\.icon-button\)/);
 assert.match(css,/button\.ghost:not\(\.icon-button\):not\(:disabled\)/);
 assert.match(css,/button\.secondary:not\(\.icon-button\):not\(:disabled\)/);
 assert.match(css,/\.icon-button:where\(:not\(:disabled\):not\(\[aria-disabled=true\]\)\):hover/);
 assert.match(css,/details\[open\] > summary\.icon-button:not\(\[aria-disabled=true\]\)/);
 assert.match(css,/\.icon-button:is\(:disabled,\[aria-disabled=true\]\)\s*\{[^}]*background:var\(--disabled-bg\);color:var\(--disabled\)/);
 assert.match(css,/\.icon-button\.icon-button--retain-active\[aria-pressed=true\]/);
 assert.match(css,/\.icon-button--emergency\s*\{[^}]*--icon-button-active-surface:var\(--danger\)/);
 assert.match(css,/\.icon-button--compact\s*\{--icon-button-size:var\(--size-28\)/);
 assert.doesNotMatch(read('ComponentStyles'),/:is\(\.topbar,#basic-case-actions\) button\.icon-button/);
 assert.doesNotMatch(read('UiStandards'),/\.cases-toolbar > \.icon-button\s*\{[^}]*color:/);
 assert.doesNotMatch(read('ElegantStyles'),/\.equipment-header \.icon-button\s*\{[^}]*background:/);
 assert.doesNotMatch(read('CasesStyles'),/\.case-tools \.icon-button\s*\{/);
 assert.match(read('WebApp'),/id="play-simulation" class="[^"]*icon-button--retain-active/);
 assert.match(read('ClientPlayback'),/classList\.add\('icon-button','icon-button--retain-active'\)/);
 assert.match(read('Simulation2D'),/icon-button icon-button--retain-active/);
});
test('icon decoration promotes only labelled icon-only controls, including menu summaries',()=>{
 const w=new JSDOM('<main><button id="new" data-icon="plus" title="New"></button>'+
 '<details><summary id="menu" class="ghost" data-icon="upload" aria-label="Export"></summary></details>'+
 '<button id="tab" class="app-section-tab" data-icon="chart" aria-label="Results">Results</button>'+
 '<button id="text" data-icon="save" title="Save">Save</button>'+
 '<button id="excluded" data-icon="edit" title="Edit" data-icon-button="false"></button>'+
 '<button id="unlabelled" data-icon="refresh"></button>'+
 '<button id="dynamic" title="Refresh"></button>'+
 '<button id="disabled" data-icon="trash" title="Delete" disabled></button></main>',{runScripts:'outside-only'}).window;
 try{
  w.eval(read('Icons').match(/<script>([\s\S]*?)<\/script>/)[1]);
  const get=id=>w.document.getElementById(id);
  get('dynamic').innerHTML=w.STIcons.svg('refresh');
  w.STIcons.decorate();
  for(const id of ['new','menu','dynamic','disabled'])assert(get(id).classList.contains('icon-button'),id);
  for(const id of ['tab','text','excluded','unlabelled'])assert(!get(id).classList.contains('icon-button'),id);
  assert(get('disabled').disabled);
  const before=get('dynamic').innerHTML;
  w.STIcons.decorate();
  assert.equal(get('dynamic').innerHTML,before);
  assert.equal(get('menu').querySelectorAll('svg.icon').length,1);
  get('menu').parentElement.open=true;
  assert(get('menu').parentElement.open);
 }finally{w.close();}
});
