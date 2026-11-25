import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(path,'utf8');

function telemetryHarness(){
  const source=read('apps-script/Simulation2D.html');
  const constants=source.slice(source.indexOf('  const tableScale='),source.indexOf('  const machineHeight='));
  const pills=source.slice(source.indexOf('  function statusPillColors('),source.indexOf('  const telemetryIconPaths='));
  const data=source.slice(source.indexOf('  function telemetryData('),source.indexOf('  function measureTelemetry('));
  const efficiency=read('apps-script/EquipmentEfficiency.html').replace(/<\/?script>/g,'');
  const telemetry=source.slice(source.indexOf('  function drawTelemetry('),source.indexOf('  function productWidth('));
  const position=source.slice(source.indexOf('      const analysisButton=analysisButtons.get(item.id);'),
    source.indexOf('      const controls=machineControls.get(item.id);'));
  const button={style:{}};
  const api=vm.runInNewContext(constants+pills+efficiency+data+telemetry+`
    const item={id:'belt',kind:'belt',name:'A long equipment name',bottlesPerUnit:1,rate:2,speed:100,
      produced:159,capacityBottles:36,inputBottleFactor:1,residenceSeconds:3},
      index=0,origin=20,telemetryY=100,screenWidth=10000,h=10000;
    const items=[{center:600,telemetryWidth:conveyorGroupWidth,telemetryOffset:7}];
    function positionAnalysis(factor){${position}}
    ({drawTelemetry,positionAnalysis,item,tableScale,telemetryRowHeight,telemetryPadding,
      telemetryColumns,telemetryWidths,
      left:origin+items[0].center-items[0].telemetryWidth/2,y:telemetryY+items[0].telemetryOffset})`,{
    localize2D:String,num:String,window:{},scheduleOptions:{failures:{checked:false}},
    bottleStages:new Map(),bottleStageNames:['Empty'],conveyorDimensions:new Map([['belt',{status:'FAIL'}]]),
    conveyorGeometryRows:()=>[],analysisButtons:new Map([['belt',button]]),drawTelemetryIcon(){},
    strokeBox(context,left,top,width,height){context.box(left,top,width,height);},
  });
  return {...api,button};
}

function recordingContext(zoom){
  let transform={scale:zoom,x:0,y:0};
  const stack=[],pills=[],tables=[],text=[];
  const context={font:'12px system-ui',textAlign:'left',textBaseline:'alphabetic',
    save(){stack.push({...transform,font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline});},
    restore(){const {font,textAlign,textBaseline,...saved}=stack.pop();Object.assign(this,{font,textAlign,textBaseline});transform=saved;},
    translate(x,y){transform.x+=x*transform.scale;transform.y+=y*transform.scale;},
    scale(x){transform.scale*=x;},beginPath(){},fill(){},arc(){},fillRect(){},
    measureText(value){return {width:String(value).length*parseFloat(this.font.match(/([\d.]+)px/)[1])*.55};},
    rect(x,y,width,height){return {left:transform.x+x*transform.scale,top:transform.y+y*transform.scale,
      width:width*transform.scale,height:height*transform.scale};},
    roundRect(x,y,width,height){pills.push(this.rect(x,y,width,height));},
    box(x,y,width,height){tables.push(this.rect(x,y,width,height));},
    fillText(value,x,y,maxWidth){
      const width=Math.min(this.measureText(value).width,maxWidth??Infinity)*transform.scale;
      text.push({value,left:transform.x+x*transform.scale-(this.textAlign==='right'?width:this.textAlign==='center'?width/2:0),
        width,fontSize:parseFloat(this.font.match(/([\d.]+)px/)[1])*transform.scale});
    }
  };
  return {context,pills,tables,text};
}

const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-8,message||`${actual} != ${expected}`);

