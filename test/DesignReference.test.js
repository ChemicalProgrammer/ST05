import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

// Prueba el diálogo real con la misma estructura y scripts de Apps Script.
test('Ctrl+Shift+S abre catálogo accesible y las pestañas funcionan',()=>{
  const source=fs.readFileSync('apps-script/DesignReference.html','utf8');
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const time=fs.readFileSync('apps-script/TimeControls.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom=new JSDOM('<!doctype html><html><body>'+source.replace(/<script>[\s\S]*?<\/script>/,'')+'</body></html>',{runScripts:'outside-only'});
  try{
    const w=dom.window;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    w.eval(time);
    w.eval(script);
    const modal=w.document.getElementById('design-reference-dialog');
    assert.equal(modal.open,false);
    const key=new w.KeyboardEvent('keydown',{key:'S',code:'KeyS',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true});
    w.dispatchEvent(key);
    assert.equal(modal.open,true);
    assert.equal(key.defaultPrevented,true);
    const tabs=[...modal.querySelector('.design-reference-tabs').children].filter(node=>node.getAttribute('role')==='tab');
    assert.equal(tabs.length,5);
    const cards=w.document.getElementById('design-ref-tab-cards');
    cards.click();
    assert.equal(cards.getAttribute('aria-selected'),'true');
    assert.equal(w.document.getElementById('design-ref-cards').hidden,false);
    assert.equal(w.document.getElementById('design-ref-controls').hidden,true);
    assert.ok(w.document.querySelector('#design-ref-time-output .st-time-output'));
    for(const tab of tabs){
      const panel=w.document.getElementById(tab.getAttribute('aria-controls'));
      const catalog=panel.querySelector('[role="table"]');
      assert.ok(catalog,'Cada pestaña debe incluir la tabla de tres columnas');
      const headers=[...catalog.querySelectorAll('[role="columnheader"]')].map(el=>el.textContent.trim());
      assert.deepEqual(headers,['Control o diseño','Explicación','Nombre del control']);
      const rows=[...catalog.querySelectorAll('.design-reference-row')];
      assert.ok(rows.length>0,'Cada pestaña debe mostrar ejemplos');
      for(const row of rows){
        const cells=[...row.children].filter(child=>child.getAttribute('role')==='cell');
        assert.equal(cells.length,3,'Cada fila tiene vista previa, descripción y nombre');
        assert.ok(cells[0].children.length,'La primera columna muestra el control o diseño');
        assert.ok(cells[1].textContent.trim(),'La segunda columna describe su función');
        assert.ok(cells[2].querySelector('strong')?.textContent.trim(),'La tercera columna identifica el nombre reutilizable');
        assert.ok(cells[2].querySelector('code')?.textContent.trim(),'El nombre incluye selector o token técnico');
        assert.match(cells[2].querySelector('.design-reference-control-type')?.textContent||'',/^(Básico|Compuesto · .+)$/);
      }
    }
    const columns=w.document.querySelector('.design-reference-column-heads');
    assert.ok(columns);
    assert.ok(w.document.querySelector('.design-reference-control-name strong')?.textContent.includes('Subsección'));
    for(const name of ['Título de subsección','Descripción de subsección','Separador interno de subsección']){
      assert.ok([...w.document.querySelectorAll('.design-reference-control-name strong')].some(node=>node.textContent===name),name);
    }
    assert.ok(w.document.querySelector('fieldset.subsection-fieldset > legend.subsection-divider'));
    assert.equal(w.document.querySelectorAll('.design-reference-column-heads').length,5);
    // Interactive preview navigation never changes the selected real catalog tab.
    w.document.getElementById('design-ref-tab-navigation').click();
    const sampleNav=w.document.querySelector('.design-reference-main-navigation');
    const examples=[...sampleNav.querySelectorAll('[data-design-preview-option]')];
    examples[1].click();
    assert.equal(examples[1].getAttribute('aria-current'),'page');
    assert.equal(examples[0].getAttribute('aria-current'),'false');
    assert.equal(w.document.getElementById('design-ref-tab-navigation').getAttribute('aria-selected'),'true');
    const sampleDialog=w.document.querySelector('.design-reference-dialog-tabs-preview');
    const dialogExamples=[...sampleDialog.querySelectorAll('[data-design-preview-option]')];
    dialogExamples[1].click();
    assert.equal(dialogExamples[1].getAttribute('aria-selected'),'true');
    assert.equal(dialogExamples[0].getAttribute('aria-selected'),'false');
    w.document.getElementById('design-ref-tab-controls').click();
    const controls=[...w.document.querySelectorAll('.design-reference-control-name strong')].map(el=>el.textContent.trim());
    for(const name of ['Pestaña de navegación principal','Pestañas de cuadro de diálogo','Pestaña de simulación','Selector de simulación','Botón principal','Botón de peligro','Botón de errores','Campo de búsqueda','Menú desplegable de acciones','Panel de gráfica','Tabla de datos','Selector circular de color']){
      assert.ok(controls.includes(name),'Missing reusable control: '+name);
    }
    assert.equal(controls.length,new Set(controls).size,'Cada control debe tener un nombre único');
    const primary=w.document.querySelector('[data-design-preview-action]');
    primary.click();
    assert.equal(w.document.getElementById('design-ref-action-output').textContent,'1');
    w.document.querySelector('.design-reference-counter-button').click();
    assert.equal(w.document.getElementById('design-ref-counter').textContent,'1');
    w.document.getElementById('design-reference-close').click();
    assert.equal(modal.open,false);
  }finally{dom.window.close();}
});

test('What-if tiene exportación y título en la barra de herramientas única',()=>{
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  const a=web.indexOf('<section id="whatif-panel"'),b=web.indexOf('<section id="comparison-panel"',a);
  const fragment=web.slice(a,b);
  const heading=fragment.indexOf('id="whatif-subsection-title"');
  const exportControl=fragment.indexOf('id="export-whatif-json"');
  const content=fragment.indexOf('id="whatif-subsection-content"');
  assert.ok(heading>=0&&exportControl>heading&&content>exportControl);
  assert.match(fragment,/aria-controls="whatif-subsection-content">Scenario options<\/button>/);
  assert.equal((fragment.match(/id="export-whatif-json"/g)||[]).length,1);
  assert.match(fragment,/class="fold-tools button-row"/);
});

test('KPI, resultado y escenario tienen nombres y reglas distintas',()=>{
  const style=fs.readFileSync('apps-script/ComponentStyles.html','utf8');
  const basic=fs.readFileSync('apps-script/BasicMode.html','utf8');
  const whatif=fs.readFileSync('apps-script/WhatIf.html','utf8');
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  assert.match(style,/\.metric-card--featured/);
  assert.match(style,/\.metric-card--result/);
  assert.match(style,/\.metric-card--scenario/);
  assert.match(style,/@media\(hover:hover\) and \(pointer:fine\)/);
  assert.match(basic,/row\.classList\.add\('metric-card','metric-card--featured'\)/);
  assert.match(whatif,/metric-card--scenario/);
  const playback=web.split('id="simulation-playback-metrics"')[1].split('</div>')[0];
  assert.equal((playback.match(/class="metric-card metric-card--result"/g)||[]).length,10);
  assert.doesNotMatch(playback,/metric-card--featured/);
  assert.match(style,/#simulation-playback-metrics > article\.metric-card--result/);
  assert.match(style,/#simulation-playback-metrics > article\.metric-card--result > strong,[\s\S]*?font-size:var\(--font-section\)/);
  assert.match(style,/\.metric-card--result > strong \.st-time-output b \{font-size:inherit!important/);
  assert.match(basic,/metric\(efficiencies,'Theoretical equipment efficiency'/);
  assert.match(basic,/metric\(efficiencies,'Simulated efficiency'/);
  assert.match(web,/include_\('ComponentStyles'\)/);
});

test('Las unidades ajustan inputs y conservan reservas de output; las subsecciones muestran descripciones',()=>{
  const styles=fs.readFileSync('apps-script/ComponentStyles.html','utf8');
  const tokens=fs.readFileSync('apps-script/DesignTokens.html','utf8');
  const ui=fs.readFileSync('apps-script/UiStandards.html','utf8');
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  const real=fs.readFileSync('apps-script/RealDataPanel.html','utf8');
  const products=fs.readFileSync('apps-script/Products.html','utf8');
  assert.match(tokens,/--time-unit-gap:\s*2px/);
  assert.match(tokens,/--time-unit-slot:\s*3\.25ch/);
  assert.match(styles,/grid-template-columns:minmax\(0,1fr\) max-content/);
  assert.match(styles,/\.live-equipment-card \.st-time-output\[data-variant=metric\]/);
  assert.match(ui,/\.subsection-heading-title/);
  assert.match(ui,/\.subsection-description/);
  assert.match(ui,/\.subsection-divider/);
  assert.match(web,/<fieldset class="simulation2d-setting-toggles" aria-label="2D simulation options">/);
  assert.doesNotMatch(web,/simulation2d-setting-toggles subsection-fieldset|<legend class="subsection-divider">Options<\/legend>/);
  const simulation2d=fs.readFileSync('apps-script/Simulation2D.html','utf8');
  assert.doesNotMatch(simulation2d,/\.simulation2d-setting-toggles[^\n]*border-top/);
  assert.match(web,/id="simulation-playback-status"/);
  assert.match(real,/class="subsection-description"/);
  assert.match(products,/var guidance=\{/);
  const buttons=[...web.matchAll(/<button[^>]*data-subsection-toggle[^>]*>/g)];
  assert.ok(buttons.length>=12,'Las pantallas principales conservan subsecciones plegables');
  const descriptions=(web.match(/class="subsection-description"/g)||[]).length;
  assert.ok(descriptions>=13,'Las subsecciones principales tienen descripción');
});

test('El encabezado es compacto, el estado no revela frames y las eficiencias muestran KPI destacado',()=>{
  const web=fs.readFileSync('apps-script/WebApp.html','utf8');
  const ui=fs.readFileSync('apps-script/UiStandards.html','utf8');
  const style=fs.readFileSync('apps-script/ComponentStyles.html','utf8');
  const playback=fs.readFileSync('apps-script/ClientPlayback.html','utf8');
  assert.match(ui,/\.st-subsection > \.st-subsection-header \{[\s\S]*?display:grid/);
  assert.doesNotMatch(ui,/-webkit-line-clamp:2;line-clamp:2/);
  assert.match(ui,/\.fold-native > summary \.subsection-heading-copy \{[\s\S]*?flex-direction:column;flex-wrap:nowrap/);
  assert.match(ui,/#simulation-playback \.fold-heading #simulation-playback-status \{[\s\S]*?margin:0;[\s\S]*?white-space:nowrap/);
  assert.match(ui,/\.fold-heading > div:has\(> h3 > \.fold-toggle\)/);
  assert.match(ui,/#simulation-playback \.fold-heading #simulation-playback-status/);
  assert.match(ui,/#simulation-playback #playback-performance \{display:none!important;\}/);
  assert.match(web,/id="playback-performance"[^>]*aria-hidden="true" hidden/);
  assert.match(playback,/setPlaybackStatus\(state\.run\.playing\?'Playing':\(finished\?'Completed':\(sample\.virtualSecond>0\?'Paused':'Ready'\)\)\)/);
  assert.doesNotMatch(playback,/setPlaybackStatus\([^\n]*client\.s_frame/);
  assert.match(style,/#simulation-playback-efficiencies #basic-efficiencies > \.metric-card--featured/);
  assert.match(style,/border-top:var\(--card-accent-width\) solid var\(--accent\)!important/);
  assert.match(style,/#simulation-playback-efficiencies #basic-efficiencies > \.metric-card--featured > strong/);
  const cards=web.split('id="simulation-playback-metrics"')[1].split('</div>')[0];
  assert.equal((cards.match(/metric-card--result/g)||[]).length,10);
});

test('La descripción usa las líneas necesarias y conserva la separación compartida',()=>{
  const ui=fs.readFileSync('apps-script/UiStandards.html','utf8');
  assert.match(ui,/overflow:visible;overflow-wrap:anywhere;white-space:normal;text-overflow:clip/);
  assert.match(ui,/row-gap:var\(--subsection-description-gap\)/);
  assert.match(ui,/\.st-subsection > \.st-subsection-header > \.subsection-heading-copy \{\s*display:flex;flex-direction:column;align-items:stretch;align-self:center;\s*grid-column:1;grid-row:1;gap:var\(--subsection-description-gap\)/);
  assert.match(ui,/padding-inline-start:var\(--subsection-text-inset\)/);
  const catalog=fs.readFileSync('apps-script/DesignReference.html','utf8');
  assert.match(catalog,/STSubsection.create\(\{title, description, tools\}\)/);
  assert.match(catalog,/data-design-token="--subsection-description-gap"/);
});

test('El Header utiliza su clase de navegación reutilizable',()=>{
  const basic=fs.readFileSync('apps-script/BasicMode.html','utf8');
  const css=fs.readFileSync('apps-script/ComponentStyles.html','utf8');
  assert.match(basic,/b\.classList\.add\('app-section-tab'\)/);
  assert.match(css,/\.app-section-tab\[aria-current=page\]/);
  const source=fs.readFileSync('apps-script/DesignReference.html','utf8');
  const rows=(source.match(/class="design-reference-row"/g)||[]).length;
  assert.ok(rows>=75,'El catálogo debe incluir navegación, controles, tipografía, márgenes y tarjetas');
  assert.equal((source.match(/class="design-reference-column-heads"/g)||[]).length,5);
  assert.match(source,/querySelector\('\.design-reference-tabs'\)\.querySelectorAll\(':scope > \[role=tab\]'\)/);
});
