import {scenarioFDistributionSurvival,scenarioMeanSummary,scenarioStudentTPValue,scenarioHolmAdjust} from './ScenarioStatistics.js';

// The same confidence setting drives intervals and the complementary test
// threshold. Do not silently ignore an explicitly supplied alpha or choose the
// more favorable of two conflicting settings.
function scenarioDOEInferenceSettings(options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options))return {reason:'INVALID_INFERENCE_SETTINGS'};
  const levels=[options.confidenceLevel,options.confidence].filter(value=>value!==undefined);
  if(levels.some(value=>!Number.isFinite(value)||value<=0||value>=1))return {reason:'INVALID_CONFIDENCE_LEVEL'};
  if(options.alpha!==undefined&&(!Number.isFinite(options.alpha)||options.alpha<=0||options.alpha>=1))return {reason:'INVALID_ALPHA'};
  const confidenceLevel=levels[0]??(options.alpha!==undefined?Number((1-options.alpha).toPrecision(15)):.95);
  if(levels.some(value=>Math.abs(value-confidenceLevel)>1e-12)||options.alpha!==undefined&&Math.abs(options.alpha+confidenceLevel-1)>1e-12)return {reason:'INCONSISTENT_INFERENCE_SETTINGS'};
  return {confidenceLevel,alpha:Number((1-confidenceLevel).toPrecision(15))};
}

// Two-level pilot: at most four factors, with explicit feasible bounds.
export function createScenarioDOE(factors) {
  if(!Array.isArray(factors)||factors.length<1||factors.length>4)throw Error('DOE_SELECT_ONE_TO_FOUR_FACTORS');
  const seen=new Set();
  for(const f of factors){
    const key=f.equipmentId+':'+f.path;
    if(seen.has(key)||!Number.isFinite(f.low)||!Number.isFinite(f.high)||f.low>=f.high||!Number.isFinite(f.before))throw Error('DOE_INVALID_FACTOR');
    if(f.path.startsWith('noiseProfile.reliability.')){
      if(f.external!==true||!(f.before>0))throw Error('DOE_EXTERNAL_EVIDENCE_REQUIRED');
      if(f.path.endsWith('mtbfMinutes')?f.low<f.before:f.high>f.before)throw Error('DOE_RELIABILITY_DIRECTION');
    }else if(f.external){if(f.path!=='nominalRatePerSecond'||f.interventionType!=='REPLACEMENT'||!f.justification?.trim()||!Number.isFinite(f.replacementMaximumBpm)||f.high>f.replacementMaximumBpm/60||f.low<f.before)throw Error('DOE_INVALID_FACTOR');}
    seen.add(key);
  }
  return {type:'FULL_FACTORIAL_TWO_LEVEL',factors:JSON.parse(JSON.stringify(factors)),designPoints:Array.from({length:2**factors.length},(_,index)=>{
    const levels=factors.map((_,i)=>(index>>i)&1?1:-1);
    return {index,levels,changes:factors.map((f,i)=>({equipmentId:f.equipmentId,path:f.path,before:f.before,after:levels[i]===1?f.high:f.low,unit:f.unit,...(f.external?{external:true,justification:f.justification,interventionType:f.interventionType,originTier:f.originTier,...(f.replacementMaximumBpm!==undefined?{replacementMaximumBpm:f.replacementMaximumBpm}:{})}:{})})).filter(c=>c.before!==c.after)};
  })};
}
function scenarioDOEOrderedObservations(design,observations) {
  if(!Array.isArray(design?.factors)||design.factors.length<1||design.factors.length>4||!Array.isArray(design.designPoints)||!Array.isArray(observations))return null;
  const expected=2**design.factors.length,points=design.designPoints;
  if(points.length!==expected||new Set(points.map(point=>point?.index)).size!==expected||points.some(point=>!Array.isArray(point?.levels)||point.levels.length!==design.factors.length||point.levels.some(level=>level!==-1&&level!==1))||new Set(points.map(point=>point.levels.join(','))).size!==expected)return null;
  if(observations.length!==expected||new Set(observations.map(row=>row?.index)).size!==expected||observations.some(row=>!Number.isFinite(row?.oee)||!Number.isFinite(row?.throughput)))return null;
  const ordered=points.map(point=>observations.find(row=>row.index===point.index));
  return ordered.every(Boolean)?ordered:null;
}

