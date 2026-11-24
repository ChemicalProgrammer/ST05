import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=name=>fs.readFileSync(new URL('../apps-script/'+name,import.meta.url),'utf8');
const source=read('Simulation2D.html');
const appearanceSource=source.slice(source.indexOf('  const bottleStyles='),source.indexOf("  el('appearance')?.addEventListener"));
function browser(){
  const dom=new JSDOM('<!doctype html><body><button id="open">Open</button><div id="home" hidden><label class="simulation2d-dialog-field">Equipment view<select id="style"><option value="blocks">Blocks</option><option value="animated">Animated designs</option></select></label></div><canvas id="canvas"></canvas></body>',{runScripts:'outside-only'});
  const w=dom.window,d=w.document,writes=[];
  w.matchMedia=()=>({matches:true});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.STPreferences={read:()=>null,write:(...args)=>writes.push(args)};
  w.STSimulation2DMachines={drawBottle(){},drawCase(){}};w.STMotion={reduced:()=>true,reveal(){}};
  for(const file of ['Icons.html','Subsection.html'])w.eval(read(file).match(/<script>([\s\S]*?)<\/script>/)[1]);
  const record={metadata:{}};
  w.STSubsection.connectCase(()=>record,()=>{});
  d.addEventListener('click',e=>{const b=e.target.closest('[data-subsection-toggle]');if(b)w.STSubsection.userToggle(b,b.getAttribute('aria-expanded')!=='true');});
  let checkpoints=0;w.checkpoint=()=>checkpoints++;w.draw=()=>{};
  w.machineStyle=d.getElementById('style');w.canvas=d.getElementById('canvas');
  w.eval(appearanceSource+'\nwindow.appearanceAPI={open:openAppearance,read:()=>({...appearance})};');
  return {w,d,record,writes,open:()=>{w.appearanceAPI.open();return d.getElementById('simulation2d-appearance-dialog');},value:()=>w.appearanceAPI.read(),checkpoints:()=>checkpoints,close:()=>w.close()};
}
test('layout appearance uses shared tabs and compact persisted subsections without dropping any controls',()=>{
  const h=browser();try{
    const dialog=h.open(),tabs=[...dialog.querySelectorAll('[role=tab]')],pages=[...dialog.querySelectorAll('[role=tabpanel]')];
    assert.deepEqual(tabs.map(t=>t.textContent),['Equipment','Bottles','Boxes']);
    assert(tabs.every(t=>t.classList.contains('app-section-tab')&&t.querySelector('svg')));
    assert.deepEqual(pages.map(p=>p.hidden),[false,true,true]);
    assert.equal(dialog.querySelectorAll('.st-subsection-b').length,4);
    assert.equal(dialog.querySelectorAll('.simulation2d-color-trigger').length,8);
    assert.equal(dialog.querySelectorAll('.simulation2d-bottle-choice').length,9);
    assert.equal(pages[0].querySelectorAll('.simulation2d-color-trigger').length,3);
    assert.equal(pages[1].querySelectorAll('.simulation2d-color-trigger').length,3);
    assert.equal(pages[2].querySelectorAll('.simulation2d-color-trigger').length,2);
    assert.equal(pages[0].querySelector('#style'),h.w.machineStyle);
    tabs[0].dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(tabs[1].getAttribute('aria-selected'),'true');assert.equal(h.d.activeElement,tabs[1]);
    const toggle=pages[1].querySelector('[data-subsection-toggle]');toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'false');
    dialog.querySelector('.dialog-actions .ghost').click();
    const reopened=h.open();reopened.querySelector('#simulation2d-appearance-tab-bottles').click();
    assert.equal(reopened.querySelector('#simulation2d-appearance-group-bottle-shape [data-subsection-toggle]').getAttribute('aria-expanded'),'false');
    assert.equal(h.checkpoints(),0);
  }finally{h.close();}
});
test('cancel restores original appearance and control; apply checkpoints the draft once',()=>{
  const h=browser();try{
    let dialog=h.open(),original=h.value();h.w.machineStyle.value='animated';
    dialog.querySelector('#simulation2d-appearance-tab-bottles').click();
    dialog.querySelector('[data-bottle-style=shower]').click();
    dialog.querySelector('.dialog-actions .ghost').click();
    assert.equal(h.value().bottle,original.bottle);assert.equal(h.w.machineStyle.value,'blocks');assert.equal(h.d.getElementById('home').contains(h.w.machineStyle),true);
    assert.equal(h.checkpoints(),0);assert.equal(h.writes.length,0);
    dialog=h.open();h.w.machineStyle.value='animated';dialog.querySelector('#simulation2d-appearance-tab-bottles').click();dialog.querySelector('[data-bottle-style=shower]').click();
    dialog.querySelector('.dialog-actions button:last-child').click();
    assert.equal(h.value().bottle,'shower');assert.equal(h.w.machineStyle.value,'animated');assert.equal(h.checkpoints(),1);
    assert.deepEqual(h.writes,[['simulation2dBottleStyle','shower'],['simulation2dMachineStyle','animated']]);
  }finally{h.close();}
});
