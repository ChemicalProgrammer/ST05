import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenarioDOE,analyzeScenarioDOE,analyzeScenarioANOVA,scenarioFSurvival} from '../src/analysis/ScenarioDOE.js';
import {scenarioStudentTCritical,scenarioStudentTPValue,scenarioMeanSummary,scenarioHolmAdjust,scenarioPairedSummary,planScenarioReplications} from '../src/analysis/ScenarioStatistics.js';
const factor=i=>({equipmentId:'conveyor-'+i,path:'speed',before:10,low:10,high:20,unit:'m/min'});
test('DOE enumerates all 16 unique four-factor combinations without changing inputs',()=>{
 const factors=[0,1,2,3].map(factor),snapshot=JSON.stringify(factors),design=createScenarioDOE(factors);
 assert.equal(design.designPoints.length,16);assert.equal(new Set(design.designPoints.map(p=>p.levels.join(','))).size,16);
 assert.equal(design.designPoints[0].changes.length,0);assert.equal(design.designPoints[15].changes.length,4);assert.equal(JSON.stringify(factors),snapshot);
 assert.throws(()=>createScenarioDOE([...factors,factor(4)]),/ONE_TO_FOUR/);
 assert.throws(()=>createScenarioDOE([{...factor(0),low:20,high:10}]),/INVALID_FACTOR/);
 assert.throws(()=>createScenarioDOE([{...factor(0),before:null}]),/INVALID_FACTOR/);
 assert.throws(()=>createScenarioDOE([{...factor(0),external:true}]),/INVALID_FACTOR/);
 assert.throws(()=>createScenarioDOE([factor(0),factor(0)]),/INVALID_FACTOR/);
});
test('DOE recovers main and pair interaction contrasts and refuses incomplete designs',()=>{
 const design=createScenarioDOE([factor(0),factor(1)]);
 const observations=design.designPoints.map(p=>({index:p.index,throughput:100+3*p.levels[0]+7*p.levels[0]*p.levels[1],oee:50+2*p.levels[1]}));
 const analysis=analyzeScenarioDOE(design,observations);assert(analysis.complete);
 assert.equal(analysis.effects[0].throughput,6);assert.equal(analysis.effects[1].oee,4);assert.equal(analysis.effects[2].throughput,14);
 assert.equal(analyzeScenarioDOE(design,observations.slice(1)).complete,false);
 assert.equal(analyzeScenarioDOE(design,observations.map((o,i)=>i===0?{...o,throughput:null}:o)).complete,false);
});

test('reliability DOE preserves intervention evidence at every level and rejects unjustified or adverse targets',()=>{
 const f={equipmentId:'filler',path:'noiseProfile.reliability.mtbfMinutes',before:30,low:30,high:60,external:true,justification:'Replace worn drive; target from supplier reliability data.',unit:'min'};
 const design=createScenarioDOE([f]);assert.equal(design.designPoints[0].changes.length,0);assert.equal(design.designPoints[1].changes[0].external,true);assert.equal(design.designPoints[1].changes[0].justification,f.justification);
 assert.doesNotThrow(()=>createScenarioDOE([{...f,justification:''}]));
 assert.doesNotThrow(()=>createScenarioDOE([{...f,justification:undefined}]));
 assert.throws(()=>createScenarioDOE([{...f,low:20}]),/RELIABILITY_DIRECTION/);
 assert.throws(()=>createScenarioDOE([{...f,external:false}]),/EVIDENCE_REQUIRED/);
 const repair={...f,path:'noiseProfile.reliability.mttrMinutes',before:3,low:1,high:3};assert.equal(createScenarioDOE([repair]).designPoints[0].changes[0].after,1);
 assert.throws(()=>createScenarioDOE([{...repair,high:4}]),/RELIABILITY_DIRECTION/);
});

const close=(actual,expected,tolerance=1e-10)=>assert(Math.abs(actual-expected)<=tolerance,actual+' differs from '+expected);
const pairedExample=(deltas,baseline=100)=>({
 base:{throughput:baseline,roundMetrics:deltas.map((_,seed)=>({seed,throughput:baseline,oee:50}))},
 candidate:{roundMetrics:deltas.map((delta,seed)=>({seed,throughput:baseline+delta,oee:51+delta/100}))}
});
function replicatedFactorial(design,model,seeds=[100,101,102,103,104,105]) {
 return design.designPoints.map(point=>{
  const roundMetrics=seeds.map((seed,j)=>({seed,...model(point.levels,j)}));
  return {index:point.index,roundMetrics,throughput:roundMetrics.reduce((sum,row)=>sum+row.throughput,0)/seeds.length,oee:roundMetrics.reduce((sum,row)=>sum+row.oee,0)/seeds.length};
 });
}

