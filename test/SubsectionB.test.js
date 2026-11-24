import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import postcss from 'postcss';

const moduleSource=fs.readFileSync('apps-script/Subsection.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const styles=postcss.parse(fs.readFileSync('apps-script/UiStandards.html','utf8').replace(/<\/?style>/g,''));
const bRules=[];
styles.walkRules(rule=>{
  if(rule.nodes.some(node=>node.type==='decl'&&node.prop==='--subsection-header-padding-start'&&node.value==='var(--subsection-b-header-padding-block)'))bRules.push(rule);
});
assert.equal(bRules.length,1,'One shared compact variant must serve native, classic and dialog subsections.');
const usesB=node=>bRules.some(rule=>node.matches(rule.selector));

function browser(markup=''){
  const dom=new JSDOM('<!doctype html><body>'+markup+'</body>',{runScripts:'outside-only'});
  dom.window.eval(moduleSource);
  return {w:dom.window,d:dom.window.document,api:dom.window.STSubsection,close:()=>dom.window.close()};
}

test('explicit B supports native and classic controls without changing their open state or accessible relationships',()=>{
  const h=browser();
  try{
    const native=h.api.create({title:'Conveyor variables',description:'Select feasible targets.',variant:'B',open:false});
    const classic=h.api.create({title:'Search settings',variant:'B',native:false,open:false,titleId:'search-title'});
    h.d.body.append(native.section,classic.section);
    for(const control of [native,classic]){
      assert.equal(control.section.dataset.subsectionVariant,'B');
      assert(control.section.classList.contains('st-subsection-b'));
      assert(usesB(control.section));
      assert.equal(control.section.querySelectorAll('.subsection-heading-copy').length,1);
    }
    assert.equal(native.section.open,false);
    const toggle=classic.title.querySelector('.fold-toggle');
    assert.equal(toggle.getAttribute('aria-expanded'),'false');
    assert.equal(toggle.getAttribute('aria-controls'),classic.body.id);
    assert.equal(classic.section.getAttribute('aria-labelledby'),'search-title');
    assert.equal(classic.body.hidden,true);assert.equal(classic.body.inert,true);
    assert.equal(native.description.textContent,'Select feasible targets.');
    assert.throws(()=>h.api.create({title:'Unsupported',variant:'compact'}),/variant must be A or B/);
  }finally{h.close();}
});

test('dialog B applies after insertion and follows shared controls moved between inline and modal views',()=>{
  const h=browser('<main id="workspace"></main><dialog id="popup"></dialog><section role="dialog" id="custom-dialog"></section>');
  try{
    const control=h.api.create({title:'Format settings',native:false,content:'Shared format editor'});
    assert.equal(control.section.dataset.subsectionVariant,undefined,'The reusable default must stay context sensitive.');
    assert.equal(usesB(control.section),false);
    h.d.getElementById('workspace').append(control.section);assert.equal(usesB(control.section),false);
    const header=control.header,body=control.body;
    h.d.getElementById('popup').append(control.section);assert.equal(usesB(control.section),true);
    h.d.getElementById('custom-dialog').append(control.section);assert.equal(usesB(control.section),true);
    h.d.getElementById('workspace').append(control.section);assert.equal(usesB(control.section),false);
    assert.equal(control.section.querySelector('.st-subsection-header'),header);
    assert.equal(control.section.querySelector('.fold-content'),body);
  }finally{h.close();}
});

test('explicit A remains full size inside dialogs and nested B sections while explicit B works inline',()=>{
  const h=browser('<dialog id="popup"></dialog>');
  try{
    const parent=h.api.create({title:'Dialog group',variant:'B'});
    const reference=h.api.create({title:'Subsection A reference',variant:'A'});
    const inline=h.api.create({title:'Subsection B reference',variant:'B'});
    h.d.getElementById('popup').append(parent.section);parent.body.append(reference.section);h.d.body.append(inline.section);
    assert(usesB(parent.section));assert(usesB(inline.section));assert.equal(usesB(reference.section),false);
    assert.equal(reference.section.classList.contains('st-subsection-b'),false);
    const defaults=[];styles.walkRules(rule=>{if(rule.selector==='.st-subsection')rule.walkDecls(decl=>defaults.push(decl.prop));});
    for(const property of ['--subsection-header-padding-start','--subsection-header-padding-end','--subsection-header-text','--subsection-header-description-text','--subsection-header-divider','--subsection-header-title-size','--subsection-header-copy-gap']){
      assert(defaults.includes(property),'Nested sections reset '+property+' instead of inheriting B from their parent.');
    }
  }finally{h.close();}
});

test('legacy dialog enhancement preserves edited toolbar and content nodes and does not require a B-specific renderer',()=>{
  const h=browser('<dialog open><section class="fold-card" id="legacy"><div class="fold-heading"><h3><button class="fold-toggle" data-subsection-toggle aria-controls="values" aria-expanded="true">Settings</button></h3><p class="subsection-description">Current values</p><select id="view"><option value="one">One</option><option value="two">Two</option></select></div><div class="fold-content" id="values"><input id="target" value="10"></div></section></dialog>');
  try{
    const section=h.d.getElementById('legacy'),select=h.d.getElementById('view'),input=h.d.getElementById('target');
    select.value='two';input.value='25';let changes=0;select.addEventListener('change',()=>changes++);select.focus();
    const control=h.api.enhance(section);h.api.init(section);
    assert(usesB(section));assert.equal(h.api.enhance(section),control);
    assert.equal(h.d.getElementById('view'),select);assert.equal(h.d.getElementById('target'),input);
    assert.equal(select.value,'two');assert.equal(input.value,'25');assert.equal(h.d.activeElement,select);
    select.dispatchEvent(new h.w.Event('change'));assert.equal(changes,1);
    assert(control.tools.contains(select));assert.equal(control.body.hidden,false);
  }finally{h.close();}
});

test('the compact variant scopes its theme changes to header copy and leaves toolbar and body colors independent',()=>{
  const h=browser('<dialog id="popup"></dialog>');
  try{
    const control=h.api.create({title:'Options',description:'Description',tools:[{label:'Apply',text:'Apply'}],content:h.d.createElement('input')});
    h.d.getElementById('popup').append(control.section);
    const themed=[];styles.walkRules(rule=>{
      if(rule.nodes.some(node=>node.type==='decl'&&['color','border-block-end-color'].includes(node.prop)&&/var\(--subsection-header-/.test(node.value)))themed.push(rule);
    });
    assert(themed.some(rule=>control.title.matches(rule.selector)));
    assert(themed.some(rule=>control.description.matches(rule.selector)));
    for(const node of [control.tools.querySelector('button'),control.body.querySelector('input')]){
      assert.equal(themed.some(rule=>node.matches(rule.selector)),false,'B must not restyle header actions or form controls.');
    }
  }finally{h.close();}
});
