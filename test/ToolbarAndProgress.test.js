import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync('apps-script/'+name+'.html','utf8');

test('header, nested toolbars and equipment controls use one spacing token',()=>{
  assert.match(read('DesignTokens'),/--toolbar-gap:\s*var\(--space-2\)/);
  assert.match(read('DesignTokens'),/--workspace-toolbar-inset:\s*calc\(var\(--workspace-gutter\) \+ var\(--subsection-header-inset\) \+ var\(--border-width\)\)/);
  assert.match(read('Styles'),/\.button-row \{[^}]*gap:\s*var\(--toolbar-gap\)/);
  assert.match(read('Styles'),/\.button-row > :is\(\.button-row,\.equipment-filters,\.equipment-view-tools\) \{[^}]*gap:var\(--toolbar-gap\)/);
  const shell=read('ShellStyles');
  assert.match(shell,/padding:0 var\(--workspace-toolbar-inset\) 0 var\(--page-padding\)/);
  for(const selector of ['header-case-actions','simulation-toolbar','simulation-actions']){
    const rule=shell.split('\n').find(l=>l.startsWith('.'+selector+' {'));
    assert(rule.includes('gap:var(--toolbar-gap)'),selector);
  }
  const editor=read('EditorStyles');
  assert.match(editor,/\.equipment-view-tools \{[^}]*gap:var\(--toolbar-gap\)/);
  assert.match(read('UiStandards'),/\.st-equipment-control-dock \{[^}]*gap:var\(--toolbar-gap\)/);
  assert.match(read('RealDataStyles'),/\.real-data-toolbar \.button-row \{[^}]*gap:var\(--toolbar-gap\)/);
  assert.match(read('DesignReference'),/data-design-token="--toolbar-gap"/);
  const sim=read('Simulation2D');
  assert(!/#simulation2d-panel \.fold-tools \{[^}]*gap:(?!var\(--toolbar-gap\))[^;}]+/.test(sim));
});

test('both progress headers render calculation then visualization, followed by the execution clock',()=>{
  const web=read('WebApp'),ui=read('UiStandards');
  for(const prefix of ['playback','simulation2d']){
    const begin=web.indexOf('id="'+prefix+'-calculation-bar"');
    const end=web.indexOf('</p>',begin);
    const markup=web.slice(begin,end);
    assert(begin>=0);
    const positions=['calculation-bar','visualization-bar','calculation-progress','progress','execution-time'].map(s=>markup.indexOf('id="'+prefix+'-'+s+'"'));
    assert(positions.every((p,i)=>p>=0&&(i===0||p>positions[i-1])));
    assert.match(markup,/class="execution-progress-slash"[^>]*>\/<\/span>/);
  }
  assert.match(ui,/\.execution-progress-calculation \{--execution-progress-color:var\(--secondary\)/);
  assert.match(ui,/\.execution-progress-visualization \{--execution-progress-color:var\(--accent\)/);
});

function nodes(){
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:0,classList:{toggle(){}}});return elements.get(id);};
  return el;
}
test('numerical calculation updates independently of visualization and resets correctly',()=>{
  const source=read('ClientPlayback'),begin=source.indexOf('    function syncNumericalExecutionIndicators()'),end=source.indexOf('    var playbackClock;',begin);
  const el=nodes(),result={provisional:true,durationSeconds:100,calculatedThroughSeconds:97.3};
  const context={state:{run:{playing:false,result}},roundSession:null,numericalExecutionClock:{elapsedMs:2500,startedAt:null,known:true},numericalExecutionTimer:null,
    performance:{now:()=>1000},document:{documentElement:{lang:'en'},getElementById:el},window:{setTimeout:()=>1,clearTimeout(){}},
    numericalExecutionElapsedMs:()=>2500,executionTimeText:()=> '00:00:02'};
  vm.createContext(context);
  vm.runInContext(source.slice(begin,end),context);
  el('playback-visualization-bar').value=95.4;
  vm.runInContext('syncNumericalExecutionIndicators()',context);
  assert.equal(el('playback-calculation-progress').textContent,'97.3%');
  assert(Math.abs(el('playback-calculation-bar').value-97.3)<1e-8);
  assert.equal(el('playback-visualization-bar').value,95.4);
  assert.equal(el('playback-execution-time').textContent,'Elapsed 00:00:02');
  result.provisional=false;
  vm.runInContext('syncNumericalExecutionIndicators()',context);
  assert.equal(el('playback-calculation-bar').value,100);
  context.state.run.playbackAction='reset';
  vm.runInContext('syncNumericalExecutionIndicators()',context);
  assert.equal(el('playback-calculation-bar').value,0);
  assert.equal(el('playback-calculation-progress').textContent,'0.0%');
});

test('2D calculation and visualization reflect the independent engine horizon',()=>{
  const source=read('Simulation2D'),begin=source.indexOf('  function status(){'),end=source.indexOf('  // Pending wall-clock credit',begin);
  const el=nodes(),context={el,defaultRun:null,representative:null,model:{time:42.5,line:[]},limitSeconds:100,definitions:[],runState:'Running',validation:'',dynamicBalancingRequested:false,
    localize2D:s=>s,document:{documentElement:{lang:'en'}},executionElapsed:()=>1000,executionClockLabel:()=> '00:00:01',num:String};
  vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
  for(const time of [42.5,100,0]){
    context.model.time=time;vm.runInContext('status()',context);
    for(const id of ['calculation-bar','visualization-bar'])assert.equal(el(id).value,time);
    for(const id of ['calculation-progress','progress'])assert.equal(el(id).textContent,time.toFixed(1)+'%');
  }
  assert.equal(el('execution-time').textContent,'Elapsed 00:00:01');
});