test('Student inverse and tails agree with independently tabulated distribution values',()=>{
 // Reference values independently checked with scipy.stats.t.ppf/sf; df=1
 // also has the analytic Cauchy quantile tan(pi*(.975-.5)).
 for(const [df,critical] of [[1,12.706204736174694],[2,4.302652729749462],[5,2.5705818356363146],[10,2.228138851986274],[29,2.045229642132703],[100,1.9839715185235518]])close(scenarioStudentTCritical(.95,df),critical);
 close(scenarioStudentTCritical(.99,2),9.924843200918287);
 close(scenarioStudentTCritical(.95,1),Math.tan(Math.PI*(.975-.5)));
 close(scenarioStudentTPValue(2,2),.18350341907227397);
 close(scenarioStudentTPValue(-3,5),.030099247897462586);
 close(scenarioFSurvival(4.9646027437307145,1,10),.05);
 close(scenarioFSurvival(1,1,1),.5);
 assert.equal(scenarioStudentTCritical(1,5),null);
 assert.equal(scenarioStudentTCritical(.95,0),null);
 assert.equal(scenarioStudentTPValue(NaN,5),null);
 assert.equal(scenarioStudentTPValue(Infinity,5),0);
 assert.equal(scenarioFSurvival(-1,1,10),null);
});

test('paired summaries match by seed and account for common-random-number covariance',()=>{
 const base={roundMetrics:[1000,2000,500,3000].map((throughput,seed)=>({seed,throughput,oee:50+seed}))};
 const deltas=[3,5,7,5],candidate={roundMetrics:base.roundMetrics.map((row,i)=>({...row,throughput:row.throughput+deltas[i],oee:row.oee+deltas[i]/10})).reverse()};
 const before=JSON.stringify({base,candidate}),summary=scenarioPairedSummary(base,candidate),metric=summary.metrics.throughput;
 assert(summary.available);assert.equal(summary.n,4);assert.deepEqual(summary.seedIds,[0,1,2,3]);
 close(metric.mean,5);close(metric.standardDeviation,Math.sqrt(8/3));close(metric.standardError,Math.sqrt(2/3));
 close(metric.lower,5-3.1824463052837078*Math.sqrt(2/3));close(metric.upper,5+3.1824463052837078*Math.sqrt(2/3));
 close(summary.metrics.oee.mean,.5);assert.equal(metric.df,3);
 assert.equal(JSON.stringify({base,candidate}),before);
 // Adding the same large seed disturbance to both alternatives leaves evidence unchanged.
 base.roundMetrics.forEach(row=>{row.throughput+=row.seed*100000;});
 candidate.roundMetrics.forEach(row=>{row.throughput+=row.seed*100000;});
 assert.deepEqual(scenarioPairedSummary(base,candidate).metrics.throughput,metric);
});

test('paired evidence refuses duplicate, nonfinite and mismatched seeds without dropping observations',()=>{
 for(const target of ['base','candidate']) {
  const data=pairedExample([1,2,3]);data[target].roundMetrics[1].seed=0;
  assert.equal(scenarioPairedSummary(data.base,data.candidate).reason,'DUPLICATE_SEED_IDS');
 }
 for(const seed of [NaN,Infinity,'1',null]) {
  const data=pairedExample([1,2,3]);data.candidate.roundMetrics[1].seed=seed;
  assert.equal(scenarioPairedSummary(data.base,data.candidate).reason,'INVALID_SEED_IDS');
 }
 const data=pairedExample([1,2,3]);data.candidate.roundMetrics[1].seed=99;
 assert.equal(scenarioPairedSummary(data.base,data.candidate).reason,'SEED_IDS_DO_NOT_MATCH');
 const single=pairedExample([1]);assert.equal(scenarioPairedSummary(single.base,single.candidate).available,false);
});

