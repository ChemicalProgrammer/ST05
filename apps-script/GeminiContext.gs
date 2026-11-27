// Bound request size independently of replay duration or the number of saved runs.
var GEMINI_CONTEXT_BUDGET_ = {contextCharacters:96000,requestCharacters:160000,historyCharacters:16000,maxEquipment:1000,maxOtherSimulations:30,maxSearchEvaluations:6,maxSearchTrials:12,maxEvidenceChanges:12,searchEvidenceCharacters:12000,maxLocalProposals:12,maxLocalChanges:24};
function compactValues_(object,depth) {
  if(!object||typeof object!=='object'||Array.isArray(object))return {};
  var result={};Object.keys(object).slice(0,48).forEach(function(key){
    if(['replay','events','samples','sourceImport','rows','__proto__','constructor','prototype'].includes(key))return;
    var value=object[key];
    if(typeof value==='number'&&isFinite(value)||typeof value==='boolean'||value===null)result[key]=value;
    else if(typeof value==='string')result[key]=value.slice(0,180);
    else if(depth>0&&value&&!Array.isArray(value))result[key]=compactValues_(value,depth-1);
  });return result;
}
// Compact search evidence is advisory data; approval remains in the simulator.
function compactSearchEvidence_(simulation) {
  var signature=STScenarioEngine_.signature(simulation),all=simulation.whatIf?.evaluations||[];
  var current=all.filter(function(e){return e.sourceSimulationId===simulation.id&&e.sourceSignature===signature&&e.tier==='ZERO'&&e.searchScope==='ZERO'&&e.method==='ZERO_PHYSICAL_OFAT_DOE_V1'&&e.searchSettingsSignature===STScenarioEngine_.searchSettingsSignature({automaticBasic:true});}).sort(function(a,b){return String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));});
  function changes(items){return (items||[]).slice(0,GEMINI_CONTEXT_BUDGET_.maxEvidenceChanges).map(function(c){return {equipmentId:c.equipmentId,path:c.path,before:c.before,after:c.after,external:!!c.external,interventionType:c.interventionType,originTier:c.originTier,packageId:c.packageId,targetId:c.targetId,packagePaths:Array.isArray(c.packagePaths)?c.packagePaths.slice(0,12):undefined,analysisOnly:c.analysisOnly===true,justification:typeof c.justification==='string'?c.justification.slice(0,240):undefined};});}
  function metrics(m){return m?{oee:m.oee,throughput:m.throughput}:undefined;}
  var entries=current.slice(0,GEMINI_CONTEXT_BUDGET_.maxSearchEvaluations).map(function(e){
    var trials=e.trialHistory||[],selected=(e.selections||[]).filter(function(c){return c.selected;}),study=compactScenarioStudyEvidence_(simulation,e);
    return {title:String(e.title||'').slice(0,160),scope:e.searchScope,status:e.status,method:e.method,updatedAt:e.updatedAt,run:compactValues_(e.run,0),searchStoppedEarly:!!e.searchStoppedEarly,trials:e.trials,infeasibleTrials:e.infeasibleTrials,
      baseline:metrics(e.baseline),best:metrics(e.candidate),changes:changes(e.evaluatedChanges),changesOmitted:Math.max(0,(e.evaluatedChanges||[]).length-GEMINI_CONTEXT_BUDGET_.maxEvidenceChanges),
      limits:selected.slice(0,GEMINI_CONTEXT_BUDGET_.maxEvidenceChanges).map(function(c){return {equipmentId:c.equipmentId,path:c.path,limit:c.limit,direction:c.limitDirection,unit:c.unit};}),limitsOmitted:Math.max(0,selected.length-GEMINI_CONTEXT_BUDGET_.maxEvidenceChanges),
      independentCheck:e.independentCheck?{passed:study?.confirmation.status==='MODEL_REPRODUCED',reportedPassed:e.independentCheck.passed,seed:e.independentCheck.seed,rounds:e.independentCheck.rounds,baseline:metrics(e.independentCheck.baseline),candidate:metrics(e.independentCheck.candidate)}:undefined,
      study:study,
      warningCount:(e.warnings||[]).length,doe:e.doe?{combinations:e.doe.combinations,completed:(e.doe.observations||[]).length,complete:!!e.doe.analysis?.complete}:undefined,
      tested:trials.slice(-GEMINI_CONTEXT_BUDGET_.maxSearchTrials).map(function(t){return {changes:changes(t.changes),changesOmitted:Math.max(0,(t.changes||[]).length-GEMINI_CONTEXT_BUDGET_.maxEvidenceChanges),feasible:t.feasible,oee:t.oee,throughput:t.throughput,warningCount:t.warningCount};}),
      testedOmitted:Math.max(0,trials.length-GEMINI_CONTEXT_BUDGET_.maxSearchTrials)+(e.trialHistoryOmitted||0),trialHistoryAvailable:Array.isArray(e.trialHistory)};
  });
  while(entries.length&&JSON.stringify(entries).length>GEMINI_CONTEXT_BUDGET_.searchEvidenceCharacters)entries.pop();
  return {evaluations:entries,totalCurrent:current.length,omitted:current.length-entries.length,staleExcluded:all.length-current.length,details:'Bounded saved search evidence only; tested is a partial history, not all combinations. Missing trial history on older evaluations is unknown. Running/cancelled results are provisional. No plant validation.'};
}
// Background methodology is advisory context. Rebuild it from current source
// data; keep the bounded summary free of replay, full signatures and raw rows.
function compactScenarioStudyEvidence_(simulation,evaluation) {
  if(!STScenarioEngine_.study)return undefined;
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.keys(value).sort().reduce(function(copy,key){if(value[key]!==undefined)copy[key]=canonical(value[key]);return copy;},{});return value;}
  var evidence=Object.assign({},evaluation),original=evaluation.independentCheck;
  if(original){
    var check=Object.assign({},original),current=STScenarioEngine_.readiness(simulation).ready&&evaluation.sourceSimulationId===simulation.id&&evaluation.sourceSignature===STScenarioEngine_.signature(simulation)&&evaluation.searchPolicyVersion==='MATCHED_CAPEX_V12'&&evaluation.tier==='ZERO'&&evaluation.searchScope==='ZERO'&&evaluation.method==='ZERO_PHYSICAL_OFAT_DOE_V1'&&evaluation.searchSettingsSignature===STScenarioEngine_.searchSettingsSignature({automaticBasic:true})&&(evaluation.evaluatedChanges||[]).every(function(c){return STScenarioEngine_.zeroAllowed(c,simulation.equipment);})&&evaluation.methodologySignature===JSON.stringify(STScenarioEngine_.methodologyInputs(simulation.whatIf?.methodology||{}))&&['IMPROVEMENT_REPRODUCED','ENGINEERING_REVIEW_REQUIRED','NOT_REPRODUCED'].includes(evaluation.status);
    evidence.independentCheck=check;
    if(current&&STScenarioEngine_.confirm){
      var verified=STScenarioEngine_.confirm(check.baseline,check.candidate,evaluation.confirmationPlan,simulation.whatIf?.methodology||{});
      check.passed=original.passed===true&&verified.passed;check.confirmationKind=verified.kind;check.statisticalEvidence=verified.statisticalEvidence;check.precision=verified.precision;check.oeeGuard=verified.oeeGuard;check.practicalThreshold=verified.threshold;check.reason=verified.reason;
      if(check.durationSeconds!==check.baseline?.durationSeconds||check.rounds!==evaluation.confirmationPlan?.rounds||check.unitOfFlow!==(simulation.unitOfFlow||simulation.results?.unitOfFlow||simulation.results?.replay?.unitOfFlow||'units')||check.unitOfFlow!==check.baseline?.unitOfFlow){check.passed=false;check.reason='CONFIRMATION_METADATA_MISMATCH';}
    }else{check.passed=false;check.reason='CURRENT_CONFIRMATION_REQUIRED';delete check.statisticalEvidence;}
  }
  var study=STScenarioEngine_.study(simulation,evidence),confirmation=study.evidence.confirmation;
  return {version:study.version,packageId:study.evaluatedPackage.id,sourceStatus:study.source.status,
    objective:study.objective,confirmation:{status:confirmation.status,kind:confirmation.kind,
      practicalThreshold:confirmation.practicalThreshold,precision:confirmation.precision,reason:confirmation.reason,
      n:confirmation.statisticalEvidence?.n,confidenceLevel:confirmation.statisticalEvidence?.confidenceLevel,
      throughput:compactValues_(confirmation.statisticalEvidence?.metrics?.throughput,0),
      interpretation:confirmation.interpretation},
    hypotheses:study.hypotheses.slice(0,6).map(function(h){return {equipmentId:h.equipmentId,classification:h.classification,costClass:h.costClass,targetSourceStatus:h.targetSource.status,sourceReference:typeof h.targetSource.sourceReference==='string'?h.targetSource.sourceReference.slice(0,120):undefined,rootCauseVerified:false,targetAchievabilityVerified:false};}),
    hypothesesOmitted:Math.max(0,study.hypotheses.length-6),
    experiment:{status:study.evidence.experiment.status,fixedChanges:study.evidence.experiment.fixedChanges?.slice(0,6),
      inference:study.evidence.experiment.anova?.primaryInference,multiplicity:study.evidence.experiment.anova?.multiplicity},
    feasibility:{status:study.feasibility.status,verified:false},
    economics:{status:study.economics.status,reason:study.economics.reason,scope:study.economics.scope,monetaryInputsRequired:study.economics.monetaryInputsRequired,currency:study.economics.currency,npv:study.economics.npv,simplePaybackYears:study.economics.simplePaybackYears,npvPositive:study.economics.npvPositive,
      missingInputs:study.economics.missingInputs?.slice(0,12),invalidInputs:study.economics.invalidInputs?.slice(0,12),blockers:study.economics.blockers?.slice(0,8)},
    plantValidation:{status:study.plantValidation.status,verified:false}};
}
function buildGeminiContext_(caseData,simulationId) {
  var simulation=(caseData.simulations||[]).find(function(s){return s.id===simulationId;});
  if(!simulation)throw createSimulatorError_('SIMULATION_NOT_FOUND','Select an existing simulation before asking Gemini.');
  var result=simulation.results?.summary?simulation.results:null;
  // Planner candidate validation clones inputs: keep replay and saved search history
  // out of that working copy as well as out of the HTTP payload.
  var planning={id:simulation.id,equipment:simulation.equipment,dynamicConfig:simulation.dynamicConfig,unitOfFlow:simulation.unitOfFlow,whatIf:{externalOptions:simulation.whatIf?.externalOptions||[]},results:result?{summary:result.summary,equipmentMetrics:result.equipmentMetrics,accumulationZoneMetrics:result.accumulationZoneMetrics,durationSeconds:result.durationSeconds,unitOfFlow:result.unitOfFlow,inputSignature:result.inputSignature,replicationStatus:result.replicationStatus,seed:result.seed,effectiveRuntimeStop:result.effectiveRuntimeStop,batch:result.batch?{rounds:result.batch.rounds,rows:result.batch.rows?.map(function(row){return {seed:row.seed,durationSeconds:row.durationSeconds,summary:row.summary,effectiveRuntimeStop:row.effectiveRuntimeStop};}),equipmentStatistics:result.batch.equipmentStatistics}:undefined}:null};
  var audits=STScenarioEngine_.audit(planning),plan=STScenarioEngine_.plan(planning),sourceReadiness=STScenarioEngine_.readiness(planning),searchEvidence=compactSearchEvidence_(simulation);
  var context={version:'analysis-context-v2',case:{id:caseData.id,name:String(caseData.name||'').slice(0,160),unitOfFlow:caseData.unitOfFlow,revision:caseData.revision},selectedSimulation:{id:simulation.id,name:simulation.name,dynamicConfig:compactValues_(simulation.dynamicConfig,1),hasResults:!!result,sourceReadiness:sourceReadiness,summary:compactValues_(result?.summary,1),seed:result?.seed,durationSeconds:result?.durationSeconds,equipment:[]},otherSimulations:[],searchEvidence:searchEvidence,scenarioDefinitions:STScenarioEngine_.definitions,proposalNeeds:(plan.proposalNeeds||[]).slice(0,30),capacityDiagnosis:Object.assign({},plan.capacityDiagnosis,{equipmentTime:undefined,limitingEquipment:(plan.capacityDiagnosis?.limitingEquipment||[]).slice(0,30)}),lossDiagnosis:Object.assign({},plan.diagnosis,{equipment:(plan.diagnosis?.equipment||[]).slice(0,30)}),reliabilityOpportunities:(plan.reliabilityOpportunities||[]).slice(0,12).map(function(r){return {equipmentId:r.equipmentId,kind:r.kind,ownStopPercent:r.ownStopPercent,availabilityBefore:r.availabilityBefore,analysisOnly:true};}),interventionTargets:(simulation.whatIf?.externalOptions||[]).slice(0,12).map(function(p){return {tier:p.tier,changes:p.changes?.slice(0,12).map(function(c){return {equipmentId:c.equipmentId,path:c.path,before:c.before,after:c.after,replacementMaximumBpm:c.replacementMaximumBpm,external:c.external,interventionType:c.interventionType,packageId:c.packageId,targetId:c.targetId,packagePaths:Array.isArray(c.packagePaths)?c.packagePaths.slice(0,12):undefined,analysisOnly:c.analysisOnly===true,justification:String(c.justification||'').slice(0,600)};})};}),localProposals:(sourceReadiness.ready?plan.projects:[]).slice(0,GEMINI_CONTEXT_BUDGET_.maxLocalProposals).map(function(p){return {tier:p.tier,kind:p.kind,basis:p.basis,canApply:p.canApply,changes:p.changes.slice(0,GEMINI_CONTEXT_BUDGET_.maxLocalChanges),changesOmitted:Math.max(0,p.changes.length-GEMINI_CONTEXT_BUDGET_.maxLocalChanges),evidence:compactValues_(p.evidence,1)};}),coverage:{totalEquipment:simulation.equipment.length,includedEquipment:0,omittedEquipment:0,otherSimulationsOmitted:0,replayIncluded:false,eventsIncluded:false,sourceSheetRowsIncluded:false,commandsIncluded:false,commandCount:simulation.dynamicConfig?.commands?.length||0,details:'Full-run aggregates and selected physical inputs only. Raw replay, event logs, raw imports, command schedule and other simulations equipment are excluded. Engineering rules without inputs are not evaluated.'},limitations:plan.checks.filter(function(c){return c.status==='NOT_EVALUATED';}).slice(0,30)};
  // Diagnostic detail grows independently from the main equipment list. Bound
  // its arrays as well, and report omissions without turning absent rows into
  // zero losses or deleting the statistics of a retained confirmation.
  var diagnosticSections=[];
  function diagnosticArray(owner,key,label,total){
    if(!owner||!Array.isArray(owner[key]))return;
    var values=owner[key],count=Number.isInteger(total)?total:values.length;
    owner[key]=values.slice(0,30);diagnosticSections.push({owner:owner,key:key,label:label,total:count});
  }
  diagnosticArray(context.lossDiagnosis,'opportunities','lossOpportunities');
  diagnosticArray(context.lossDiagnosis,'equipment','lossEquipment',(plan.diagnosis?.equipment||[]).length);
  context.lossDiagnosis.rankings=Object.assign({},context.lossDiagnosis.rankings);
  Object.keys(context.lossDiagnosis.rankings).forEach(function(key){diagnosticArray(context.lossDiagnosis.rankings,key,'lossRanking.'+key);});
  context.lossDiagnosis.stopDataQuality=Object.assign({},context.lossDiagnosis.stopDataQuality);
  Object.keys(context.lossDiagnosis.stopDataQuality).forEach(function(key){diagnosticArray(context.lossDiagnosis.stopDataQuality,key,'stopDataQuality.'+key);});
  diagnosticArray(context,'limitations','unevaluatedChecks',plan.checks.filter(function(check){return check.status==='NOT_EVALUATED';}).length);
  diagnosticArray(context,'proposalNeeds','proposalNeeds',(plan.proposalNeeds||[]).length);
  diagnosticArray(context,'reliabilityOpportunities','reliabilityOpportunities',(plan.reliabilityOpportunities||[]).length);
  diagnosticArray(context,'interventionTargets','interventionTargets',(simulation.whatIf?.externalOptions||[]).length);
  diagnosticArray(context.capacityDiagnosis,'limitingEquipment','limitingEquipment',(plan.capacityDiagnosis?.limitingEquipment||[]).length);
  context.coverage.diagnostics={details:'Omitted diagnostic entries are unknown, not zero losses or absent constraints. Scalar source readiness and retained confirmation statistics are preserved.',sections:{}};
  if(caseData.contextLossBreakdown)context.browserLossDiagnosis=compactValues_(caseData.contextLossBreakdown,1);
  context.metricDefinitions={"rateLoss":"lineRateLossSeconds is gross shortfall integrated only over positive final-output ticks. lineRateRecoverySeconds separately records above-reference output. Runtime - effective runtime = loss - recovery, which can be negative. ABOVE_REFERENCE_OUTPUT is diagnostic, not an invalid reference by itself. Source Rate Loss is comparison-only. Match plant gross/net definition and runtime convention before computing a meaningful gap.","downtime":"totalFailureSeconds sums equipment failure durations; overlapping stops and buffering mean this is NOT exclusive line downtime. Do not compare that sum directly with reported plant UPDT.","restarts":"repairRestartCount counts repair recoveries, including immediate recoveries when repairRampEnabled=false. Repair ramps default off. A conveyor downstream ramp may control the adjacent machine; inspect control mapping and executed start requests.","reliability":"CONVEYOR_FAILURES_EXCLUDED is an intentional model assumption confirmed for this plant comparison: conveyors normally have no own stochastic failures and require no MTBF/MTTR; they still respond to material, sensors, blocking and manual/calendar stops. Explicit existing conveyor failure profiles are exceptions and must be preserved unless the user disables them. NO_RELIABILITY_DATA on a machine means reliability inputs are missing; it is different from the conveyor assumption. Missing MTBF/MTTR must not be filled with invented values. The ST MTBF clock now consumes only positive processed-flow ticks. reliabilityExposureSeconds records productive operating time; total starvation/blocking, Prime waiting and no-flow delays consume none. Partial productive ticks count fully. The previous engine used enabled time, so compare the saved clock basis/version before interpreting failure counts. Calendar wear and empty spinning are not modeled."};
  var reliabilitySearch=(simulation.whatIf?.evaluations||[]).filter(e=>e.sourceSignature===STScenarioEngine_.signature(simulation)&&e.reliabilityTargetSearch).slice(-1)[0]?.reliabilityTargetSearch;if(reliabilitySearch)context.reliabilityTargetSearch={analysisOnly:true,classification:'ZERO',status:reliabilitySearch.status,run:reliabilitySearch.run,conditionalReliabilityGain:reliabilitySearch.conditionalReliabilityGain,ranking:(reliabilitySearch.ranking||[]).slice(0,12).map(r=>({equipmentId:r.equipmentId,name:r.name,deltaThroughput:r.deltaThroughput,deltaOeePp:r.deltaOeePp})),selectedChanges:(reliabilitySearch.selectedChanges||[]).slice(0,24),interpretation:reliabilitySearch.interpretation};
  if((result?.engineId||simulation.dynamicConfig?.engineId)==='DES_SIMPY_EXPERIMENTAL'){context.selectedSimulation.engineId='DES_SIMPY_EXPERIMENTAL';context.selectedSimulation.engine=compactValues_(result?.engine,1);context.localProposals=[];context.limitations.unshift({rule:'DES_EXPERIMENTAL_MODEL',status:'NOT_VALIDATED',message:'Experimental spatial item model for alternating machine–conveyor lines, including packed queues, Prime/Back-up sensors, downtime, ramps and residual discharge. OEE and What-If are not validated. Different engines do not pair failure schedules.'});}
  if(simulation.whatIf?.reliabilitySensitivity?.sourceSignature===STScenarioEngine_.signature(simulation)){var sensitivity=simulation.whatIf.reliabilitySensitivity;context.reliabilitySensitivity={analysisOnly:true,run:compactValues_(sensitivity.run,0),levels:sensitivity.levels,coverage:sensitivity.coverage,jointSensitivity:sensitivity.jointSensitivity?{deltaThroughput:sensitivity.jointSensitivity.deltaThroughput,deltaOeePoints:sensitivity.jointSensitivity.deltaOeePoints,confirmation:sensitivity.jointSensitivity.confirmation?{deltaThroughput:sensitivity.jointSensitivity.confirmation.deltaThroughput,deltaOeePoints:sensitivity.jointSensitivity.confirmation.deltaOeePoints}:undefined}:undefined,observations:(sensitivity.observations||[]).slice(0,12).map(function(r){return {equipmentId:r.equipmentId,kind:r.kind,deltaThroughput:r.deltaThroughput,deltaOeePoints:r.deltaOeePoints};}),confirmation:sensitivity.confirmation?{equipmentId:sensitivity.confirmation.equipmentId,kind:sensitivity.confirmation.kind,deltaThroughput:sensitivity.confirmation.deltaThroughput,deltaOeePoints:sensitivity.confirmation.deltaOeePoints}:null};}
  if(result?.batch)context.selectedSimulation.replications={rounds:result.batch.rounds,baseSeed:result.batch.baseSeed,statistics:compactValues_(result.batch.statistics,2),evidenceRound:1,note:'Equipment display metrics use round 1; compatible loss diagnosis uses replication equipment means where available. Observed inactivity is not causal attribution.'};
  context.selectedSimulation.equipment=simulation.equipment.slice(0,GEMINI_CONTEXT_BUDGET_.maxEquipment).map(function(e){
    var audit=audits.find(function(a){return a.equipmentId===e.id;});
    return {id:e.id,name:String(e.name).slice(0,120),type:e.type,nominalRatePerSecond:e.nominalRatePerSecond,initialMode:e.initialMode,processData:compactValues_(e.processData,2),noiseProfile:compactValues_(e.noiseProfile,2),metrics:compactValues_(result?.equipmentMetrics?.[e.id],1),engineering:audit?{input:compactValues_(audit.engineering?.input,0),calculated:compactValues_(audit.engineering?.calculated,0),goals:(audit.engineering?.audit?.goals||[]).map(function(g){return {id:g.id,status:g.status};})}:null};
  });
  context.otherSimulations=(caseData.simulations||[]).filter(function(s){return s.id!==simulation.id;}).slice(0,GEMINI_CONTEXT_BUDGET_.maxOtherSimulations).map(function(s){return {id:s.id,name:String(s.name).slice(0,120),equipmentCount:Array.isArray(s.equipment)?s.equipment.length:Number(s.equipmentCount)||0,seed:s.results?.seed,summary:compactValues_(s.results?.summary,0)};});
  function update(){diagnosticSections.forEach(function(section){var included=section.owner[section.key].length;context.coverage.diagnostics.sections[section.label]={total:section.total,included:included,omitted:Math.max(0,section.total-included)};});context.coverage.searchEvaluationsIncluded=context.searchEvidence.evaluations.length;context.coverage.searchEvaluationsOmitted=context.searchEvidence.totalCurrent-context.searchEvidence.evaluations.length;context.searchEvidence.omitted=context.coverage.searchEvaluationsOmitted;context.coverage.localProposalsOmitted=plan.projects.length-context.localProposals.length;context.coverage.includedEquipment=context.selectedSimulation.equipment.length;context.coverage.omittedEquipment=simulation.equipment.length-context.coverage.includedEquipment;context.coverage.otherSimulationsOmitted=Math.max(0,(caseData.totalSimulationCount||caseData.simulations.length)-1-context.otherSimulations.length);return JSON.stringify(context);}
  var json=update();
  while(json.length>GEMINI_CONTEXT_BUDGET_.contextCharacters&&context.otherSimulations.length){context.otherSimulations.pop();json=update();}
  while(json.length>GEMINI_CONTEXT_BUDGET_.contextCharacters&&context.localProposals.length){context.localProposals.pop();json=update();}
  // Remove duplicate/advisory diagnostic detail before discarding complete
  // saved confirmation entries. Never partially trim their effect thresholds.
  diagnosticSections.forEach(function(section){while(json.length>GEMINI_CONTEXT_BUDGET_.contextCharacters&&section.owner[section.key].length){section.owner[section.key].pop();json=update();}});
  while(json.length>GEMINI_CONTEXT_BUDGET_.contextCharacters&&context.selectedSimulation.equipment.length){context.selectedSimulation.equipment.pop();json=update();}
  while(json.length>GEMINI_CONTEXT_BUDGET_.contextCharacters&&context.searchEvidence.evaluations.length){context.searchEvidence.evaluations.pop();json=update();}
  if(json.length>GEMINI_CONTEXT_BUDGET_.contextCharacters)throw createSimulatorError_('GEMINI_CONTEXT_LIMIT','The compact analysis is still too large. Reduce the selected equipment scope.');
  return {json:json,coverage:context.coverage,simulation:simulation,characters:json.length};
}
function compactGeminiHistory_(history) {
  if(!Array.isArray(history)||history.length>24)throw createSimulatorError_('INVALID_HISTORY','Clear the conversation and try again.');
  history.forEach(function(m){if(!m||!['user','model'].includes(m.role)||typeof m.text!=='string'||m.text.length>32000)throw createSimulatorError_('INVALID_HISTORY','Clear the conversation and try again.');});
  var selected=[],size=0;
  for(var i=history.length-1;i>=0;i--){if(size+history[i].text.length>GEMINI_CONTEXT_BUDGET_.historyCharacters)break;selected.unshift({role:history[i].role,parts:[{text:history[i].text}]});size+=history[i].text.length;}
  // Conversations sent to Gemini begin with a user turn.
  while(selected.length&&selected[0].role!=='user')selected.shift();
  return {contents:selected,omitted:history.length-selected.length};
}
