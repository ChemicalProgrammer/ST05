function getScenarioSourceSignature_(request,user) {
  var record=getCase_(request.caseId,user);
  if(Number(request.expectedRevision)!==Number(record.revision))throw createSimulatorError_('CASE_CONFLICT','The case changed. Review the latest version before creating a scenario.');
  var source=record.simulations.find(function(s){return s.id===request.simulationId;});
  if(!source)throw createSimulatorError_('SIMULATION_NOT_FOUND','The source simulation no longer exists.');
  requireCompletedScenarioSource_(source);
  return {revision:record.revision,simulationId:source.id,signature:STScenarioEngine_.signature(source)};
}

function requireCompletedScenarioSource_(source) {
  var readiness=STScenarioEngine_.readiness?.(source);
  if(!readiness?.ready)throw createSimulatorError_('SCENARIO_SOURCE_NOT_READY','Complete the numerical simulation to 100% with the current inputs before generating CAPEX scenarios.',[readiness?.reason||'SOURCE_VALIDATION_UNAVAILABLE']);
  return readiness;
}

function createScenario_(request,user) {
  return withCaseWriteLock_(function() {
    var owned=getOwnedCaseFile_(request.caseId,user),record=ensureCaseSimulations_(owned.caseData);
    var prepared=prepareScenarioFromRecord_(request,record,user);
    owned.file=persistCaseRecord_(record,owned);if(typeof updateCaseIndex_==='function')updateCaseIndex_(record,owned.file,user);return prepared;
  });
}
function prepareScenarioFromRecord_(request,record,user) {
    if(Number(request.expectedRevision)!==Number(record.revision))throw createSimulatorError_('CASE_CONFLICT','The case changed. Review the latest version before creating a scenario.');
    var source=record.simulations.find(function(s){return s.id===request.simulationId;});
    if(!source)throw createSimulatorError_('SIMULATION_NOT_FOUND','The source simulation no longer exists.');
    requireCompletedScenarioSource_(source);
    var sourceSignature=STScenarioEngine_.signature(source),submitted=request.proposal;
    // Reject paused CAPEX scopes before local planning or AI proposal binding.
    if(!['ZERO','MEDIUM'].includes(submitted?.tier)||submitted.searchScope&&submitted.searchScope!==submitted.tier||submitted.tier==='MEDIUM'&&(request.origin!=='REVIEWED'||record.metadata?.workspaceMode!=='MINIMAL'))throw createSimulatorError_('SCENARIO_CAPEX_DISABLED','This CAPEX scope is disabled.');
    if(request.origin==='LOCAL'){
      // Recompute the recommendation from the supplied source. A local
      // proposal is valid only if its exact edits still match a current candidate.
      // Browser fingerprints are not needed to establish that equivalence.
      submitted=resolveLocalScenarioProposal_(submitted,source);
    }else if(['GEMINI','REVIEWED'].includes(request.origin)){
      if(request.sourceSignature!==sourceSignature)throw createSimulatorError_('SCENARIO_STALE','The simulation inputs changed. Request a new proposal.');
      if(request.origin==='GEMINI'){
        if(submitted?.sourceSignature&&submitted.sourceSignature!==sourceSignature||submitted?.sourceSimulationId&&submitted.sourceSimulationId!==source.id)throw createSimulatorError_('SCENARIO_STALE','This Gemini proposal belongs to different simulation inputs. Request a new proposal.');
        // Rebind descriptive AI "before" values only when the proposal itself
        // carries the exact unchanged-source fingerprint. Preserve all targets.
        if(submitted?.sourceSignature===sourceSignature&&submitted.sourceSimulationId===source.id)submitted=bindGeminiScenarioProposal_(submitted,source);
      }
    }else throw createSimulatorError_('INVALID_SCENARIO','The scenario origin is invalid.');
    var proposal=normalizeScenarioProposal_(submitted,source),copy;
    try{copy=STScenarioEngine_.apply(source,proposal.changes);}catch(error){throw createSimulatorError_('INVALID_SCENARIO','The proposed inputs did not pass the physical model checks.',[String(error.message)]);}
    copy.id=generateSimulationId_(record.simulations.length)+'-'+Utilities.getUuid().slice(0,8);
    copy.name=proposal.title.slice(0,120);copy.clonedFromSimulationId=source.id;copy.results=null;copy.geminiHistory=[];delete copy.whatIf;
    copy.createdAt=new Date().toISOString();copy.updatedAt=copy.createdAt;
    // Normalization establishes the intervention scope independently of whether
    // its model targets have implementation evidence. Keep both facts.
    copy.scenario={analysisOnly:proposal.analysisOnly,classification:'INTERVENTION_SCOPE',kind:proposal.kind,title:proposal.title,capex:proposal.tier,evidenceBasis:proposal.basis,sourceSimulationId:source.id,sourceSimulationName:source.name,sourceSignature:sourceSignature,changes:proposal.changes,evidence:proposal.evidence,origin:request.origin,plantValidated:false,validation:proposal.analysisOnly?'EXPLORATORY_TARGETS_REQUIRE_FEASIBILITY_REVIEW':proposal.evidence.engineeringReview?'ENGINEERING_REVIEW_REQUIRED':proposal.evidence.independentValidation==='NOT_REPRODUCED_REQUIRES_VALIDATION'?'NOT_REPRODUCED_REQUIRES_VALIDATION':copy.scenarioWarnings?.length?'ENGINEERING_REVIEW_REQUIRED':'INPUTS_VALIDATED_NOT_SIMULATED',engineeringWarnings:copy.scenarioWarnings||[],createdAt:copy.createdAt};
    // Rebuild background evidence from the exact saved experiment. Never accept
    // a client/agent-authored study or transfer another package's economics.
    if(STScenarioEngine_.study)copy.scenario.study=buildSavedScenarioStudy_(source,proposal,sourceSignature,copy.scenarioWarnings||[],record.metadata?.scenarioSearch);
    record.simulations.push(copy);record.revision++;record.updatedAt=copy.createdAt;
    return {case:record,simulationId:copy.id};
}

