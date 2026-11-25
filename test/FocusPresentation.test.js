import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=name=>fs.readFileSync('apps-script/'+name+'.html','utf8');
const script=read('FocusPresentation').match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(){
  const dom=new JSDOM('<header><button id="button" aria-pressed="true">Header</button></header><span id="belt" class="brand-conveyor" tabindex="0">Belt</span><input id="edit" value="draft">',{runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  w.eval(script);
  const mode=()=>d.documentElement.dataset.focusRings;
  const key=(key,extra={})=>d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
  const pointer=target=>target.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));
  return {w,d,mode,key,pointer,button:d.getElementById('button'),belt:d.getElementById('belt'),edit:d.getElementById('edit'),close:()=>w.close()};
}
test('window and tab switching clear only visual focus rings, preserving focused control and active state',()=>{
  const h=fixture();
  try{
    assert.equal(h.mode(),'off');
    h.button.focus();h.key('Tab');assert.equal(h.mode(),'on');
    h.w.dispatchEvent(new h.w.Event('blur'));assert.equal(h.mode(),'off');
    h.w.dispatchEvent(new h.w.Event('focus'));assert.equal(h.mode(),'off');
    assert.equal(h.d.activeElement,h.button);assert.equal(h.button.getAttribute('aria-pressed'),'true');
    h.key('Tab',{altKey:true});assert.equal(h.mode(),'off');
    h.key('Tab',{shiftKey:true});assert.equal(h.mode(),'on');
    h.d.dispatchEvent(new h.w.Event('visibilitychange'));assert.equal(h.mode(),'off');
    h.key('ArrowDown');assert.equal(h.mode(),'on');
    const restored=new h.w.Event('pageshow');Object.defineProperty(restored,'persisted',{value:true});
    h.w.dispatchEvent(restored);assert.equal(h.mode(),'off');
  }finally{h.close();}
});
test('pointer interaction with header or brand conveyor suppresses the ring but keyboard access remains',()=>{
  const h=fixture();
  try{
    h.button.focus();h.key('Enter');assert.equal(h.mode(),'on');
    h.pointer(h.button);assert.equal(h.mode(),'off');assert.equal(h.d.activeElement,h.button);
    h.pointer(h.belt);h.belt.focus();assert.equal(h.mode(),'off');assert.equal(h.d.activeElement,h.belt);
    h.key('r');assert.equal(h.mode(),'on');
    h.key('ArrowLeft');assert.equal(h.mode(),'on');
    h.pointer(h.edit);h.edit.focus();h.edit.value='unsaved';
    h.w.dispatchEvent(new h.w.Event('blur'));assert.equal(h.d.activeElement,h.edit);assert.equal(h.edit.value,'unsaved');
    h.key('Shift');assert.equal(h.mode(),'off');h.key('s',{ctrlKey:true});assert.equal(h.mode(),'off');
    h.key('a');assert.equal(h.mode(),'on');assert.equal(h.d.activeElement,h.edit);
  }finally{h.close();}
});
test('the shared focus policy affects rings rather than selected states or normal input borders',()=>{
  const css=read('FocusPresentation'),web=read('WebApp');
  assert.match(web,/include_\('FocusPresentation'\)/);
  assert.match(css,/html\[data-focus-rings=off\] :focus-visible,[\s\S]*?outline:none!important/);
  assert.doesNotMatch(css,/\.blur\(|preventDefault\(|stopPropagation\(|aria-pressed|border-color\s*:/);
  assert.match(read('BrandConveyorStyles'),/\.brand-conveyor:focus-visible\s*\{\s*outline:/);
  assert.match(read('Styles'),/icon-button\[aria-pressed=true\]/);
  assert.match(read('Styles'),/input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):focus-visible/);
  assert.match(read('ComponentStyles'),/:where\(html:not\(\[data-focus-rings=off\]\)\) #header-errors:not\(\.hidden\) #header-error-button:focus-visible/);
});
