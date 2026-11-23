import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('2D equipment uses numeric-style status pills in the first table and above the machine',()=>{
  const src=read('apps-script/Simulation2D.html');
  assert.ok(src.includes('function drawTelemetryIcon(context,x,y,belt,ink)'));
  assert.ok(src.includes('function drawStatusPill(context,state,lamp,colors,x,y,options={})'));
  assert.ok(src.includes('function drawSignal(context,x,y,signal,colors,zoomFactor)'));
  assert.ok(src.includes('drawSignal(context,x+width/2,signalY,signal,colors,factor)'));
  assert.ok(src.includes('drawSignal(context,sx,top-14,signal,colors,factor)'));
  assert.ok(src.includes('drawStatusPill(context,signal.state,signal.lamp,colors,'));
  assert.ok(src.includes("if(showSignal&&label==='State')"));
  assert.ok(src.includes('drawStatusPill(context,value,signal.lamp,colors,'));
  assert.ok(src.includes('context.scale(1/factor,1/factor)'),'Labels above equipment use constant on-screen size');
  for(const token of ['running-soft','starved-soft','blocked-soft','failure-soft','info-soft','stopped-soft'])
    assert.ok(src.includes("color('"+token+"'"),'Use shared numeric badge token '+token);
});

test('Conveyor geometry title and evaluation keep a compact zoom-independent badge',()=>{
  const src=read('apps-script/Simulation2D.html');
  assert.ok(src.includes("{column:3,title:'Conveyor Geometry',rows:conveyorGeometryRows(item),verdict:"));
  assert.ok(src.includes('card(data.column,cardLeft,data.title,data.rows,data.showSignal,data.verdict)'));
  assert.ok(src.includes("analysisButton.style.transform='translate(-100%,-50%)'"));
  assert.ok(!src.includes("analysisButton.style.transform='translate(-100%,-50%) scale("));
  assert.ok(src.includes('tableLeft>=screenWidth||cx<=0'));
  assert.ok(!src.includes('cx-analysisButton.offsetWidth*factor>=screenWidth'));
  assert.ok(src.includes('.simulation2d-analysis-action::before {content:'+"'●'"));
  assert.ok(src.includes('.simulation2d-analysis-action.simulation2d-verdict-fail {background:var(--failure-soft);color:var(--danger);}'));
  assert.ok(src.includes('font-size:10px'));
  assert.ok(src.includes('height:16px;max-width:72px'));
  assert.ok(src.includes('analysisButton.style.maxWidth=Math.max(28,Math.min(72,tableWidth*.38))'));
  assert.ok(src.includes('window.STIcons.equipment(kind)'));
  assert.ok(src.includes('telemetryIconPaths.set(kind,path)'));
  assert.ok(!src.includes('#simulation2d-legend'));
});

test('Products and Formats have a single workspace top gutter',()=>{
  const src=read('apps-script/ProductStyles.html');
  const start=src.indexOf('/* El margen superior ya lo aporta .workspace-content.');
  assert.ok(start>=0);
  assert.ok(src.slice(start).includes('#products-workspace .products-editor > .dialog-body {\n  padding-block-start:0;\n}'));
  assert.ok(!src.includes('padding-block-start:var(--workspace-gutter);'));
});

test('Case product/format controls keep single/multiple support',()=>{
  const products=read('apps-script/Products.html');
  const settings=read('apps-script/Settings.html');
  const web=read('apps-script/WebApp.html');
  assert.ok(products.includes('productFormatMode'));
  assert.ok(products.includes("c.products.length>1||c.formats.length>1?'multiple':'single'"));
  assert.ok(products.includes("section('Products & Formats')"));
  assert.ok(products.includes('function addMenu(parent)'));
  assert.ok(products.includes('var filtered=all'));
  assert.ok(products.includes("renderMaterial(simple==='single'?'products':currentTab)"));
  assert.ok(!products.includes('formats-tab-products'));
  assert.ok(!products.includes('formats-tab-formats'));
  assert.ok(settings.includes('settings-product-format-mode'));
  assert.ok(web.includes('value="single">Single product and format (default)'));
  assert.ok(web.includes('value="multiple">Multiple products and formats'));
});

// Un solo control para los checkboxes de configuración en ambas simulaciones.
test('2D Settings reuses framed checkbox cards without replacing the input controls',()=>{
  const markup=read('apps-script/WebApp.html');
  const styles=read('apps-script/ComponentStyles.html');
  const ui=read('apps-script/UiStandards.html');
  const group=markup.split('<fieldset class="simulation2d-setting-toggles" aria-label="2D simulation options">')[1]?.split('</fieldset>')[0];
  assert.ok(group,'The 2D settings checkbox group must exist');
  const ids=['simulation2d-dimensions','simulation2d-failures','simulation2d-show-events'];
  for(const id of ids){
    assert.match(group,new RegExp('<label class="checkbox-label st-checkbox-card" for="'+id+'">'));
    assert.match(group,new RegExp('<input id="'+id+'" type="checkbox"'));
    assert.equal((group.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  }
  assert.equal((group.match(/class="checkbox-label st-checkbox-card"/g)||[]).length,3);
  assert.match(group,/id="simulation2d-failures" type="checkbox" checked/);
  assert.match(group,/id="simulation2d-show-events" type="checkbox" aria-controls="simulation2d-events-panel"/);
  const numerical=markup.split('<div class="simulation-run-inclusions">')[1]?.split('</div>')[0]||'';
  assert.equal((numerical.match(/class="checkbox-label st-checkbox-card"/g)||[]).length,3);
  assert.match(styles,/label\.st-checkbox-card \{[\s\S]*?border:var\(--border-width\) solid var\(--line\)/);
  assert.match(styles,/label\.st-checkbox-card > input\[type=checkbox\] \{/);
  assert.doesNotMatch(ui,/#simulation-duration-content \.simulation-run-inclusions \.checkbox-label \{/);
});
