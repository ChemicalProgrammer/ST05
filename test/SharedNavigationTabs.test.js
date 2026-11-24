import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../apps-script/'+name,import.meta.url),'utf8');
test('all static tabs have the shared icon-and-label control',()=>{
  for(const name of ['WebApp.html','DesignReference.html']){
    const tabs=read(name).match(/<button\b[^>]*\brole="tab"[^>]*>/g)||[];
    assert.ok(tabs.length>=5,name);
    for(const tag of tabs){assert.match(tag,/class="[^"]*\bapp-section-tab\b/);assert.match(tag,/data-icon="[^"]+"/);}
  }
});
test('dynamic scenario, conveyor and simulation tabs reuse the same control',()=>{
  assert.match(read('ScenarioExplorer.html'),/tab\.className='app-section-tab';tab\.dataset\.icon=\['search','machine','conveyor','pulse'\]\[index\];STIcons\.button/);
  assert.match(read('BasicMode.html'),/b\.classList\.add\('app-section-tab'\);STIcons\.button\(b,b\.dataset\.icon\)/);
  assert.match(read('ClientSimulation.html'),/workspace-tab nav-item app-section-tab/);
});
test('shared tab appearance supports selected, current and pressed states, without a full border',()=>{
  const css=read('ComponentStyles.html');
  assert.match(css,/button\.app-section-tab:is\(\[aria-current=page\],\[aria-selected=true\],\[aria-pressed=true\]\):not\(:disabled\)\s*\{[^}]*border-color:transparent;[^}]*box-shadow:inset 0 -2px 0 var\(--accent\)/);
  assert.match(css,/button\.app-section-tab\[hidden\],button\.app-section-tab\.hidden\s*\{display:none!important/);
  assert.doesNotMatch(read('DialogStyles.html'),/\.settings-tabs button\[aria-selected=true\]/);
});
