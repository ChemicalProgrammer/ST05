import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('apps-script/ScenarioExplorer.html','utf8');
const block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+a.length));
const api=new Function(block('  function displayedOutcome(','  function evidenceState(')+'\nreturn {displayedOutcome,recoverCompactEvaluation,compactDialogOutcome};')();
const previous={sourceSimulationId:'s',sourceSignature:'current',searchPolicyVersion:'MATCHED_CAPEX_V12',method:'ZERO_PHYSICAL_OFAT_DOE_V1',searchSettingsSignature:'v6',methodologySignature:'method',status:'ENGINEERING_REVIEW_REQUIRED',baseline:{oee:50,throughput:100},candidate:{oee:55,throughput:110},independentCheck:{passed:true},originalVerificationRequired:true,originalVerification:{passed:true},evaluatedChanges:[{equipmentId:'belt',before:300,after:360}],warnings:[{rule:'VERIFY'}]};
const identity={id:'s',signature:'current',searchSettingsSignature:'v6',methodologySignature:'method',ready:true,applicable:()=>true};
function pending(overrides={}){
 return {sourceSimulationId:'s',sourceSignature:'current',status:'NOT_EVALUATED',reason:'Selections or limits changed; previous estimate invalidated.',lastResult:JSON.parse(JSON.stringify(previous)),...overrides};
}
test('compact automatic configuration events never invalidate current evidence',()=>{
 let called=0;const controls=[{disabled:false},{disabled:false}],body={querySelectorAll:()=>controls};
 const config=new Function('project','automaticBasic','body',block('    function readOnlyAutomaticConfiguration(){','    var configure=')+'\nreturn {readOnlyAutomaticConfiguration,lockAutomaticConfiguration};')({compact:true},true,body);
 config.lockAutomaticConfiguration();assert(controls.every(c=>c.disabled));
 const actions=new Function('activeHost','readOnlyAutomaticConfiguration','record','clearTimeout',block('    function configurationEdited(){','    function resetTargets(')+block('    function invalidateDOE(force){','    function settingChanged(')+'\nreturn {configurationEdited,invalidateDOE};')(null,config.readOnlyAutomaticConfiguration,()=>called++,()=>called++);
 actions.configurationEdited();actions.invalidateDOE(true);assert.equal(called,0);
});
test('pending record shows retained evaluated changes, not hypothetical targets',()=>{
 const entry=pending(),snapshot=JSON.stringify(entry);
 assert.equal(api.compactDialogOutcome(entry),entry.lastResult);
 assert.equal(api.compactDialogOutcome(pending({restartPending:true})),null);
 assert.equal(api.compactDialogOutcome(null),null);assert.equal(JSON.stringify(entry),snapshot);
});
test('legacy no-op invalidation recovers matching original evidence without changing measurements',()=>{
 const entry=pending(),before=JSON.stringify(entry),recovered=api.recoverCompactEvaluation(entry,identity);
 assert.equal(recovered.status,previous.status);assert.deepEqual(recovered.evaluatedChanges,previous.evaluatedChanges);
 assert.deepEqual(recovered.independentCheck,previous.independentCheck);assert.deepEqual(recovered.originalVerification,previous.originalVerification);
 assert(!recovered.lastResult);assert(!recovered.reason);assert.equal(JSON.stringify(entry),before);
 assert(api.recoverCompactEvaluation(pending({reason:'DOE settings changed.'}),identity));
});
test('recovery rejects incompatible, explicitly cancelled, restarted and incomplete evidence',()=>{
 for(const entry of [pending({restartPending:true}),pending({status:'CANCELLED'}),pending({reason:'Scenario search settings changed.'}),pending({lastResult:{...previous,sourceSignature:'old'}}),pending({lastResult:{...previous,searchSettingsSignature:'old'}}),pending({lastResult:{...previous,methodologySignature:'old'}}),pending({lastResult:{...previous,method:'old'}}),pending({lastResult:{...previous,independentCheck:null}}),pending({lastResult:{...previous,evaluatedChanges:[]}})])assert.equal(api.recoverCompactEvaluation(entry,identity),null);
 assert.equal(api.recoverCompactEvaluation(pending(),{...identity,ready:false}),null);
 assert.equal(api.recoverCompactEvaluation(pending(),{...identity,applicable:()=>false}),null);
});
test('recovered evidence is stored under the original card and creation stays guarded',()=>{
 assert.match(source,/if\(ready&&recoveredEvaluation&&sourceReadiness\(\)\.ready\)/);
 assert.match(source,/simulation\.whatIf\.evaluations=savedEntries\(simulation\)\.filter\(entry=>!sameCard\(entry\)\)\.concat\(\[restored\]\)/);
 assert.match(source,/if\(!requireCompletedSource\(\)\)return;searchSettingsChanged\(\);if\(last\?\.changes\.length\)/);
 assert.match(source,/project\.compact\?compactDialogOutcome\(latest\)/);
});
