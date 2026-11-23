import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const source=fs.readFileSync(new URL('../apps-script/ContextMenus.html',import.meta.url),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const menu=(id,classes='export-menu')=>'<details id="'+id+'" class="'+classes+'"><summary class="icon-button"><span>'+id+'</span></summary><div><button type="button">Action</button><input aria-label="Value"></div></details>';
function harness(markup=menu('first')+menu('second')){
  const dom=new JSDOM('<button id="outside">Outside</button>'+markup,{runScripts:'outside-only'});
  const w=dom.window,d=w.document;w.eval(source);
  const get=id=>d.getElementById(id);
  const settle=()=>new Promise(resolve=>w.setTimeout(resolve,0));
  const escape=target=>{const event=new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
  return {w,d,get,settle,escape,close:()=>w.close()};
}

test('outside pointer and click close menus without consuming the new action or stealing focus',async()=>{
  const h=harness();
  try{
    const first=h.get('first'),outside=h.get('outside');let actions=0;
    outside.onclick=event=>{actions++;event.stopPropagation();};
    first.querySelector('summary span').click();await h.settle();assert.equal(first.open,true);
    outside.focus();outside.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(first.open,false);assert.equal(h.d.activeElement,outside);
    outside.click();assert.equal(actions,1);
    first.open=true;await h.settle();outside.click();
    assert.equal(first.open,false);assert.equal(actions,2);assert.equal(h.d.activeElement,outside);
    assert.equal(first.querySelector('summary').getAttribute('aria-expanded'),'false');
  }finally{h.close();}
});

test('inside actions keep their own handlers and Escape closes the menu and restores its trigger',async()=>{
  const h=harness();
  try{
    const first=h.get('first'),button=first.querySelector('button'),input=first.querySelector('input');let actions=0;
    button.onclick=event=>{actions++;event.stopPropagation();};
    first.open=true;await h.settle();button.click();input.value='42';
    input.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(first.open,true);assert.equal(actions,1);assert.equal(input.value,'42');
    button.focus();const event=h.escape(button);
    assert.equal(event.defaultPrevented,true);assert.equal(first.open,false);
    assert.equal(h.d.activeElement,first.querySelector('summary'));
    assert.equal(h.escape(h.get('outside')).defaultPrevented,false,'No open menu leaves Escape to the app');
  }finally{h.close();}
});

test('opening another menu closes the previous one, including dynamically inserted menus',async()=>{
  const h=harness();
  try{
    const first=h.get('first'),second=h.get('second');
    first.querySelector('summary').click();await h.settle();
    second.querySelector('summary span').click();await h.settle();
    assert.equal(first.open,false);assert.equal(second.open,true);
    h.d.body.insertAdjacentHTML('beforeend',menu('dynamic','product-add-menu'));
    const dynamic=h.get('dynamic');dynamic.querySelector('summary').click();await h.settle();
    assert.equal(second.open,false);assert.equal(dynamic.open,true);
    assert.equal(dynamic.querySelector('summary').getAttribute('aria-expanded'),'true');
    h.get('outside').click();assert.equal(dynamic.open,false);
    dynamic.querySelector('summary').click();await h.settle();h.escape(dynamic.querySelector('summary'));
    assert.equal(dynamic.open,false);
  }finally{h.close();}
});

test('native and programmatic changes retain the latest open menu and update expanded state',async()=>{
  const h=harness();
  try{
    const first=h.get('first'),second=h.get('second');
    first.open=true;second.open=true;await h.settle();
    assert.equal(first.open,false);assert.equal(second.open,true,'The last requested opening wins');
    second.querySelector('summary').click();await h.settle();
    assert.equal(second.open,false);assert.equal(second.querySelector('summary').getAttribute('aria-expanded'),'false');
    first.open=true;await h.settle();
    const same=h.w.STContextMenus;h.w.eval(source);assert.equal(h.w.STContextMenus,same);
    h.w.STContextMenus.closeAll();assert.equal(first.open,false);
  }finally{h.close();}
});

test('subsections keep their disclosure state while toolbar menus dismiss independently',async()=>{
  const h=harness('<details id="section" class="fold-card" open><summary>Subsection</summary><div>'+menu('inside','import-menu')+'</div></details><details id="plain" open><summary>Other details</summary>Content</details>');
  try{
    const section=h.get('section'),plain=h.get('plain'),inside=h.get('inside');
    inside.querySelector('summary').click();await h.settle();h.escape(inside.querySelector('summary'));
    assert.equal(inside.open,false);assert.equal(section.open,true);assert.equal(plain.open,true);
    h.get('outside').click();assert.equal(section.open,true);assert.equal(plain.open,true);
    section.querySelector('summary').click();await h.settle();assert.equal(section.open,false);
  }finally{h.close();}
});

test('Escape is scoped to the active dialog and does not consume its close when no menu is open inside',async()=>{
  const h=harness(menu('background')+'<dialog id="dialog" open><button id="dialog-action">Dialog action</button>'+menu('modal-menu')+'</dialog>');
  try{
    const background=h.get('background'),dialog=h.get('dialog'),action=h.get('dialog-action'),inside=h.get('modal-menu');
    background.open=true;await h.settle();action.focus();
    assert.equal(h.escape(action).defaultPrevented,false,'A background menu cannot intercept a modal Escape');
    inside.querySelector('summary').click();await h.settle();inside.querySelector('button').focus();
    assert.equal(h.escape(inside.querySelector('button')).defaultPrevented,true);
    assert.equal(inside.open,false);assert.equal(dialog.open,true);
    assert.equal(h.d.activeElement,inside.querySelector('summary'));
    assert.equal(h.escape(inside.querySelector('summary')).defaultPrevented,false,'The next Escape can close the dialog');
  }finally{h.close();}
});