test('2D labels above equipment retain shared screen pixel metrics at every zoom',()=>{
  const source=read('apps-script/Simulation2D.html');
  const start=source.indexOf('  function statusPillColors('),end=source.indexOf('  const telemetryIconPaths=',start);
  const {drawScreenStatusPill,drawSignal}=vm.runInNewContext(source.slice(start,end)
    +'\n({drawScreenStatusPill,drawSignal})',{localize2D:String});
  const metrics={font:'500 13px system-ui',height:24,paddingX:8,dotRadius:3,dotGap:5};
  for(const zoom of [.1,1,6]){
    let factor=zoom;const stack=[],rectangles=[],dots=[],fonts=[];
    const context={save(){stack.push(factor);},restore(){factor=stack.pop();},translate(){},scale(x){factor*=x;},
      beginPath(){},fill(){},measureText(){return {width:40};},
      roundRect(x,y,width,height){rectangles.push({width:width*factor,height:height*factor});},
      arc(x,y,radius){dots.push(radius*factor);},fillText(){fonts.push(this.font);}};
    const colors={badgeMetrics:metrics};
    drawScreenStatusPill(context,'Running','running',colors,100,80,zoom,110);
    drawSignal(context,100,80,{state:'Running',lamp:'running'},colors,zoom);
    assert.equal(rectangles.length,2);
    for(const box of rectangles){assert.equal(box.height,24);assert.equal(box.width,67);}
    assert.deepEqual(dots,[3,3]);assert.deepEqual(fonts,[metrics.font,metrics.font]);
    assert.equal(factor,zoom,'The caller canvas transform is restored');
  }
});

test('Equipment tables show one header status pill sized relative to their rows at every zoom',()=>{
  const harness=telemetryHarness();
  for(const kind of ['machine','belt']){
    const signal=kind==='belt'?{state:'Accumulating',lamp:'blocked'}:{state:'Running',lamp:'running'};
    let previous;
    for(const zoom of [.1,1,6]){
      const recorded=recordingContext(zoom);
      harness.drawTelemetry(recorded.context,{...harness.item,kind},harness.left,harness.y,signal,'ink','border','surface','muted','soft',{});
      const {pills,tables,text}=recorded;
      assert.equal(pills.length,1,'The header is the only state badge within the tables');
      assert.ok(!text.some(entry=>entry.value==='State'),'No duplicate state row remains');
      const table=tables[0],rowHeight=harness.telemetryRowHeight*zoom;
      for(const pill of pills){
        near(pill.height/rowHeight,16/18,'A status pill fits within one table row');
        assert.ok(pill.left>=table.left&&pill.left+pill.width<=table.left+table.width);
      }
      const heading=text.find(entry=>entry.value==='A long equipment name');
      assert.ok(heading.left+heading.width<pills[0].left,'The equipment name has room before its badge');
      const labels=text.filter(entry=>entry.value===signal.state.toUpperCase());
      assert.equal(labels.length,1);
      for(const label of labels)near(label.fontSize/rowHeight,11/18);
      const dimensions=pills.map(pill=>({width:pill.width/zoom,height:pill.height/zoom}));
      if(previous)dimensions.forEach((pill,index)=>{
        near(pill.width,previous[index].width);near(pill.height,previous[index].height);
      });
      previous=dimensions;
    }
  }
});

test('Geometry PASS/FAIL scales with its table and stays clear of the title',()=>{
  const source=read('apps-script/Simulation2D.html'),harness=telemetryHarness();
  const baseHeight=Number(source.match(/\.simulation2d-analysis-action\s*\{\s*--status-pill-height:([\d.]+)px/)[1]);
  for(const zoom of [.1,1,6]){
    harness.positionAnalysis(zoom);
    const {style}=harness.button,recorded=recordingContext(zoom);
    harness.drawTelemetry(recorded.context,harness.item,harness.left,harness.y,
      {state:'Accumulating',lamp:'blocked'},'ink','border','surface','muted','soft',{});
    const table=recorded.tables[2],heading=recorded.text.find(entry=>entry.value==='Conveyor Geometry');
    // Evaluate the CSS transform against the widest possible button, including
    // its percentage translations and right-center origin, not just its scale.
    const width=parseFloat(style.maxWidth),height=baseHeight;
    const transform=style.transform.match(/^translate\(([-\d.]+)%,([-\d.]+)%\) scale\(([^)]+)\)$/);
    assert.ok(transform);assert.equal(style.transformOrigin,'right center');
    const scale=Number(transform[3]),translateX=Number(transform[1])*width/100,translateY=Number(transform[2])*height/100;
    const point=(x,y)=>({x:parseFloat(style.left)+width+translateX+(x-width)*scale,
      y:parseFloat(style.top)+height/2+translateY+(y-height/2)*scale});
    const topLeft=point(0,0),bottomRight=point(width,height);
    near(bottomRight.x,table.left+table.width-harness.telemetryPadding*zoom,'Right edge stays anchored inside the table');
    near((topLeft.y+bottomRight.y)/2,table.top+19*harness.tableScale*zoom,'Badge stays centered on the heading');
    near((bottomRight.y-topLeft.y)/(harness.telemetryRowHeight*zoom),16/18);
    assert.ok(topLeft.y>=table.top&&bottomRight.y<=table.top+30*harness.tableScale*zoom,
      'Evaluation remains in the heading, above the column labels');
    assert.ok(heading.left+heading.width<topLeft.x,'Even the maximum-width badge leaves the geometry title clear');
    assert.equal(harness.button.hidden,false);
  }
});

