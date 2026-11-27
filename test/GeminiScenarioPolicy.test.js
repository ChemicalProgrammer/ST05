import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function policies() {
 const context=vm.createContext({PropertiesService:{getUserProperties:()=>({getProperty:()=>null})}});
 for(const name of ['ApplicationGuide.gs','GeminiService.gs'])vm.runInContext(fs.readFileSync('apps-script/'+name,'utf8'),context);
 return context;
}

test('Gemini scenario guidance requires complete current results and keeps financial amounts outside scope',()=>{
 const context=policies();
 for(const mode of [true,false]){
  const policy=context.geminiPolicy_(mode,false);
  assert.match(policy,/sourceReadiness\.ready === true/);assert.match(policy,/every configured replication completed/);assert.match(policy,/proposals:\[\]/);
  assert.match(policy,/Financial budgets, prices, ROI and payback are outside/);
  assert.match(policy,/complete equipment replacement belongs to High/);
  assert.doesNotMatch(policy,/missing cost evidence|targets, budgets|thresholds.*price/i);
  assert.match(policy,/Never invent a minor\/major split or infer physical cause from duration alone/);
 }
 const general=context.geminiPolicy_(false,true);
 assert.doesNotMatch(general,/sourceReadiness|ANOVA/,'General app guidance should not require a numerical result');
});

test('Gemini and application guidance describe the same existing DOE settings and primary inference',()=>{
 const context=policies(),policy=context.ST_GEMINI_SEARCH_POLICY,guide=context.flowPilotApplicationGuide_();
 assert.match(policy,/up to 3 factors at Medium search depth and up to 4 at High search depth/);
 assert.match(policy,/Medium and High search depths calculate ANOVA from the same DOE observations/);
 assert.match(policy,/Holm-adjusted p-values across all effects and both OEE and throughput as one family/);
 assert.match(policy,/configured confidence level \(0\.95 by default\)/);
 assert.match(policy,/Fix the confirmation replication count.*before seeing confirmation outcomes/);
 assert.match(guide,/10 simulated minutes in Medium or 15 in High/);assert.match(guide,/three new seeds/);
 assert.match(guide,/no separate alpha or confidence control/);assert.match(guide,/Include DOE belongs to the case/);
 assert.match(guide,/zero observed variance cannot establish statistical significance/);
 assert.doesNotMatch(guide,/every feasible target individually for 30 minutes|12\/24 pairs|5 simulated minutes, 3 rounds|uncertain confirmation can use additional rounds/);
});

test('expanded default guidance still fits the existing editable prompt limits',()=>{
 const definitions=policies().geminiPromptDefinitions_();
 assert(definitions.every(def=>def.defaultText.length<=8000));
 assert(definitions.reduce((sum,def)=>sum+def.defaultText.length,0)<=40000);
});


test('all mode guidance uses independent CAPEX scopes and Basic automatic DOE',()=>{
 const context=policies(),guide=context.flowPilotApplicationGuide_();
 assert.match(context.ST_GEMINI_ZERO_CAPEX_POLICY,/sensor positions and timing, conveyor speeds/);
 assert.match(context.ST_GEMINI_ZERO_CAPEX_POLICY,/reduce downtime/);
 assert.match(context.ST_GEMINI_MEDIUM_CAPEX_POLICY,/accumulation and buffer capacity only/);
 assert.match(context.ST_GEMINI_MEDIUM_CAPEX_POLICY,/one, two or three/);
 assert.match(context.ST_GEMINI_HIGH_CAPEX_POLICY,/complete equipment replacement only/);
 assert.match(guide,/up to three factors and eight combinations/);
 assert.match(guide,/old saved inclusions are ignored/);
 assert.doesNotMatch(guide,/Medium includes Zero by default|High offers independent Include Zero/);
});
