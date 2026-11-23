import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync('apps-script/'+name,'utf8');

test('one equipment arrangement choice is shared by Basic and Advance',()=>{
  const basic=read('BasicMode.html'),web=read('WebApp.html'),settings=read('Settings.html');
  assert.ok(basic.includes("function split(){return (STPreferences.caseOptions().equipmentLayout||'split')==='split';}"));
  assert.ok(basic.includes("mountEquipmentLayout(separate)"));
  assert.ok(web.includes('id="settings-equipment-layout"'));
  assert.ok(web.includes('value="split">Separate Equipment and Conveyors'));
  assert.ok(web.includes('value="combined">Equipment and Conveyors together'));
  assert.ok(settings.includes("window.dispatchEvent(new Event('st-equipment-layout-change'))"));
});

test('numerical configuration removes the extra section but keeps model inputs',()=>{
  const web=read('WebApp.html');
  for(const removed of ['id="run-config"','class="model-boundary','id="run-duration-summary"','Shifts are reporting boundaries, not stop/start events.'])
    assert.ok(!web.includes(removed),removed);
  for(const id of ['run-seed','run-shift-count','run-effective-progress'])
    assert.equal((web.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.ok(web.includes('id="run-internal-parameters" hidden'));
});

test('numeric control buttons stay inside the identity frame on an independent full-width row',()=>{
  const playback=read('ClientPlayback.html'),css=read('UiStandards.html');
  assert.ok(playback.includes('overviewSide.append(visualHeader,chartAside)'));
  assert.ok(playback.includes('visualHeader.append(controlDock)'));
  assert.ok(css.includes('grid-column:1 / -1!important;grid-row:3!important;'));
  assert.ok(playback.includes("visualHeader.append(card.querySelector('.live-state'))"));
  assert.ok(css.includes('flex-flow:row wrap!important'));
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr) max-content!important'));
  assert.ok(css.includes('html[data-events-enabled=false] .live-equipment-card'));
});

test('2D machine and conveyor icons share STIcons and verdict follows geometry heading',()=>{
  const src=read('Simulation2D.html'),web=read('WebApp.html');
  assert.ok(src.includes('window.STIcons.equipment(kind)'));
  assert.ok(src.includes('new Path2D(data)'));
  assert.ok(src.includes('telemetryIconPaths.set(kind,path)'));
  assert.ok(src.includes('analysisButton.style.maxWidth=Math.max(28,Math.min(72,tableWidth*.38))'));
  assert.ok(src.includes("button.className='simulation2d-analysis-action st-status-pill'"));
  assert.ok(!src.includes('#simulation2d-legend'));
  assert.ok(!web.includes('id="simulation2d-legend"'));
  assert.ok(!web.includes('Scroll to zoom at the pointer. Drag or hold the middle mouse button to pan. Use Fit to recenter.</p>'));
});

test('advanced summary, scenario and comparison prose is removed without dropping metrics',()=>{
  const web=read('WebApp.html'),results=read('Results.html'),
    whatIf=read('WhatIf.html'),explorer=read('ScenarioExplorer.html');
  assert.ok(web.includes('id="results-kpis"'));
  assert.ok(web.includes('id="results-rate-loss-highlights"'));
  assert.ok(web.includes('id="results-meta" hidden'));
  assert.ok(web.includes('id="results-reference" hidden'));
  assert.ok(!web.includes('class="chart-note whatif-context"'));
  assert.ok(!results.includes("section.querySelector('.chart-note').textContent=data.note"));
  assert.ok(results.includes("target.dataset.unitsMismatch='true'"));
  assert.ok(!whatIf.includes('scenario-design-checks'));
  assert.ok(!whatIf.includes('Search retains the initial format and changeovers.'));
  assert.ok(!explorer.includes('scenario-stale-targets'));
});

test('the results history block receives a full reusable subsection gap',()=>{
  const css=read('UiStandards.html');
  assert.ok(css.includes('#results-body > #results-history-group'));
  assert.ok(css.includes('margin-block-start:var(--subsection-gap)!important'));
});