function scenarioDOEResidualDiagnostics(residuals,mse,seedCount) {
  const values=residuals.flat(),count=values.length;
  const secondMoment=values.reduce((sum,value)=>sum+value*value/count,0);
  const treatmentResidualVariances=residuals.map(row=>row.reduce((sum,value)=>sum+value*value,0)/(seedCount-1));
  const smallest=Math.min(...treatmentResidualVariances),largest=Math.max(...treatmentResidualVariances);
  return {
    residualCount:count,independentSeedBlocks:seedCount,zeroResidualVariance:mse===0,
    maximumAbsoluteStandardizedResidual:mse>0?Math.max(...values.map(value=>Math.abs(value)))/Math.sqrt(mse):null,
    descriptiveSkewness:secondMoment>0?values.reduce((sum,value)=>sum+value**3/count,0)/secondMoment**1.5:null,
    treatmentResidualVariances,descriptiveVarianceRatio:smallest>0?largest/smallest:null,
    normality:{tested:false,established:false,reason:seedCount<20?'TOO_FEW_INDEPENDENT_SEED_BLOCKS_FOR_RELIABLE_SHAPE_ASSESSMENT':'NORMALITY_NOT_TESTED'},
    independence:{verified:false,assumption:'Independent random streams across seed blocks; matching unique seed identifiers alone does not prove independence.'},
    equalVariance:{tested:false,assumedOnlyForExploratoryBlockedF:true},
    warnings:['RESIDUALS_WITHIN_A_SEED_ARE_DEPENDENT','DESCRIPTIVE_RESIDUAL_CHECKS_DO_NOT_VALIDATE_NORMALITY',...(mse===0?['ZERO_VARIANCE_DOES_NOT_ESTABLISH_CERTAINTY']:[])]
  };
}

function scenarioDOEInferentialAnalysis(design,observations,options={}) {
  const settings=scenarioDOEInferenceSettings(options);
  if(settings.reason)return {complete:false,reason:settings.reason};
  const ordered=scenarioDOEOrderedObservations(design,observations);
  if(!ordered)return {complete:false,reason:'INCOMPLETE_OR_INFEASIBLE_DESIGN'};
  const {confidenceLevel,alpha}=settings;
  const n=ordered.length,r=ordered[0].roundMetrics?.length;
  if(!(r>=3)||ordered.some(row=>!Array.isArray(row.roundMetrics)||row.roundMetrics.length!==r||row.roundMetrics.some(value=>!Number.isFinite(value?.seed)||!Number.isFinite(value.oee)||!Number.isFinite(value.throughput))||new Set(row.roundMetrics.map(value=>value.seed)).size!==r))return {complete:false,reason:'MATCHED_REPLICATIONS_REQUIRED'};
  const seedIds=ordered[0].roundMetrics.map(row=>row.seed),rowsBySeed=ordered.map(row=>new Map(row.roundMetrics.map(value=>[value.seed,value])));
  if(rowsBySeed.some(rows=>seedIds.some(seed=>!rows.has(seed))))return {complete:false,reason:'MATCHED_REPLICATIONS_REQUIRED'};
  const terms=[];
  for(let mask=1;mask<n;mask++)terms.push(design.factors.map((_,i)=>i).filter(i=>mask&(1<<i)));
  const metrics={},hypotheses=[];
  for(const metric of ['oee','throughput']) {
    const values=rowsBySeed.map(rows=>seedIds.map(seed=>rows.get(seed)[metric]));
    const means=values.map(row=>row.reduce((sum,value)=>sum+value,0)/r);
    const grand=means.reduce((sum,value)=>sum+value,0)/n;
    const blocks=seedIds.map((_,j)=>values.reduce((sum,row)=>sum+row[j],0)/n);
    const residuals=values.map((row,i)=>row.map((value,j)=>value-means[i]-blocks[j]+grand));
    const residualSS=residuals.reduce((sum,row)=>sum+row.reduce((s,value)=>s+value*value,0),0);
    const residualDf=(n-1)*(r-1),mse=residualSS/residualDf;
    if(!Number.isFinite(residualSS))return {complete:false,reason:'NONFINITE_REPLICATION_STATISTICS'};
    const effects=[];
    for(const indices of terms) {
      const signs=design.designPoints.map(point=>indices.reduce((sign,i)=>sign*point.levels[i],1));
      // Each seed supplies one high-minus-low factorial contrast. Its variance
      // includes CRN covariance; a pooled treatment residual variance need not.
      const contrasts=seedIds.map((_,j)=>values.reduce((sum,row,i)=>sum+signs[i]*row[j]/(n/2),0));
      const summary=scenarioMeanSummary(contrasts,{confidenceLevel});
      if(!summary)return {complete:false,reason:'NONFINITE_REPLICATION_STATISTICS'};
      const effect=summary.mean,sumSquares=n*r*effect*effect/4;
      const f=mse>1e-20?sumSquares/mse:null,pValue=f===null?null:scenarioFSurvival(f,1,residualDf);
      const t=summary.inferenceAvailable?effect/summary.standardError:null;
      const paired={...summary,t,pValue:t===null?null:scenarioStudentTPValue(t,r-1),pAdjusted:null,significantAdjusted:null,method:'T_TEST_OF_INDEPENDENT_SEED_CONTRASTS',confidenceIntervalScope:'MARGINAL_NOT_SIMULTANEOUS'};
      const row={factors:indices,effect,sumSquares,df:1,f,pValue,significant:pValue===null?null:pValue<alpha,blockedFExploratory:true,paired,lower:summary.lower,upper:summary.upper,standardError:summary.standardError,pAdjusted:null,significantAdjusted:null,effectMagnitude:{absolute:Math.abs(effect),relativeToGrandMean:grand!==0?effect/grand:null,pairedStandardized:summary.standardDeviation>0?effect/summary.standardDeviation:null,units:metric==='oee'?'PERCENTAGE_POINTS':'OUTPUT_UNITS_PER_MINUTE'},partialEtaSquared:sumSquares+residualSS>0?sumSquares/(sumSquares+residualSS):null};
      effects.push(row);hypotheses.push(row);
    }
    const reportedMeansMatchReplications=ordered.every((row,i)=>Math.abs(row[metric]-means[i])<=1e-9*Math.max(1,Math.abs(means[i])));
    metrics[metric]={residualSS,residualDf,residualMeanSquare:mse,seedBlockSS:n*blocks.reduce((sum,value)=>sum+(value-grand)**2,0),seedBlockDf:r-1,grandMean:grand,reportedMeansMatchReplications,effectSource:'ROUND_METRICS',residualDiagnostics:scenarioDOEResidualDiagnostics(residuals,mse,r),effects};
  }
  // One predeclared family includes all factorial contrasts in both reported
  // metrics, not separate families selected after seeing the more favorable Y.
  const adjusted=scenarioHolmAdjust(hypotheses.map(row=>row.paired.pValue));
  hypotheses.forEach((row,i)=>{row.pAdjusted=adjusted[i];row.significantAdjusted=adjusted[i]===null?null:adjusted[i]<alpha;row.paired.pAdjusted=row.pAdjusted;row.paired.significantAdjusted=row.significantAdjusted;});
  return {complete:true,model:'FULL_FACTORIAL_WITH_SEED_BLOCKS',primaryInference:'PAIRED_CONTRASTS_ACROSS_INDEPENDENT_SEED_BLOCKS',alpha,confidenceLevel,seedIds,replications:r,multiplicity:{method:'HOLM',scope:'ALL_FACTORIAL_CONTRASTS_ACROSS_OEE_AND_THROUGHPUT',metrics:['oee','throughput'],familySize:hypotheses.length,intervals:'NOMINAL_MARGINAL_INTERVALS_NOT_MULTIPLICITY_ADJUSTED'},interpretation:'Primary inference uses per-seed factorial contrasts and Holm-adjusted p-values across all effects and both metrics. Marginal Student intervals assume independent seed blocks and suitable contrast distributions. Legacy blocked F and p-values remain exploratory because CRN covariance need not satisfy their pooled-error assumptions. Zero observed variance yields no inferential interval or p-value. Statistical evidence does not establish practical value, a global optimum, or plant validity.',metrics};
}

