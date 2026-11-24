// Format settings are applied on copies; installation and reliability stay shared.
export const PRODUCT_FLOW_UNITS = ['BOTTLES', 'CASES'];
export function productFlowUnit(equipment, side='output') {
  return equipment.processData?.flowUnits?.[side] || 'BOTTLES';
}
export function productPresentation(product,unit='BOTTLES'){
  return product.presentations?.[unit==='CASES'?'case':'bottle']||{lengthMm:unit==='CASES'?product.caseLengthMm:product.bottleLengthMm,bottlesPerCase:product.bottlesPerCase};
}
export function productPackSize(product){return productPresentation(product,'CASES').bottlesPerCase??product.bottlesPerCase;}
export function productProfileUnits(equipment,product){
  const profile=product.equipment?.[equipment.id]||{},base=equipment.processData?.flowUnits||{};
  return {input:profile.inputUnit||base.input||'BOTTLES',output:profile.outputUnit||base.output||'BOTTLES'};
}
// Physical transport is a consequence of the machine flow on either side.
// Resolve contiguous conveyor segments together. Legacy conveyor unit fields
// are only a fallback when no adjacent machine declares a usable unit.
function isProductConveyor(e){return e?.type==='CONVEYOR'||e?.processData?.role==='CONVEYOR';}
function declaredProductFlow(e,product){
  const profile=product?.equipment?.[e.id]||{},base=e.processData?.flowUnits||{};
  return {input:profile.inputUnit||base.input||null,output:profile.outputUnit||base.output||null};
}
export function resolveLineFlowUnits(equipment=[],product={}){
  const valid=v=>PRODUCT_FLOW_UNITS.includes(v);
  const rows=equipment.map(e=>({...declaredProductFlow(e,product),source:isProductConveyor(e)?'UNRESOLVED':'MACHINE'}));
  for(let start=0;start<equipment.length;){
    if(!isProductConveyor(equipment[start])){start++;continue;}
    let end=start+1;while(end<equipment.length&&isProductConveyor(equipment[end]))end++;
    const upstream=start>0?equipment[start-1]:null,downstream=end<equipment.length?equipment[end]:null;
    const left=upstream&&valid(rows[start-1].output)?rows[start-1].output:null;
    const right=downstream&&valid(rows[end].input)?rows[end].input:null;
    for(let i=start;i<end;i++){
      const belt=equipment[i],name=belt.name||belt.id;
      if(left&&right&&left!==right){
        rows[i]={input:null,output:null,source:'CONFLICT',
          reason:name+': incompatible machine flow: '+(upstream.name||upstream.id)+' outputs '+left+
          ', but '+(downstream.name||downstream.id)+' receives '+right+'. Correct the machines’ Material flow; a conveyor cannot convert bottles to cases.'};
      }else if(left||right){
        const unit=left||right;rows[i]={input:unit,output:unit,source:'INFERRED'};
      }else{
        const explicit=rows[i];
        if(valid(explicit.input)&&explicit.input===explicit.output)rows[i]={input:explicit.input,output:explicit.output,source:'LEGACY'};
        else rows[i]={input:null,output:null,source:'UNRESOLVED',
          reason:name+': transport unit cannot be inferred. Define Material flow on the connected machines.'};
      }
    }
    start=end;
  }
  return rows;
}