function buildSavedScenarioStudy_(source,proposal,sourceSignature,warnings,searchSettings) {
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.keys(value).sort().reduce(function(copy,key){if(value[key]!==undefined)copy[key]=canonical(value[key]);return copy;},{});return value;}
  function changesKey(changes){return JSON.stringify((changes||[]).map(function(c){return canonical({equipmentId:c.equipmentId,path:c.path,before:c.before,after:c.after,replacementMaximumBpm:c.replacementMaximumBpm,analysisOnly:c.analysisOnly===true,external:c.external===true,interventionType:c.interventionType,originTier:c.originTier,packageId:c.packageId,targetId:c.targetId,packagePaths:Array.isArray(c.packagePaths)?c.packagePaths.slice().sort():undefined});}).sort(function(a,b){return (a.equipmentId+':'+a.path).localeCompare(b.equipmentId+':'+b.path);}));}
  var key=changesKey(proposal.changes),methodologySignature=JSON.stringify(STScenarioEngine_.methodologyInputs(source.whatIf?.methodology||{})),searchSettingsSignature=STScenarioEngine_.searchSettingsSignature(searchSettings);
  var matched=(source.whatIf?.evaluations||[]).filter(function(entry){return entry.sourceSimulationId===source.id&&entry.sourceSignature===sourceSignature&&entry.searchPolicyVersion==='MATCHED_CAPEX_V12'&&entry.method===(proposal.tier==='MEDIUM'?'MEDIUM_BUFFER_PACKAGES_V1':'ZERO_PHYSICAL_OFAT_DOE_V1')&&entry.tier===proposal.tier&&entry.searchScope===proposal.tier&&entry.methodologySignature===methodologySignature&&entry.searchSettingsSignature===STScenarioEngine_.searchSettingsSignature({speedProfile:'FAST',automaticBasic:true})&&changesKey(entry.evaluatedChanges)===key&&['IMPROVEMENT_REPRODUCED','ENGINEERING_REVIEW_REQUIRED','NOT_REPRODUCED'].includes(entry.status);}).sort(function(a,b){return String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));})[0];
  var evidence=matched?JSON.parse(JSON.stringify(matched)):{sourceSimulationId:source.id,sourceSignature:sourceSignature,unitOfFlow:source.unitOfFlow||'units',evaluatedChanges:proposal.changes,analysisOnly:proposal.analysisOnly,status:'NO_MATCHING_CURRENT_EVALUATION'};
  evidence.warnings=(evidence.warnings||[]).concat(warnings);
  if(evidence.independentCheck){
    var check=evidence.independentCheck,confirmation=STScenarioEngine_.confirm(check.baseline,check.candidate,evidence.confirmationPlan,source.whatIf?.methodology||{});
    check.passed=confirmation.passed&&check.passed===true;check.confirmationKind=confirmation.kind;check.statisticalEvidence=confirmation.statisticalEvidence;check.precision=confirmation.precision;check.reason=confirmation.reason;
    check.oeeGuard=confirmation.oeeGuard;check.practicalThreshold=confirmation.threshold;
    if(!Number.isFinite(check.baseline?.overflowUnits)||!Number.isFinite(check.candidate?.overflowUnits)||check.candidate.overflowUnits>check.baseline.overflowUnits+1e-6){check.passed=false;check.reason='OVERFLOW_REGRESSION';}
    if((!evidence.confirmationPlan?.automaticBasic||check.scenarioFidelity!=='PHYSICAL_PRECISE_V1'||check.baseline?.scenarioFidelity!=='PHYSICAL_PRECISE_V1'||check.candidate?.scenarioFidelity!=='PHYSICAL_PRECISE_V1')){check.passed=false;check.reason='BASIC_PRECISE_CONFIRMATION_REQUIRED';}
    if(check.durationSeconds!==check.baseline?.durationSeconds||check.rounds!==evidence.confirmationPlan?.rounds||check.unitOfFlow!==(source.unitOfFlow||source.results?.unitOfFlow||source.results?.replay?.unitOfFlow||'units')||check.unitOfFlow!==check.baseline?.unitOfFlow){check.passed=false;check.reason='CONFIRMATION_METADATA_MISMATCH';}
  }
  if(['ZERO','MEDIUM'].includes(proposal.tier)){
    evidence.originalVerificationRequired=true;
    if(evidence.independentCheck?.passed===true){evidence.originalVerification=STScenarioEngine_.verifyOriginal(source,evidence.originalVerification?.candidate||null,proposal.changes);}
    if(evidence.originalVerification?.passed!==true&&['IMPROVEMENT_REPRODUCED','ENGINEERING_REVIEW_REQUIRED'].includes(evidence.status))evidence.status='NOT_REPRODUCED';
  }
  return STScenarioEngine_.study(source,evidence);
}
function resolveLocalScenarioProposal_(proposal,source) {
  if(!proposal||proposal.sourceSimulationId!==source.id||!Array.isArray(proposal.changes)||!proposal.changes.length)throw createSimulatorError_('INVALID_SCENARIO','The local scenario source or changes are invalid.');
  var current=STScenarioEngine_.plan(source).candidates.find(function(candidate){
    return candidate.canApply&&candidate.kind===proposal.kind&&candidate.tier===proposal.tier&&candidate.basis===proposal.basis&&
      candidate.equipmentId===proposal.equipmentId&&candidate.changes.length===proposal.changes.length&&
      candidate.changes.every(function(change,index){
        var submitted=proposal.changes[index];
        return submitted&&change.equipmentId===submitted.equipmentId&&change.path===submitted.path&&change.before===submitted.before&&change.after===submitted.after;
      });
  });
  if(!current)throw createSimulatorError_('SCENARIO_REVIEW_REQUIRED','The saved inputs now produce a different recommendation. Reopen What-If to review the updated proposal.');
  // Evidence is always recomputed by the server; only the display title comes
  // from the client, and its type and length are validated by the shared service.
  return Object.assign({},current,{title:proposal.title});
}
function normalizeScenarioProposal_(proposal,source) {
  requireCompletedScenarioSource_(source);
  if(!proposal||!['ZERO','MEDIUM'].includes(proposal.tier)||!['STATIC','DYNAMIC','HYBRID'].includes(proposal.basis)||!Array.isArray(proposal.changes))throw createSimulatorError_('INVALID_SCENARIO','The scenario format is invalid.');
  if(!proposal.changes.length||!proposal.changes.every(c=>proposal.tier==='MEDIUM'?c.interventionType==='ACCUMULATION'&&STScenarioEngine_.categoryAllows(c,'MEDIUM'):STScenarioEngine_.zeroAllowed(c,source.equipment)))throw createSimulatorError_('INVALID_SCENARIO','The changes do not belong to the selected CAPEX category.');
  if(proposal.basis!=='STATIC'&&!source.results?.summary)throw createSimulatorError_('INVALID_SCENARIO','Dynamic evidence requires a completed simulation.');
  var title=typeof proposal.title==='string'?proposal.title.trim().slice(0,120):'';
  if(!title)throw createSimulatorError_('INVALID_SCENARIO','A scenario title is required.');
  // Field allowlist, value bounds, expected before values, topology and audits are shared with the browser.
  try{STScenarioEngine_.apply(source,proposal.changes);}catch(error){
    if(error.message==='SCENARIO_STALE'){
      var mismatches=proposal.changes.map(function(change){var equipment=source.equipment.find(function(e){return e.id===change.equipmentId;});if(!equipment)return null;var current=change.path.split('.').reduce(function(value,key){return value?.[key];},equipment)??null;return current!==change.before?(equipment.name||equipment.id)+' · '+change.path+': proposal before '+JSON.stringify(change.before)+'; current '+JSON.stringify(current):null;}).filter(Boolean).slice(0,6);
      throw createSimulatorError_('SCENARIO_STALE','The proposed starting values do not match the selected simulation. Request a new proposal.',mismatches);
    }
    throw createSimulatorError_('INVALID_SCENARIO','The scenario contains an invalid change.',[String(error.message)]);
  }
  var exploratory=proposal.analysisOnly===true;if(exploratory&&!proposal.changes.some(c=>c.analysisOnly===true)||!exploratory&&proposal.changes.some(c=>c.analysisOnly===true))throw createSimulatorError_('INVALID_SCENARIO','Exploratory changes must retain their exploratory scenario qualification.');
  if(proposal.changes.some(function(c){return c.packagePaths!==undefined&&(!Array.isArray(c.packagePaths)||c.packagePaths.length>Object.keys(STScenarioEngine_.fields).length||c.packagePaths.some(function(path){return typeof path!=='string'||!Object.prototype.hasOwnProperty.call(STScenarioEngine_.fields,path);}));}))throw createSimulatorError_('INVALID_SCENARIO','The intervention package contains unsupported inputs.');
  var changes=proposal.changes.map(function(c){return {equipmentId:c.equipmentId,path:c.path,before:c.before,after:c.after,...(c.analysisOnly===true?{analysisOnly:true}:{}),...(c.replacementMaximumBpm!==undefined?{replacementMaximumBpm:c.replacementMaximumBpm}:{}),...(c.originTier?{originTier:c.originTier}:{}),...(c.interventionType?{interventionType:c.interventionType,costClass:STScenarioEngine_.interventions[c.interventionType]?.costClass}:{}),...(typeof c.packageId==='string'?{packageId:c.packageId.slice(0,160)}:{}),...(typeof c.targetId==='string'?{targetId:c.targetId.slice(0,160)}:{}),...(Array.isArray(c.packagePaths)?{packagePaths:c.packagePaths.slice()}:{}),unit:STScenarioEngine_.fields[c.path][2],...(c.external===true?{external:true}:{}),...(typeof c.justification==='string'?{justification:c.justification.slice(0,600)}:{})};});
  if(proposal.changes.some(function(c){return !STScenarioEngine_.categoryAllows(c,proposal.tier,{allowAnalysisOnly:exploratory})||c.originTier&&c.originTier!==proposal.tier;}))throw createSimulatorError_('INVALID_SCENARIO','Each CAPEX category is independent. Every change must belong to the selected intervention scope.');
  var evidence={};
  if(proposal.evidence&&typeof proposal.evidence==='object'&&!Array.isArray(proposal.evidence))Object.keys(proposal.evidence).slice(0,12).forEach(function(key){
    if(!/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(key)||['constructor','prototype'].includes(key))return;
    var value=proposal.evidence[key];if(typeof value==='number'&&isFinite(value)||value===null)evidence[key]=value;else if(typeof value==='string')evidence[key]=value.slice(0,600);
  });
  // Keep the conservative draft classification even if generic evidence hit its key budget.
  if(proposal.evidence?.independentValidation==='NOT_REPRODUCED_REQUIRES_VALIDATION')evidence.independentValidation='NOT_REPRODUCED_REQUIRES_VALIDATION';
  return {analysisOnly:exploratory,title:title,kind:typeof proposal.kind==='string'?proposal.kind.slice(0,60):'CUSTOM',tier:proposal.tier,basis:proposal.basis,changes:changes,evidence:evidence};
}


// AI provides targets; authoritative starting values come from the source inputs.
function bindGeminiScenarioProposal_(proposal,source){
  if(!Array.isArray(proposal?.changes))throw createSimulatorError_('INVALID_SCENARIO','The scenario changes must be a list.');
  return Object.assign({},proposal,{changes:proposal.changes.map(function(change){
    var equipment=source.equipment.find(function(e){return e.id===change?.equipmentId;});
    if(!equipment||!Object.prototype.hasOwnProperty.call(STScenarioEngine_.fields,change.path))throw createSimulatorError_('INVALID_SCENARIO','The scenario references an unknown equipment or input.');
    var before=change.path.split('.').reduce(function(value,key){return value?.[key];},equipment)??null;
    return Object.assign({},change,{before:before});
  })});
}
