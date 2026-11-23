import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('Canvas 2D shows equipment icon with name and color state tags instead of traffic lights',()=>{
  const src=read('apps-script/Simulation2D.html');
  assert.match(src,/function drawTelemetryIcon\(context,x,y,belt,ink\)/);
  assert.match(src,/function drawSignal\(context,x,y,signal,colors\)/);
  assert.match(src,/drawSignal\(context,x\+width\/2,signalY,signal,colors\)/);
  assert.match(src,/drawSignal\(context,sx,top-14,signal,colors\)/);
  assert.match(src,/if\(showSignal&&label==='State'\)/);
  assert.match(src,/card\(data\.column,cardLeft,data\.title,data\.rows,data\.showSignal,data\.verdict\)/);
  assert.match(src,/\{column:3,title:'Conveyor Geometry',rows:conveyorGeometryRows\(item\),verdict:/);
});

test('Case product/format configuration preserves legacy multiple catalogs and shared controls',()=>{
  const products=read('apps-script/Products.html');
  const settings=read('apps-script/Settings.html');
  const web=read('apps-script/WebApp.html');
  assert.match(products,/productFormatMode/);
  assert.match(products,/c\.products\.length>1\|\|c\.formats\.length>1\?'multiple':'single'/);
  assert.match(products,/section\('Products & Formats'\)/);
  assert.match(products,/function addMenu\(parent\)/);
  assert.match(products,/var filtered=all/);
  assert.match(products,/renderMaterial\(simple==='single'\?'products':currentTab\)/);
  assert.doesNotMatch(products,/formats-tab-products|formats-tab-formats/);
  assert.match(settings,/settings-product-format-mode/);
  assert.match(web,/value="single">Single product and format \(default\)/);
  assert.match(web,/value="multiple">Multiple products and formats/);
});