test('2D equipment uses numeric-style status pills in the first table and above the machine',()=>{
  const src=read('apps-script/Simulation2D.html');
  assert.ok(src.includes('function drawTelemetryIcon(context,x,y,belt,ink)'));
  assert.ok(src.includes('function drawStatusPill(context,state,lamp,colors,x,y,options={})'));
  assert.ok(src.includes('function drawSignal(context,x,y,signal,colors,zoomFactor)'));
  assert.ok(src.includes('drawSignal(context,x+width/2,signalY,signal,colors,factor)'));
  assert.ok(src.includes('drawSignal(context,sx,top-14,signal,colors,factor)'));
  assert.ok(src.includes('drawScreenStatusPill(context,signal.state,signal.lamp,colors,'));
  assert.ok(src.includes('colors.badgeMetrics'));
  assert.ok(src.includes("style.getPropertyValue('--status-pill-'+name)"));
  assert.ok(src.includes('context.scale(1/factor,1/factor)'));
  assert.ok(src.includes('context.scale(1/factor,1/factor)'),'Labels above equipment use constant on-screen size');
  for(const token of ['running-soft','starved-soft','blocked-soft','failure-soft','info-soft','stopped-soft'])
    assert.ok(src.includes("color('"+token+"'"),'Use shared numeric badge token '+token);
});

test('Conveyor geometry evaluation retains the shared pill styling and analysis action',()=>{
  const src=read('apps-script/Simulation2D.html');
  assert.ok(src.includes("{column:3,title:'Conveyor Geometry',rows:conveyorGeometryRows(item),verdict:"));
  assert.ok(src.includes('card(data.column,cardLeft,data.title,data.rows,data.showSignal,data.verdict)'));
  assert.ok(src.includes('tableLeft>=screenWidth||cx<=0'));
  assert.ok(!src.includes('cx-analysisButton.offsetWidth*factor>=screenWidth'));
  assert.ok(src.includes("button.className='simulation2d-analysis-action st-status-pill'"));
  assert.ok(src.includes('.simulation2d-analysis-action.simulation2d-verdict-fail {background:var(--failure-soft);color:var(--danger);}'));
  const ui=read('apps-script/UiStandards.html');
  assert.ok(ui.includes('font-size:var(--status-pill-font-size)'));
  assert.ok(ui.includes('height:var(--status-pill-height)'));
  assert.ok(ui.includes('width:var(--status-pill-dot-size)'));
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
  assert.equal((numerical.match(/class="checkbox-label st-checkbox-card"/g)||[]).length,4);
  assert.match(numerical,/id="run-dynamic-balancing" type="checkbox">/);
  assert.ok(!group.includes('run-dynamic-balancing'),'2D must not claim dynamic speed support');
  assert.match(styles,/label\.st-checkbox-card \{[\s\S]*?border:var\(--border-width\) solid var\(--line\)/);
  assert.match(styles,/label\.st-checkbox-card > input\[type=checkbox\] \{/);
  assert.doesNotMatch(ui,/#simulation-duration-content \.simulation-run-inclusions \.checkbox-label \{/);
});
