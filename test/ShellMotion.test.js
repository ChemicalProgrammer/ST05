import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('apps-script/Shell.html','utf8').replace(/^<script>|<\/script>\s*$/g,'');
test('navigation reveals the actual visible workspace panel, including Simulation 2D',()=>{
 const calls=[],nodes=new Map();
 function get(id){
  if(!nodes.has(id)){
   const classes=new Set();
   nodes.set(id,{id,classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,v){if(v)classes.add(k);else classes.delete(k);}},setAttribute(){},before(){},appendChild(){},prepend(){},focus(){},dataset:{}});
  }
  return nodes.get(id);
 }
 const document={getElementById:get,querySelectorAll:()=>[],documentElement:{lang:'en',dataset:{}}};
 const state={activeCase:{id:'c',name:'Test',simulations:[]},bootstrap:{uiMode:'ADVANCE'},run:{},uiView:'simulation'};
 const actions={assistant(){},syncSaveButton(){},syncSimulation2D(visible){calls.push(['2d',visible]);}};
 const window={STBasicMode:{sync(s){document.documentElement.dataset.headerView=s.basicView||s.uiView;}}};
 const api=new Function('window','document','STPreferences','STSettings','STIcons','STMotion','STProducts','STRealData','STResults','__ST_TEXT__',source+';return window.STShell;')(
  window,document,{read:()=>null,caseOptions:()=>({showRealData:true})},{applyCaseCharts(){},syncMode(){}},{decorate(){}},{reveal(panel){assert(!panel.classList.contains('hidden'));calls.push(['reveal',panel.id]);}},{render(){}},{render(){}},{render(){}},key=>key)(state,actions);
 const panels={simulation:'run',simulation2d:'simulation2d',results:'results',editor:'editor',products:'products',realdata:'realdata',whatif:'whatif',comparison:'comparison'};
 for(const [view,name] of Object.entries(panels)){
  state.uiView=view;api.sync();
  assert.deepEqual(calls.at(-1),['reveal',name+'-panel']);
  assert.deepEqual(calls.at(-2),['2d',view==='simulation2d']);
  for(const other of Object.values(panels))assert.equal(get(other+'-panel').classList.contains('hidden'),other!==name);
  const count=calls.filter(c=>c[0]==='reveal').length;
  api.sync();assert.equal(calls.filter(c=>c[0]==='reveal').length,count,'no repeated animation during refresh');
 }
 state.uiView='simulation2d';api.sync();assert.deepEqual(calls.at(-1),['reveal','simulation2d-panel']);
 state.activeCase=null;api.sync();assert.deepEqual(calls.at(-1),['reveal','cases-panel']);
});