export function productUnitFactor(equipment, product, side='output') {
  return productFlowUnit(equipment, side)==='CASES' ? productPackSize(product) : 1;
}
export function applyProductProfile(equipment, product) {
  const lineFlow=resolveLineFlowUnits(equipment,product);
  return equipment.map((original,index)=>{
    const item=JSON.parse(JSON.stringify(original)),profile=product.equipment?.[item.id]||{};
    item.processData=item.processData||{};
    if(profile.applies===false){item.processData.productApplies=false;return item;}
    const resolved=lineFlow[index];
    // Drafts can be inspected before all flows agree. Runtime validation
    // rejects conflicts before simulation; the preview carries their reason.
    if(isProductConveyor(item)&&(resolved.source==='CONFLICT'||resolved.source==='UNRESOLVED'))item.processData.transportFlowIssue=resolved.reason;
    else delete item.processData.transportFlowIssue;
    item.processData.flowUnits=PRODUCT_FLOW_UNITS.includes(resolved.input)&&PRODUCT_FLOW_UNITS.includes(resolved.output)
      ?{input:resolved.input,output:resolved.output}:productProfileUnits(item,product);
    item.unitOfFlow=item.processData.flowUnits.output.toLowerCase();
    if(profile.ratePerMinute!==undefined)item.nominalRatePerSecond=profile.ratePerMinute/60;
    if(profile.startupSeconds!==undefined)item.startupDelaySeconds=profile.startupSeconds;
    if(profile.startupSeconds!==undefined)item.processData.upstream={...item.processData.upstream,startupTimeSeconds:profile.startupSeconds};
    if(profile.rampSeconds!==undefined)item.restartRampUpSeconds=profile.rampSeconds;
    if(profile.rampSeconds!==undefined)item.processData.downstream={...item.processData.downstream,rampUpTimeSeconds:profile.rampSeconds};
    item.processData.productInputRatePerSecond=item.nominalRatePerSecond*productUnitFactor(item,product)/productUnitFactor(item,product,'input');
    if(item.type==='CONVEYOR'||item.processData.role==='CONVEYOR') {
      const length=productPresentation(product,productFlowUnit(item)).lengthMm??item.processData.upstream?.packageLengthMm??item.processData.accumulation?.productLengthMm;
      const upstream={...item.processData.upstream,packageLengthMm:length},accumulation={...item.processData.accumulation};
      if(accumulation.productLengthMm!==undefined)accumulation.productLengthMm=length;
      if(accumulation.productPitchMm!==undefined&&profile.movingGapMm!==undefined)accumulation.productPitchMm=length+profile.movingGapMm;
      if(profile.movingGapMm!==undefined)accumulation.productSpacingOverride=true;
      for(const key of ['movingGapMm','accumulatedGapMm'])if(profile[key]!==undefined)accumulation[key]=profile[key];
      if ((product.formatId ?? product.id)?.startsWith('sheet-format-') && Number.isFinite(profile.dischargeGapMm)) {
        accumulation.useSheetDesignPitch = true;
      }
      if(profile.dischargeGapMm!==undefined)upstream.dischargePitchMm=length+profile.dischargeGapMm;
      const downstream={...item.processData.downstream};
      if(profile.infeedGapMm!==undefined)downstream.infeedPitchMm=length+profile.infeedGapMm;
      if(profile.speedMmPerSecond!==undefined){accumulation.speedMode='MANUAL';accumulation.conveyorSpeedMmPerSecond=profile.speedMmPerSecond;delete accumulation.targetPopulationPercent;delete accumulation.targetOverspeedPercent;}
      item.processData={...item.processData,upstream,downstream,accumulation};
    }
    return item;
  });
}
export function validateProductDefinitions(products,equipment=[],options={}){
  if(!Array.isArray(products)||products.length>100)throw Error('Configure at most 100 products.');
  const positive=value=>Number.isFinite(value)&&value>0,nonnegative=value=>Number.isFinite(value)&&value>=0,ids=new Set();
  for(const p of products){
    if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim())throw Error('Products require unique IDs and a name.');ids.add(p.id);
    const pack=productPackSize(p);if(!Number.isInteger(pack)||pack<1||pack>10000)throw Error(p.name+': bottles per case must be an integer from 1 to 10,000.');
    if(p.volumeMl!==undefined&&!nonnegative(p.volumeMl))throw Error(p.name+': volume must be nonnegative.');
    const lineFlow=resolveLineFlowUnits(equipment,p);
    for(const unit of PRODUCT_FLOW_UNITS){
      const presentation=productPresentation(p,unit),used=equipment.some((e,i)=>p.equipment?.[e.id]?.applies!==false&&(lineFlow[i].input===unit||lineFlow[i].output===unit));
      if(options.requireDimensions!==false&&used&&presentation.lengthMm===undefined){const belts=equipment.filter((e,i)=>isProductConveyor(e)&&lineFlow[i].output===unit&&p.equipment?.[e.id]?.applies!==false);if(belts.some(e=>!positive(e.processData?.upstream?.packageLengthMm??e.processData?.accumulation?.productLengthMm)))throw Error(p.name+': enter the '+(unit==='CASES'?'case':'bottle')+' length along the conveyor, or set a default on each conveyor.');}
      for(const key of ['lengthMm','widthMm','heightMm'])if(presentation[key]!==undefined&&!positive(presentation[key]))throw Error(p.name+': '+unit.toLowerCase()+' '+key+' must be positive.');
    }
    for(const [id,profile] of Object.entries(p.equipment||{})){
      if(!equipment.some(e=>e.id===id))continue;
      if(profile.applies!==undefined&&typeof profile.applies!=='boolean')throw Error(p.name+' / '+id+': applicability must be a checkbox value.');
      for(const key of ['inputUnit','outputUnit'])if(profile[key]!==undefined&&!PRODUCT_FLOW_UNITS.includes(profile[key]))throw Error(p.name+' / '+id+': select a bottle or case presentation.');
      if(profile.applies===false)continue;
      for(const key of ['movingGapMm','accumulatedGapMm','dischargeGapMm','infeedGapMm','startupSeconds','rampSeconds'])if(profile[key]!==undefined&&!nonnegative(profile[key]))throw Error(p.name+' / '+id+': '+key+' must be nonnegative.');
      for(const key of ['ratePerMinute','speedMmPerSecond'])if(profile[key]!==undefined&&!positive(profile[key]))throw Error(p.name+' / '+id+': '+key+' must be positive.');
    }
  }
}
export function validateProductSetup(input) {
  const products=input?.run?.productCatalog,initialId=input?.run?.initialFormatId??input?.run?.initialProductId;
  if(input?.run?.initialFormatId&&input?.run?.initialProductId&&input.run.initialFormatId!==input.run.initialProductId)throw Error('Initial format references disagree.');
  if(!products?.length&&!initialId){if(input?.run?.eventsEnabled!==false&&input?.run?.plannedStops?.some(e=>e.targetFormatId||e.targetProductId))throw Error('Select an initial product before assigning a changeover destination.');return [];}
  if(!Array.isArray(products)||!products.length)throw Error('Configure at least one product.');
  if(input.run.engineId&&input.run.engineId!=='ST_CURRENT')throw Error('Product profiles and bottle/case conversion require the ST engine.');
  const equipment=input.case?.equipment||[];validateProductDefinitions(products,equipment,{requireDimensions:false});
  const ids=new Set(products.map(p=>p.id)),used=new Set([initialId]);
  if(!ids.has(initialId))throw Error('Select an initial product.');
  for(const event of input.run.eventsEnabled===false?[]:(input.run.plannedStops||[])){const destination=event.targetFormatId??event.targetProductId;if(!destination)continue;if(event.targetFormatId&&event.targetProductId&&event.targetFormatId!==event.targetProductId)throw Error('Changeover format references disagree.');if(event.category!=='changeoverMinutes'||!ids.has(destination))throw Error('A changeover must reference an existing destination packing format.');used.add(destination);}
  const scheduled=products.filter(p=>used.has(p.id)),initial=scheduled.find(p=>p.id===initialId);
  const initialFlow=resolveLineFlowUnits(equipment,initial);
  return scheduled.map(product=>{
    const lineFlow=resolveLineFlowUnits(equipment,product);
    // Applicability is checked before flow, preserving the existing no-bypass contract.
    for(const e of equipment)if(product.equipment?.[e.id]?.applies===false)throw Error(product.name+' does not apply to '+e.name+'. This serial line has no bypass; select a compatible product or include this equipment.');
    for(let i=0;i<equipment.length;i++){
      const e=equipment[i],isBelt=isProductConveyor(e),units=lineFlow[i];
      if(units.source==='CONFLICT'||units.source==='UNRESOLVED')throw Error(units.reason);
      if(!PRODUCT_FLOW_UNITS.includes(units.input)||!PRODUCT_FLOW_UNITS.includes(units.output))throw Error(e.name+': select input and output units in Material flow.');
      if(!isBelt&&units.input!==units.output&&!(e.type==='CASE_PACKER'&&units.input==='BOTTLES'&&units.output==='CASES'))throw Error(e.name+': bottle-to-case conversion belongs on a Case Packer.');
      if(i===0&&units.input!=='BOTTLES')throw Error('The first machine must receive bottles.');
      if(i&&lineFlow[i-1].output!==units.input)throw Error(e.name+': input unit does not match the preceding output.');
      const a=initialFlow[i];
      if(a.input!==units.input||a.output!==units.output)throw Error(e.name+': changing bottle/case presentation at the same installed step during a run is not supported; use separate simulations.');
    }
    validateProductDefinitions([product],equipment);
    return {product,equipment:applyProductProfile(equipment,product)};
  });
}