export function analyzeScenarioDOE(design,observations,options={}) {
  const settings=scenarioDOEInferenceSettings(options);
  if(settings.reason)return {complete:false,effects:[],reason:settings.reason};
  const ordered=scenarioDOEOrderedObservations(design,observations);
  if(!ordered)return {complete:false,effects:[],reason:'INCOMPLETE_OR_INFEASIBLE_DESIGN'};
  const expected=ordered.length,terms=design.factors.map((_,i)=>[i]),inference=scenarioDOEInferentialAnalysis(design,observations,options);
  const inferenceAvailable=inference.complete&&Object.values(inference.metrics).some(metric=>metric.effects.some(effect=>effect.paired.inferenceAvailable));
  for(let i=0;i<design.factors.length;i++)for(let j=i+1;j<design.factors.length;j++)terms.push([i,j]);
  return {complete:true,confidenceLevel:settings.confidenceLevel,alpha:settings.alpha,interpretation:'High-minus-low effects describe this tested design. When matched replications are available, effects and statistics use per-seed contrasts and a joint Holm family across both metrics; intervals are marginal. Observation order does not establish independent random streams. This is not a global optimum or plant validation.',inference:{available:inferenceAvailable,reason:inference.complete?(inferenceAvailable?null:'NO_ESTIMABLE_CONTRAST_VARIANCE'):inference.reason,multiplicity:inference.multiplicity??null},effects:terms.map(indices=>{
    const effect={factors:indices,type:indices.length===1?'MAIN':'TWO_FACTOR_INTERACTION',statistics:{oee:null,throughput:null}};
    for(const metric of ['oee','throughput']) {
      effect[metric]=ordered.reduce((sum,row,i)=>sum+row[metric]*indices.reduce((sign,j)=>sign*design.designPoints[i].levels[j],1),0)/(expected/2);
      if(inference.complete) {
        effect.statistics[metric]=inference.metrics[metric].effects.find(row=>row.factors.join(',')===indices.join(',')).paired;
        effect[metric]=effect.statistics[metric].mean;
      }
    }
    return effect;
  })};
}

// Preserve the blocked ANOVA API and its descriptive sums of squares. The
// `.paired` fields are primary; legacy `.f/.pValue/.significant` are exploratory.
export function analyzeScenarioANOVA(design,observations,options={}) {
  return scenarioDOEInferentialAnalysis(design,observations,options);
}

export function scenarioFSurvival(f,df1,df2) {
  return scenarioFDistributionSurvival(f,df1,df2);
}