test('missing metrics stay null and zero observed variance supplies no certainty',()=>{
 for(const value of [undefined,null,NaN,Infinity]) {
  const data=pairedExample([1,2,3]);data.candidate.roundMetrics[0].throughput=value;
  const summary=scenarioPairedSummary(data.base,data.candidate);
  assert(summary.available);assert.equal(summary.metrics.throughput,null);assert(summary.metrics.oee);
  assert.equal(summary.metricReasons.throughput,'MISSING_OR_NONFINITE_METRICS');
 }
 const data=pairedExample([5,5,5]),summary=scenarioPairedSummary(data.base,data.candidate).metrics.throughput;
 assert.equal(summary.mean,5);assert.equal(summary.standardDeviation,0);assert.equal(summary.lower,null);assert.equal(summary.upper,null);
 assert.equal(summary.inferenceAvailable,false);assert.equal(summary.reason,'ZERO_OBSERVED_VARIANCE');
 assert.equal(scenarioMeanSummary([5,5+Number.EPSILON*5,5]).lower,null);
 assert.equal(scenarioMeanSummary([1,NaN,2]),null);
 assert.equal(scenarioPairedSummary(data.base,data.candidate,{confidenceLevel:2}).available,false);
});

test('Holm adjustment controls the declared family including unavailable tests',()=>{
 assert.deepEqual(scenarioHolmAdjust([.01,.04,.03]),[.03,.06,.06]);
 assert.deepEqual(scenarioHolmAdjust([.01,null,.03]),[.03,null,.06]);
 assert.deepEqual(scenarioHolmAdjust([.4,.7,.8]),[1,1,1]);
 assert.deepEqual(scenarioHolmAdjust([NaN,-1,2]),[null,null,null]);
});

test('replication plans solve the Student precision criterion and expose the cap',()=>{
 const {base,candidate}=pairedExample([4,5,6]);
 const plan=planScenarioReplications(base,candidate);
 assert.equal(plan.status,'PLANNED');assert.equal(plan.rounds,18);assert.equal(plan.requiredRounds,18);assert.equal(plan.targetHalfWidth,.5);assert.equal(plan.capped,false);
 close(plan.plannedHalfWidth,.49728830071298413);
 assert(scenarioStudentTCritical(.95,16)/Math.sqrt(17)>.5);
 assert.deepEqual(plan.pilotSeeds,[0,1,2]);assert.equal(plan.confirmationMustExcludePilotSeeds,true);
 const capped=planScenarioReplications(base,candidate,{maxRounds:12});
 assert.equal(capped.rounds,12);assert.equal(capped.requiredRounds,18);assert.equal(capped.capped,true);assert.equal(capped.status,'PRECISION_TARGET_EXCEEDS_CAP');
 assert.equal(planScenarioReplications(base,candidate,{absolutePrecision:1}).requiredRounds,7);
 assert.equal(planScenarioReplications(base,candidate,{absolutePrecision:10,minRounds:6}).rounds,6);
 assert.equal(planScenarioReplications(base,candidate,{confirmationSeeds:[2,3,4]}).status,'PILOT_CONFIRMATION_SEEDS_OVERLAP');
 assert.equal(planScenarioReplications(base,candidate,{confirmationSeeds:[10,11,12]}).status,'PLANNED');
});

test('replication planning handles missing evidence, zero variance and invalid precision honestly',()=>{
 const zero=pairedExample([2,2,2]),plan=planScenarioReplications(zero.base,zero.candidate);
 assert.equal(plan.status,'ZERO_PILOT_VARIANCE');assert.equal(plan.rounds,6);assert.equal(plan.requiredRounds,null);
 assert.equal(planScenarioReplications(zero.base,zero.candidate,{maxRounds:4}).rounds,4);
 const few=pairedExample([1,2]);assert.equal(planScenarioReplications(few.base,few.candidate).status,'INSUFFICIENT_PILOT_EVIDENCE');
 const empty=pairedExample([1,2,3],0);assert.equal(planScenarioReplications(empty.base,empty.candidate).status,'POSITIVE_PRECISION_REQUIRED');
 assert.equal(planScenarioReplications(empty.base,empty.candidate,{absolutePrecision:1}).status,'PLANNED');
 assert.equal(planScenarioReplications(zero.base,zero.candidate,{absolutePrecision:0}).status,'POSITIVE_PRECISION_REQUIRED');
 assert.equal(planScenarioReplications(zero.base,zero.candidate,{minRounds:8,maxRounds:3}).status,'INVALID_OPTIONS');
 assert.equal(planScenarioReplications(zero.base,zero.candidate,{confidenceLevel:1}).status,'INVALID_OPTIONS');
});

