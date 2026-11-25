import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=name=>fs.readFileSync(new URL('../apps-script/'+name,import.meta.url),'utf8');
const script=name=>read(name).match(/<script>([\s\S]*?)<\/script>/)[1];

test('Case Gallery animates both layout directions without changing filters or case identity',()=>{
 const dom=new JSDOM('<!doctype html><html><body><main id="application"><span id="breadcrumb-view"></span><input id="case-search"><select id="case-filter"><option value="all">Active</option><option value="archived">Archived</option></select><select id="case-sort"><option value="name">Name</option></select><button id="case-layout"></button><div id="cases-list"></div><div id="case-pagination"></div></main></body></html>',{runScripts:'outside-only'});
 try{
  const w=dom.window,d=w.document,animations=[],prefs={caseLayout:'list'},media={matches:false};
  w.matchMedia=()=>media;w.STPreferences={read:key=>prefs[key],write:(key,value)=>{prefs[key]=value;}};
  w.STIcons={svg:()=>'<svg></svg>'};w.__ST_TEXT__=key=>key;
  w.HTMLElement.prototype.getBoundingClientRect=function(){
   const grid=this.parentElement?.classList.contains('grid'),index=Array.from(this.parentElement?.children||[]).indexOf(this);
   return {left:grid?index*320:0,top:grid?0:index*60,width:grid?300:800,height:grid?150:60};
  };
  w.HTMLElement.prototype.animate=function(frames,options){
   const animation={key:this.dataset.motionKey,frames,options,cancelled:false,cancel(){this.cancelled=true;}};
   animations.push(animation);return animation;
  };
  w.eval(script('Motion.html'));w.eval(script('CaseGallery.html'));
  const cases=['a','b','c'].map((id,i)=>({id,name:id,equipmentCount:3,isSimulationReady:true,archived:i===2,updatedAt:'2026-11-24T00:00:00Z'}));
  const render=()=>w.STCaseGallery.render(cases,()=>{},()=>{});
  const target=d.getElementById('cases-list'),toggle=d.getElementById('case-layout');
  const keys=()=>Array.from(target.querySelectorAll('.case-row'),r=>r.dataset.motionKey);
  render();assert.deepEqual(keys(),['a','b']);assert.equal(animations.length,0);
  toggle.click();assert(target.classList.contains('grid'));assert.equal(prefs.caseLayout,'grid');assert.deepEqual(keys(),['a','b']);
  assert.equal(animations.length,2);assert(animations.every(a=>a.options.duration===220));
  assert.equal(animations[1].frames[0].transform,'translate(-40px,40px)');
  toggle.click();assert(!target.classList.contains('grid'));assert.equal(prefs.caseLayout,'list');assert.deepEqual(keys(),['a','b']);
  assert.equal(animations.length,4);assert(animations.slice(0,2).every(a=>a.cancelled));
  assert.equal(animations[3].frames[0].transform,'translate(40px,-40px)');
  d.getElementById('case-filter').value='archived';render();assert.deepEqual(keys(),['c']);assert.equal(animations.length,4);
  media.matches=true;toggle.click();assert(target.classList.contains('grid'));assert.deepEqual(keys(),['c']);assert.equal(animations.length,4);
  assert.equal(d.getElementById('case-filter').value,'archived');
 }finally{dom.window.close();}
});

test('Welcome and KPI/gallery cards use the same accent width token',()=>{
 assert.match(read('DesignTokens.html'),/--card-accent-width:\s*var\(--space-1\)/);
 assert.match(read('ShellStyles.html'),/\.auth-card\s*\{[^}]*border-top:\s*var\(--card-accent-width\) solid var\(--secondary\)/);
 assert.match(read('CasesStyles.html'),/\.cases-list\.grid \.case-row\s*\{[^}]*border-top:\s*var\(--card-accent-width\)/);
 assert.match(read('ComponentStyles.html'),/border-top:\s*var\(--card-accent-width\) solid var\(--accent\)/);
 assert.doesNotMatch(read('ElegantStyles.html'),/\.auth-card\s*\{[^}]*border-top:/);
});
