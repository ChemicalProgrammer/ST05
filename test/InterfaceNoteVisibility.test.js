import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {renderAppsScript} from '../scripts/render-apps-script.mjs';

const dom=new JSDOM(renderAppsScript().html,{runScripts:'outside-only',virtualConsole:new VirtualConsole()});
const document=dom.window.document,root=document.documentElement,rules=[];
after(()=>dom.window.close());
// Match production selectors against production DOM and resolve the winning
// display declaration. jsdom does not implement the complete browser cascade;
// this checks CSS visibility contracts, not layout pixels or closed parent tabs.
function compare(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2];}
function specificity(node){
  if(node.type==='id')return [1,0,0];
  if(node.type==='class'||node.type==='attribute')return [0,1,0];
  if(node.type==='tag')return [0,0,1];
  if(node.type==='pseudo'){
    if(node.value===':where')return [0,0,0];
    if([':is',':not',':has'].includes(node.value))return node.nodes.map(specificity).sort(compare).at(-1)||[0,0,0];
    return node.value.startsWith('::')?[0,0,1]:[0,1,0];
  }
  return (node.nodes||[]).map(specificity).reduce((sum,next)=>sum.map((value,index)=>value+next[index]),[0,0,0]);
}
for(const style of document.querySelectorAll('style'))postcss.parse(style.textContent).walkRules(rule=>{
  const declarations=rule.nodes.filter(node=>node.type==='decl'&&node.prop==='display');
  if(!declarations.length)return;
  const conditions=[];
  for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule')conditions.push(parent);
  for(const selector of selectorParser().astSync(rule.selector).nodes)rules.push({
    selector:selector.toString(),specificity:specificity(selector),conditions,declarations
  });
});
function applies(rule,width){
  return rule.conditions.every(condition=>{
    if(condition.name!=='media')return false;
    const query=condition.params.match(/^\s*\((max|min)-width\s*:\s*(\d+)px\)\s*$/);
    return Boolean(query)&&(query[1]==='max'?width<=Number(query[2]):width>=Number(query[2]));
  });
}
function display(element,width){
  const matches=[];
  rules.forEach((rule,order)=>{
    if(!applies(rule,width))return;
    try{if(!element.matches(rule.selector))return;}catch{return;}
    rule.declarations.forEach((declaration,index)=>matches.push({
      value:declaration.value,important:Boolean(declaration.important),specificity:rule.specificity,order,index
    }));
  });
  if(element.style.display)matches.push({value:element.style.display,
    important:element.style.getPropertyPriority('display')==='important',specificity:[1000000,0,0],order:rules.length,index:0});
  return matches.sort((a,b)=>Number(a.important)-Number(b.important)||compare(a.specificity,b.specificity)
    ||a.order-b.order||a.index-b.index).at(-1)?.value||(element.hidden?'none':'initial');
}
function eachMode(check){
  const attributes=['data-ui-mode','data-visual-style'],originals=attributes.map(attribute=>root.getAttribute(attribute));
  try{
    for(const mode of ['basic','advance'])for(const style of ['classic','elegant'])for(const width of [390,1440]){
      root.dataset.uiMode=mode;root.dataset.visualStyle=style;check(width,mode+'/'+style+'/'+width);
    }
  }finally{attributes.forEach((attribute,index)=>{if(originals[index]===null)root.removeAttribute(attribute);else root.setAttribute(attribute,originals[index]);});}
}
function add(parent,className,attributes={}){
  const node=document.createElement('p');node.className=className;node.textContent='Current content';
  Object.entries(attributes).forEach(([name,value])=>node.setAttribute(name,value));parent.append(node);return node;
}

test('explanatory notes already present in equipment, results and settings stay hidden in both modes',()=>{
  const nodes=['editor-meta','run-case-meta','vgraph-context','vgraph-caveat','throughput-method',
    'settings-engine-note','settings-case-note','gemini-history-note'].map(id=>document.getElementById(id));
  assert.ok(nodes.every(Boolean),'Use actual production notes from several views');
  nodes.forEach(node=>{node.textContent='Explanatory text';node.hidden=false;node.classList.remove('hidden');});
  eachMode((width,context)=>nodes.forEach(node=>assert.equal(display(node,width),'none',context+' / '+node.id)));
});

test('dynamically inserted prose and conveyor format previews share the same visibility rule',()=>{
  const parents=[document.getElementById('equipment-list'),document.getElementById('results-body'),
    document.querySelector('#settings-dialog .settings-section')];
  const added=[];
  try{
    for(const parent of parents){
      const note=add(parent,'chart-note');note.style.display='block';added.push(note);
    }
    const equipment=parents[0],preview=add(equipment,'format-zone-preview'),help=add(equipment,'parameter-help');
    added.push(preview,help);
    const section=document.createElement('div');section.className='format-zone-heading';equipment.append(section);added.push(section);
    const headingNote=add(section,'');
    eachMode((width,context)=>{
      for(const node of [...added.filter(node=>node!==section),headingNote])
        assert.equal(display(node,width),'none',context+' / '+(node.className||'format heading prose'));
    });
  }finally{added.forEach(node=>node.remove());}
});

test('subsection descriptions, semantic status and error messages are exempt from prose suppression',()=>{
  const descriptions=[...document.querySelectorAll('.fold-card .subsection-description,.fold-card .subsection-playback-meta')];
  assert.ok(descriptions.length>15,'Check the shared subsection descriptions throughout the application');
  const staticStatus=['simulation2d-status','control-event-selection-status','simulation-equipment-empty',
    'gemini-key-status','gemini-model-status','gemini-error','configuration-error','settings-error'].map(id=>document.getElementById(id));
  staticStatus.forEach(node=>{assert.ok(node);node.textContent='Active status or error';});
  const parent=document.querySelector('#settings-dialog .settings-section'),added=[];
  try{
    for(const attributes of [{role:'status'},{role:'alert'},{'aria-live':'polite'},{'data-error-notice':'message'}])
      added.push(add(parent,'chart-note',attributes));
    added.push(add(parent,'chart-note error'),add(parent,'chart-note subsection-description'),
      add(parent,'chart-note subsection-playback-meta'),add(parent,'format-guidance'),add(parent,'gemini-ai-policy-note'));
    eachMode((width,context)=>{
      for(const node of [...descriptions,...staticStatus,...added])
        assert.notEqual(display(node,width),'none',context+' / '+(node.id||node.className));
    });
  }finally{added.forEach(node=>node.remove());}
});

test('effective-runtime progress becomes visible when the controller removes hidden and can be hidden again',()=>{
  const progress=document.getElementById('run-effective-progress'),originalHidden=progress.hidden,originalText=progress.textContent;
  assert.ok(progress);assert.equal(progress.getAttribute('role'),'status');assert.equal(progress.getAttribute('aria-live'),'polite');
  try{
    progress.textContent='Effective runtime: 45 / 60 min';
    eachMode((width,context)=>{
      progress.hidden=true;assert.equal(display(progress,width),'none',context+' / inactive progress');
      progress.hidden=false;assert.notEqual(display(progress,width),'none',context+' / active progress');
      progress.hidden=true;assert.equal(display(progress,width),'none',context+' / completed progress');
    });
  }finally{progress.hidden=originalHidden;progress.textContent=originalText;}
});