test('replicated factorials recover known effects with paired intervals and a joint two-metric Holm family',()=>{
 const design=createScenarioDOE([factor(0),factor(1)]),noise=[-2,-1,0,1,2,0],common=[-30,10,50,-10,0,20];
 const observations=replicatedFactorial(design,([a,b],j)=>({throughput:100+3*a+7*a*b+common[j]+(.2*a+.8*b+.3*a*b)*noise[j],oee:50+2*b+.1*a*noise[j]}));
 const result=analyzeScenarioANOVA(design,observations),effects=result.metrics.throughput.effects;
 assert(result.complete);assert.equal(result.primaryInference,'PAIRED_CONTRASTS_ACROSS_INDEPENDENT_SEED_BLOCKS');
 close(effects[0].effect,6);close(effects[1].effect,0);close(effects[2].effect,14);
 close(effects[0].paired.standardDeviation,.4*Math.sqrt(2));close(effects[0].paired.standardError,.4/Math.sqrt(3));
 close(effects[0].lower,6-2.5705818356363146*.4/Math.sqrt(3));assert(effects[0].upper>6);assert.equal(effects[0].paired.df,5);
 assert.equal(result.multiplicity.familySize,6);assert.deepEqual(result.multiplicity.metrics,['oee','throughput']);
 assert(effects[0].significantAdjusted);assert(effects[2].significantAdjusted);assert.equal(effects[1].significantAdjusted,false);
 assert(effects[0].pAdjusted>=effects[0].paired.pValue);assert.equal(effects[0].paired.pAdjusted,effects[0].pAdjusted);
 assert.equal(effects[0].effectMagnitude.units,'OUTPUT_UNITS_PER_MINUTE');close(effects[0].effectMagnitude.absolute,6);
 const descriptive=analyzeScenarioDOE(design,observations);
 close(descriptive.effects[0].throughput,6);close(descriptive.effects[0].statistics.throughput.lower,effects[0].lower);assert(descriptive.inference.available);
 const diagnostics=result.metrics.throughput.residualDiagnostics;
 assert.equal(diagnostics.independentSeedBlocks,6);assert.equal(diagnostics.residualCount,24);assert.equal(diagnostics.normality.established,false);assert.equal(diagnostics.normality.tested,false);
 assert.equal(diagnostics.independence.verified,false);assert(diagnostics.warnings.includes('RESIDUALS_WITHIN_A_SEED_ARE_DEPENDENT'));
});

test('primary contrast uncertainty respects unequal CRN covariance instead of pooled blocked error',()=>{
 const design=createScenarioDOE([factor(0),factor(1)]),large=[-2,-1,0,1,2,0],small=[1,-1,1,-1,1,-1];
 const observations=replicatedFactorial(design,([a,b],j)=>({throughput:100+2*a+5*b+10*large[j]*a+.1*small[j]*b,oee:50+b+.1*a*large[j]+.05*b*small[j]}));
 const result=analyzeScenarioANOVA(design,observations),b=result.metrics.throughput.effects.find(row=>row.factors.join(',')==='1');
 close(b.effect,10);assert(b.paired.standardError<.1);assert(b.pValue>.05,'Pooled legacy F is imprecise for the low-noise B contrast');
 assert(b.paired.pValue<1e-8);assert(b.significantAdjusted);assert(b.blockedFExploratory);
});

test('ANOVA preserves legacy blocked sums but distinguishes deterministic effects from inferential evidence',()=>{
 const design=createScenarioDOE([factor(0),factor(1)]),noise=[-1,0,1],common=[0,10,-10];
 const observations=replicatedFactorial(design,([a,b],j)=>({throughput:100+3*a+2*a*b+common[j]+b*noise[j],oee:50+a+b*noise[j]}),[100,101,102]);
 const result=analyzeScenarioANOVA(design,observations),metric=result.metrics.throughput;
 assert.equal(metric.residualDf,6);assert.equal(metric.residualSS,8);assert.equal(metric.seedBlockSS,800);assert.equal(metric.effects[0].sumSquares,108);assert(metric.effects[0].pValue<.001);
 assert.equal(metric.effects[0].paired.pValue,null);assert.equal(metric.effects[0].pAdjusted,null);assert.equal(metric.effects[0].paired.reason,'ZERO_OBSERVED_VARIANCE');
 const deterministic=replicatedFactorial(design,([a,b])=>({throughput:100+3*a+2*a*b,oee:50+a}));
 const exact=analyzeScenarioANOVA(design,deterministic);
 assert.equal(exact.metrics.throughput.residualMeanSquare,0);assert.equal(exact.metrics.throughput.effects[0].lower,null);
 assert.equal(analyzeScenarioDOE(design,deterministic).inference.available,false);
});

