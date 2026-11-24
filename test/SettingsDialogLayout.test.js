import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

// Keep the production markup (rather than a hand-written fixture) so moved
// controls and section wrappers are exercised in the same DOM hierarchy.
function settingsDocument(){
  const html=fs.readFileSync('apps-script/WebApp.html','utf8');
  const start=html.indexOf('<dialog id="settings-dialog"'),close='</dialog>';
  const end=html.indexOf(close,start);
  assert(start>=0&&end>start,'Settings dialog must exist in WebApp.html');
  const fragment=html.slice(start,end+close.length).replace(/<\?[\s\S]*?\?>/g,'');
  return new JSDOM(fragment).window;
}
const style=path=>fs.readFileSync(path,'utf8');

test('Case General keeps name/export in the first row and two settings in the second',()=>{
  const window=settingsDocument(),doc=window.document;
  try {
    const caseSection=doc.getElementById('settings-case-section'),
      form=doc.getElementById('case-editor-form'),
      firstRow=form.querySelector(':scope > .settings-case-general-grid'),
      secondRow=caseSection.querySelector(':scope > .settings-case-options');
    assert(firstRow&&secondRow,'Case General must expose two layout rows');
    assert.equal(firstRow.children.length,2);
    assert(firstRow.children[0].contains(doc.getElementById('case-name')));
    assert(firstRow.children[1].contains(doc.getElementById('export-complete-case')));
    assert.equal(secondRow.children.length,2);
    assert(secondRow.children[0].contains(doc.getElementById('settings-product-format-mode')));
    assert(secondRow.children[1].contains(doc.getElementById('settings-equipment-layout')));
    assert(form.contains(doc.getElementById('case-name')),'Case-name validation remains inside form');
    assert(!form.contains(doc.getElementById('settings-product-format-mode')),'Product settings remain outside the name form');
    const css=style('apps-script/DialogStyles.html');
    assert.match(css,/#settings-dialog #settings-case-section \.settings-case-options\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(css,/@media\(max-width:600px\)\s*\{[\s\S]*#settings-dialog #settings-case-section \.settings-case-options\s*\{grid-template-columns:minmax\(0,1fr\)/);
  } finally {window.close();}
});

test('Recording and charts puts shift accounting in column two beside chart window',()=>{
  const window=settingsDocument(),doc=window.document;
  try {
    const windowPicker=doc.getElementById('run-chart-window'),
      toggle=doc.getElementById('run-track-shifts'),grid=windowPicker.closest('.settings-simulation-grid'),
      section=windowPicker.closest('.settings-section');
    assert(toggle&&grid&&section);
    assert.equal(toggle.closest('.settings-simulation-grid'),grid);
    assert.equal(grid.children.length,4);
    assert.equal(grid.children[2].querySelector('select'),windowPicker);
    assert.equal(grid.children[3],toggle.closest('label'));
    assert(toggle.closest('label').classList.contains('settings-recording-toggle'));
    assert(!section.querySelector('.recording-toggle-grid'),'No extra margin-bearing checkbox grid');
    const css=style('apps-script/DialogStyles.html');
    assert.match(css,/#settings-page-simulation \.settings-recording-toggle\s*\{[^}]*align-self:end;/);
  } finally {window.close();}
});

test('Settings sections use a single padding/margin rule across tabs',()=>{
  const css=style('apps-script/DialogStyles.html'),standards=style('apps-script/UiStandards.html');
  assert.match(css,/#settings-dialog \.settings-section\s*\{[^}]*gap:var\(--space-3\);[^}]*padding:var\(--space-4\) 0;margin:0;[^}]*border-bottom:/);
  assert.match(css,/#settings-dialog :is\([^)]*#settings-page-case[^)]*\) > \.settings-section:first-of-type\s*\{\s*padding-top:0;/);
  assert.match(css,/#settings-dialog :is\([^)]*#settings-run-options[^)]*\) > \.settings-section:last-of-type\s*\{\s*padding-bottom:0;border-bottom:0;/);
  assert(!standards.includes('#settings-dialog .settings-section { padding-bottom:'));
  assert(!standards.includes('.simulation-settings-groups > .settings-section { padding-block:'));
  assert(!standards.includes('.recording-toggle-grid { margin-top:'));
  assert.match(standards,/#settings-page-simulation \.settings-simulation-grid\s*\{[^}]*gap:var\(--space-3\)/);
});