test('factorial inference is invariant to row order, includes higher interactions and refuses damaged replication sets',()=>{
 const design=createScenarioDOE([factor(0),factor(1),factor(2)]),noise=[-2,-1,0,1,2,0];
 const observations=replicatedFactorial(design,([a,b,c],j)=>({throughput:100+5*a*b*c+.1*a*b*c*noise[j],oee:50+.1*a*noise[j]}));
 const first=analyzeScenarioANOVA(design,observations);
 assert.equal(first.metrics.throughput.effects.length,7);assert.equal(first.multiplicity.familySize,14);close(first.metrics.throughput.effects[6].effect,10);
 const reordered=observations.map(row=>({...row,roundMetrics:[...row.roundMetrics].reverse()})).reverse();
 close(analyzeScenarioANOVA(design,reordered).metrics.throughput.effects[6].paired.lower,first.metrics.throughput.effects[6].paired.lower);
 for(const damage of [rows=>{rows[1].roundMetrics[0].seed=999;},rows=>{rows[1].roundMetrics[0].seed=rows[1].roundMetrics[1].seed;},rows=>{rows[1].roundMetrics[0].seed=Infinity;},rows=>{rows[1].roundMetrics[0].throughput=null;},rows=>{rows[1].roundMetrics.pop();}]) {
  const rows=structuredClone(observations);damage(rows);assert.equal(analyzeScenarioANOVA(design,rows).complete,false);
 }
 assert.equal(analyzeScenarioANOVA(design,observations.slice(1)).complete,false);
 assert.equal(analyzeScenarioANOVA({},observations).complete,false);
});

test('DOE and ANOVA share confidence, alpha and the predeclared two-metric family',()=>{
 const design=createScenarioDOE([factor(0),factor(1)]),noise=[-2,-1,0,1,2,0];
 const observations=replicatedFactorial(design,([a,b],j)=>({throughput:100+3*a+2*b+(.2*a+.8*b+.3*a*b)*noise[j],oee:50+2*b+.1*a*noise[j]}));
 const ordinary=analyzeScenarioANOVA(design,observations),strict=analyzeScenarioANOVA(design,observations,{confidenceLevel:.99});
 assert.equal(ordinary.alpha,.05);assert.equal(strict.alpha,.01);assert.equal(strict.confidenceLevel,.99);
 assert.equal(strict.multiplicity.familySize,6);
 const before=ordinary.metrics.throughput.effects[0],after=strict.metrics.throughput.effects[0];
 assert(after.lower<before.lower);assert(after.upper>before.upper);assert.equal(after.pAdjusted,before.pAdjusted);
 assert.deepEqual(analyzeScenarioANOVA(design,observations,{alpha:.01}),strict);
 assert.deepEqual(analyzeScenarioANOVA(design,observations,{confidence:.99,alpha:.01}),strict);
 const effects=analyzeScenarioDOE(design,observations,{confidenceLevel:.99,alpha:.01});
 assert.equal(effects.confidenceLevel,.99);assert.equal(effects.alpha,.01);
 assert.equal(effects.effects[0].statistics.throughput.lower,after.lower);
});

test('invalid or conflicting inference settings cannot silently produce significance',()=>{
 const design=createScenarioDOE([factor(0)]),observations=replicatedFactorial(design,([a],j)=>({throughput:100+a*(j+1),oee:50+a*(j+1)/10}));
 for(const analyze of [analyzeScenarioDOE,analyzeScenarioANOVA]){
  for(const confidenceLevel of [0,1,-.1,1.1,NaN,null,'0.95'])assert.equal(analyze(design,observations,{confidenceLevel}).reason,'INVALID_CONFIDENCE_LEVEL');
  for(const alpha of [0,1,-.1,1.1,NaN,null,'0.05'])assert.equal(analyze(design,observations,{alpha}).reason,'INVALID_ALPHA');
  assert.equal(analyze(design,observations,{confidenceLevel:.95,alpha:.01}).reason,'INCONSISTENT_INFERENCE_SETTINGS');
  assert.equal(analyze(design,observations,{confidenceLevel:.95,confidence:.99}).reason,'INCONSISTENT_INFERENCE_SETTINGS');
  assert.equal(analyze(design,observations,null).complete,false);
 }
});

