var STScenarioEngine_ = (function(){
// One namespace for cached simulation outputs and consumers of their evidence.
// Bump it when simulation mathematics or the serialized result contract changes.
const SIMULATION_PROVENANCE_VERSION = 'ST_CURRENT:0.20.1/DES:0.5.0/cache:30';

function canonicalSimulationInputSignature(input) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().filter(key => value[key] !== undefined)
        .map(key => [key, canonical(value[key])])
    );
    return value;
  }
  const run = {...input.run};
  // Enabled/default reliability are equivalent; disabled reliability is not.
  if (run.reliabilityEnabled !== false) delete run.reliabilityEnabled;
  // PRECISE preserves the historical step. Explicitly choosing it must not
  // invalidate an otherwise identical completed simulation.
  if (run.numericalResolution === 'PRECISE') delete run.numericalResolution;
  return JSON.stringify(canonical({
    version: SIMULATION_PROVENANCE_VERSION,
    unitOfFlow: input.case.unitOfFlow || 'units',
    equipment: input.case.equipment,
    run: {
      durationSeconds: 300, tickSeconds: .25, sampleEverySeconds: 5,
      seed: 1, commands: [], rounds: 1, engineId: 'ST_CURRENT', ...run
    }
  }));
}

const productVolumeUnits = Object.freeze({mL:1,L:1000,'fl oz (US)':29.5735295625,'fl oz (UK)':28.4130625});

// Relational authoring catalog; simulation receives immutable resolved format snapshots.
function legacyCatalog(metadata={},equipment) {
  const clone=value=>JSON.parse(JSON.stringify(value));
  if(metadata.formatCatalog){
    const source=clone(metadata.formatCatalog);
    const catalog={...source,version:source.version||1,products:source.products||[],boxes:source.boxes||[],formats:source.formats||[]};
    return equipment?shareFormatBehavior(catalog,equipment):catalog;
  }
  const result={version:1,products:[],boxes:[],formats:[]};
  for(const old of metadata.products||[]){
    const bottle=old.presentations?.bottle||{lengthMm:old.bottleLengthMm};
    const box=old.presentations?.case||{lengthMm:old.caseLengthMm};
    const productId='product-'+old.id,boxId='box-'+old.id;
    result.products.push({id:productId,name:old.name,volumeMl:old.volumeMl,bottle:clone(bottle)});
    result.boxes.push({id:boxId,name:(old.name||'Product')+' box',lengthMm:box.lengthMm,widthMm:box.widthMm,heightMm:box.heightMm});
    result.formats.push({id:old.id,name:old.name,productId,boxId,bottlesPerCase:box.bottlesPerCase??old.bottlesPerCase??12,packPattern:old.packPattern||'',equipment:clone(old.equipment||{})});
  }
  return equipment?shareFormatBehavior(result,equipment):result;
}
// Move reusable behavior to its material owner, retaining only genuine format exceptions.
function shareFormatBehavior(catalog,equipment){
  if(catalog.version>=2)return catalog;
  const clone=value=>JSON.parse(JSON.stringify(value));
  for(const record of [...catalog.products,...catalog.boxes])record.equipment=record.equipment||{};
  for(const format of catalog.formats){
    const product=catalog.products.find(p=>p.id===format.productId),box=catalog.boxes.find(b=>b.id===format.boxId);
    if(!product||!box)continue;
    for(const [id,profile] of Object.entries(format.equipment||{})){
      const base=equipment.find(e=>e.id===id),input=profile.inputUnit||base?.processData?.flowUnits?.input||'BOTTLES',output=profile.outputUnit||base?.processData?.flowUnits?.output||'BOTTLES';
      if(input!==output)continue;
      const owner=output==='CASES'?box:product,behavior={...profile};delete behavior.inputUnit;delete behavior.outputUnit;
      const existing=owner.equipment[id];
      if(!existing)owner.equipment[id]=clone(behavior);
      // Identical values become shared; differing fields remain explicit compatibility overrides.
      const override={inputUnit:input,outputUnit:output};
      for(const [key,value] of Object.entries(behavior))if(JSON.stringify(value)!==JSON.stringify(owner.equipment[id][key]))override[key]=clone(value);
      format.equipment[id]=override;
    }
  }
  catalog.version=2;return catalog;
}
function resolveLegacyPackingFormats(catalog){
  return catalog.formats.map(format=>{
    const product=catalog.products.find(p=>p.id===format.productId),box=catalog.boxes.find(b=>b.id===format.boxId);
    if(!product||!box)throw Error((format.name||'Packing format')+': select an existing product and box.');
    const profiles={};
    for(const id of new Set([...Object.keys(product.equipment||{}),...Object.keys(box.equipment||{}),...Object.keys(format.equipment||{})])){
      const local=format.equipment?.[id]||{},input=local.inputUnit||'BOTTLES',output=local.outputUnit||input;
      const shared=input!==output?{}:(output==='CASES'?box.equipment?.[id]:product.equipment?.[id])||{};
      const active=profile=>{const result=JSON.parse(JSON.stringify(profile));if(result.enabled===false||result.applies===false){for(const key of Object.keys(result))if(!['inputUnit','outputUnit'].includes(key))delete result[key];}delete result.enabled;return result;};
      profiles[id]={...active(shared),...active(local)};
    }
    return {id:format.id,formatId:format.id,name:format.name,productId:product.id,productName:product.name,boxId:box.id,boxName:box.name,
      volumeMl:product.volumeMl,bottleLengthMm:product.bottle?.lengthMm,caseLengthMm:box.lengthMm,bottlesPerCase:format.bottlesPerCase,packPattern:format.packPattern||'',
      presentations:{bottle:JSON.parse(JSON.stringify(product.bottle||{})),case:{lengthMm:box.lengthMm,widthMm:box.widthMm,heightMm:box.heightMm,bottlesPerCase:format.bottlesPerCase}},
      equipment:profiles};
  });
}
// Version 3 owns packaging dimensions and case behavior directly on each format.
function normalizeFormatCatalog(metadata={},equipment){
  if(metadata.formatCatalog?.version>=3)return JSON.parse(JSON.stringify(metadata.formatCatalog));
  const previous=legacyCatalog(metadata,equipment),snapshots=resolveLegacyPackingFormats(previous);
  const catalog={version:3,products:previous.products,formats:previous.formats.map((format,index)=>{
    const resolved=snapshots[index],profiles={};for(const [id,p] of Object.entries(resolved.equipment)){const units={inputUnit:p.inputUnit||'BOTTLES',outputUnit:p.outputUnit||p.inputUnit||'BOTTLES'};profiles[id]=units.inputUnit==='BOTTLES'&&units.outputUnit==='BOTTLES'?JSON.parse(JSON.stringify(format.equipment?.[id]||units)):p;}
    return {id:format.id,name:format.name,productId:format.productId,bottlesPerCase:format.bottlesPerCase,case:{lengthMm:resolved.caseLengthMm,widthMm:resolved.presentations.case.widthMm,heightMm:resolved.presentations.case.heightMm},equipment:profiles,legacyBoxId:resolved.boxId,legacyBoxName:resolved.boxName,packPattern:format.packPattern||''};
  })};
  // Keep pre-migration input records for recovery; run snapshots and IDs are never rewritten.
  if(previous.products.length||previous.boxes.length||previous.formats.length)catalog.legacyCatalog=JSON.parse(JSON.stringify(previous));
  return catalog;
}
function resolvePackingFormats(catalog,equipment){
  if((catalog.version||1)<3)return resolveLegacyPackingFormats(catalog);
  const active=profile=>{const p=JSON.parse(JSON.stringify(profile||{}));if(p.enabled===false||p.applies===false)for(const key of Object.keys(p))if(!['inputUnit','outputUnit'].includes(key))delete p[key];delete p.enabled;return p;};
  return catalog.formats.map(format=>{
    const product=catalog.products.find(p=>p.id===format.productId);if(!product)throw Error((format.name||'Format')+': select an existing product.');
    const box=format.case||{},profiles={};
    // Effective transport also selects the right material owner for behavior
    // overrides. Do not allow stale conveyor unit fields to select bottle
    // settings on a case conveyor (or vice versa).
    const line=Array.isArray(equipment)?resolveLineFlowUnits(equipment,{equipment:format.equipment||{}}):[];
    const flows=new Map((equipment||[]).map((e,i)=>[e.id,line[i]]));
    for(const id of new Set([...Object.keys(product.equipment||{}),...Object.keys(format.equipment||{}),...flows.keys()])){
      const local=format.equipment?.[id]||{},resolved=flows.get(id);
      const input=resolved?.input||local.inputUnit||'BOTTLES',output=resolved?.output||local.outputUnit||input;
      const shared=input==='BOTTLES'&&output==='BOTTLES'?product.equipment?.[id]||{}:{};
      const profile={...active(shared),...active(local)};
      if(resolved?.source==='INFERRED'){profile.inputUnit=resolved.input;profile.outputUnit=resolved.output;}
      if(Object.keys(profile).length)profiles[id]=profile;
    }
    return {id:format.id,formatId:format.id,name:format.name,productId:product.id,productName:product.name,boxId:format.legacyBoxId||format.id,boxName:format.legacyBoxName||format.name,volumeMl:product.volumeMl,bottleLengthMm:product.bottle?.lengthMm,caseLengthMm:box.lengthMm,bottlesPerCase:format.bottlesPerCase,packPattern:format.packPattern||'',presentations:{bottle:JSON.parse(JSON.stringify(product.bottle||{})),case:{lengthMm:box.lengthMm,widthMm:box.widthMm,heightMm:box.heightMm,bottlesPerCase:format.bottlesPerCase}},equipment:profiles};
  });
}
function validateFormatCatalog(catalog){
  for(const [kind,items] of [['Product',catalog.products],...((catalog.version||1)<3?[['Box',catalog.boxes]]:[]),['Packing format',catalog.formats]]){
    if(!Array.isArray(items)||items.length>100)throw Error(kind+': at most 100 records are supported.');
    const ids=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim())throw Error(kind+' requires a name and a unique ID.');ids.add(item.id);}
  }
  for(const p of catalog.products){if(p.volumeMl!==undefined&&(!Number.isFinite(p.volumeMl)||p.volumeMl<0))throw Error(p.name+': volume must be nonnegative.');}
  for(const item of [...catalog.products.map(p=>({...p,...p.bottle})),...(catalog.boxes||[]),...(catalog.formats||[]).map(f=>({...f,...f.case}))])for(const key of ['lengthMm','widthMm','heightMm'])if(item[key]!==undefined&&(!Number.isFinite(item[key])||item[key]<=0))throw Error(item.name+': dimensions must be positive.');
  for(const p of catalog.products)validateMaterialRecord(p,'products');
  for(const b of catalog.boxes||[])validateMaterialRecord(b,'boxes');
  if(catalog.version>=3)for(const f of catalog.formats)validateMaterialRecord(f,'formats');
  const formats=resolvePackingFormats(catalog);
  for(const f of formats)if(!Number.isInteger(f.bottlesPerCase)||f.bottlesPerCase<1||f.bottlesPerCase>10000)throw Error(f.name+': bottles per case must be an integer from 1 to 10,000.');
  return formats;
}
function mergeFormatCatalogs(current,incoming){
  current=normalizeFormatCatalog({formatCatalog:current});incoming=normalizeFormatCatalog({formatCatalog:incoming});validateFormatCatalog(current);validateFormatCatalog(incoming);
  const result=JSON.parse(JSON.stringify(current));
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  for(const key of ['products','formats'])for(const record of incoming[key]){
    const existing=result[key].find(item=>item.id===record.id);
    if(existing&&JSON.stringify(canonical(existing))!==JSON.stringify(canonical(record)))throw Error('Shared '+key+' record '+record.name+' differs from the current case. Import the complete case or use matching catalog records.');
    if(!existing)result[key].push(JSON.parse(JSON.stringify(record)));
  }
  validateFormatCatalog(result);return result;
}

const MATERIAL_PROFILE_KEYS=['ratePerMinute','startupSeconds','rampSeconds','movingGapMm','accumulatedGapMm','dischargeGapMm','infeedGapMm','speedMmPerSecond','enabled','applies'];
function validateMaterialRecord(record,kind){
  if(!record||typeof record.name!=='string'||!record.name.trim())throw Error('Enter a '+(kind==='formats'?'format':kind==='boxes'?'box':'product')+' name.');
  for(const value of Object.values(record.equipment||{})){
    if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Equipment settings must be objects.');
    for(const key of ['enabled','applies'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error(key+' must be a checkbox value.');
    for(const key of MATERIAL_PROFILE_KEYS.filter(k=>!['enabled','applies'].includes(k)))if(value[key]!==undefined&&(!Number.isFinite(value[key])||value[key]<0||(['ratePerMinute','speedMmPerSecond'].includes(key)&&value[key]===0)))throw Error(record.name+': '+key+' must be '+(['ratePerMinute','speedMmPerSecond'].includes(key)?'positive.':'nonnegative.'));
  }
  const shape=kind==='formats'?record.case||{}:kind==='boxes'?record:record.bottle||{};
  for(const key of ['lengthMm','widthMm','heightMm'])if(shape[key]!==undefined&&(!Number.isFinite(shape[key])||shape[key]<=0))throw Error(record.name+': dimensions must be positive.');
  if(kind==='formats'&&(typeof record.productId!=='string'||!record.productId||!Number.isInteger(record.bottlesPerCase)||record.bottlesPerCase<1||record.bottlesPerCase>10000))throw Error('Select a product and a whole number of bottles per case from 1 to 10,000.');
  if(record.volumeUnit!==undefined&&!Object.hasOwn(productVolumeUnits,record.volumeUnit))throw Error(record.name+': select a valid volume unit.');
  if(record.volumeMl!==undefined&&(!Number.isFinite(record.volumeMl)||record.volumeMl<0))throw Error(record.name+': volume must be nonnegative.');
}
function materialConfiguration(kind,record,equipment=[]){
  if(!['products','boxes','formats'].includes(kind))throw Error('Choose a product or format configuration.');
  validateMaterialRecord(record,kind);
  return {schema:kind==='formats'?'st-material-configuration-v2':'st-material-configuration-v1',kind,record:JSON.parse(JSON.stringify(record))};
}
function readMaterialConfiguration(text,kind,currentId,equipment=[]){
  if(text.length>1048576)throw Error('Configuration exceeds 1 MB.');
  const payload=JSON.parse(text,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsafe configuration key.');return value;});
  if(!['st-material-configuration-v1','st-material-configuration-v2'].includes(payload.schema)||payload.kind!==kind||!payload.record)throw Error('Import a matching '+(kind==='formats'?'format':kind==='boxes'?'box':'product')+' configuration.');
  const source=payload.record,allowed=kind==='formats'?['id','name','productId','bottlesPerCase','case','equipment','legacyBoxId','legacyBoxName','packPattern']:kind==='boxes'?['id','name','lengthMm','widthMm','heightMm','equipment']:['id','name','volumeMl','volumeUnit','bottle','equipment'];
  for(const key of Object.keys(source))if(!allowed.includes(key))throw Error('Unsupported material field: '+key);
  if(source.case)for(const key of Object.keys(source.case))if(!['lengthMm','widthMm','heightMm'].includes(key))throw Error('Unsupported case field: '+key);
  if(source.bottle)for(const key of Object.keys(source.bottle))if(!['lengthMm','widthMm','heightMm'].includes(key))throw Error('Unsupported bottle field: '+key);
  const result={...source,id:currentId,equipment:{}};
  if(source.equipment&&(Array.isArray(source.equipment)||typeof source.equipment!=='object'))throw Error('Equipment settings must be an object.');
  for(const [id,profile] of Object.entries(source.equipment||{})){
    if(!equipment.some(e=>e.id===id))throw Error('Equipment '+id+' is not installed in this simulation. Import into a matching line.');
    if(!profile||Array.isArray(profile)||typeof profile!=='object')throw Error('Equipment settings must be objects.');
    for(const key of Object.keys(profile))if(!MATERIAL_PROFILE_KEYS.includes(key)&&!(kind==='formats'&&['inputUnit','outputUnit'].includes(key)))throw Error('Unsupported equipment field: '+key);
    if(kind==='formats')for(const side of ['inputUnit','outputUnit'])if(profile[side]!==undefined&&!['BOTTLES','CASES'].includes(profile[side]))throw Error('Invalid physical unit.');
    result.equipment[id]={...profile};
  }
  validateMaterialRecord(result,kind);return result;
}

// Format settings are applied on copies; installation and reliability stay shared.
const PRODUCT_FLOW_UNITS = ['BOTTLES', 'CASES'];
function productFlowUnit(equipment, side='output') {
  return equipment.processData?.flowUnits?.[side] || 'BOTTLES';
}
function productPresentation(product,unit='BOTTLES'){
  return product.presentations?.[unit==='CASES'?'case':'bottle']||{lengthMm:unit==='CASES'?product.caseLengthMm:product.bottleLengthMm,bottlesPerCase:product.bottlesPerCase};
}
function productPackSize(product){return productPresentation(product,'CASES').bottlesPerCase??product.bottlesPerCase;}
function productProfileUnits(equipment,product){
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
function resolveLineFlowUnits(equipment=[],product={}){
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

function productUnitFactor(equipment, product, side='output') {
  return productFlowUnit(equipment, side)==='CASES' ? productPackSize(product) : 1;
}
function applyProductProfile(equipment, product) {
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
function validateProductDefinitions(products,equipment=[],options={}){
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
function validateProductSetup(input) {
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

// Calendar exclusions are mutually exclusive line stops; reporting adjustments
// stay outside the physical schedule. Event timing is independent of the RNG.
const PLANT_STOP_FIELDS = ['changeoverMinutes','cleaningMinutes','autonomousMaintenanceMinutes','plannedMaintenanceMinutes','breakMinutes','trainingMinutes','experimentationMinutes'];
function plantCalendarSchedule(calendar, tickSeconds=.25) {
  if(!calendar?.enabled||calendar.mode!=='SCHEDULED')return {events:[],horizonSeconds:null};
  const fail=message=>{throw new Error('Plant calendar: '+message);};
  if(!Number.isFinite(tickSeconds)||tickSeconds<=0)fail('invalid tick duration.');
  for(const key of ['totalMinutes','externalMinutes','coReportingErrorMinutes',...PLANT_STOP_FIELDS])if(calendar[key]!=null&&(!Number.isFinite(calendar[key])||calendar[key]<0))fail(key+' must be nonnegative.');
  if(!(calendar.totalMinutes>0))fail('total time is required.');
  const horizonSeconds=(calendar.totalMinutes-(calendar.externalMinutes||0)-(calendar.coReportingErrorMinutes||0))*60;
  if(!(horizonSeconds>0))fail('exclusions leave no simulation time.');
  if(!['EVEN','TIMED',undefined].includes(calendar.distribution))fail('unsupported event distribution.');
  if(!['RESTART','RESUME',undefined].includes(calendar.restartPolicy))fail('unsupported restart policy.');
  const events=[];
  for(const key of PLANT_STOP_FIELDS){const minutes=calendar[key]||0;if(!minutes)continue;
    const plan=calendar.plans?.[key]||{},count=plan.count??1;
    if(!Number.isInteger(count)||count<1||count>1000)fail(key+' requires 1–1,000 events.');
    if(events.length+count>5000)fail('at most 5,000 events are supported.');
    const durationSeconds=minutes*60/count;
    if(durationSeconds<tickSeconds)fail(key+' events are shorter than one simulation tick.');
    for(let i=0;i<count;i++){
      let start=null;
      if(calendar.distribution==='TIMED'){
        if(!Number.isFinite(plan.firstStartMinutes)||plan.firstStartMinutes<0)fail(key+' requires a nonnegative first start.');
        if(count>1&&(!Number.isFinite(plan.intervalMinutes)||plan.intervalMinutes<=0))fail(key+' requires a positive interval.');
        start=(plan.firstStartMinutes+i*(plan.intervalMinutes||0))*60;
      }
      events.push({category:key,occurrence:i+1,startSeconds:start,durationSeconds});
    }
  }
  const stopped=events.reduce((sum,e)=>sum+e.durationSeconds,0),free=horizonSeconds-stopped;
  if(free<tickSeconds)fail('exclusions must leave positive operating time.');
  if(calendar.distribution!=='TIMED'){
    let cursor=free/(events.length+1);
    // Interleave categories so repeated events do not become a single cluster.
    events.sort((a,b)=>a.occurrence-b.occurrence||PLANT_STOP_FIELDS.indexOf(a.category)-PLANT_STOP_FIELDS.indexOf(b.category));
    events.forEach(e=>{e.startSeconds=cursor;cursor+=e.durationSeconds+free/(events.length+1);});
  }
  const align=seconds=>Math.ceil((seconds-1e-8)/tickSeconds)*tickSeconds;
  events.forEach(e=>{e.endSeconds=align(e.startSeconds+e.durationSeconds);e.startSeconds=align(e.startSeconds);e.durationSeconds=e.endSeconds-e.startSeconds;if(e.endSeconds>horizonSeconds+1e-8)fail(e.category+' extends beyond the calendar.');});
  events.sort((a,b)=>a.startSeconds-b.startSeconds);
  for(let i=1;i<events.length;i++)if(events[i].startSeconds<events[i-1].endSeconds-1e-8)fail('planned events overlap; adjust first start or interval.');
  return {events,horizonSeconds,plannedStopSeconds:events.reduce((n,e)=>n+e.durationSeconds,0),restartPolicy:calendar.restartPolicy||'RESTART'};
}

function resolvePlannedStops(run) {
  if(run.eventsEnabled===false)return {events:[],horizonSeconds:null};
  if(run.plannedStops!==undefined){
    if(!Array.isArray(run.plannedStops)||run.plannedStops.length>5000)throw new Error('Planned stops must be an array of at most 5,000 events.');
    if(run.plantCalendar?.application==='EVENTS'&&(!Number.isFinite(run.plantCalendar.appliedHorizonSeconds)||run.plantCalendar.appliedHorizonSeconds<=0))throw new Error('Applied calendar horizon is invalid.');
    const tick=run.tickSeconds,events=run.plannedStops.map((e,index)=>{
      if(!e||!Number.isFinite(e.startSeconds)||e.startSeconds<0||!Number.isFinite(e.endSeconds)||e.endSeconds<=e.startSeconds)throw new Error('Invalid planned stop '+(index+1));
      if(!['RESTART','RESUME'].includes(e.restartPolicy||'RESTART'))throw new Error('Invalid planned stop restart policy.');
      const startSeconds=Math.ceil((e.startSeconds-1e-8)/tick)*tick,endSeconds=Math.ceil((e.endSeconds-1e-8)/tick)*tick;
      if(endSeconds-startSeconds<tick-1e-8)throw new Error('Planned stop is shorter than one tick.');
      if(e.targetFormatId&&e.targetProductId&&e.targetFormatId!==e.targetProductId)throw new Error('Changeover format references disagree.');
      return {...e,targetProductId:e.targetFormatId??e.targetProductId,startSeconds,endSeconds,durationSeconds:endSeconds-startSeconds,restartPolicy:e.restartPolicy||'RESTART'};
    }).sort((a,b)=>a.startSeconds-b.startSeconds);
    events.forEach((e,i)=>{if(i&&e.startSeconds<events[i-1].endSeconds-1e-8)throw new Error('Planned stops overlap.');if(run.plantCalendar?.application==='EVENTS'&&e.endSeconds>run.plantCalendar.appliedHorizonSeconds+1e-8)throw new Error('A line stop extends beyond the applied calendar horizon.');});
    return {events,horizonSeconds:run.plantCalendar?.application==='EVENTS'?run.plantCalendar.appliedHorizonSeconds:run.durationSeconds,plannedStopSeconds:events.reduce((s,e)=>s+e.durationSeconds,0),restartPolicy:'PER_EVENT'};
  }
  return plantCalendarSchedule(run.plantCalendar,run.tickSeconds);
}

/**
 * Deterministic conveyor-design calculations based on the SimuLine / CAT
 * engineering worksheet.  All linear rates below use millimetres per second
 * so the result can be consumed directly by the event simulation.
 */
function calculateConveyorEngineering(input = {}) {
  const values = normaliseInput(input);
  const calculated = calculate(values);
  const audit = createAudit(values, calculated);

  return { input: values, calculated, audit };
}

function normaliseInput(input) {
  return {
    targetOverspeedPercent: numberOrUndefined(input.targetOverspeedPercent),
    targetPopulationPercent: numberOrUndefined(input.targetPopulationPercent),
    resolvedConveyorSpeedMmPerSecond: numberOrUndefined(input.resolvedConveyorSpeedMmPerSecond),
    resolvedProductPitchMm: numberOrUndefined(input.resolvedProductPitchMm),
    manualLbaMm: numberOrUndefined(input.manualLbaMm),
    installedLengthMm: numberOrUndefined(input.installedLengthMm),
    primeReserveMm: numberOrUndefined(input.primeReserveMm),
    packageLengthMm: numberOrUndefined(input.packageLengthMm),
    upstreamDischargePitchMm: numberOrUndefined(input.upstreamDischargePitchMm),
    upstreamNominalSpeedBpm: numberOrUndefined(input.upstreamNominalSpeedBpm),
    downstreamHighSpeedBpm: numberOrUndefined(input.downstreamHighSpeedBpm),
    downstreamInfeedPitchMm: numberOrUndefined(input.downstreamInfeedPitchMm),
    conveyorSpeedFactorPercent: numberOrUndefined(input.conveyorSpeedFactorPercent),
    codingSpeedFactorPercent: nonNegativeOrDefault(input.codingSpeedFactorPercent, 0),
    accumulationSpeedFactorPercent: nonNegativeOrDefault(input.accumulationSpeedFactorPercent, 0),
    infeedOverspeedPercent: nonNegativeOrDefault(input.infeedOverspeedPercent, 5),
    dischargeRunoutLengthMm: nonNegativeOrDefault(input.dischargeRunoutLengthMm, 0),
    rejectRunoutLengthMm: nonNegativeOrDefault(input.rejectRunoutLengthMm, 0),
    blockedTimeDelaySeconds: nonNegativeOrDefault(input.blockedTimeDelaySeconds, 0),
    clearTimeDelaySeconds: nonNegativeOrDefault(input.clearTimeDelaySeconds, 0),
    insuranceFactorUnits: nonNegativeOrDefault(input.insuranceFactorUnits, 0),
    backupSensorPositionMm: numberOrUndefined(input.backupSensorPositionMm),
    upstreamStopResponseSeconds: nonNegativeOrDefault(input.upstreamStopResponseSeconds, 0),
    bottlesDischargedAtStop: nonNegativeOrDefault(input.bottlesDischargedAtStop, 0),
    downstreamRampUpSeconds: nonNegativeOrDefault(input.downstreamRampUpSeconds, 0),
    upstreamStartupTimeSeconds: nonNegativeOrDefault(input.upstreamStartupTimeSeconds, 0)
  };
}

function calculate(values) {
  const upstreamDischargeVelocityMmPerSecond = multiplyAndDivide(
    values.upstreamNominalSpeedBpm,
    values.upstreamDischargePitchMm,
    60
  );
  const machineOutputRateMmPerSecond = multiplyAndDivide(
    values.upstreamNominalSpeedBpm,
    values.packageLengthMm,
    60
  );
  const dischargeZoneSpeedMmPerSecond = isFiniteNumber(upstreamDischargeVelocityMmPerSecond) &&
    isFiniteNumber(values.conveyorSpeedFactorPercent)
    ? upstreamDischargeVelocityMmPerSecond * (1 + values.conveyorSpeedFactorPercent / 100)
    : undefined;
  const codingZoneSpeedMmPerSecond = multiplyIfFinite(dischargeZoneSpeedMmPerSecond, 1 + values.codingSpeedFactorPercent / 100);
  const infeedVelocity=multiplyAndDivide(values.downstreamHighSpeedBpm,values.downstreamInfeedPitchMm,60);
  const conveyorSpeedMmPerSecond = values.resolvedConveyorSpeedMmPerSecond ?? (values.targetPopulationPercent !== undefined
    ? safeDivide(machineOutputRateMmPerSecond, values.targetPopulationPercent, 100)
    : values.targetOverspeedPercent !== undefined ? multiplyIfFinite(infeedVelocity,1+values.targetOverspeedPercent/100)
    : multiplyIfFinite(codingZoneSpeedMmPerSecond, 1 + values.accumulationSpeedFactorPercent / 100));
  const dischargePopulationPercent = safeDivide(machineOutputRateMmPerSecond, dischargeZoneSpeedMmPerSecond, 100);
  const codingPopulationPercent = safeDivide(machineOutputRateMmPerSecond, codingZoneSpeedMmPerSecond, 100);
  const populationPercent = safeDivide(machineOutputRateMmPerSecond, conveyorSpeedMmPerSecond, 100);
  const effectiveProductPitchMm = values.resolvedProductPitchMm ?? safeDivide(values.packageLengthMm, populationPercent, 100);
  const productGapMm = isFiniteNumber(effectiveProductPitchMm) && isFiniteNumber(values.packageLengthMm)
    ? effectiveProductPitchMm - values.packageLengthMm
    : undefined;
  // A photoeye normally sees short occupied and clear intervals as packages
  // pass.  These are design values, not the continuous Back-up condition
  // produced by a queue reaching the sensor.
  const packagePassSensorSeconds = safeDivide(values.packageLengthMm, conveyorSpeedMmPerSecond);
  const sensorClearGapSeconds = safeDivide(productGapMm, conveyorSpeedMmPerSecond);
  const sensorCycleSeconds = safeDivide(effectiveProductPitchMm, conveyorSpeedMmPerSecond);
  const downstreamConsumptionRateMmPerSecond = multiplyAndDivide(
    values.downstreamHighSpeedBpm,
    values.packageLengthMm,
    60
  );
  const packagesDuringBlockedDelay = multiplyAndDivide(
    values.upstreamNominalSpeedBpm,
    values.blockedTimeDelaySeconds,
    60
  );
  const totalOverflowPackages = sumIfFinite(
    packagesDuringBlockedDelay,
    values.bottlesDischargedAtStop,
    values.insuranceFactorUnits
  );
  const overflowProductLengthMm = multiplyIfFinite(totalOverflowPackages, effectiveProductPitchMm);
  const overflowLengthMm = sumIfFinite(
    values.dischargeRunoutLengthMm,
    values.rejectRunoutLengthMm,
    overflowProductLengthMm
  );
  const calculatedUsefulAccumulationLengthMm = subtractIfFinite(
    values.installedLengthMm,
    values.primeReserveMm,
    overflowLengthMm
  );
  const usefulAccumulationLengthMm = values.manualLbaMm ?? calculatedUsefulAccumulationLengthMm;
  const primeSensorPositionMm = subtractIfFinite(values.installedLengthMm, values.primeReserveMm);
  const actualBackupSensorPositionMm = values.manualLbaMm !== undefined
    ? subtractIfFinite(primeSensorPositionMm, values.manualLbaMm)
    : firstDefined(values.backupSensorPositionMm, overflowLengthMm);
  const conveyorCapacityUnits = safeFloorDivide(values.installedLengthMm, effectiveProductPitchMm);
  const primeTravelSeconds = safeDivide(primeSensorPositionMm, conveyorSpeedMmPerSecond);
  const totalTravelSeconds = safeDivide(values.installedLengthMm, conveyorSpeedMmPerSecond);
  const overflowTransitSeconds = safeDivide(overflowLengthMm, conveyorSpeedMmPerSecond);
  const recoveryToBackupSeconds = sumIfFinite(
    values.clearTimeDelaySeconds,
    values.upstreamStartupTimeSeconds,
    overflowTransitSeconds
  );
  const queueReductionOneMm = multiplyIfFinite(downstreamConsumptionRateMmPerSecond, recoveryToBackupSeconds);
  const remainingAccumulationMm = subtractIfFinite(usefulAccumulationLengthMm, queueReductionOneMm);
  const timeToQueueSeconds = isFiniteNumber(remainingAccumulationMm) && remainingAccumulationMm > 0
    ? safeDivide(remainingAccumulationMm, sumIfFinite(conveyorSpeedMmPerSecond, downstreamConsumptionRateMmPerSecond))
    : 0;
  const queueReductionTwoMm = multiplyIfFinite(downstreamConsumptionRateMmPerSecond, timeToQueueSeconds);
  const recoveryLengthMm = subtractIfFinite(usefulAccumulationLengthMm, queueReductionOneMm, queueReductionTwoMm);
  const antiStarveSeconds = multiplyAndDivide(usefulAccumulationLengthMm, populationPercent, 100 * downstreamConsumptionRateMmPerSecond);
  const antiBlockSeconds = isFiniteNumber(usefulAccumulationLengthMm) && isFiniteNumber(populationPercent)
    ? safeDivide(usefulAccumulationLengthMm * (1 - populationPercent / 100), machineOutputRateMmPerSecond)
    : undefined;
  const recommendedInfeedConveyorSpeedMmPerSecond = multiplyAndDivide(
    values.downstreamHighSpeedBpm,
    values.downstreamInfeedPitchMm,
    60 / (1 + values.infeedOverspeedPercent / 100)
  );
  const recommendedConveyorSpeedFactorPercent = isFiniteNumber(recommendedInfeedConveyorSpeedMmPerSecond) &&
    isFiniteNumber(upstreamDischargeVelocityMmPerSecond) && upstreamDischargeVelocityMmPerSecond > 0
    ? (recommendedInfeedConveyorSpeedMmPerSecond / upstreamDischargeVelocityMmPerSecond - 1) * 100
    : undefined;

  // Linear ramp-up integral: reserve half the full-rate consumption over the ramp.
  const minimumRampAccumulationLengthMm = multiplyAndDivide(downstreamConsumptionRateMmPerSecond, values.downstreamRampUpSeconds, 2);
  const minimumInstalledLengthMm = sumIfFinite(overflowLengthMm, values.primeReserveMm, minimumRampAccumulationLengthMm);
  const downstreamInfeedRateMmPerSecond = multiplyAndDivide(values.downstreamHighSpeedBpm, values.downstreamInfeedPitchMm, 60);
  return compact({
    dischargeZoneSpeedMmPerSecond,
    codingZoneSpeedMmPerSecond,
    dischargePopulationPercent,
    codingPopulationPercent,
    minimumRampAccumulationLengthMm,
    minimumInstalledLengthMm,
    downstreamInfeedRateMmPerSecond,
    actualInfeedOverspeedPercent: isFiniteNumber(conveyorSpeedMmPerSecond)&&downstreamInfeedRateMmPerSecond>0?(conveyorSpeedMmPerSecond/downstreamInfeedRateMmPerSecond-1)*100:undefined,
    upstreamDischargeVelocityMmPerSecond,
    machineOutputRateMmPerSecond,
    conveyorSpeedMmPerSecond,
    populationPercent,
    effectiveProductPitchMm,
    productGapMm,
    packagePassSensorSeconds,
    sensorClearGapSeconds,
    sensorCycleSeconds,
    downstreamConsumptionRateMmPerSecond,
    packagesDuringBlockedDelay,
    totalOverflowPackages,
    overflowProductLengthMm,
    overflowLengthMm,
    usefulAccumulationLengthMm,
    calculatedUsefulAccumulationLengthMm,
    primeSensorPositionMm,
    recommendedBackupSensorPositionMm: overflowLengthMm,
    actualBackupSensorPositionMm,
    conveyorCapacityUnits,
    primeTravelSeconds,
    totalTravelSeconds,
    overflowTransitSeconds,
    recoveryToBackupSeconds,
    queueReductionOneMm,
    timeToQueueSeconds,
    queueReductionTwoMm,
    recoveryLengthMm,
    antiStarveSeconds,
    antiBlockSeconds,
    recommendedInfeedConveyorSpeedMmPerSecond,
    recommendedConveyorSpeedFactorPercent
  });
}

function createAudit(values, calculated) {
  const inputFields = [
    values.installedLengthMm,
    values.primeReserveMm,
    values.packageLengthMm,
    values.upstreamDischargePitchMm,
    values.upstreamNominalSpeedBpm,
    values.conveyorSpeedFactorPercent
  ];
  const inputsReady = inputFields.every((value) => isFiniteNumber(value) && value >= 0) &&
    values.installedLengthMm > 0 && values.packageLengthMm > 0 &&
    values.upstreamDischargePitchMm > 0 && values.upstreamNominalSpeedBpm > 0;
  const installedLengthValid = isFiniteNumber(values.installedLengthMm) &&
    isFiniteNumber(values.primeReserveMm) && isFiniteNumber(calculated.overflowLengthMm) &&
    values.installedLengthMm > values.primeReserveMm + calculated.overflowLengthMm;
  const recoveryEvaluated = isFiniteNumber(calculated.recoveryLengthMm);
  const backupPositionEvaluated = isFiniteNumber(calculated.actualBackupSensorPositionMm) &&
    isFiniteNumber(calculated.recommendedBackupSensorPositionMm);
  const sensorTimingEvaluated = isFiniteNumber(calculated.packagePassSensorSeconds) &&
    isFiniteNumber(calculated.sensorClearGapSeconds);
  const blockedDebounceAdequate = sensorTimingEvaluated &&
    values.blockedTimeDelaySeconds > calculated.packagePassSensorSeconds;
  const clearDebounceAdequate = sensorTimingEvaluated &&
    values.clearTimeDelaySeconds > calculated.sensorClearGapSeconds;

  const goals = [
    goal('POPULATION', !isFiniteNumber(calculated.populationPercent) ? 'NOT_EVALUATED' : calculated.populationPercent > 100 || calculated.populationPercent <= 0 ? 'FAIL' : calculated.populationPercent > 50 ? 'WARNING' : 'PASS',
      !isFiniteNumber(calculated.populationPercent) ? 'Population needs valid flow and belt-speed inputs.' : calculated.populationPercent > 100 || calculated.populationPercent <= 0 ? 'Population must be greater than 0 and no more than 100%.' : calculated.populationPercent > 50 ? 'Design occupancy above 50%: consider a target of 50% or less and verify the required belt speed and infeed capacity. This is a design recommendation, not a universal safety limit.' : 'Design occupancy is within the suggested 50% target.'),
    goal('MANUAL_LBA', values.manualLbaMm === undefined ? 'PASS' : values.manualLbaMm > 0 && values.manualLbaMm <= calculated.calculatedUsefulAccumulationLengthMm ? 'PASS' : 'FAIL',
      'Manual LBA must be positive and fit within installed length after Prime and required overflow reserves. It sets Back-up to Prime position minus LBA.'),
    goal(
      'INPUT_INTEGRITY',
      inputsReady ? 'PASS' : 'NOT_EVALUATED',
      inputsReady
        ? 'Required SimuLine inputs are physically usable.'
        : 'Installed length, Prime reserve, package length, upstream discharge pitch, upstream BPM, and conveyor speed factor are required.'
    ),
    goal(
      'SMOOTH_RECOVERY',
      !recoveryEvaluated ? 'NOT_EVALUATED' : calculated.recoveryLengthMm > 0 ? 'PASS' : 'WARNING',
      !recoveryEvaluated
        ? 'Recovery length cannot be evaluated until downstream high speed and infeed pitch are available.'
        : calculated.recoveryLengthMm > 0
          ? 'Recovery length is positive; the modeled restart has physical margin.'
          : 'Recovery length is zero or negative; this configuration can create unstable or stuttering restarts.'
    ),
    goal(
      'INSTALLED_LENGTH',
      !isFiniteNumber(calculated.overflowLengthMm) ? 'NOT_EVALUATED' : installedLengthValid ? 'PASS' : 'FAIL',
      !isFiniteNumber(calculated.overflowLengthMm)
        ? 'Overflow length cannot be evaluated until the upstream flow inputs are complete.'
        : installedLengthValid
          ? 'Installed length exceeds Prime reserve plus required overflow length.'
          : 'Installed length is insufficient for the Prime reserve and required overflow length.'
    ),
    goal(
      'BACKUP_POSITION',
      !backupPositionEvaluated ? 'NOT_EVALUATED' : calculated.actualBackupSensorPositionMm >= calculated.recommendedBackupSensorPositionMm ? 'PASS' : 'WARNING',
      !backupPositionEvaluated
        ? 'Back-up position is not available.'
        : calculated.actualBackupSensorPositionMm >= calculated.recommendedBackupSensorPositionMm
          ? 'Back-up position leaves the calculated overflow margin.'
          : 'Back-up is too close to the upstream machine for the calculated residual flow.'
    ),
    goal(
      'SENSOR_DEBOUNCE',
      !sensorTimingEvaluated ? 'NOT_EVALUATED' : blockedDebounceAdequate && clearDebounceAdequate ? 'PASS' : 'WARNING',
      !sensorTimingEvaluated
        ? 'Sensor pulse timing cannot be evaluated until package length, pitch, and conveyor speed are available.'
        : blockedDebounceAdequate && clearDebounceAdequate
          ? 'Back-up blocked and clear delays exceed the normal package pulse and gap at the configured belt speed.'
          : 'At least one Back-up delay is no longer than a normal package pulse or gap; the control can chatter or react to normal product spacing.'
    )
  ];

  return {
    status: aggregateAuditStatus(goals),
    goals
  };
}

function goal(id, status, message) {
  return { id, status, message };
}

function aggregateAuditStatus(goals) {
  if (goals.some((item) => item.status === 'FAIL')) return 'FAIL';
  if (goals.some((item) => item.status === 'WARNING')) return 'WARNING';
  if (goals.some((item) => item.status === 'NOT_EVALUATED')) return 'NOT_EVALUATED';
  return 'PASS';
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function numberOrUndefined(value) {
  return isFiniteNumber(value) ? value : undefined;
}

function nonNegativeOrDefault(value, fallback) {
  return isFiniteNumber(value) && value >= 0 ? value : fallback;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function multiplyAndDivide(left, right, divisor) {
  return isFiniteNumber(left) && isFiniteNumber(right) && isFiniteNumber(divisor) && divisor !== 0
    ? left * right / divisor
    : undefined;
}

function multiplyIfFinite(left, right) {
  return isFiniteNumber(left) && isFiniteNumber(right) ? left * right : undefined;
}

function safeDivide(numerator, denominator, multiplier = 1) {
  return isFiniteNumber(numerator) && isFiniteNumber(denominator) && denominator > 0
    ? numerator / denominator * multiplier
    : undefined;
}

function safeFloorDivide(numerator, denominator) {
  return isFiniteNumber(numerator) && isFiniteNumber(denominator) && denominator > 0
    ? Math.floor(numerator / denominator)
    : undefined;
}

function sumIfFinite(...values) {
  return values.every(isFiniteNumber) ? values.reduce((total, value) => total + value, 0) : undefined;
}

function subtractIfFinite(first, ...rest) {
  return isFiniteNumber(first) && rest.every(isFiniteNumber)
    ? rest.reduce((total, value) => total - value, first)
    : undefined;
}



function resolveAccumulationZoneDefinition(allEquipment, ownerIndex) {
  const equipment = Array.isArray(allEquipment) ? allEquipment : [];
  const owner = equipment[ownerIndex];
  if (!owner) {
    return { definition: undefined, origin: 'NONE', sources: {}, assumptions: [] };
  }

  if (isConveyorEquipment(owner)) {
    return resolveConveyorZone(equipment, owner, ownerIndex);
  }

  const next = equipment[ownerIndex + 1];
  if (isConveyorEquipment(next)) {
    return {
      definition: {
        kind: 'INTERNAL_HANDOFF',
        id: owner.id + '--handoff--' + next.id,
        name: owner.name + ' handoff to ' + next.name,
        upstreamControlEquipmentId: owner.id,
        downstreamControlEquipmentId: next.id
      },
      origin: 'INTERNAL_HANDOFF',
      sources: {},
      assumptions: ['Internal handoff: no abstract buffer is modeled between a machine and its following conveyor.']
    };
  }

  return { definition: undefined, origin: 'NONE', sources: {}, assumptions: [] };
}

function isConveyorEquipment(equipment) {
  return Boolean(equipment && (equipment.type === 'CONVEYOR' || equipment.processData?.role === 'CONVEYOR'));
}

function hasFormatAccumulationData(equipment) {
  return Boolean(equipment?.processData?.accumulation &&
    typeof equipment.processData.accumulation === 'object' &&
    !Array.isArray(equipment.processData.accumulation));
}

function resolveConveyorZone(equipment, owner, ownerIndex) {
  const format = owner.processData?.accumulation || {};
  const upstreamControl = findNearestNonConveyor(equipment, ownerIndex - 1, -1);
  const downstreamControl = findNearestNonConveyor(equipment, ownerIndex + 1, 1);
  const resolved = hasFlowPilotInputs(owner, format)
    ? resolveFlowPilotConveyor(owner, format, upstreamControl, downstreamControl)
    : resolveDirectPhysicalConveyor(owner, format, upstreamControl, downstreamControl);
  if (format.speedMode === 'MANUAL' && format.targetPopulationPercent === undefined && format.targetOverspeedPercent === undefined) {
    resolved.definition.conveyorSpeedMmPerSecond = format.conveyorSpeedMmPerSecond;
    resolved.sources.conveyorSpeedMmPerSecond = 'processData.accumulation.conveyorSpeedMmPerSecond';
    for (const key of ['packagePassSensorSeconds', 'sensorClearGapSeconds', 'sensorCycleSeconds']) delete resolved.definition[key];
    resolved.assumptions.push('Manual belt speed overrides the engineering speed calculation.');
  }
  const definition = resolved.definition;
  if (isFiniteNumber(definition.productLengthMm) && isFiniteNumber(format.movingGapMm) && (format.productSpacingOverride===true || format.targetPopulationPercent === undefined && format.targetOverspeedPercent === undefined)) {
    definition.productPitchMm = definition.productLengthMm + format.movingGapMm;
    definition.gapMm = format.movingGapMm;
    resolved.sources.productPitchMm = 'product length + processData.accumulation.movingGapMm';
    for (const key of ['packagePassSensorSeconds', 'sensorClearGapSeconds', 'sensorCycleSeconds']) delete definition[key];
  }
  definition.accumulatedPitchMm = format.accumulatedPitchMm ??
    (isFiniteNumber(definition.productLengthMm) ? definition.productLengthMm + (format.accumulatedGapMm ?? 0) : definition.productPitchMm);
  resolved.sources.accumulatedPitchMm = format.accumulatedPitchMm !== undefined ? 'processData.accumulation.accumulatedPitchMm' : 'product length + accumulated gap (default 0 mm)';
  const sheetPitch = owner.processData?.upstream?.dischargePitchMm;
  if ((format.useSheetDesignPitch || owner.characteristics?.sourceSheetLayout === 'plant-sheet-v2') &&
      format.movingGapMm === undefined && format.gapMm === undefined && format.productPitchMm === undefined &&
      format.targetPopulationPercent === undefined && format.targetOverspeedPercent === undefined &&
      Number.isFinite(sheetPitch) && sheetPitch >= definition.productLengthMm) {
    definition.productPitchMm = sheetPitch;
    definition.gapMm = sheetPitch - definition.productLengthMm;
    resolved.sources.productPitchMm = 'Sheet conveyor design pitch';
    for (const key of ['packagePassSensorSeconds', 'sensorClearGapSeconds', 'sensorCycleSeconds']) delete definition[key];
  }
  completeConveyorDerivedGeometry(resolved, owner, format, upstreamControl, downstreamControl);
  if (definition.engineering) {
    // Runtime geometry may override worksheet speed/spacing. Preserve the
    // worksheet audit separately rather than presenting it as the active model.
    definition.engineering.runtimeGeometry = {
      speedMode: format.speedMode || 'AUTO',
      conveyorSpeedMmPerSecond: definition.conveyorSpeedMmPerSecond,
      movingPitchMm: definition.productPitchMm,
      accumulatedPitchMm: definition.accumulatedPitchMm,
      transferCapacityPerSecond: definition.conveyorSpeedMmPerSecond / definition.productPitchMm,
      capacityUnits: Math.floor(definition.usableLengthMm / definition.accumulatedPitchMm)
    };
  }
  return resolved;
}

// The import does not contain every runtime field. Resolve only missing
// derivatives from available physical inputs, never silently clamp a sensor
// to fit an undersized conveyor or invent a belt speed or package dimension.
function completeConveyorDerivedGeometry(resolved, owner, format, upstreamControl, downstreamControl) {
  const d=resolved.definition,s=resolved.sources,positive=v=>isFiniteNumber(v)&&v>0;
  const geometry=owner.processData?.geometry||{},upstream=owner.processData?.upstream||{};
  const set=(key,value,source)=>{
    if(!isDefined(d[key])&&isFiniteNumber(value)){
      d[key]=value;s[key]=source;return true;
    }
    return false;
  };
  // Preserve direct geometry as a fallback for hybrid/imported records.
  set('usableLengthMm',format.usableLengthMm,'processData.accumulation.usableLengthMm');
  set('productLengthMm',format.productLengthMm,'processData.accumulation.productLengthMm');
  set('productLengthMm',upstream.packageLengthMm,'processData.upstream.packageLengthMm');
  if(!isDefined(d.productPitchMm)){
    set('productPitchMm',format.productPitchMm,'processData.accumulation.productPitchMm');
    if(!isDefined(d.productPitchMm)&&positive(d.productLengthMm)&&isFiniteNumber(format.gapMm))
      set('productPitchMm',d.productLengthMm+format.gapMm,'calculated: package length + declared gap');
    // If the worksheet factor is missing but the installed belt speed is
    // known, the steady-feed pitch is v / q. A belt slower than the packed
    // feed is capacity-limited, so its theoretical moving pitch is the
    // packed pitch, not a negative inter-package gap.
    const rate=upstreamControl?.nominalRatePerSecond;
    if(!isDefined(d.productPitchMm)&&positive(d.productLengthMm)&&positive(d.conveyorSpeedMmPerSecond)&&positive(rate)){
      const packed=positive(d.accumulatedPitchMm)?Math.max(d.productLengthMm,d.accumulatedPitchMm):d.productLengthMm;
      const pitch=Math.max(packed,d.conveyorSpeedMmPerSecond/rate);
      if(set('productPitchMm',pitch,'calculated: actual belt speed / upstream package rate, limited by packed pitch')){
        resolved.assumptions.push('Missing moving pitch: calculated from actual belt velocity and upstream nominal package rate; packed spacing is the capacity-limited lower bound. This is modeled spacing, not a measured pitch.');
      }
    }
  }
  if(positive(d.productPitchMm)&&positive(d.productLengthMm)){
    set('gapMm',d.productPitchMm-d.productLengthMm,'calculated: effective moving pitch - package length');
    set('accumulatedPitchMm',d.productLengthMm+(format.accumulatedGapMm??0),'calculated: package length + accumulated gap');
  }
  set('primeSensorPositionMm',format.primeSensorPositionMm,'processData.accumulation.primeSensorPositionMm');
  if(!isDefined(d.primeSensorPositionMm)&&isFiniteNumber(d.usableLengthMm)&&isFiniteNumber(geometry.lpPrimeMm))
    set('primeSensorPositionMm',d.usableLengthMm-geometry.lpPrimeMm,'calculated: L_act - L_p');
  // The installed sensor wins over an inferred recommendation. For an
  // unmeasured Back-up use the existing engineering overflow calculation.
  if(!isDefined(format.manualLbaMm))set('backupSensorPositionMm',format.backupSensorPositionMm,'processData.accumulation.backupSensorPositionMm');
  if(isFiniteNumber(format.manualLbaMm)&&isFiniteNumber(d.primeSensorPositionMm))
    set('backupSensorPositionMm',d.primeSensorPositionMm-format.manualLbaMm,'calculated: Prime position minus manual LBA');
  const needPitchAudit=d.engineering&&!positive(d.engineering.calculated.effectiveProductPitchMm);
  if((!isDefined(d.backupSensorPositionMm)||needPitchAudit)&&positive(d.productPitchMm)&&positive(d.productLengthMm)&&positive(d.conveyorSpeedMmPerSecond)&&positive(upstreamControl?.nominalRatePerSecond)){
    const prior=d.engineering?.input||{};
    const recalculated=calculateConveyorEngineering({
      ...prior,installedLengthMm:d.usableLengthMm,
      primeReserveMm:isFiniteNumber(d.primeSensorPositionMm)&&isFiniteNumber(d.usableLengthMm)?d.usableLengthMm-d.primeSensorPositionMm:geometry.lpPrimeMm,
      packageLengthMm:d.productLengthMm,
      upstreamDischargePitchMm:prior.upstreamDischargePitchMm??upstream.dischargePitchMm??upstreamControl?.processData?.upstream?.dischargePitchMm,
      upstreamNominalSpeedBpm:rateBpm(upstreamControl),
      downstreamHighSpeedBpm:prior.downstreamHighSpeedBpm??(downstreamControl?.processData?.productInputRatePerSecond!==undefined?downstreamControl.processData.productInputRatePerSecond*60:rateBpm(downstreamControl)),
      downstreamInfeedPitchMm:prior.downstreamInfeedPitchMm??owner.processData?.downstream?.infeedPitchMm??downstreamControl?.processData?.downstream?.infeedPitchMm,
      resolvedConveyorSpeedMmPerSecond:d.conveyorSpeedMmPerSecond,resolvedProductPitchMm:d.productPitchMm,
      dischargeRunoutLengthMm:geometry.actualDischargeMm??format.dischargeRunoutLengthMm,
      rejectRunoutLengthMm:geometry.actualCodingMm??format.rejectRunoutLengthMm,
      blockedTimeDelaySeconds:format.blockedTimeDelaySeconds,
      clearTimeDelaySeconds:format.clearTimeDelaySeconds,
      insuranceFactorUnits:format.insuranceFactorUnits,
      bottlesDischargedAtStop:format.bottlesDischargedAtStop??upstreamControl?.processData?.upstream?.bottlesDischargedAtStop,
      upstreamStopResponseSeconds:format.upstreamStopResponseSeconds,
      downstreamRampUpSeconds:format.downstreamRampUpSeconds??downstreamControl?.processData?.downstream?.rampUpTimeSeconds,
      upstreamStartupTimeSeconds:upstream.startupTimeSeconds??upstreamControl?.processData?.upstream?.startupTimeSeconds,
      manualLbaMm:format.manualLbaMm,backupSensorPositionMm:d.backupSensorPositionMm
    });
    if(set('backupSensorPositionMm',recalculated.calculated.actualBackupSensorPositionMm,'calculated: required overflow L_bu using resolved moving pitch')){
      resolved.assumptions.push('No installed Back-up position: using the calculated engineering overflow reserve L_bu. Verify the actual photoeye position in the plant before treating this as a measured configuration.');
    }
    // Retain the audit of the resolved inputs instead of leaving a missing
    // pitch/overflow audit when the fallback is what makes the model valid.
    if(d.engineering)d.engineering=recalculated;
  }
  if(!isDefined(d.backupRestartPositionMm)&&isFiniteNumber(d.backupSensorPositionMm)){
    set('backupRestartPositionMm',format.backupRestartPositionMm??d.backupSensorPositionMm,
      isDefined(format.backupRestartPositionMm)?'processData.accumulation.backupRestartPositionMm':'same Back-up position; Clear Time Delay provides the restart debounce');
  }
  if(positive(d.productPitchMm)&&positive(d.conveyorSpeedMmPerSecond)){
    set('packagePassSensorSeconds',positive(d.productLengthMm)?d.productLengthMm/d.conveyorSpeedMmPerSecond:undefined,'calculated: package length / actual conveyor speed');
    set('sensorClearGapSeconds',isFiniteNumber(d.gapMm)?d.gapMm/d.conveyorSpeedMmPerSecond:undefined,'calculated: product gap / actual conveyor speed');
    set('sensorCycleSeconds',d.productPitchMm/d.conveyorSpeedMmPerSecond,'calculated: effective pitch / actual conveyor speed');
  }
}

function resolveFlowPilotConveyor(owner, format, upstreamControl, downstreamControl) {
  const sources = {};
  const packageLength = selectValue([
    sourceValue(owner.processData?.upstream?.packageLengthMm, 'processData.upstream.packageLengthMm'),
    sourceValue(upstreamControl?.processData?.upstream?.packageLengthMm, 'upstream processData.upstream.packageLengthMm')
  ]);
  const dischargePitch = selectValue([
    sourceValue(owner.processData?.upstream?.dischargePitchMm, 'processData.upstream.dischargePitchMm'),
    sourceValue(upstreamControl?.processData?.upstream?.dischargePitchMm, 'upstream processData.upstream.dischargePitchMm')
  ]);
  const conveyorSpeedFactor = selectValue([
    sourceValue(format.conveyorSpeedFactorPercent, 'processData.accumulation.conveyorSpeedFactorPercent'),
    sourceValue(owner.processData?.speedAndSensors?.conveyorSpeedFactorVsDischargeVelocityPercent, 'processData.speedAndSensors.conveyorSpeedFactorVsDischargeVelocityPercent')
  ]);
  const installedLength = sourceValue(owner.processData?.geometry?.lactMm, 'processData.geometry.lactMm');
  const primeReserve = sourceValue(owner.processData?.geometry?.lpPrimeMm, 'processData.geometry.lpPrimeMm');
  const downstreamHighSpeed = selectValue([
    sourceValue(downstreamControl?.processData?.productInputRatePerSecond===undefined?undefined:downstreamControl.processData.productInputRatePerSecond*60, 'product downstream input rate'),
    sourceValue(format.useNominalDesignSpeed ? rateBpm(downstreamControl) : undefined, 'downstream nominalRatePerSecond'),
    sourceValue(downstreamControl?.processData?.equipment?.maximumSpeedBpm, 'downstream processData.equipment.maximumSpeedBpm'),
    sourceValue(rateBpm(downstreamControl), 'downstream nominalRatePerSecond')
  ]);
  const downstreamInfeedPitch = selectValue([
    sourceValue(downstreamControl?.processData?.productInputRatePerSecond===undefined?undefined:owner.processData?.downstream?.infeedPitchMm, 'product conveyor infeed pitch'),
    sourceValue(format.useNominalDesignSpeed ? owner.processData?.downstream?.infeedPitchMm : undefined, 'processData.downstream.infeedPitchMm'),
    sourceValue(downstreamControl?.processData?.downstream?.infeedPitchMm, 'downstream processData.downstream.infeedPitchMm'),
    sourceValue(owner.processData?.downstream?.infeedPitchMm, 'processData.downstream.infeedPitchMm')
  ]);
  const upstreamStopResponse = sourceValue(format.upstreamStopResponseSeconds, 'processData.accumulation.upstreamStopResponseSeconds');
  const bottlesDischargedAtStop = selectValue([
    sourceValue(format.bottlesDischargedAtStop, 'processData.accumulation.bottlesDischargedAtStop'),
    sourceValue(upstreamControl?.processData?.upstream?.bottlesDischargedAtStop, 'upstream processData.upstream.bottlesDischargedAtStop')
  ]);
  const downstreamRampUp = selectValue([
    sourceValue(format.downstreamRampUpSeconds, 'processData.accumulation.downstreamRampUpSeconds'),
    sourceValue(downstreamControl?.processData?.downstream?.rampUpTimeSeconds, 'downstream processData.downstream.rampUpTimeSeconds')
  ]);
  const calculation = calculateConveyorEngineering({
    targetPopulationPercent: format.targetPopulationPercent,
    targetOverspeedPercent: format.targetOverspeedPercent,
    manualLbaMm: format.manualLbaMm,
    installedLengthMm: installedLength.value,
    primeReserveMm: primeReserve.value,
    packageLengthMm: packageLength.value,
    upstreamDischargePitchMm: dischargePitch.value,
    upstreamNominalSpeedBpm: rateBpm(upstreamControl),
    downstreamHighSpeedBpm: downstreamHighSpeed.value,
    downstreamInfeedPitchMm: downstreamInfeedPitch.value,
    conveyorSpeedFactorPercent: conveyorSpeedFactor.value,
    codingSpeedFactorPercent: owner.processData?.speedAndSensors?.codingConveyorSpeedFactorVsPreviousConveyorPercent,
    accumulationSpeedFactorPercent: owner.processData?.speedAndSensors?.conveyorSpeedFactorVsPreviousConveyorPercent,
    infeedOverspeedPercent: owner.processData?.speedAndSensors?.overspeedVsInfeedScrewPercent,
    dischargeRunoutLengthMm: owner.processData?.geometry?.actualDischargeMm ?? format.dischargeRunoutLengthMm,
    rejectRunoutLengthMm: owner.processData?.geometry?.actualCodingMm ?? format.rejectRunoutLengthMm,
    blockedTimeDelaySeconds: format.blockedTimeDelaySeconds,
    clearTimeDelaySeconds: format.clearTimeDelaySeconds,
    insuranceFactorUnits: format.insuranceFactorUnits,
    backupSensorPositionMm: format.backupSensorPositionMm,
    upstreamStopResponseSeconds: upstreamStopResponse.value,
    bottlesDischargedAtStop: bottlesDischargedAtStop.value,
    downstreamRampUpSeconds: downstreamRampUp.value,
    upstreamStartupTimeSeconds: owner.processData?.upstream?.startupTimeSeconds ?? upstreamControl?.processData?.upstream?.startupTimeSeconds
  });
  const derived = calculation.calculated;
  const definition = {
    kind: 'FLOWPILOT_ENGINEERING',
    id: format.id || owner.id + '--physical-zone',
    name: format.name || (owner.name || owner.id) + ' accumulation',
    upstreamControlEquipmentId: upstreamControl?.id,
    downstreamControlEquipmentId: downstreamControl?.id,
    engineering: calculation,
    upstreamRestartDelaySeconds: calculation.input.upstreamStartupTimeSeconds
  };

  assignIfDefined(definition, 'usableLengthMm', calculation.input.installedLengthMm, sources, installedLength.source);
  assignIfDefined(definition, 'productLengthMm', packageLength.value, sources, packageLength.source);
  assignIfDefined(definition, 'gapMm', derived.productGapMm, sources, 'calculated: effective pitch - package length');
  assignIfDefined(definition, 'productPitchMm', derived.effectiveProductPitchMm, sources, 'calculated: package length / population');
  assignIfDefined(definition, 'conveyorSpeedMmPerSecond', derived.conveyorSpeedMmPerSecond, sources, format.targetOverspeedPercent!==undefined?'calculated: downstream infeed velocity × (1 + target overspeed)':format.targetPopulationPercent!==undefined?'calculated: packed material flow / target population':'calculated: discharge velocity × (1 + speed factor)');
  assignIfDefined(definition, 'packagePassSensorSeconds', derived.packagePassSensorSeconds, sources,
    'calculated: package length / conveyor speed');
  assignIfDefined(definition, 'sensorClearGapSeconds', derived.sensorClearGapSeconds, sources,
    'calculated: product gap / conveyor speed');
  assignIfDefined(definition, 'sensorCycleSeconds', derived.sensorCycleSeconds, sources,
    'calculated: product pitch / conveyor speed');
  assignIfDefined(definition, 'primeSensorPositionMm', derived.primeSensorPositionMm, sources, 'calculated: L_act - L_p');
  assignIfDefined(definition, 'backupSensorPositionMm', derived.actualBackupSensorPositionMm, sources,
    format.manualLbaMm !== undefined ? 'calculated: Prime position minus manual LBA' : isDefined(format.backupSensorPositionMm) ? 'processData.accumulation.backupSensorPositionMm' : 'calculated: required overflow length L_bu');
  assignIfDefined(definition, 'backupRestartPositionMm', derived.actualBackupSensorPositionMm, sources,
    'same Back-up position; Clear Time Delay provides the restart debounce');
  assignIfDefined(definition, 'blockedTimeDelaySeconds', calculation.input.blockedTimeDelaySeconds, sources,
    'processData.accumulation.blockedTimeDelaySeconds');
  assignIfDefined(definition, 'clearTimeDelaySeconds', calculation.input.clearTimeDelaySeconds, sources,
    'processData.accumulation.clearTimeDelaySeconds');
  assignIfDefined(definition, 'upstreamStopResponseSeconds', calculation.input.upstreamStopResponseSeconds, sources,
    upstreamStopResponse.source);
  assignIfDefined(definition, 'bottlesDischargedAtStop', calculation.input.bottlesDischargedAtStop, sources,
    bottlesDischargedAtStop.source);
  assignIfDefined(definition, 'downstreamRampUpSeconds', calculation.input.downstreamRampUpSeconds, sources,
    downstreamRampUp.source);

  return {
    definition,
    origin: 'FLOWPILOT_ENGINEERING',
    sources,
    assumptions: [
      'SimuLine geometry is active by default: L_act, L_p, package pitch, speed factor, and sensor delays are converted to the physical zone.',
      'Positions are measured from upstream discharge toward downstream infeed.',
      'Prime is L_act - L_p. If no installed Back-up position is supplied, L_bu is used as the calculated recommendation.'
    ]
  };
}

function resolveDirectPhysicalConveyor(owner, format, upstreamControl, downstreamControl) {
  const sources = {};
  const usableLength = selectValue([
    sourceValue(format.usableLengthMm, 'processData.accumulation.usableLengthMm')
  ]);
  const productLength = selectValue([
    sourceValue(format.productLengthMm, 'processData.accumulation.productLengthMm'),
    sourceValue(owner.processData?.upstream?.packageLengthMm, 'processData.upstream.packageLengthMm')
  ]);
  const gap = selectValue([
    sourceValue(format.gapMm, 'processData.accumulation.gapMm')
  ]);
  const explicitPitch = selectValue([
    sourceValue(format.productPitchMm, 'processData.accumulation.productPitchMm')
  ]);
  const pitch = selectValue([
    explicitPitch,
    sourceValue(
      sumNumericValues(productLength.value, gap.value),
      productLength.source && gap.source ? productLength.source + ' + ' + gap.source : undefined
    )
  ]);
  const conveyorSpeed = selectValue([
    sourceValue(format.conveyorSpeedMmPerSecond, 'processData.accumulation.conveyorSpeedMmPerSecond')
  ]);
  const primeSensor = selectValue([
    sourceValue(format.primeSensorPositionMm, 'processData.accumulation.primeSensorPositionMm')
  ]);
  const backupSensor = selectValue([
    sourceValue(format.backupSensorPositionMm, 'processData.accumulation.backupSensorPositionMm')
  ]);
  const backupRestart = selectValue([
    sourceValue(format.backupRestartPositionMm, 'processData.accumulation.backupRestartPositionMm')
  ]);
  const upstreamStopResponse = sourceValue(format.upstreamStopResponseSeconds, 'processData.accumulation.upstreamStopResponseSeconds');
  const bottlesDischargedAtStop = selectValue([
    sourceValue(format.bottlesDischargedAtStop, 'processData.accumulation.bottlesDischargedAtStop'),
    sourceValue(
      upstreamControl?.processData?.upstream?.bottlesDischargedAtStop,
      'upstream processData.upstream.bottlesDischargedAtStop'
    )
  ]);
  const downstreamRampUp = selectValue([
    sourceValue(format.downstreamRampUpSeconds, 'processData.accumulation.downstreamRampUpSeconds'),
    sourceValue(
      downstreamControl?.processData?.downstream?.rampUpTimeSeconds,
      'downstream processData.downstream.rampUpTimeSeconds'
    )
  ]);

  const definition = {
    kind: 'FORMAT_GEOMETRY',
    id: format.id || owner.id + '--physical-zone',
    name: format.name || (owner.name || owner.id) + ' accumulation',
    upstreamControlEquipmentId: upstreamControl?.id,
    downstreamControlEquipmentId: downstreamControl?.id
  };
  assignIfDefined(definition, 'usableLengthMm', usableLength.value, sources, usableLength.source);
  assignIfDefined(definition, 'productLengthMm', productLength.value, sources, productLength.source);
  assignIfDefined(definition, 'gapMm', gap.value, sources, gap.source);
  assignIfDefined(definition, 'productPitchMm', pitch.value, sources, pitch.source);
  assignIfDefined(definition, 'conveyorSpeedMmPerSecond', conveyorSpeed.value, sources, conveyorSpeed.source);
  assignIfDefined(definition, 'primeSensorPositionMm', primeSensor.value, sources, primeSensor.source);
  assignIfDefined(definition, 'backupSensorPositionMm', backupSensor.value, sources, backupSensor.source);
  assignIfDefined(definition, 'backupRestartPositionMm', backupRestart.value, sources, backupRestart.source);
  assignIfDefined(definition, 'blockedTimeDelaySeconds', format.blockedTimeDelaySeconds, sources, 'processData.accumulation.blockedTimeDelaySeconds');
  assignIfDefined(definition, 'clearTimeDelaySeconds', format.clearTimeDelaySeconds, sources, 'processData.accumulation.clearTimeDelaySeconds');
  assignIfDefined(definition, 'upstreamStopResponseSeconds', upstreamStopResponse.value, sources, upstreamStopResponse.source);
  assignIfDefined(definition, 'bottlesDischargedAtStop', bottlesDischargedAtStop.value, sources, bottlesDischargedAtStop.source);
  assignIfDefined(definition, 'downstreamRampUpSeconds', downstreamRampUp.value, sources, downstreamRampUp.source);

  return {
    definition,
    origin: 'FORMAT_GEOMETRY',
    sources,
    assumptions: [
      'This conveyor uses direct named physical geometry.',
      'Prime and Back-up positions are explicit; SimuLine L_act and L_p are not available on this Case.',
      'The upstream and downstream controlled equipment are inferred from the line sequence.'
    ]
  };
}

function hasFlowPilotInputs(owner, format) {
  return [
    owner.processData?.geometry?.lactMm,
    owner.processData?.geometry?.lpPrimeMm,
    format.conveyorSpeedFactorPercent,
    owner.processData?.speedAndSensors?.conveyorSpeedFactorVsDischargeVelocityPercent
  ].some(isDefined);
}

function findNearestNonConveyor(equipment, startIndex, direction) {
  for (let index = startIndex; index >= 0 && index < equipment.length; index += direction) {
    const candidate = equipment[index];
    if (candidate && !isConveyorEquipment(candidate)) return candidate;
  }
  return undefined;
}

function rateBpm(equipment) {
  return isFiniteNumber(equipment?.nominalRatePerSecond) ? equipment.nominalRatePerSecond * 60 : undefined;
}

function selectValue(candidates) {
  for (const candidate of candidates) {
    if (candidate && isDefined(candidate.value)) return candidate;
  }
  return { value: undefined, source: undefined };
}

function sourceValue(value, source) {
  return { value, source };
}

function sumNumericValues(left, right) {
  return isFiniteNumber(left) && isFiniteNumber(right) ? left + right : undefined;
}

function assignIfDefined(target, key, value, sources, source) {
  if (!isDefined(value)) return;
  target[key] = value;
  if (sources && source) sources[key] = source;
}

function isDefined(value) {
  return value !== undefined && value !== null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}



function validateSimulationInput(input) {
  const details = [];
  try { const resolvedProducts=validateProductSetup(input);if(resolvedProducts.length){for(const resolved of resolvedProducts)validateCase({...input.case,equipment:resolved.equipment},details,resolved.product);}else validateCase(input?.case, details); } catch(error) { details.push(invalid('run.productCatalog',error.message)); }
  validateRun(input?.run, details);
  try { if(input?.run?.tickSeconds>0)resolvePlannedStops(input.run);if(input?.run?.eventsEnabled!==false&&(input?.run?.plannedStops?.length||input?.run?.plantCalendar?.enabled&&input.run.plantCalendar.mode==='SCHEDULED')&&input.run.engineId==='DES_SIMPY_EXPERIMENTAL')throw new Error('Scheduled plant stops currently require the ST engine.'); } catch(error){details.push(invalid('run.plantCalendar',error.message));}
  if(input?.run?.eventsEnabled!==false)validateCommands(input?.run?.commands, input?.case?.equipment, details);

  return details.length === 0
    ? { ok: true }
    : {
        ok: false,
        error: {
          code: 'INVALID_SIMULATION_INPUT',
          message: 'The simulation input does not satisfy the required physical-line contract.',
          details
        }
      };
}

function validateCase(caseModel, details,product) {
  if (!caseModel || typeof caseModel !== 'object') {
    details.push(required('case'));
    return;
  }
  if (!Array.isArray(caseModel.equipment) || caseModel.equipment.length < 3) {
    details.push(invalid('case.equipment', 'must contain at least a machine, a conveyor, and a machine'));
    return;
  }

  const ids = new Set();
  caseModel.equipment.forEach((equipment, index) => {
    const path = 'case.equipment[' + index + ']';
    if (!equipment || typeof equipment !== 'object') {
      details.push(invalid(path, 'must be an object'));
      return;
    }
    if (!nonEmptyString(equipment.id)) details.push(required(path + '.id'));
    if (ids.has(equipment.id)) details.push(invalid(path + '.id', 'must be unique'));
    ids.add(equipment.id);
    if (!nonEmptyString(equipment.type)) details.push(required(path + '.type'));
    if(equipment.unitOfFlow!==undefined&&(typeof equipment.unitOfFlow!=='string'||equipment.unitOfFlow.trim().length>40))details.push(invalid(path+'.unitOfFlow','must be text of at most 40 characters'));
    if (!positiveNumber(equipment.nominalRatePerSecond)) {
      details.push(invalid(path + '.nominalRatePerSecond', 'must be a number greater than zero'));
    }
    if (!['AUTO', 'MANUAL', 'PAUSE', 'STOP'].includes(equipment.initialMode)) {
      details.push(invalid(path + '.initialMode', 'must be AUTO, MANUAL, PAUSE, or STOP'));
    }
    if (equipment.bufferAfterCapacity !== undefined) {
      details.push(invalid(path + '.bufferAfterCapacity', 'is no longer supported; configure the physical conveyor geometry instead'));
    }
    if (equipment.accumulationZone !== undefined) {
      details.push(invalid(path + '.accumulationZone', 'is no longer supported; configure processData.accumulation on the conveyor instead'));
    }
    validateNoiseProfile(equipment.noiseProfile, path, details);
    validateStartProfile(equipment, path, details);
    const design=equipment.processData?.equipment;
    if(product&&!isConveyorEquipment(equipment)&&design?.internalCapacityBottles!=null){
      const minimum=productUnitFactor(equipment,product)/productUnitFactor(equipment,product,'input');
      if(design.internalCapacityBottles<minimum)
        details.push(invalid(path+'.processData.equipment.internalCapacityBottles',equipment.name+': internal capacity must hold at least '+minimum+' '+(equipment.processData?.flowUnits?.input==='CASES'?'cases':'bottles')+' for one output package.'));
    }
  });

  validateAlternatingTopology(caseModel.equipment, details);
  caseModel.equipment.forEach((equipment, index) => {
    const path = 'case.equipment[' + index + ']';
    if (!equipment || typeof equipment !== 'object') return;
    if (isConveyorEquipment(equipment)) {
      validateConveyorGeometry(caseModel.equipment, index, path, details);
    } else if (equipment.processData?.accumulation !== undefined) {
      details.push(invalid(path + '.processData.accumulation', 'belongs only on a CONVEYOR'));
    }
  });
}

function validateAlternatingTopology(equipment, details) {
  const first = equipment[0];
  const last = equipment[equipment.length - 1];
  if (isConveyorEquipment(first)) details.push(invalid('case.equipment[0]', 'a line must start with a machine, not a conveyor'));
  if (isConveyorEquipment(last)) details.push(invalid('case.equipment[' + (equipment.length - 1) + ']', 'a line must end with a machine, not a conveyor'));

  equipment.forEach((item, index) => {
    if (!item) return;
    const path = 'case.equipment[' + index + ']';
    const previous = equipment[index - 1];
    const next = equipment[index + 1];
    if (isConveyorEquipment(item)) {
      if (!previous || isConveyorEquipment(previous) || !next || isConveyorEquipment(next)) {
        details.push(invalid(path, 'must sit between two non-conveyor machines'));
      }
    } else if (next && !isConveyorEquipment(next)) {
      details.push(invalid(path, 'must be followed by a CONVEYOR; direct machine-to-machine accumulation is not modeled'));
    }
  });
}

function validateConveyorGeometry(allEquipment, index, path, details) {
  const accumulation = allEquipment[index].processData?.accumulation;
  if (!accumulation || typeof accumulation !== 'object' || Array.isArray(accumulation)) {
    details.push(required(path + '.processData.accumulation'));
    return;
  }

  if (accumulation.speedMode !== undefined && !['AUTO', 'MANUAL'].includes(accumulation.speedMode)) details.push(invalid(path + '.processData.accumulation.speedMode', 'must be AUTO or MANUAL'));
  validateOptionalNonNegative(accumulation.movingGapMm, path + '.processData.accumulation.movingGapMm', details);
  validateOptionalNonNegative(accumulation.accumulatedGapMm, path + '.processData.accumulation.accumulatedGapMm', details);
  if (accumulation.targetPopulationPercent !== undefined && !(positiveNumber(accumulation.targetPopulationPercent) && accumulation.targetPopulationPercent <= 100)) details.push(invalid(path + '.processData.accumulation.targetPopulationPercent', 'must be greater than 0 and at most 100%'));
  if(accumulation.targetOverspeedPercent!==undefined&&!(Number.isFinite(accumulation.targetOverspeedPercent)&&accumulation.targetOverspeedPercent>=0&&accumulation.targetOverspeedPercent<=1000))details.push(invalid(path+'.processData.accumulation.targetOverspeedPercent','must be between 0 and 1000%'));
  if(accumulation.targetOverspeedPercent!==undefined&&accumulation.targetPopulationPercent!==undefined)details.push(invalid(path+'.processData.accumulation','choose either target Population or target Overspeed, not both'));
  const resolved = resolveAccumulationZoneDefinition(allEquipment, index);
  if (accumulation.manualLbaMm !== undefined && !(positiveNumber(accumulation.manualLbaMm) && accumulation.manualLbaMm <= resolved.definition?.engineering?.calculated?.calculatedUsefulAccumulationLengthMm)) details.push(invalid(path + '.processData.accumulation.manualLbaMm', 'must be positive and fit after Prime and required overflow reserves'));
  validatePhysicalZone(resolved.definition, path + '.processData.accumulation', details, allEquipment[index].name||allEquipment[index].id);
}

function validatePhysicalZone(zone, path, details, conveyorName) {
  if (!zone || !['FORMAT_GEOMETRY', 'FLOWPILOT_ENGINEERING'].includes(zone.kind)) {
    details.push(invalid(path, 'could not resolve a physical conveyor zone'));
    return;
  }

  if (!positiveNumber(zone.usableLengthMm)) {
    details.push(invalid(path + '.usableLengthMm', 'must be a number greater than zero'));
  }
  if (zone.productPitchMm !== undefined && !positiveNumber(zone.productPitchMm)) {
    details.push(invalid(path + '.productPitchMm', 'must be a number greater than zero'));
  }
  if (zone.productLengthMm !== undefined && !positiveNumber(zone.productLengthMm)) {
    details.push(invalid(path + '.productLengthMm', 'must be a number greater than zero'));
  }
  if (zone.gapMm !== undefined && !nonNegativeNumber(zone.gapMm)) {
    details.push(invalid(path + '.gapMm', 'must be a number greater than or equal to zero'));
  }

  if(zone.engineering?.runtimeGeometry?.speedMode!=='MANUAL'&&zone.engineering?.calculated?.dischargePopulationPercent>100+1e-9){
    details.push(invalid(path+'.gapMm','discharge pitch and discharge factor must leave non-overlapping package spacing in the discharge zone'));
  }
  const hasExplicitPitch = positiveNumber(zone.productPitchMm);
  const hasLengthAndGap = positiveNumber(zone.productLengthMm) && nonNegativeNumber(zone.gapMm);
  if (!hasExplicitPitch && !hasLengthAndGap) {
    details.push(invalid(path, conveyorName+': moving pitch could not be derived. Provide package length and a valid belt speed with upstream machine rate, or a measured pitch/gap.'));
  }

  if (zone.accumulatedPitchMm !== undefined && (!positiveNumber(zone.accumulatedPitchMm) || zone.accumulatedPitchMm < (zone.productLengthMm || 0) || zone.accumulatedPitchMm > (zone.productPitchMm ?? zone.productLengthMm + zone.gapMm))) {
    details.push(invalid(path + '.accumulatedPitchMm', 'must be between product length and moving pitch'));
  }
  const pitch = hasExplicitPitch ? zone.productPitchMm : hasLengthAndGap ? zone.productLengthMm + zone.gapMm : null;
  if (positiveNumber(zone.usableLengthMm) && positiveNumber(pitch) && Math.floor(zone.usableLengthMm / pitch) < 1) {
    details.push(invalid(path, 'usableLengthMm must hold at least one product pitch'));
  }

  if (!positiveNumber(zone.conveyorSpeedMmPerSecond)) {
    details.push(invalid(path + '.conveyorSpeedMmPerSecond', 'must be a number greater than zero'));
  }
  validateRequiredSensor(zone.primeSensorPositionMm, path + '.primeSensorPositionMm', zone.usableLengthMm, details);
  if(zone.backupSensorPositionMm===undefined||zone.backupSensorPositionMm===null){
    // One missing derivative must not generate a second missing restart-field
    // error. The installed sensor is optional when engineering can resolve it.
    if(hasExplicitPitch||hasLengthAndGap)details.push(invalid(path,conveyorName+': Back-up position could not be derived from the overflow reserve. Check the available package spacing, belt speed, upstream rate and geometry; enter the installed Back-up position only if known.'));
  }else{
    validateRequiredSensor(zone.backupSensorPositionMm, path + '.backupSensorPositionMm', zone.usableLengthMm, details);
    validateRequiredSensor(zone.backupRestartPositionMm, path + '.backupRestartPositionMm', zone.usableLengthMm, details);
  }

  if (nonNegativeNumber(zone.backupRestartPositionMm) && nonNegativeNumber(zone.backupSensorPositionMm) &&
      zone.backupRestartPositionMm < zone.backupSensorPositionMm) {
    details.push(invalid(path + '.backupRestartPositionMm', 'must be at or downstream of backupSensorPositionMm'));
  }
  if (nonNegativeNumber(zone.backupSensorPositionMm) && nonNegativeNumber(zone.primeSensorPositionMm) &&
      zone.backupSensorPositionMm > zone.primeSensorPositionMm) {
    details.push(invalid(path + '.backupSensorPositionMm', 'must be upstream of the Prime sensor'));
  }

  validateRequiredNonNegative(zone.upstreamStopResponseSeconds, path + '.upstreamStopResponseSeconds', details);
  validateRequiredNonNegative(zone.bottlesDischargedAtStop, path + '.bottlesDischargedAtStop', details);
  validateRequiredNonNegative(zone.downstreamRampUpSeconds, path + '.downstreamRampUpSeconds', details);
  validateOptionalNonNegative(zone.blockedTimeDelaySeconds, path + '.blockedTimeDelaySeconds', details);
  validateOptionalNonNegative(zone.clearTimeDelaySeconds, path + '.clearTimeDelaySeconds', details);
  if (!nonEmptyString(zone.upstreamControlEquipmentId)) details.push(required(path + '.upstreamControlEquipmentId'));
  if (!nonEmptyString(zone.downstreamControlEquipmentId)) details.push(required(path + '.downstreamControlEquipmentId'));
}

function validateRequiredSensor(value, path, usableLengthMm, details) {
  if (!nonNegativeNumber(value)) {
    details.push(required(path));
  } else if (positiveNumber(usableLengthMm) && value > usableLengthMm) {
    details.push(invalid(path, 'must be within usableLengthMm'));
  }
}

function validateRequiredNonNegative(value, path, details) {
  if (!nonNegativeNumber(value)) details.push(required(path));
}

function validateStartProfile(equipment, path, details) {
  validateOptionalNonNegative(equipment.processData?.equipment?.residenceTimeSeconds,path+'.processData.equipment.residenceTimeSeconds',details);
  if(equipment.processData?.equipment?.occupancyMode!==undefined&&!['STORAGE','POSITIONS'].includes(equipment.processData.equipment.occupancyMode))
    details.push(invalid(path+'.processData.equipment.occupancyMode','must be STORAGE or POSITIONS'));
  const capacity=equipment.processData?.equipment?.internalCapacityBottles;
  if(capacity!=null&&(!Number.isSafeInteger(capacity)||capacity<1))details.push(invalid(path+'.processData.equipment.internalCapacityBottles','must be a positive whole number of incoming units (bottles or cases)'));
  validateOptionalNonNegative(equipment.startupDelaySeconds, path + '.startupDelaySeconds', details);
  validateOptionalNonNegative(equipment.restartRampUpSeconds, path + '.restartRampUpSeconds', details);
  ['conveyorSpeedFactorVsDischargeVelocityPercent','codingConveyorSpeedFactorVsPreviousConveyorPercent','conveyorSpeedFactorVsPreviousConveyorPercent','overspeedVsInfeedScrewPercent'].forEach(key=>validateOptionalNonNegative(equipment.processData?.speedAndSensors?.[key],path+'.processData.speedAndSensors.'+key,details));
  ['actualDischargeMm','actualCodingMm'].forEach(key=>validateOptionalNonNegative(equipment.processData?.geometry?.[key],path+'.processData.geometry.'+key,details));
  validateOptionalNonNegative(equipment.processData?.upstream?.startupTimeSeconds, path + '.processData.upstream.startupTimeSeconds', details);
  validateOptionalNonNegative(equipment.processData?.downstream?.rampUpTimeSeconds, path + '.processData.downstream.rampUpTimeSeconds', details);
  const split=equipment.processData?.equipment?.stopInputs;
  if(split!==undefined){
    const splitPath=path+'.processData.equipment.stopInputs';
    if(!split||typeof split!=='object'||Array.isArray(split))details.push(invalid(splitPath,'must be an object'));
    else for(const kind of ['minor','major']){
      const pair=split[kind],valid=pair&&((positiveNumber(pair.mtbfMinutes)&&positiveNumber(pair.mttrMinutes))||(pair.mtbfMinutes===0&&pair.mttrMinutes===0));
      if(!valid)details.push(invalid(splitPath+'.'+kind,'supply positive MTBF/MTTR minutes or 0 and 0 for an absent category'));
    }
  }
  const repairRamp=equipment.processData?.downstream?.rampAfterRepair;
  if(repairRamp!==undefined&&typeof repairRamp!=='boolean')details.push(invalid(path+'.processData.downstream.rampAfterRepair','must be a boolean'));
}

function validateOptionalNonNegative(value, path, details) {
  if (value !== undefined && value !== null && !nonNegativeNumber(value)) {
    details.push(invalid(path, 'must be a number greater than or equal to zero'));
  }
}

function validateRun(run, details) {
  if (!run || typeof run !== 'object') {
    details.push(required('run'));
    return;
  }
  if (run.eventsEnabled !== undefined && typeof run.eventsEnabled !== 'boolean') details.push(invalid('run.eventsEnabled','must be a boolean'));
  if(run.discretePackages!==undefined&&typeof run.discretePackages!=='boolean')details.push(invalid('run.discretePackages','must be a boolean'));
  if(run.discretePackages&&(run.engineId==='DES_SIMPY_EXPERIMENTAL'||(run.rounds??1)!==1))details.push(invalid('run.discretePackages','Bottle Live requires the ST engine and one round'));
  if(run.calculationMode!==undefined&&!['LIVE','FAST','SUMMARY'].includes(run.calculationMode))details.push(invalid('run.calculationMode','unsupported mode'));
  if(run.numericalResolution!==undefined&&!['PRECISE','BALANCED','FAST'].includes(run.numericalResolution))details.push(invalid('run.numericalResolution','must be PRECISE, BALANCED, or FAST'));
  if (run.reliabilityEnabled !== undefined && typeof run.reliabilityEnabled !== 'boolean') details.push(invalid('run.reliabilityEnabled', 'must be a boolean'));
  if (run.reliabilityCategories !== undefined) {
    const categories=run.reliabilityCategories;
    if (!categories || typeof categories !== 'object' || Array.isArray(categories) ||
        Object.entries(categories).some(([key,value])=>!['general','minor','major'].includes(key)||typeof value!=='boolean')) {
      details.push(invalid('run.reliabilityCategories','must contain boolean general, minor or major settings'));
    }
  }
  if (!positiveNumber(run.durationSeconds)) details.push(invalid('run.durationSeconds', 'must be a number greater than zero'));
  if(run.effectiveRuntimeTargetSeconds!==undefined&&(!positiveNumber(run.effectiveRuntimeTargetSeconds)||run.effectiveRuntimeTargetSeconds>run.durationSeconds||Math.abs(run.durationSeconds/run.tickSeconds-Math.round(run.durationSeconds/run.tickSeconds))>1e-8))details.push(invalid('run.effectiveRuntimeTargetSeconds','must be positive and at most the tick-aligned time limit'));
  if (!positiveNumber(run.tickSeconds)) details.push(invalid('run.tickSeconds', 'must be a number greater than zero'));
  if (!Number.isInteger(run.seed)) details.push(invalid('run.seed', 'must be an integer'));
  if (run.sampleEverySeconds !== undefined && !positiveNumber(run.sampleEverySeconds)) {
    details.push(invalid('run.sampleEverySeconds', 'must be a number greater than zero'));
  }
}

function validateCommands(commands, equipment, details) {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) {
    details.push(invalid('run.commands', 'must be an array'));
    return;
  }
  const equipmentIds = new Set(Array.isArray(equipment) ? equipment.map((item) => item?.id) : []);
  commands.forEach((command, index) => {
    const path = 'run.commands[' + index + ']';
    if (!command || typeof command !== 'object') {
      details.push(invalid(path, 'must be an object'));
      return;
    }
    if (!nonNegativeNumber(command.atVirtualSecond)) {
      details.push(invalid(path + '.atVirtualSecond', 'must be a number greater than or equal to zero'));
    }
    if (!equipmentIds.has(command.equipmentId)) {
      details.push(invalid(path + '.equipmentId', 'must reference an equipment unit in case.equipment'));
    }
    if (!['RUN', 'PAUSE', 'STOP', 'MANUAL', 'AUTO', 'EMERGENCY_STOP', 'RESET'].includes(command.action)) {
      details.push(invalid(path + '.action', 'is not supported'));
    }
  });
}

function validateNoiseProfile(noiseProfile, equipmentPath, details) {
  if (noiseProfile === undefined) return;
  if (!noiseProfile || typeof noiseProfile !== 'object' || Array.isArray(noiseProfile)) {
    details.push(invalid(equipmentPath + '.noiseProfile', 'must be an object'));
    return;
  }
  if (noiseProfile.microStop !== undefined) validateMicroStop(noiseProfile.microStop, equipmentPath, details);
  if (noiseProfile.reliability !== undefined) validateReliability(noiseProfile.reliability, equipmentPath, details);
}

function validateMicroStop(microStop, equipmentPath, details) {
  const path = equipmentPath + '.noiseProfile.microStop';
  if (!microStop || typeof microStop !== 'object' || Array.isArray(microStop)) {
    details.push(invalid(path, 'must be an object'));
    return;
  }
  if (microStop.probabilityPerMinute !== undefined && !nonNegativeNumber(microStop.probabilityPerMinute)) {
    details.push(invalid(path + '.probabilityPerMinute', 'must be a number greater than or equal to zero'));
  }
  if (microStop.minDurationSeconds !== undefined && !nonNegativeNumber(microStop.minDurationSeconds)) {
    details.push(invalid(path + '.minDurationSeconds', 'must be a number greater than or equal to zero'));
  }
  if (microStop.maxDurationSeconds !== undefined && !nonNegativeNumber(microStop.maxDurationSeconds)) {
    details.push(invalid(path + '.maxDurationSeconds', 'must be a number greater than or equal to zero'));
  }
  if (nonNegativeNumber(microStop.minDurationSeconds) && nonNegativeNumber(microStop.maxDurationSeconds) &&
      microStop.minDurationSeconds > microStop.maxDurationSeconds) {
    details.push(invalid(path + '.maxDurationSeconds', 'must be greater than or equal to minDurationSeconds'));
  }
}

function validateReliability(reliability, equipmentPath, details) {
  const path = equipmentPath + '.noiseProfile.reliability';
  if (!reliability || typeof reliability !== 'object' || Array.isArray(reliability)) {
    details.push(invalid(path, 'must be an object'));
    return;
  }
  if (!positiveNumber(reliability.mtbfMinutes)) {
    details.push(invalid(path + '.mtbfMinutes', 'must be a number greater than zero'));
  }
  if (!positiveNumber(reliability.mttrMinutes)) {
    details.push(invalid(path + '.mttrMinutes', 'must be a number greater than zero'));
  }
}

function required(path) { return { path, reason: 'is required' }; }
function invalid(path, reason) { return { path, reason }; }
function positiveNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function nonNegativeNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }


/** Design targets and observed flow. Recovery is an explicit planning estimate. */
function analyzeLinePerformance(equipment, result) {
  const machines = (equipment || []).filter(item => item.type !== 'CONVEYOR' && item.processData?.role !== 'CONVEYOR');
  const duration = Number(result?.durationSeconds) || 0;
  const referenceId = machines.find(item => item.type === 'PACEMAKER' || item.processData?.role === 'PACEMAKER' || item.characteristics?.isPacemaker)?.id ||
    machines.find(item => item.id === result?.summary?.lineOeePacemakerEquipmentId)?.id ||
    machines.find(item => item.type === 'FILLER')?.id || machines[0]?.id;
  const reference = machines.find(item => item.id === referenceId);
  const baselineBpm = Number(reference?.nominalRatePerSecond) * 60;
  const points = machines.map(item => {
    const configuredBpm = Number(item.nominalRatePerSecond) * 60;
    // The V-Graph shows configured machine speeds. Average production flow
    // is reported separately and must not flatten speeds to the pacemaker.
    const normalBpm = configuredBpm;
    const recovery = estimateRecoveryTarget(equipment || [], item, referenceId, normalBpm);
    const configuredMaximum = item.processData?.equipment?.maximumSpeedBpm;
    const maximumBpm = configuredMaximum === null || configuredMaximum === undefined || configuredMaximum === ''
      ? null : Number(configuredMaximum);
    const validMaximum = Number.isFinite(maximumBpm) && maximumBpm >= normalBpm && normalBpm > 0;
    const metrics = result?.equipmentMetrics?.[item.id];
    const output = Number(metrics?.outputCount);
    const stopped = Number(metrics?.stoppedSeconds);
    // Availability excludes line interactions; starvation and blocking therefore
    // reduce the operational-efficiency component of effective throughput.
    const availableSeconds = duration > 0 && Number.isFinite(stopped)
      ? Math.max(0, duration - stopped) : 0;
    const availability = duration > 0 && Number.isFinite(stopped) ? availableSeconds / duration : null;
    // Availability-only capacity estimate. Buffer recovery requires the actual
    // deviation from desired inventory and a recovery time, neither supplied here.
    // The pacemaker is the reference, not a machine to overspeed for recovery.
    const capacityEstimateBpm = item.id !== referenceId && baselineBpm > 0 && configuredBpm > 0 && availability > 0
      ? Math.max(configuredBpm, baselineBpm / availability) : null;
    const runtimeEfficiency = availableSeconds > 0 && Number.isFinite(output) && configuredBpm > 0
      ? output / (availableSeconds * configuredBpm / 60) : null;
    const observedBpm = duration > 0 && Number.isFinite(output) ? output * 60 / duration : null;
    return {
      id: item.id, name: item.name, isPacemaker: item.id === referenceId,
      normalBpm, configuredBpm, maximumBpm: validMaximum ? maximumBpm : null,
      ...recovery,
      recommendedPercent: recovery.recommendedBpm !== null && baselineBpm > 0 ? recovery.recommendedBpm / baselineBpm * 100 : null,
      recommendationExceedsMaximum: recovery.recommendedBpm !== null && validMaximum ? recovery.recommendedBpm > maximumBpm + 1e-9 : null,
      speedHeadroomPercent: validMaximum ? (maximumBpm / normalBpm - 1) * 100 : null,
      normalPercent: baselineBpm > 0 ? normalBpm / baselineBpm * 100 : null,
      maximumPercent: validMaximum && baselineBpm > 0 ? maximumBpm / baselineBpm * 100 : null,
      capacityEstimateBpm,
      capacityEstimateExceedsMaximum: capacityEstimateBpm !== null && validMaximum ? capacityEstimateBpm > maximumBpm + 1e-9 : null,
      availability, runtimeEfficiency, observedBpm,
      computedBpm: availability !== null && runtimeEfficiency !== null
        ? configuredBpm * availability * runtimeEfficiency : null,
      hasDynamicEvidence: observedBpm !== null
    };
  });
  const outletCount = Number(result?.summary?.outputCount);
  return {
    points, referenceId,
    unitOfFlow: result?.unitOfFlow || 'units',
    outletBpm: duration > 0 && Number.isFinite(outletCount) ? outletCount * 60 / duration : null,
    outputCount: Number.isFinite(outletCount) ? outletCount : null,
    durationSeconds: duration,
    hasSpeedHeadroom: points.some(point => point.speedHeadroomPercent > 0),
    hasCompleteMaxima: points.length > 0 && points.every(point => point.maximumBpm !== null),
    // The engine uses nominal speed for processing; maximum is design evidence,
    // not a simulated recovery-speed controller or a V-Graph certification.
    simulatesOverspeed: false
  };
}

function estimateRecoveryTarget(equipment, item, referenceId, normalBpm) {
  const empty = {recommendedBpm:null,recoveryUnits:null,recoveryTimeSeconds:null,recoveryBasis:'MISSING_DATA'};
  if (!(normalBpm > 0)) return empty;
  if (item.id === referenceId) return {...empty,recommendedBpm:normalBpm,recoveryUnits:0,recoveryBasis:'PACEMAKER'};
  const index = equipment.indexOf(item), referenceIndex = equipment.findIndex(e => e.id === referenceId);
  const towardReference = referenceIndex > index ? 1 : -1;
  const conveyorIndex = index + towardReference;
  const conveyor = equipment[conveyorIndex];
  if (!conveyor || conveyor.type !== 'CONVEYOR' && conveyor.processData?.role !== 'CONVEYOR')
    return {...empty,recommendedBpm:normalBpm,recoveryUnits:0,recoveryBasis:'NO_ACCUMULATION'};
  const definition = resolveAccumulationZoneDefinition(equipment, conveyorIndex).definition;
  const pitch = Number(definition?.accumulatedPitchMm);
  const usefulLength = definition?.engineering?.calculated?.usefulAccumulationLengthMm ?? definition?.usableLengthMm;
  if (!(pitch > 0) || !Number.isFinite(usefulLength) || usefulLength < 0) return empty;
  const bufferUnits = Math.floor(usefulLength / pitch);
  const reliability = item.noiseProfile?.reliability;
  // Disabled failures do not create an inferred outage, even if old MTTR values
  // are retained in processData. Missing data is not a zero-loss assumption.
  const mttr = Number(reliability?.mttrMinutes);
  const recoverySeconds = Number(item.processData?.equipment?.recoveryTimeSeconds ?? Number(reliability?.mtbfMinutes) * 60);
  if (!reliability || !Number.isFinite(mttr) || !(mttr > 0) || !Number.isFinite(recoverySeconds) || !(recoverySeconds > 0)) return empty;
  const recoveryUnits = Math.min(normalBpm * mttr, bufferUnits);
  return {
    recommendedBpm:normalBpm + recoveryUnits * 60 / recoverySeconds,
    recoveryUnits,recoveryTimeSeconds:recoverySeconds,
    recoveryBasis:item.processData?.equipment?.recoveryTimeSeconds != null ? 'EXPLICIT_RECOVERY_TIME' : 'MTBF_RECOVERY_WINDOW',
    bufferUnits,bufferCoversMeanStop:bufferUnits >= normalBpm * mttr
  };
}


// Capacity accounting and observed equipment time are distinct: time losses
// overlap across machines and must never be summed as causal global OEE loss.
// Use immutable run snapshots and time-weighted bottle equivalents across formats.
function formatCapacityCeiling(models,result,provenance){
  const rows=result.products?.rows,catalog=provenance?.run?.productCatalog;
  if(!rows?.length||!Array.isArray(catalog))return null;
  let ideal=0,capacity=0,duration=0;
  for(const row of rows){
    const product=catalog.find(p=>p.id===(row.formatId||row.productId));
    if(!product||!Number.isFinite(row.durationSeconds)||row.durationSeconds<0||!Number.isFinite(row.idealBottleOutput)||row.idealBottleOutput<0)return null;
    if(!row.durationSeconds)continue;
    const machines=applyProductProfile(models,product).filter(e=>e.type!=='CONVEYOR'&&e.processData?.role!=='CONVEYOR');
    const rates=machines.map(e=>e.nominalRatePerSecond*(productFlowUnit(e)==='CASES'?productPackSize(product):1));
    if(!rates.length||rates.some(r=>!Number.isFinite(r)||r<=0))return null;
    capacity+=Math.min(row.idealBottleOutput,Math.min(...rates)*row.durationSeconds);
    ideal+=row.idealBottleOutput;duration+=row.durationSeconds;
  }
  if(!(ideal>0)||Math.abs(duration-result.durationSeconds)>Math.max(.001,result.durationSeconds*1e-8))return null;
  return 100*capacity/ideal;
}
function diagnoseLineEfficiency(equipment,result){
  let models=equipment||[],provenance;
  try{provenance=JSON.parse(result?.inputSignature||result?.replay?.inputSignature||'null');if(Array.isArray(provenance?.equipment))models=provenance.equipment;}catch(_){}
  const line=analyzeLinePerformance(models,result),reference=line.points.find(p=>p.isPacemaker),machines=line.points.filter(p=>p.configuredBpm>0);
  const referenceBpm=reference?.configuredBpm,minimumBpm=machines.length?Math.min(...machines.map(p=>p.configuredBpm)):null;
  const ceiling=result?.products?formatCapacityCeiling(models,result,provenance):referenceBpm>0&&minimumBpm>0?Math.min(100,100*minimumBpm/referenceBpm):null;
  const mean=result?.batch?.statistics?.lineOeePercent?.mean,achieved=Number.isFinite(mean)?mean:result?.summary?.lineOeePercent;
  const valid=result?.engineId!=='DES_SIMPY_EXPERIMENTAL'&&Number.isFinite(ceiling)&&Number.isFinite(achieved)&&achieved>=0&&achieved<=ceiling+.01;
  const duration=result?.durationSeconds,read=(id,key)=>result?.batch?.equipmentStatistics?.[id]?.[key]?.mean??result?.equipmentMetrics?.[id]?.[key];
  const keys=['plannedStopSeconds','failureSeconds','microStopSeconds','pausedSeconds','emergencyStopSeconds','starvedSeconds','blockedSeconds','waitingForPrimeSeconds','backupStopSeconds'];
  return {referenceId:line.referenceId,referenceName:reference?.name,referenceBpm,minimumBpm,capacityCeilingPercent:ceiling,
    limitingEquipment:machines.filter(p=>Math.abs(p.configuredBpm-minimumBpm)<1e-7).map(p=>({id:p.id,name:p.name,bpm:p.configuredBpm,maximumBpm:p.maximumBpm})),
    achievedPercent:Number.isFinite(achieved)?achieved:null,capacityGapPp:Number.isFinite(ceiling)?100-ceiling:null,residualLossPp:valid?Math.max(0,ceiling-achieved):null,
    accountingAvailable:valid,rounds:result?.batch?.rounds||1,
    equipmentTime:machines.map(p=>({id:p.id,name:p.name,percent:Object.fromEntries(keys.map(key=>{const value=read(p.id,key);return [key,duration>0&&Number.isFinite(value)?100*value/duration:null];}))})),
    interpretation:result?.products?'Time-weighted nominal machine-speed ceiling in bottle equivalents using saved format profiles and ideal output. Excludes transport constraints, stops and startup. Equipment-time percentages overlap and are not additive global OEE contributions.':'Nominal machine-speed ceiling; excludes transport constraints, stops and startup. Residual loss is not separated causally. Equipment-time percentages overlap and are not additive global OEE contributions.'};
}


// A progress label alone is not completion evidence. Check the current model,
// requested replications, seed identities and terminal calendar/runtime exposure.
function scenarioSourceReadiness(simulation) {
  const result=simulation?.results;
  const fail=(reason,sourceStatus='UNAVAILABLE',extra={})=>({ready:false,reason,sourceStatus,...extra});
  if(!result?.summary)return fail('NO_RESULTS');
  if(result.provisional===true)return fail('INCOMPLETE_REPLICATIONS','INCOMPLETE');
  if(!(Number.isFinite(result.durationSeconds)&&result.durationSeconds>0))return fail('INVALID_RESULT_DURATION');
  if(result.replicationStatus?.state!=='COMPLETE')return fail('INCOMPLETE_REPLICATIONS','INCOMPLETE');
  if(!result.inputSignature)return fail('MISSING_INPUT_SIGNATURE');
  let provenance;try{provenance=JSON.parse(result.inputSignature);}catch(_){return fail('INVALID_INPUT_SIGNATURE');}
  if(!provenance||typeof provenance!=='object')return fail('INVALID_INPUT_SIGNATURE');
  if(provenance.version!==SIMULATION_PROVENANCE_VERSION)return fail('PROVENANCE_VERSION_MISMATCH','HISTORICAL',{provenance:{recordedVersion:provenance.version??null,currentVersion:SIMULATION_PROVENANCE_VERSION}});
  const run={...simulation.dynamicConfig};
  if(run.durationMode==='SHIFTS')run.durationSeconds=(run.shiftHours||8)*(run.shiftCount||1)*3600;
  // With an active packing format the engine reports bottle equivalents even
  // when the case's original generic input label is "units". Do not mistake
  // that output label for the input unit recorded in the signature.
  const formatId=run.initialFormatId??run.initialProductId;
  const formatted=Array.isArray(run.productCatalog)&&run.productCatalog.some(p=>p.id===formatId);
  const inputUnit=formatted?provenance.unitOfFlow:simulation.unitOfFlow||result.unitOfFlow||'units';
  const expected=JSON.parse(canonicalSimulationInputSignature({case:{equipment:simulation.equipment,unitOfFlow:inputUnit},run}));
  if(formatted&&result.unitOfFlow!=='bottles')return fail('FLOW_UNIT_CHANGED','STALE');
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));return value;}
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  if(provenance.run?.engineId!==expected.run.engineId)return fail('ENGINE_MISMATCH','STALE');
  if(expected.run.engineId!=='ST_CURRENT')return fail('UNVALIDATED_SCENARIO_ENGINE');
  // Storage fills empty object fields and trims display labels. These do not
  // change equipment physics; all nested parameters, units and order remain exact.
  function storedEquipment(items){
    return Array.isArray(items)?items.map(unit=>{
      const copy={...unit};delete copy.uiExpanded;
      if(typeof copy.name==='string')copy.name=copy.name.trim();
      if(typeof copy.unitOfFlow==='string')copy.unitOfFlow=copy.unitOfFlow.trim()||undefined;
      for(const key of ['characteristics','noiseProfile','processData'])if(copy[key]===undefined)copy[key]={};
      // A declared 0/0 minor AND major pair with no active failure profile
      // has no aggregate MTBF or MTTR. Editors/older storage may represent
      // that undefined aggregate as null, omitted, or zero. Compare those
      // representations alike, without accepting changes to active failures
      // or to the declared stop categories.
      const data=copy.processData?.equipment,split=data?.stopInputs;
      if(!copy.noiseProfile?.reliability&&split&&['minor','major'].every(kind=>split[kind]?.mtbfMinutes===0&&split[kind]?.mttrMinutes===0)&&
         [data.mtbfMinutes,data.mttrMinutes].every(value=>value===undefined||value===null||value===0)){
        const normalized={...data};delete normalized.mtbfMinutes;delete normalized.mttrMinutes;
        copy.processData={...copy.processData,equipment:normalized};
      }
      return copy;
    }):items;
  }
  function difference(a,b,path){
    if(equal(a,b))return null;
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
        const next=difference(a[key],b[key],Array.isArray(a)?path+'['+key+']':path+'.'+key);
        if(next)return next;
      }
    }
    return path;
  }
  const equipmentDifference=difference(storedEquipment(provenance.equipment),storedEquipment(expected.equipment),'equipment');
  if(equipmentDifference)return fail('EQUIPMENT_CHANGED','STALE',{differencePath:equipmentDifference});
  if(provenance.unitOfFlow!==expected.unitOfFlow)return fail('FLOW_UNIT_CHANGED','STALE');
  function comparableRun(value){
    const copy={...value};
    for(const key of ['sampleDisplayUnit','displayRefreshFps','chartWindow'])delete copy[key];
    return copy;
  }
  // Numerical execution expands scheduled calendar stops and excludes disabled
  // manual events. The stored config is intentionally the editable unexpanded
  // representation. Reproduce that deterministic transformation, not its result.
  function preparedRun(value){
    const copy={...value,machineResidenceEnabled:value.machineResidenceEnabled??true};
    const calendar=copy.includePlantCalendar===false?{...copy.plantCalendar,enabled:false}:copy.plantCalendar;
    const manualEnabled=copy.eventsEnabled!==false;
    const manualStops=manualEnabled?(copy.plannedStops||[]).filter(event=>event?.source!=='PLANT_CALENDAR'):[];
    const commands=manualEnabled?copy.commands||[]:[];
    if(!calendar?.enabled||calendar.mode!=='SCHEDULED')return {...copy,plantCalendar:calendar,commands,plannedStops:manualStops};
    const schedule=plantCalendarSchedule(calendar,copy.tickSeconds);
    return {...copy,eventsEnabled:true,commands,plannedStops:manualStops.concat(schedule.events.map(event=>({...event,restartPolicy:schedule.restartPolicy,source:'PLANT_CALENDAR'}))),plantCalendar:{...calendar,application:'EVENTS',appliedHorizonSeconds:copy.durationSeconds}};
  }
  const observedRun=comparableRun(provenance.run),currentRun=comparableRun(expected.run);
  if(!equal(observedRun,currentRun)){
    let executionRun;
    try{executionRun=comparableRun(preparedRun(expected.run));}catch(_){}
    if(!executionRun||!equal(observedRun,executionRun))return fail('RUN_CONFIGURATION_CHANGED','STALE',{differencePath:difference(observedRun,executionRun||currentRun,'run')});
  }
  const rounds=expected.run.rounds,baseSeed=expected.run.seed>>>0;
  if(!Number.isInteger(rounds)||rounds<1||rounds>100)return fail('INVALID_REPLICATION_COUNT','INCOMPLETE');
  if(result.replicationStatus.rounds!==undefined&&result.replicationStatus.rounds!==rounds||result.batch&&result.batch.rounds!==rounds)return fail('REPLICATION_COUNT_MISMATCH','INCOMPLETE');
  const rows=result.batch?.rows||(rounds===1?[result]:[]);
  if(!Array.isArray(rows)||rows.length!==rounds)return fail('INCOMPLETE_REPLICATION_ROWS','INCOMPLETE',{rounds,completedRounds:Array.isArray(rows)?rows.length:0});
  const expectedSeeds=new Set(Array.from({length:rounds},(_,index)=>(baseSeed+index)>>>0));
  if(new Set(rows.map(row=>row.seed)).size!==rounds||rows.some(row=>!Number.isInteger(row.seed)||!expectedSeeds.has(row.seed)))return fail('REPLICATION_SEEDS_MISMATCH','INCOMPLETE');
  if(rows.some(row=>!row.summary||!Number.isFinite(row.summary.lineOeePercent)||row.summary.lineOeePercent<0||!Number.isFinite(row.summary.outputCount)||row.summary.outputCount<0))return fail('INVALID_REPLICATION_METRICS','INCOMPLETE');
  const target=expected.run.effectiveRuntimeTargetSeconds,horizon=expected.run.durationSeconds;
  if(!Number.isFinite(horizon)||horizon<=0)return fail('INVALID_RESULT_DURATION');
  for(const row of rows){
    const duration=row.durationSeconds??(target===undefined?result.durationSeconds:undefined);
    if(!Number.isFinite(duration)||duration<=0||duration>horizon+1e-6)return fail('INCOMPLETE_REPLICATION_HORIZON','INCOMPLETE');
    if(target===undefined){if(Math.abs(duration-horizon)>1e-6)return fail('INCOMPLETE_REPLICATION_HORIZON','INCOMPLETE');}
    else {
      const stop=row.effectiveRuntimeStop;
      if(!stop||stop.targetSeconds!==target||stop.limitSeconds!==horizon||!['REACHED','LIMIT_REACHED'].includes(stop.status))return fail('INCOMPLETE_RUNTIME_TARGET','INCOMPLETE');
      if(stop.status==='LIMIT_REACHED'&&Math.abs(duration-horizon)>1e-6)return fail('INCOMPLETE_RUNTIME_TARGET','INCOMPLETE');
      if(stop.status==='REACHED'&&(!Number.isFinite(stop.accumulatedSeconds)||stop.accumulatedSeconds+1e-6<target))return fail('INCOMPLETE_RUNTIME_TARGET','INCOMPLETE');
    }
  }
  return {ready:true,reason:null,sourceStatus:'CURRENT',rounds,completedRounds:rows.length,unitOfFlow:formatted?'bottles':expected.unitOfFlow,comparisonBasis:target===undefined?'FIXED_CALENDAR_HORIZON':'COMPLETED_RUNTIME_TARGET_OR_LIMIT'};
}


// Scenario policy is separate from the unchanged simulation mathematics.
const SCENARIO_POLICY = Object.freeze({microstopLimitMinutes:4,maxChanges:64});
const SCENARIO_DEFINITIONS = Object.freeze({
  ZERO:{scope:'Optimize installed assets and work practices without capital investment.',reliability:'Supported operational improvements; additional maintenance is OPEX, not capital.',costBasis:'Intervention scope; no assumed monetary threshold or required efficiency gain.'},
  MEDIUM:{scope:'Local component rehabilitation, monitoring or equipment retrofit.',reliability:'Documented retrofit MTBF/MTTR targets, with installation scope and target source.',costBasis:'Intervention type and physical scope only; no budget amount or monetary threshold is required.'},
  HIGH:{scope:'Complete equipment replacement or major line/transport redesign.',reliability:'Replacement can improve reliability without changing speed; use supplier or measured targets.',costBasis:'Complete replacement or major redesign defines this category; no budget amount or minimum efficiency gain is required.'}
});
const SCENARIO_INTERVENTIONS = Object.freeze({
  OPERATIONAL:{tier:'ZERO',costClass:'NONE',label:'Existing resources / work practices'},
  MAINTENANCE:{tier:'ZERO',costClass:'OPEX',label:'Additional maintenance / repair resources'},
  RETROFIT:{tier:'MEDIUM',costClass:'CAPEX',label:'Local retrofit / rehabilitation'},
  REPLACEMENT:{tier:'HIGH',costClass:'CAPEX',label:'Complete equipment replacement'}
});
// Input classes are declarations, not causes inferred from mean stop duration.
// The independent MICRO_STOP process is distinct from MINOR reliability events.
function scenarioStopDataCoverage(simulation,equipment){
  const reliability=equipment?.noiseProfile?.reliability,split=equipment?.processData?.equipment?.stopInputs;
  const validPair=pair=>pair&&Number.isFinite(pair.mtbfMinutes)&&Number.isFinite(pair.mttrMinutes)&&
    (pair.mtbfMinutes>0&&pair.mttrMinutes>0||pair.mtbfMinutes===0&&pair.mttrMinutes===0);
  const mode=split!==undefined?(['minor','major'].every(kind=>validPair(split?.[kind]))?'SPLIT':'INVALID_SPLIT'):
    reliability?.mtbfMinutes>0&&reliability?.mttrMinutes>0?'GENERAL':'NOT_CONFIGURED';
  const enabled=simulation?.dynamicConfig?.reliabilityEnabled!==false&&!!reliability;
  const categories=simulation?.dynamicConfig?.reliabilityCategories||{};
  const enabledClasses=!enabled?[]:mode==='SPLIT'?['minor','major'].filter(kind=>split[kind].mtbfMinutes>0&&categories[kind]!==false).map(kind=>kind.toUpperCase()):
    mode==='GENERAL'&&categories.general!==false?['GENERAL']:[];
  return {mode,source:mode==='SPLIT'?'DECLARED_EQUIPMENT_STOP_CLASSES':mode==='GENERAL'?'AGGREGATE_RELIABILITY_INPUT':'NO_VALID_CLASS_INPUT',
    enabledClasses,classSpecificAnalysisAvailable:mode==='SPLIT',breakdownRequiredForClassSpecificAttribution:mode==='GENERAL',
    microStopProcessConfigured:(equipment?.noiseProfile?.microStop?.probabilityPerMinute||0)>0,
    causeClassification:'NOT_ESTABLISHED',classesInferred:false,
    interpretation:'MINOR and MAJOR use supplied stop classes; GENERAL remains unclassified. MICRO_STOP is a separate modeled process. Duration alone does not establish a failure cause, maintenance action or replacement.'};
}
function scenarioCategoryAllows(change,tier){
  if(change.analysisOnly)return false;
  if(change.replacementMaximumBpm!==undefined)return tier==='HIGH'&&change.path==='nominalRatePerSecond'&&change.interventionType==='REPLACEMENT'&&change.external===true;
  if(change.path.startsWith('noiseProfile.reliability.')){
    const intervention=SCENARIO_INTERVENTIONS[change.interventionType];
    return !!intervention&&intervention.tier===tier;
  }
  return tier==='HIGH'||tier==='MEDIUM'&&change.path!=='processData.geometry.lactMm'||tier==='ZERO'&&!change.external&&change.path!=='processData.geometry.lactMm';
}
// Explicit exploratory levels are diagnostics, never implementation targets.
function reliabilitySensitivityCandidates(simulation,{mtbfMultiplier=2,mttrMultiplier=.5}={}){
  if(simulation.dynamicConfig?.reliabilityEnabled===false)return [];
  if(!(mtbfMultiplier>1&&mtbfMultiplier<=10&&mttrMultiplier>0&&mttrMultiplier<1))throw Error('SCENARIO_INVALID_SENSITIVITY_LEVEL');
  const diagnosis=diagnoseScenarioLosses(simulation);
  return (simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR'&&e.noiseProfile?.reliability?.mtbfMinutes>0&&e.noiseProfile?.reliability?.mttrMinutes>0).flatMap(e=>{
    const changes=['mtbfMinutes','mttrMinutes'].map((key,i)=>({...scenarioChange(e,'noiseProfile.reliability.'+key,Math.max(SCENARIO_FIELDS['noiseProfile.reliability.'+key][0],Math.min(SCENARIO_FIELDS['noiseProfile.reliability.'+key][1],e.noiseProfile.reliability[key]*(i?mttrMultiplier:mtbfMultiplier)))),external:true,analysisOnly:true,interventionType:'SENSITIVITY',justification:'Exploratory sensitivity level; not an achievable intervention target.'}));
    const observed=diagnosis.equipment.find(r=>r.equipmentId===e.id);
    const stopData= scenarioStopDataCoverage(simulation,e);
    const assessment=equipmentReliabilityAssessment(e,simulation.dynamicConfig);
    return ['MTBF','MTTR','JOINT'].map((kind,i)=>({equipmentId:e.id,equipmentName:e.name,kind,changes:i===2?changes:[changes[i]],ownStopPercent:observed?.ownStopPercent??null,
      failureSeconds:observed?.failureSeconds??null,reliabilityAssessment:assessment,stopDataCoverage:stopData,targetScope:stopData.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED',
      availabilityBefore:e.noiseProfile.reliability.mtbfMinutes/(e.noiseProfile.reliability.mtbfMinutes+e.noiseProfile.reliability.mttrMinutes)}));
  }).sort((a,b)=>(b.failureSeconds??0)-(a.failureSeconds??0));
}
const SCENARIO_FIELDS = Object.freeze({
  'nominalRatePerSecond':[0.001,1000000,'units/s'],
  'noiseProfile.reliability.mtbfMinutes':[0.001,1000000,'min'],
  'noiseProfile.reliability.mttrMinutes':[0.001,1000000,'min'],
  'processData.accumulation.conveyorSpeedMmPerSecond':[0.001,1000000,'mm/s'],
  'processData.accumulation.conveyorSpeedFactorPercent':[0,1000,'%'],
  'processData.accumulation.blockedTimeDelaySeconds':[0,3600,'s'],
  'processData.accumulation.clearTimeDelaySeconds':[0,3600,'s'],
  'processData.accumulation.backupSensorPositionMm':[0,1000000,'mm'],
  'processData.geometry.lactMm':[1,1000000,'mm'],
  'processData.geometry.lpPrimeMm':[0,1000000,'mm'],
  'processData.accumulation.downstreamRampUpSeconds':[0,3600,'s'],
  'processData.upstream.startupTimeSeconds':[0,3600,'s']
});
function scenarioCopy(value){return JSON.parse(JSON.stringify(value));}
function scenarioGet(e,path){return path.split('.').reduce((value,key)=>value?.[key],e);}
function scenarioSet(e,path,value){const parts=path.split('.'),key=parts.pop();let node=e;parts.forEach(p=>{node[p]=node[p]||{};node=node[p];});node[key]=value;}
function stableScenarioValue(value){
  if(Array.isArray(value))return value.map(stableScenarioValue);
  if(value&&typeof value==='object')return Object.keys(value).sort().reduce((result,key)=>{
    if(value[key]!==undefined)result[key]=stableScenarioValue(value[key]);
    return result;
  },{});
  return value;
}
function scenarioSignature(simulation){
  // CaseService normalizes each equipment record on write. Hash only the
  // persisted input fields and sort nested keys so JSON editor formatting and
  // key insertion order cannot invalidate a proposal with identical inputs.
  const equipment=(simulation.equipment||[]).map(unit=>({
    id:unit.id,type:unit.type,name:typeof unit.name==='string'?unit.name.trim():unit.name,
    nominalRatePerSecond:Number(unit.nominalRatePerSecond),initialMode:unit.initialMode,
    characteristics:unit.characteristics&&typeof unit.characteristics==='object'?unit.characteristics:{},
    noiseProfile:unit.noiseProfile&&typeof unit.noiseProfile==='object'?unit.noiseProfile:{},
    processData:unit.processData&&typeof unit.processData==='object'?unit.processData:{}
  }));
  const config=simulation.dynamicConfig&&typeof simulation.dynamicConfig==='object'&&!Array.isArray(simulation.dynamicConfig)?{...simulation.dynamicConfig}:{};
  delete config.chartWindow;
  if(config.numericalResolution==='PRECISE')delete config.numericalResolution;
  const unitOfFlow=simulation.unitOfFlow||simulation.results?.unitOfFlow||simulation.results?.replay?.unitOfFlow||'units';
  const text=JSON.stringify(stableScenarioValue(["SCENARIO_STREAMS_V5",SIMULATION_PROVENANCE_VERSION,simulation.id,unitOfFlow,equipment,config]));
  let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16)+':'+text.length;
}
function scenarioActiveProduct(simulation){
  const run=simulation.dynamicConfig||simulation.run||{},id=run.initialFormatId??run.initialProductId;
  return Array.isArray(run.productCatalog)?run.productCatalog.find(product=>product.id===id):undefined;
}
function scenarioEngineeringEquipment(simulation){
  const equipment=simulation.equipment||[],product=scenarioActiveProduct(simulation);
  // The runtime applies the active format before resolving conveyor geometry.
  // In particular, a Case Packer's bottle input rate differs from its case output.
  // Apply the same profile on copies; persisted rates and proposal baselines stay native.
  return product?applyProductProfile(equipment,product):equipment;
}
function scenarioAudit(simulation){
  const equipment=scenarioEngineeringEquipment(simulation);
  return equipment.flatMap((e,index)=>{
    if(e.type!=='CONVEYOR')return [];
    const zone=resolveAccumulationZoneDefinition(equipment,index).definition;
    return [{equipmentId:e.id,equipmentName:e.name,engineering:zone?.engineering||null,upstreamId:zone?.upstreamControlEquipmentId,downstreamId:zone?.downstreamControlEquipmentId}];
  });
}
// Screening policy, not a manufacturer requirement or an automatic replacement rule.
// All time inputs are in minutes, except explicitly named Seconds fields.
const EQUIPMENT_RELIABILITY_POLICY=Object.freeze({availabilityTarget:.95,mtbfTargetMinutes:60,mttrTargetMinutes:10});
function equipmentReliabilityAssessment(equipment,config={},policy=EQUIPMENT_RELIABILITY_POLICY){
  const e=equipment||{},r=e.noiseProfile?.reliability,split=e.processData?.equipment?.stopInputs;
  const target=Number.isFinite(policy.availabilityTarget)&&policy.availabilityTarget>0&&policy.availabilityTarget<1?policy.availabilityTarget:.95;
  const bfTarget=Number.isFinite(policy.mtbfTargetMinutes)&&policy.mtbfTargetMinutes>0?policy.mtbfTargetMinutes:60;
  const trTarget=Number.isFinite(policy.mttrTargetMinutes)&&policy.mttrTargetMinutes>0?policy.mttrTargetMinutes:10;
  const thresholds={availabilityTarget:target,mtbfTargetMinutes:bfTarget,mttrTargetMinutes:trTarget};
  const base={equipmentId:e.id,name:e.name,thresholds,status:'NOT EVALUATED',action:'NOT_EVALUATED',replacementRequired:null,
    source:'CONFIGURED_MODEL',classes:[],mtbfMinutes:null,mttrMinutes:null,availability:null,unavailability:null,ratio:null};
  const none=reason=>({...base,reason});
  if(e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR')return none('CONVEYOR');
  if(e.processData?.productApplies===false)return none('NOT_APPLICABLE');
  if(config.reliabilityEnabled===false)return none('FAILURES_DISABLED');
  const positive=p=>Number.isFinite(p?.mtbfMinutes)&&p.mtbfMinutes>0&&Number.isFinite(p?.mttrMinutes)&&p.mttrMinutes>0;
  const zero=p=>p?.mtbfMinutes===0&&p?.mttrMinutes===0;
  const categories=config.reliabilityCategories||{};
  let classes=[],mode;
  if(split!==undefined){
    if(!['minor','major'].every(k=>positive(split?.[k])||zero(split?.[k])))return none('INVALID_INPUTS');
    const configured=['minor','major'].filter(k=>positive(split[k]));
    if(!configured.length)return none('NO_MODELED_FAILURES');
    if(!positive(r))return none('INVALID_INPUTS');
    classes=configured.filter(k=>categories[k]!==false).map(k=>({kind:k.toUpperCase(),mtbfMinutes:split[k].mtbfMinutes,mttrMinutes:split[k].mttrMinutes}));
    mode='SPLIT';
  }else{
    if(!r||zero(r))return none('NO_MODELED_FAILURES');
    if(!positive(r))return none('INVALID_INPUTS');
    if(categories.general!==false)classes=[{kind:'GENERAL',mtbfMinutes:r.mtbfMinutes,mttrMinutes:r.mttrMinutes}];
    mode='GENERAL';
  }
  if(!classes.length)return none('CATEGORIES_DISABLED');
  // Independent failure clocks share exposure; durations are frequency-weighted.
  const totalRate=classes.reduce((s,p)=>s+1/p.mtbfMinutes,0);
  const mtbfMinutes=1/totalRate,mttrMinutes=classes.reduce((s,p)=>s+(1/p.mtbfMinutes)*p.mttrMinutes,0)/totalRate;
  const availability=mtbfMinutes/(mtbfMinutes+mttrMinutes),ratio=mtbfMinutes/mttrMinutes;
  if(![mtbfMinutes,mttrMinutes,availability,ratio].every(Number.isFinite))return none('INVALID_INPUTS');
  const frequent=mtbfMinutes<bfTarget,long=mttrMinutes>trTarget,belowTarget=availability+1e-12<target;
  // A declared major class may be long even when its weighted mean is short.
  const longClass=classes.some(p=>p.mttrMinutes>trTarget);
  const action=frequent&&(long||longClass)&&belowTarget?'REBUILD_OR_REPLACE_REVIEW':
    frequent&&(long||longClass)?'JOINT_RELIABILITY_REVIEW':frequent?'IMPROVE_MTBF':long||longClass?'IMPROVE_MTTR':
    belowTarget?'JOINT_RELIABILITY_REVIEW':'KEEP_MONITOR';
  const status=belowTarget?'FAIL':action==='KEEP_MONITOR'?'PASS':'REVIEW';
  const requiredMtbfMinutes=target/(1-target)*mttrMinutes,requiredMttrMinutes=(1-target)/target*mtbfMinutes;
  const severity=availability>=.99?'EXCELLENT':availability>=.98?'VERY_GOOD':availability>=.95?'GOOD':
    availability>=.9?'FAIR':availability>=.8?'POOR':availability>=.5?'CRITICAL':'SEVERE';
  return {...base,status,action,reason:belowTarget?'BELOW_TARGET':status==='REVIEW'?'PATTERN_REVIEW':'TARGET_MET',mode,
    classes:classes.map(p=>({...p,eventShare:(1/p.mtbfMinutes)/totalRate,failuresPerOperatingHour:60/p.mtbfMinutes})),
    mtbfMinutes,mttrMinutes,availability,unavailability:1-availability,ratio,severity,frequent,long,longClass,
    failuresPerOperatingHour:60/mtbfMinutes,failuresPerDay:1440/(mtbfMinutes+mttrMinutes),
    downtimeMinutesPerDay:1440*(1-availability),requiredMtbfMinutes,requiredMttrMinutes,
    mtbfImprovementFactor:Math.max(1,requiredMtbfMinutes/mtbfMinutes),
    mttrReductionPercent:Math.max(0,100*(1-requiredMttrMinutes/mttrMinutes))};
}
function analyzeEquipmentReliability(simulation,equipmentId,{observed,audits,policy,includeSavedEvidence=true}={}){
  const equipment=simulation?.equipment||[],config=simulation?.dynamicConfig||simulation?.run||{},e=equipment.find(x=>x.id===equipmentId);
  const assessment=equipmentReliabilityAssessment(e,config,policy);
  const report={...assessment,observed:null,bufferCoverage:[],capacity:null,counterfactual:null,
    feasibility:'NOT_ESTABLISHED',replacementRequired:null};
  if(!e||e.type==='CONVEYOR'||e.processData?.role==='CONVEYOR')return report;
  // A completed compatible result uses replication means; a UI may supply a
  // current single-run observation explicitly, separately from the design inputs.
  if(observed===undefined&&simulation.results){
    try{
      const diagnosis=diagnoseScenarioLosses(simulation);
      const row=diagnosis.status==='OBSERVED'?diagnosis.equipment.find(x=>x.equipmentId===equipmentId):null;
      if(row)observed={...row,durationSeconds:diagnosis.durationSeconds,basis:diagnosis.rounds>1?'REPLICATION_MEAN':'COMPLETED_RUN'};
    }catch(_){}
  }
  const finite=v=>Number.isFinite(v)&&v>=0?v:null;
  if(observed&&observed.durationSeconds>0){
    const duration=observed.durationSeconds,failureSeconds=finite(observed.failureSeconds),count=finite(observed.failureCount),exposure=finite(observed.reliabilityExposureSeconds);
    report.observed={basis:observed.basis||'RECORDED_RUN',durationSeconds:duration,failureSeconds,failureCount:count,
      reliabilityExposureSeconds:exposure,failurePercent:failureSeconds===null?null:100*failureSeconds/duration,
      microStopSeconds:finite(observed.microStopSeconds),starvedSeconds:finite(observed.starvedSeconds),blockedSeconds:finite(observed.blockedSeconds),
      waitingForPrimeSeconds:finite(observed.waitingForPrimeSeconds),backupStopSeconds:finite(observed.backupStopSeconds),
      observedExposurePerFailureMinutes:count>0&&exposure!==null?exposure/count/60:null,
      observedFaultTimePerFailureMinutes:count>0&&failureSeconds!==null?failureSeconds/count/60:null,
      interpretation:'Observed stop exposure; unfinished repairs and short runs may bias ratios. Local losses are not additive line losses.'};
  }
  // Use the engineering model's populated accumulation reserve / free-space
  // estimate, not nominal conveyor length or an assumed full/empty buffer.
  if(assessment.mttrMinutes>0){
    let list=audits;
    if(!list){try{list=scenarioAudit(simulation);}catch(_){list=[];}}
    for(const [direction,idKey,timeKey] of [['UPSTREAM','downstreamId','antiBlockSeconds'],['DOWNSTREAM','upstreamId','antiStarveSeconds']]){
      const connected=(list||[]).filter(a=>a[idKey]===equipmentId);
      const estimates=connected.map(a=>finite(a.engineering?.calculated?.[timeKey]));
      const seconds=connected.length&&estimates.every(v=>v!==null)?Math.min(...estimates):null;
      report.bufferCoverage.push({direction,conveyorIds:connected.map(a=>a.equipmentId),seconds,
        ratio:seconds===null?null:seconds/(assessment.mttrMinutes*60),
        classCoverage:assessment.classes.map(p=>({kind:p.kind,ratio:seconds===null?null:seconds/(p.mttrMinutes*60)})),
        basis:'ENGINEERING_DESIGN_POPULATION',status:seconds===null?'NOT EVALUATED':seconds+1e-9>=assessment.mttrMinutes*60?'PASS':'FAIL'});
    }
  }
  // Capacity screening is compared only in a common material-flow unit.
  try{
    const models=scenarioEngineeringEquipment(simulation),product=scenarioActiveProduct(simulation);
    const machine=models.find(x=>x.id===equipmentId),line=analyzeLinePerformance(models,null),point=line.points.find(x=>x.id===equipmentId),reference=line.points.find(x=>x.isPacemaker);
    const ref=models.find(x=>x.id===reference?.id);
    const flow=x=>String(x?.processData?.flowUnits?.output??x?.unitOfFlow??simulation.unitOfFlow??'units').toUpperCase();
    const factor=x=>product?productUnitFactor(x,product):1;
    const comparable=point&&reference&&ref&&machine&&(product||flow(machine)===flow(ref));
    if(point){
      const f=factor(machine),rate=point.configuredBpm*f,maximum=point.maximumBpm==null?null:point.maximumBpm*f;
      const referenceRate=comparable?reference.configuredBpm*factor(ref):null;
      const effective=assessment.availability===null?null:rate*assessment.availability;
      report.capacity={configuredRatePerMinute:finite(rate),maximumRatePerMinute:finite(maximum),referenceRatePerMinute:finite(referenceRate),
        availabilityOnlyRatePerMinute:finite(effective),maximumAvailabilityOnlyRatePerMinute:maximum!==null&&assessment.availability!==null?finite(maximum*assessment.availability):null,
        unit:product?'BOTTLE_EQUIVALENTS':flow(machine),referenceId:reference?.id??null,
        nominalDeficit:referenceRate>0&&Number.isFinite(rate)?Math.max(0,referenceRate-rate):null,
        availabilityOnlyDeficit:referenceRate>0&&effective!==null?Math.max(0,referenceRate-effective):null,
        basis:'STATIC_CAPACITY_SCREEN_NOT_THROUGHPUT'};
    }
  }catch(_){}
  if(includeSavedEvidence&&simulation.id&&simulation.whatIf?.evaluations?.length){
    try{
      const signature=scenarioSignature(simulation);
      const entries=simulation.whatIf.evaluations.filter(x=>x.sourceSimulationId===simulation.id&&x.sourceSignature===signature&&!['RUNNING','VALIDATING','INTERRUPTED'].includes(x.status))
        .slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
      for(const entry of entries){
        const search=entry.reliabilityTargetSearch??entry.sensitivityScreening?.reliabilityTargetSearch;
        const row=search?.ranking?.find(x=>x.equipmentId===equipmentId);
        if(!row||!Number.isFinite(row.deltaThroughput)||!Number.isFinite(row.deltaOeePp))continue;
        report.counterfactual={deltaThroughput:row.deltaThroughput,deltaOeePp:row.deltaOeePp,
          throughputUnit:entry.unitOfFlow||simulation.unitOfFlow||'units',run:search.run||null,updatedAt:entry.updatedAt||null,
          basis:'MATCHED_FAILURE_REMOVAL_EXPLORATORY',plantValidated:false};
        break;
      }
    }catch(_){}
  }
  return report;
}

// Catalog lists model-supported inputs even when the planner has no proposal.
// Targets start at the baseline: the user supplies bounds; no gains are invented.
function scenarioVariableCatalog(simulation){
  const referenceId=analyzeLinePerformance(simulation.equipment,simulation.results).referenceId;
  return (simulation.equipment||[]).flatMap(e=>Object.keys(SCENARIO_FIELDS).filter(path=>
    e.type==='CONVEYOR'?path.startsWith('processData.'):path==='nominalRatePerSecond'||path.startsWith('noiseProfile.reliability.')||path==='processData.upstream.startupTimeSeconds'
  ).map(path=>{
    const before=scenarioGet(e,path)??null,external=path.startsWith('noiseProfile.reliability.');
    let disabledReason=Number.isFinite(before)?null:'Set a numeric baseline in Equipment first.';
    if(external&&!(before>0))disabledReason='Set a positive reliability baseline in Equipment first.';
    if(path==='nominalRatePerSecond'){
      if(e.id===referenceId)disabledReason='Reference machine speed is fixed by the current scenario policy.';
      else if(!(Number(e.processData?.equipment?.maximumSpeedBpm)>0))disabledReason='Set the installed maximum speed in Equipment first.';
    }
    if(e.type==='CONVEYOR'&&path.endsWith('conveyorSpeedMmPerSecond')&&e.processData?.accumulation?.speedMode!=='MANUAL')disabledReason='Select manual conveyor speed in Equipment first.';
    if(e.type==='CONVEYOR'&&path.endsWith('conveyorSpeedFactorPercent')&&e.processData?.accumulation?.speedMode==='MANUAL')disabledReason='Manual speed mode uses conveyor speed instead of its automatic factor.';
    return {equipmentId:e.id,path,before,after:before,unit:SCENARIO_FIELDS[path][2],external,disabledReason,catalogOnly:true};
  }));
}
function applyScenarioChanges(simulation,changes){
  if(!Array.isArray(changes)||!changes.length||changes.length>SCENARIO_POLICY.maxChanges)throw new Error('SCENARIO_INVALID_CHANGES');
  const copy=scenarioCopy(simulation),seen=new Set();
  changes.forEach(change=>{
    const rule=Object.hasOwn(SCENARIO_FIELDS,change.path)?SCENARIO_FIELDS[change.path]:null;
    const unit=copy.equipment.find(e=>e.id===change.equipmentId),key=change.equipmentId+':'+change.path;
    if(!unit||!rule||seen.has(key)||typeof change.after!=='number'||!Number.isFinite(change.after)||change.after<rule[0]||change.after>rule[1])throw new Error('SCENARIO_INVALID_FIELD');
    if(!Object.hasOwn(change,'before')||(scenarioGet(unit,change.path)??null)!==change.before)throw new Error('SCENARIO_STALE');
    if((change.path.includes('accumulation')||change.path.includes('geometry'))&&unit.type!=='CONVEYOR')throw new Error('SCENARIO_INVALID_FIELD');
    if(change.path==='nominalRatePerSecond'){
      let maximum=Number(unit.processData?.equipment?.maximumSpeedBpm)/60;
      if(change.replacementMaximumBpm!==undefined){
        if(!(maximum>0)||change.external!==true||change.interventionType!=='REPLACEMENT'||typeof change.justification!=='string'||!change.justification.trim()||!Number.isFinite(change.replacementMaximumBpm)||change.replacementMaximumBpm<=maximum*60||change.replacementMaximumBpm>SCENARIO_FIELDS.nominalRatePerSecond[1]*60||change.after<change.before)throw Error('SCENARIO_REPLACEMENT_EVIDENCE_REQUIRED');
        maximum=change.replacementMaximumBpm/60;
      }
      if(unit.type==='CONVEYOR'||unit.id===analyzeLinePerformance(simulation.equipment,simulation.results).referenceId||!(maximum>0)||change.after>maximum)throw new Error('SCENARIO_INSTALLED_SPEED_LIMIT');
    }
    if(change.path.startsWith('noiseProfile.reliability.')){
      if(unit.type==='CONVEYOR'||!(change.before>0)||change.external!==true||typeof change.justification!=='string'||!change.justification.trim()||(!SCENARIO_INTERVENTIONS[change.interventionType]&&!(change.analysisOnly===true&&change.interventionType==='SENSITIVITY')))throw new Error('SCENARIO_EXTERNAL_EVIDENCE_REQUIRED');
      if(change.path.endsWith('mtbfMinutes')?change.after<change.before:change.after>change.before)throw new Error('SCENARIO_RELIABILITY_DIRECTION');
    }
    if(change.replacementMaximumBpm!==undefined){if(change.path!=='nominalRatePerSecond')throw Error('SCENARIO_INVALID_FIELD');scenarioSet(unit,'processData.equipment.maximumSpeedBpm',change.replacementMaximumBpm);}
    if(change.path.startsWith('noiseProfile.reliability.')&&unit.processData?.equipment?.stopInputs){
      const field=change.path.split('.').at(-1),factor=change.after/change.before;
      for(const category of Object.values(unit.processData.equipment.stopInputs))category[field]*=factor;
      unit.processData.equipment[field]=change.after;
    }
    seen.add(key);scenarioSet(unit,change.path,change.after);
  });
  if(changes.every(c=>c.before===c.after))throw new Error('SCENARIO_NO_CHANGE');
  const check=validateSimulationInput({case:{id:'scenario-preview',equipment:copy.equipment},run:Object.assign({durationSeconds:60,tickSeconds:.25,sampleEverySeconds:1,seed:1,commands:[]},copy.dynamicConfig)});
  if(!check.ok)throw new Error('SCENARIO_INVALID_PHYSICS');
  copy.scenarioWarnings=[];
  const before=scenarioAudit(simulation),after=scenarioAudit(copy);
  after.forEach((item,index)=>{
    (item.engineering?.audit?.goals||[]).forEach(goal=>{
      const previous=before[index]?.engineering?.audit?.goals?.find(g=>g.id===goal.id);
      if(previous?.status==='PASS'&&goal.status!=='PASS')copy.scenarioWarnings.push({equipmentId:item.equipmentId,rule:goal.id,before:previous.status,after:goal.status});
    });
  });
  copy.results=null;return copy;
}
function scenarioChange(e,path,after){return {equipmentId:e.id,path,before:scenarioGet(e,path)??null,after,unit:SCENARIO_FIELDS[path][2]};}
function scenarioGoal(engineering,id){return engineering?.audit?.goals?.find(g=>g.id===id)?.status;}
function scenarioRecoveryPlan(engineering,requiredSeconds=0){
  const input=engineering?.input;if(!input||!(input.installedLengthMm>0))return null;
  function evaluate(length){
    const first=calculateConveyorEngineering({...input,installedLengthMm:length}),backup=Math.ceil(first.calculated.recommendedBackupSensorPositionMm);
    if(!Number.isFinite(backup))return null;
    const check=calculateConveyorEngineering({...input,installedLengthMm:length,backupSensorPositionMm:backup});
    const passes=['INSTALLED_LENGTH','SMOOTH_RECOVERY','BACKUP_POSITION'].every(id=>scenarioGoal(check,id)==='PASS');
    return {length,backup,check,passes:passes&&(!requiredSeconds||check.calculated.antiStarveSeconds>=requiredSeconds)};
  }
  let low=Math.ceil(input.installedLengthMm),high=low,plan=evaluate(high),limit=Math.min(1000000,Math.max(high+50000,high*5));
  while(plan&&!plan.passes&&high<limit){low=high;high=Math.min(limit,high+Math.max(100,Math.ceil(high*.2)));plan=evaluate(high);}
  if(!plan?.passes)return null;
  while(high-low>1){const mid=Math.floor((low+high)/2),trial=evaluate(mid);if(trial?.passes){high=mid;plan=trial;}else low=mid;}
  return evaluate(high);
}
// Losses describe observed states, not proven causal attribution.
function diagnoseScenarioLosses(simulation){
  const result=simulation.results,readiness=scenarioSourceReadiness(simulation);
  if(!readiness.ready)return {status:'NO_COMPATIBLE_RESULTS',...readiness,equipment:[],referenceId:null,rankings:{},opportunities:[]};
  const referenceId=analyzeLinePerformance(simulation.equipment,result).referenceId;
  const rounds=result.batch?.rounds||1,replications=result.batch?.rows;
  const hasActualDurations=Array.isArray(replications)&&replications.length===rounds&&replications.every(r=>Number.isFinite(r.durationSeconds)&&r.durationSeconds>0);
  const durationSeconds=hasActualDurations?replications.reduce((sum,r)=>sum+r.durationSeconds,0)/rounds:result.durationSeconds;
  const durationBasis=hasActualDurations?'MEAN_ACTUAL_REPLICATION_DURATION':'RECORDED_RESULT_DURATION';
  const rows=(simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR').map(e=>{
    const stats=result.batch?.equipmentStatistics?.[e.id],metrics=result.equipmentMetrics?.[e.id];
    // A replicated report must not silently substitute round one's observation
    // when a replication mean is missing.
    const read=key=>{const value=rounds>1?stats?.[key]?.mean:stats?.[key]?.mean??metrics?.[key];return Number.isFinite(value)&&value>=0?value:null;};
    const failureSeconds=read('failureSeconds'),microStopSeconds=read('microStopSeconds'),starvedSeconds=read('starvedSeconds'),blockedSeconds=read('blockedSeconds');
    const ownStopSeconds=failureSeconds!==null&&microStopSeconds!==null?failureSeconds+microStopSeconds:null;
    const failureCount=read('failureCount'),microStopCount=read('microStopCount');
    const minorFailureSeconds=read('minorFailureSeconds'),majorFailureSeconds=read('majorFailureSeconds'),generalFailureSeconds=read('generalFailureSeconds');
    const minorFailureCount=read('minorFailureCount'),majorFailureCount=read('majorFailureCount'),generalFailureCount=read('generalFailureCount');
    const stopDataCoverage=scenarioStopDataCoverage(simulation,e);
    stopDataCoverage.recordedCategoryDurations=[minorFailureSeconds,majorFailureSeconds,generalFailureSeconds].every(value=>value!==null);
    stopDataCoverage.recordedCategoryCounts=[minorFailureCount,majorFailureCount,generalFailureCount].every(value=>value!==null);
    stopDataCoverage.classSpecificAnalysisAvailable=stopDataCoverage.classSpecificAnalysisAvailable&&stopDataCoverage.recordedCategoryDurations;
    const causes=[['FAILURE',failureSeconds],['MICROSTOP',microStopSeconds],['STARVATION',starvedSeconds],['BLOCKING',blockedSeconds],['WAITING_PRIME',read('waitingForPrimeSeconds')],['BACKUP_STOP',read('backupStopSeconds')]].filter(x=>x[1]!==null).sort((a,b)=>b[1]-a[1]);
    return {equipmentId:e.id,name:e.name,isReference:e.id===referenceId,failureSeconds,microStopSeconds,ownStopSeconds,starvedSeconds,blockedSeconds,
      minorFailureSeconds,majorFailureSeconds,generalFailureSeconds,minorFailureCount,majorFailureCount,generalFailureCount,stopDataCoverage,
      reliabilityAssessment:equipmentReliabilityAssessment(e,simulation.dynamicConfig),
      failureCount,microStopCount,countBasis:rounds>1?'MEAN_PER_REPLICATION':'RECORDED_RUN',
      failureCategories:['general','minor','major'].map(kind=>({kind:kind.toUpperCase(),count:read(kind+'FailureCount'),seconds:read(kind+'FailureSeconds')})),
      reliabilityExposureSeconds:read('reliabilityExposureSeconds'),
      waitingForPrimeSeconds:read('waitingForPrimeSeconds'),backupStopSeconds:read('backupStopSeconds'),dominantLoss:causes[0]?.[1]>0?causes[0][0]:'NONE',
      ownStopPercent:ownStopSeconds===null?null:100*ownStopSeconds/durationSeconds,
      starvationPercent:starvedSeconds===null?null:100*starvedSeconds/durationSeconds,
      blockingPercent:blockedSeconds===null?null:100*blockedSeconds/durationSeconds,
      dataCoverage:{ownStopDuration:ownStopSeconds!==null,failureCount:failureCount!==null,microStopCount:microStopCount!==null,
        declaredStopClasses:stopDataCoverage.mode==='SPLIT',classSpecificAnalysis:stopDataCoverage.classSpecificAnalysisAvailable}};
  });
  function rank(field,basis){return rows.filter(row=>row[field]!==null).slice().sort((a,b)=>b[field]-a[field]||a.equipmentId.localeCompare(b.equipmentId)).map((row,index)=>({rank:index+1,equipmentId:row.equipmentId,name:row.name,value:row[field],basis,...(basis==='DURATION_SECONDS'?{percentOfRun:100*row[field]/durationSeconds}:{countBasis:row.countBasis})}));}
  const rankings={ownStopDuration:rank('ownStopSeconds','DURATION_SECONDS'),failureDuration:rank('failureSeconds','DURATION_SECONDS'),microStopDuration:rank('microStopSeconds','DURATION_SECONDS'),
    minorFailureDuration:rank('minorFailureSeconds','DURATION_SECONDS'),majorFailureDuration:rank('majorFailureSeconds','DURATION_SECONDS'),generalFailureDuration:rank('generalFailureSeconds','DURATION_SECONDS'),
    minorFailureFrequency:rank('minorFailureCount','OBSERVED_EVENT_COUNT'),majorFailureFrequency:rank('majorFailureCount','OBSERVED_EVENT_COUNT'),generalFailureFrequency:rank('generalFailureCount','OBSERVED_EVENT_COUNT'),
    starvationDuration:rank('starvedSeconds','DURATION_SECONDS'),blockingDuration:rank('blockedSeconds','DURATION_SECONDS'),waitingForPrimeDuration:rank('waitingForPrimeSeconds','DURATION_SECONDS'),backupStopDuration:rank('backupStopSeconds','DURATION_SECONDS'),failureFrequency:rank('failureCount','OBSERVED_EVENT_COUNT'),microStopFrequency:rank('microStopCount','OBSERVED_EVENT_COUNT')};
  const opportunities=[];
  for(const row of rows){
    const base={equipmentId:row.equipmentId,name:row.name,evidenceLevel:'HYPOTHESIS',causalStatus:'NOT_ESTABLISHED'};
    if(row.waitingForPrimeSeconds>0||row.backupStopSeconds>0)opportunities.push({...base,kind:'SENSOR_CONTROL_AND_FLOW_RECOVERY',
      observed:{waitingForPrimeSeconds:row.waitingForPrimeSeconds,backupStopSeconds:row.backupStopSeconds},
      mechanismsToTest:['NORMAL_PACKAGE_PULSE','BACKUP_DEBOUNCE','PRIME_RESERVE','FLOW_BALANCE'],
      interpretation:'Waiting for Prime and Back-up can be propagated control losses. Check actual passage time, buffer geometry and matched simulation sensitivity before attributing the loss.'});
    if(row.failureSeconds>0)opportunities.push({...base,kind:'INTERNAL_STOP_REDUCTION',observed:{failureSeconds:row.failureSeconds,failureCount:row.failureCount,
      minorFailureSeconds:row.minorFailureSeconds,majorFailureSeconds:row.majorFailureSeconds,generalFailureSeconds:row.generalFailureSeconds},
      targetScope:row.stopDataCoverage.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED',
      mechanismsToTest:['MTBF','MTTR'],requiredEvidence:['Failure-mode history with class and cause','Paired line-output counterfactual','Achievable intervention target'],
      interpretation:'Reliability stop exposure identifies a hypothesis. Aggregate MTBF/MTTR changes affect all configured stop classes; they do not alter the separate MICRO_STOP process or determine an intervention category.'});
    if((row.minorFailureSeconds||0)+(row.microStopSeconds||0)>0)opportunities.push({...base,kind:'SHORT_STOP_FLOW_RECOVERY',
      observed:{minorFailureSeconds:row.minorFailureSeconds,microStopSeconds:row.microStopSeconds},mechanismsToTest:['SENSOR_CONTROL','FLOW_BALANCE','EXISTING_BUFFER_RECOVERY'],
      interpretation:'Test recovery and propagation around declared minor stops or the separate MICRO_STOP process. Sensor and speed adjustments do not directly improve modeled failure MTBF/MTTR or eliminate stop events.'});
    if(row.majorFailureSeconds>0)opportunities.push({...base,kind:'MAJOR_STOP_CAUSE_REVIEW',observedSeconds:row.majorFailureSeconds,
      mechanismsToTest:['CAUSE_STRATIFICATION','DOCUMENTED_INTERVENTION'],requiredEvidence:['Stop cause and internal/external origin','Maintenance history or replacement target'],
      interpretation:'A declared major stop is not proof of an external cause, irreparable equipment or a replacement requirement. CAPEX follows the supported intervention scope.'});
    if(row.stopDataCoverage.mode==='GENERAL')opportunities.push({...base,kind:'STOP_CLASS_DATA_REQUIRED',observedSeconds:row.generalFailureSeconds,
      requiredEvidence:['Separate minor and major stop frequencies and durations on the same operating exposure','Cause and internal/external origin'],
      interpretation:'General inputs remain usable for line-flow experiments. Class-specific conclusions require measured or explicitly documented classes; no split is inferred from the aggregate MTTR.'});
    if(row.starvedSeconds>0)opportunities.push({...base,kind:'UPSTREAM_SUPPLY_OR_BUFFER',observedSeconds:row.starvedSeconds,mechanismsToTest:['UPSTREAM_CAPACITY','UPSTREAM_RELIABILITY','BUFFER_RECOVERY','SENSOR_CONTROL'],interpretation:'Missing input may be propagated from upstream. Starvation does not prove a fault in this equipment.'});
    if(row.blockedSeconds>0)opportunities.push({...base,kind:'DOWNSTREAM_CAPACITY_OR_BUFFER',observedSeconds:row.blockedSeconds,mechanismsToTest:['DOWNSTREAM_CAPACITY','DOWNSTREAM_RELIABILITY','BUFFER_RECOVERY','SENSOR_CONTROL'],interpretation:'Restricted discharge may be propagated from downstream. Blocking does not prove a fault in this equipment.'});
  }
  return {status:rows.some(r=>r.failureSeconds!==null||r.microStopSeconds!==null||r.starvedSeconds!==null||r.blockedSeconds!==null)?'OBSERVED':'MISSING_METRICS',sourceStatus:'CURRENT',referenceId,durationSeconds,durationBasis,rounds,equipment:rows,rankings,opportunities,
    stopDataQuality:{splitEquipmentIds:rows.filter(row=>row.stopDataCoverage.mode==='SPLIT').map(row=>row.equipmentId),
      generalEquipmentIds:rows.filter(row=>row.stopDataCoverage.mode==='GENERAL').map(row=>row.equipmentId),
      classSpecificEquipmentIds:rows.filter(row=>row.stopDataCoverage.classSpecificAnalysisAvailable).map(row=>row.equipmentId),
      splitInferred:false,scope:'STOP_CLASSES_NOT_ROOT_CAUSES',flowOptimizationRequiresSplit:false},
    attribution:{additive:false,basis:'OBSERVED_EQUIPMENT_STATES',causalStatus:'NOT_ESTABLISHED',countsInferred:false},
    interpretation:'Observed losses and possible propagation paths; inactivity alone does not establish a line bottleneck. Equipment losses overlap and are not additive global OEE contributions. Event counts are reported only when recorded. MINOR/MAJOR reliability classes and the independent MICRO_STOP process are retained separately; general stops are not split or assigned a cause.'};
}
function scenarioLossEvidence(simulation,diagnosis,equipment,kind){
  if(diagnosis.status!=='OBSERVED')return {priorityBonus:0};
  const index=simulation.equipment.findIndex(e=>e.id===equipment.id),referenceIndex=simulation.equipment.findIndex(e=>e.id===diagnosis.referenceId);
  const ids=equipment.type==='CONVEYOR'?[simulation.equipment[index-1]?.id,simulation.equipment[index+1]?.id]:[equipment.id];
  const local=diagnosis.equipment.filter(r=>ids.includes(r.equipmentId)),reference=diagnosis.equipment.find(r=>r.isReference);
  const reliabilityTarget=kind==='RELIABILITY_INTERVENTION';
  const seconds=local.reduce((sum,r)=>sum+(reliabilityTarget?(r.failureSeconds||0):(r.minorFailureSeconds||0)+(r.microStopSeconds||0))+(r.starvedSeconds||0)+(r.blockedSeconds||0)+(reliabilityTarget?0:(r.waitingForPrimeSeconds||0)+(r.backupStopSeconds||0)),0);
  const direction=index<referenceIndex?'UPSTREAM':index>referenceIndex?'DOWNSTREAM':'REFERENCE';
  const referenceLoss=direction==='UPSTREAM'?reference?.starvedSeconds:direction==='DOWNSTREAM'?reference?.blockedSeconds:0;
  const bonus=Math.min(30,seconds/diagnosis.durationSeconds*20+(referenceLoss||0)/diagnosis.durationSeconds*20);
  return {priorityBonus:bonus,priorityBasis:reliabilityTarget?'RELIABILITY_FAILURE_EXPOSURE_AND_PROPAGATION':'MINOR_STOP_EXPOSURE_AND_FLOW_PROPAGATION',
    observedLosses:local,referenceInteraction:{direction,seconds:referenceLoss||0},
    reliabilityPriority:reliabilityTarget,interpretation:reliabilityTarget?'Diagnostic priority for documented reliability interventions, not a demonstrated causal gain.':
      'Flow priority uses declared minor stops, the separate MICRO_STOP process and propagated starvation/blocking. Major and unclassified own-stop durations do not boost this priority. Flow adjustments do not directly change reliability stop parameters or establish the origin of propagated losses.'};
}
// Opportunity screening does not create undocumented implementation targets.
function scenarioProposalNeeds(simulation){
  const equipment=scenarioEngineeringEquipment(simulation),product=scenarioActiveProduct(simulation),line=analyzeLinePerformance(equipment,null),reference=line.points.find(p=>p.isPacemaker),options=(simulation.whatIf?.externalOptions||[]).filter(o=>{try{if(!o.changes?.length||!o.changes.every(c=>scenarioCategoryAllows(c,o.tier)))return false;applyScenarioChanges(simulation,o.changes);return true;}catch(_){return false;}}).flatMap(o=>o.changes),needs=[];
  if(!reference)return needs;
  const factors=new Map(equipment.map(item=>[item.id,product?productUnitFactor(item,product):1]));
  const referenceBpm=reference.configuredBpm*factors.get(reference.id);
  for(const point of line.points){
    const unit=equipment.find(e=>e.id===point.id),r=unit.noiseProfile?.reliability;
    // Compare like units without rewriting installed/native machine limits.
    const configuredBpm=point.configuredBpm*factors.get(point.id),maximumBpm=point.maximumBpm===null?null:point.maximumBpm*factors.get(point.id);
    const hasCapacity=options.some(c=>c.equipmentId===point.id&&c.replacementMaximumBpm!==undefined);
    if(!point.isPacemaker&&configuredBpm<referenceBpm-1e-6&&(!maximumBpm||maximumBpm<referenceBpm)&&!hasCapacity)needs.push({kind:'CAPACITY_TARGET_REQUIRED',equipmentId:point.id,name:point.name,configuredBpm,installedMaximumBpm:maximumBpm,referenceBpm,requiredInput:'Documented replacement operating speed, new maximum capacity and source. No target is inferred from the reference.'});
    if(simulation.dynamicConfig?.reliabilityEnabled!==false&&r?.mtbfMinutes>0&&r?.mttrMinutes>0){
      const availability=r.mtbfMinutes/(r.mtbfMinutes+r.mttrMinutes),effective=configuredBpm*availability;
      const hasReliability=options.some(c=>c.equipmentId===point.id&&c.path.startsWith('noiseProfile.reliability.'));
      if(effective<referenceBpm-1e-6&&!hasReliability)needs.push({kind:'RELIABILITY_TARGET_REQUIRED',equipmentId:point.id,name:point.name,availabilityPercent:100*availability,availabilityOnlyBpm:effective,referenceBpm,requiredInput:'Evaluate sensitivity, then supply an achievable MTBF/MTTR target, intervention type and source. Availability-only capacity is screening, not simulated throughput.'});
    }
  }
  return needs.sort((a,b)=>(a.availabilityOnlyBpm??a.configuredBpm)-(b.availabilityOnlyBpm??b.configuredBpm));
}
function planScenarios(simulation){
  const audit=scenarioAudit(simulation),engineeringEquipment=scenarioEngineeringEquipment(simulation),diagnosis=diagnoseScenarioLosses(simulation);
  const capacityDiagnosis=diagnoseLineEfficiency(simulation.equipment,diagnosis.status==='OBSERVED'?simulation.results:null);
  const result=diagnosis.status==='OBSERVED'?simulation.results:null;
  const candidates=[],checks=[];
  const equipmentReliability=(simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR'&&e.processData?.role!=='CONVEYOR').map(e=>equipmentReliabilityAssessment(e,simulation.dynamicConfig));
  equipmentReliability.forEach(r=>checks.push({equipmentId:r.equipmentId,rule:'EQUIPMENT_RELIABILITY',status:r.status==='NOT EVALUATED'?'NOT_EVALUATED':r.status,assessment:r,interpretation:'Engineering screening thresholds; not a replacement mandate.'}));
  function add(kind,tier,equipment,changes,evidence,priority,basis){
    changes=changes.filter(c=>c.before!==c.after);if(!changes.length)return;
    let disabledReason=null;try{applyScenarioChanges(simulation,changes);}catch(error){disabledReason=error.message;}
    const losses=scenarioLossEvidence(simulation,diagnosis,equipment,kind);evidence={...evidence,...losses,
      reliabilityParametersChanged:changes.some(change=>change.path.startsWith('noiseProfile.reliability.')),
      classificationBasis:'INTERVENTION_SCOPE',budgetUsed:false};priority+=losses.priorityBonus;if(diagnosis.status==='OBSERVED')basis='HYBRID';
    candidates.push({id:kind+':'+equipment.id,kind,tier,titleKey:'scenario.'+kind.toLowerCase(),equipmentId:equipment.id,equipmentName:equipment.name,changes,evidence,priority,basis,canApply:!disabledReason,disabledReason,sourceSimulationId:simulation.id,sourceSignature:scenarioSignature(simulation)});
  }
  audit.forEach(item=>{
    const e=simulation.equipment.find(x=>x.id===item.equipmentId),engineering=item.engineering;
    const zone=resolveAccumulationZoneDefinition(engineeringEquipment,simulation.equipment.indexOf(e)).definition;
    // An isolated package must not be mistaken for a continuously blocked
    // photoeye. Use the actual resolved belt velocity and package length,
    // independently of the completeness of the worksheet engineering audit.
    const delayPath='processData.accumulation.blockedTimeDelaySeconds';
    const blockedDelay=scenarioGet(e,delayPath);
    const normalPulse=zone?.productLengthMm>0&&zone?.conveyorSpeedMmPerSecond>0
      ?zone.productLengthMm/zone.conveyorSpeedMmPerSecond:null;
    const pulseConflict=Number.isFinite(normalPulse)&&Number.isFinite(blockedDelay)&&blockedDelay>=0&&
      Number.isFinite(zone?.backupSensorPositionMm)&&zone.backupSensorPositionMm>=0&&
      zone.backupSensorPositionMm<=zone.usableLengthMm&&blockedDelay<=normalPulse+1e-9;
    if(pulseConflict){
      // A small explicit screening margin, not a validated PLC setting.
      const target=Math.ceil((normalPulse+.15)*10)/10;
      const measuredZone=Object.values(result?.accumulationZoneMetrics||{}).find(z=>z.ownerEquipmentId===e.id);
      if(target<=SCENARIO_FIELDS[delayPath][1])add('SENSOR_DEBOUNCE','ZERO',e,[scenarioChange(e,delayPath,target)],{
        targetBasis:'ACTUAL_PACKAGE_PASS_TIME',pulseSeconds:normalPulse,blockedDelaySeconds:blockedDelay,
        proposedDelaySeconds:target,screeningMarginSeconds:.15,actualBeltSpeedMmPerSecond:zone.conveyorSpeedMmPerSecond,
        packageLengthMm:zone.productLengthMm,backupTriggerCount:measuredZone?.backupTriggerCount??null,
        backupPassedUnits:measuredZone?.backupPassedUnits??null,counterBasis:'REPRESENTATIVE_ROUND_IF_AVAILABLE',
        engineeringReviewRequired:true,interpretation:'Hypothesis: normal package pulses may trigger Back-up. Confirm PLC response, installed sensor location, stopping distance and overflow reserve before changing a plant setting.'
      },110,'STATIC');
      checks.push({equipmentId:e.id,rule:'ACTUAL_SENSOR_PULSE',status:'REVIEW',pulseSeconds:normalPulse,blockedDelaySeconds:blockedDelay,targetSeconds:target});
    }
    if(!engineering){checks.push({equipmentId:e.id,rule:'GEOMETRY',status:'NOT_EVALUATED'});return;}
    const input=engineering.input,c=engineering.calculated;
    checks.push(...engineering.audit.goals.map(g=>({equipmentId:e.id,rule:g.id,status:g.status})));
    const speed=c.recommendedConveyorSpeedFactorPercent;
    if(e.processData?.accumulation?.speedMode==='MANUAL'&&Number.isFinite(c.recommendedInfeedConveyorSpeedMmPerSecond))add('SPEED_BALANCE','ZERO',e,[scenarioChange(e,'processData.accumulation.conveyorSpeedMmPerSecond',c.recommendedInfeedConveyorSpeedMmPerSecond)],{recommendedSpeedMmPerSecond:c.recommendedInfeedConveyorSpeedMmPerSecond},64,'STATIC');
    if(e.processData?.accumulation?.speedMode!=='MANUAL'&&Number.isFinite(speed)&&speed>=0&&Math.abs(speed-input.conveyorSpeedFactorPercent)>=.25){
      add('SPEED_BALANCE','ZERO',e,[scenarioChange(e,'processData.accumulation.conveyorSpeedFactorPercent',Number(speed.toFixed(2)))],{recommendedSpeedMmPerSecond:c.recommendedInfeedConveyorSpeedMmPerSecond},64,'STATIC');
    }
    if(!pulseConflict&&scenarioGoal(engineering,'SENSOR_DEBOUNCE')==='WARNING'&&Number.isFinite(c.packagePassSensorSeconds)&&Number.isFinite(c.sensorClearGapSeconds)){
      const greater=v=>Math.ceil((v+.01)*100)/100;
      add('SENSOR_DEBOUNCE','ZERO',e,[scenarioChange(e,'processData.accumulation.blockedTimeDelaySeconds',Math.max(input.blockedTimeDelaySeconds,greater(c.packagePassSensorSeconds))),scenarioChange(e,'processData.accumulation.clearTimeDelaySeconds',Math.max(input.clearTimeDelaySeconds,greater(c.sensorClearGapSeconds)))],{pulseSeconds:c.packagePassSensorSeconds,gapSeconds:c.sensorClearGapSeconds},82,'STATIC');
    }
    // Search existing sensor locations on every supported conveyor, even when
    // worksheet targets pass. These are hypotheses, not promised gains.
    if(zone?.usableLengthMm>0){
      const bound=Math.min(zone.usableLengthMm,zone.primeSensorPositionMm,zone.backupRestartPositionMm??Infinity),current=e.processData?.accumulation?.backupSensorPositionMm;
      const engineeringTargetAvailable=Number.isFinite(c.recommendedBackupSensorPositionMm);
      let backup=engineeringTargetAvailable?Math.min(c.recommendedBackupSensorPositionMm,bound):NaN;
      // A missing worksheet speed factor must not remove an installed sensor
      // from the search. Reuse its bounded range as an explicit hypothesis;
      // do not fill in the missing engineering data or claim a calculated target.
      if(!engineeringTargetAvailable&&Number.isFinite(current)&&current>=0&&current<=bound&&
        Number.isFinite(zone.primeSensorPositionMm)&&zone.primeSensorPositionMm<=zone.usableLengthMm&&
        (zone.backupRestartPositionMm===undefined||Number.isFinite(zone.backupRestartPositionMm)&&zone.backupRestartPositionMm<=zone.usableLengthMm))backup=current*.5;
      if(backup===e.processData?.accumulation?.backupSensorPositionMm)backup=Math.min(zone.primeSensorPositionMm,zone.backupRestartPositionMm??Infinity)*.5;
      if(Number.isFinite(backup)&&backup>=0)add('SENSOR_POSITION','ZERO',e,[scenarioChange(e,'processData.accumulation.backupSensorPositionMm',Math.min(bound,Number(backup.toFixed(2))))],{installedLengthMm:zone.usableLengthMm,engineeringTargetAvailable,targetBasis:engineeringTargetAvailable?'ENGINEERING_TARGET':'EXISTING_SENSOR_RANGE'},75,'STATIC');
    }
    if(zone?.usableLengthMm>0&&e.processData?.geometry?.lpPrimeMm>0){
      add('SENSOR_WINDOW','ZERO',e,[scenarioChange(e,'processData.geometry.lpPrimeMm',e.processData.geometry.lpPrimeMm*.5)],{installedLengthMm:zone.usableLengthMm},72,'STATIC');
    }
    const upstream=simulation.equipment.find(x=>x.id===item.upstreamId),stopData=scenarioStopDataCoverage(simulation,upstream);
    const minorMttr=stopData.enabledClasses.includes('MINOR')?upstream.processData.equipment.stopInputs.minor.mttrMinutes:null;
    const coverage=minorMttr>0&&Number.isFinite(c.antiStarveSeconds)?c.antiStarveSeconds/(minorMttr*60):null;
    checks.push({equipmentId:e.id,rule:'ACCUMULATION_1_TO_2_MTTR',status:coverage===null?'NOT_EVALUATED':coverage>=1&&coverage<=2?'PASS':'REVIEW',coverage,referenceEquipmentId:upstream?.id,
      stopClass:minorMttr>0?'MINOR':null,mttrMinutes:minorMttr,basis:minorMttr>0?'DECLARED_MINOR_STOP_MTTR':'MINOR_STOP_INPUT_REQUIRED',
      interpretation:'Buffer coverage uses the declared minor-stop MTTR. Aggregate MTTR is not classified as a microstop by a duration cutoff.'});
    const recoveryFailed=['INSTALLED_LENGTH','SMOOTH_RECOVERY','BACKUP_POSITION'].some(id=>['FAIL','WARNING'].includes(scenarioGoal(engineering,id)));
    const observedDownstream=diagnosis.equipment.find(r=>r.equipmentId===item.downstreamId);
    const observedStarvation=diagnosis.status==='OBSERVED'&&(observedDownstream?.starvedSeconds||0)>diagnosis.durationSeconds*.01;
    if(recoveryFailed||(coverage!==null&&coverage<1)||observedStarvation){
      const plan=scenarioRecoveryPlan(engineering,minorMttr>0?minorMttr*60:0);
      if(plan){
        const losses=result?.accumulationZoneMetrics&&Object.values(result.accumulationZoneMetrics).find(x=>x.ownerEquipmentId===e.id);
        if(plan.length>input.installedLengthMm){
          add('BUFFER_RECOVERY','HIGH',e,[scenarioChange(e,'processData.accumulation.backupSensorPositionMm',plan.backup),scenarioChange(e,'processData.geometry.lactMm',plan.length)],{recoveryLengthMm:c.recoveryLengthMm,requiredOverflowMm:c.overflowLengthMm,addedLengthMm:plan.length-input.installedLengthMm,coverage,
            bufferStopTarget:minorMttr>0?{stopClass:'MINOR',mttrMinutes:minorMttr,basis:'DECLARED_INPUT'}:null,overflowUnits:losses?.overflowUnits??null},96+(losses?.overflowUnits>0?5:0),losses?'HYBRID':'STATIC');
        }else{
          // Existing length plus a sensor adjustment is an operational change,
          // not a capital project merely because recovery sizing found it.
          if(!candidates.some(candidate=>candidate.kind==='SENSOR_POSITION'&&candidate.equipmentId===e.id))
            add('SENSOR_POSITION','ZERO',e,[scenarioChange(e,'processData.accumulation.backupSensorPositionMm',plan.backup)],{installedLengthMm:input.installedLengthMm,recoveryWithinInstalledLength:true},75,'STATIC');
          checks.push({equipmentId:e.id,rule:'RECOVERY_WITHIN_INSTALLED_LENGTH',status:'PASS',classification:'ZERO',addedLengthMm:0});
        }
      }
    }
    // The supplied design brief requires data not present in the current import contract.
    checks.push({equipmentId:e.id,rule:'TURN_TRAP_AND_FILLED_DIAMETER',status:'NOT_EVALUATED'});
  });
  (simulation.equipment||[]).filter(e=>e.type!=='CONVEYOR').forEach(e=>{
    const r=e.noiseProfile?.reliability;if(!(r?.mtbfMinutes>0&&r?.mttrMinutes>0))return;
    const stopData=scenarioStopDataCoverage(simulation,e);
    if(stopData.mode==='GENERAL')checks.push({equipmentId:e.id,rule:'STOP_CLASS_BREAKDOWN_REQUIRED_FOR_TARGETED_DIAGNOSIS',status:'NOT_EVALUATED',
      blocksFlowOptimization:false,interpretation:'Supply minor/major data to target a stop class. General reliability remains usable; its mean duration is not a class or cause.'});
    if(stopData.enabledClasses.includes('MAJOR'))checks.push({equipmentId:e.id,rule:'MAJOR_STOPS_REQUIRE_CAUSE_AND_INTERVENTION_REVIEW',status:'REVIEW',
      replacementRequired:null,interpretation:'A declared major stop does not determine its external/internal cause or the intervention category.'});
    if(stopData.enabledClasses.includes('MINOR')&&e.processData.equipment.stopInputs.minor.mttrMinutes>SCENARIO_POLICY.microstopLimitMinutes)checks.push({equipmentId:e.id,
      rule:'LONG_DECLARED_MINOR_STOP_BUFFER_TARGET',status:'REVIEW',stopClass:'MINOR',interpretation:'Review the long declared minor-stop buffer target; the input is not reclassified by duration.'});
  });
  analyzeLinePerformance(simulation.equipment,result).points.forEach(point=>{
    if(point.isPacemaker||!(point.maximumBpm>0)||!(point.recommendedBpm>0))return;
    const equipment=simulation.equipment.find(e=>e.id===point.id),target=Math.min(point.maximumBpm,point.recommendedBpm)/60;
    add('V_CURVE','ZERO',equipment,[scenarioChange(equipment,'nominalRatePerSecond',target)],{maximumBpm:point.maximumBpm,recommendedBpm:point.recommendedBpm},70,'STATIC');
  });
  checks.push({rule:'PACEMAKER_DESIRED_STATE_AND_V_GRAPH',status:'NOT_EVALUATED'});
  (simulation.whatIf?.externalOptions||[]).forEach(option=>{
    if(simulation.dynamicConfig?.reliabilityEnabled===false&&option.changes?.some(c=>c.path.startsWith('noiseProfile.reliability.')))return;
    if(!['ZERO','MEDIUM','HIGH'].includes(option.tier)||!option.changes?.length||!option.changes.every(c=>scenarioCategoryAllows(c,option.tier)))return;
    const equipment=simulation.equipment.find(e=>e.id===option.changes[0].equipmentId);if(!equipment)return;
    add(option.changes.some(c=>c.replacementMaximumBpm!==undefined)?'CAPACITY_REPLACEMENT':'RELIABILITY_INTERVENTION',option.tier,equipment,option.changes,{targetSource:'USER_DOCUMENTED',interventionType:option.changes[0].interventionType,costClass:SCENARIO_INTERVENTIONS[option.changes[0].interventionType]?.costClass,interpretation:'Supported intervention hypothesis; dynamic benefit and shifted constraints require evaluation.'},option.changes.some(c=>c.replacementMaximumBpm!==undefined)&&capacityDiagnosis.limitingEquipment.some(e=>e.id===equipment.id)?120:90,'STATIC');
  });
  const projects=['ZERO','MEDIUM','HIGH'].map(tier=>{
    const choices=candidates.filter(p=>p.tier===tier).sort((a,b)=>Number(b.canApply)-Number(a.canApply)||b.priority-a.priority);
    return choices[0]||{tier,canApply:false,titleKey:'scenario.no_proposal',basis:'STATIC',changes:[],evidence:{},disabledReason:'SCENARIO_INSUFFICIENT_EVIDENCE'};
  });
  return {sourceReadiness:scenarioSourceReadiness(simulation),proposalNeeds:scenarioProposalNeeds(simulation),equipmentReliability,capacityDiagnosis,definitions:SCENARIO_DEFINITIONS,interventions:SCENARIO_INTERVENTIONS,reliabilityOpportunities:reliabilitySensitivityCandidates(simulation),projects,checks,candidates,diagnosis,hasDynamicEvidence:diagnosis.status==='OBSERVED'};
}



// Dependency-free statistics for independent seed replications, not simulation ticks.
// Student intervals invert the incomplete-beta t distribution (no normal approximation).
// A repeated deterministic result is descriptive evidence; zero sample variance does
// not identify the stochastic variance and therefore does not yield a p-value or CI.

function scenarioLogGamma(value) {
  const coefficients=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.6150291621406,12.507343278686905,-.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
  if(value<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*value))-scenarioLogGamma(1-value);
  const z=value-1;
  let sum=.9999999999998099;
  for(let i=0;i<coefficients.length;i++)sum+=coefficients[i]/(z+i+1);
  const t=z+7.5;
  return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(sum);
}

function scenarioBetaFraction(a,b,x) {
  const tiny=1e-300;
  let c=1,d=1-(a+b)*x/(a+1);
  if(Math.abs(d)<tiny)d=tiny;
  d=1/d;
  let h=d;
  for(let m=1;m<=500;m++) {
    let term=m*(b-m)*x/((a+2*m-1)*(a+2*m));
    d=1+term*d;if(Math.abs(d)<tiny)d=tiny;
    c=1+term/c;if(Math.abs(c)<tiny)c=tiny;
    d=1/d;h*=d*c;
    term=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
    d=1+term*d;if(Math.abs(d)<tiny)d=tiny;
    c=1+term/c;if(Math.abs(c)<tiny)c=tiny;
    d=1/d;
    const delta=d*c;h*=delta;
    if(Math.abs(delta-1)<2e-14)break;
  }
  return h;
}

function scenarioRegularizedBeta(x,a,b) {
  if(x<=0)return 0;
  if(x>=1)return 1;
  const front=Math.exp(scenarioLogGamma(a+b)-scenarioLogGamma(a)-scenarioLogGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  const value=x<(a+1)/(a+b+2)?front*scenarioBetaFraction(a,b,x)/a:1-front*scenarioBetaFraction(b,a,1-x)/b;
  return Math.max(0,Math.min(1,value));
}

function scenarioFDistributionSurvival(f,df1,df2) {
  if(!(typeof f==='number'&&f>=0&&Number.isFinite(df1)&&df1>0&&Number.isFinite(df2)&&df2>0))return null;
  if(f===0)return 1;
  if(f===Infinity)return 0;
  return scenarioRegularizedBeta(df2/(df2+df1*f),df2/2,df1/2);
}

function scenarioStudentTPValue(t,df) {
  if(typeof t!=='number'||Number.isNaN(t)||!Number.isFinite(df)||df<=0)return null;
  if(t===0)return 1;
  return scenarioRegularizedBeta(df/(df+t*t),df/2,.5);
}

function scenarioStudentTCritical(confidenceLevel=.95,df) {
  if(!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1||!Number.isFinite(df)||df<=0)return null;
  const tail=1-confidenceLevel;
  let low=0,high=1;
  while(scenarioStudentTPValue(high,df)>tail&&high<1e150)high*=2;
  if(scenarioStudentTPValue(high,df)>tail)return null;
  for(let iteration=0;iteration<100;iteration++) {
    const mid=(low+high)/2;
    if(scenarioStudentTPValue(mid,df)>tail)low=mid;else high=mid;
    if(high-low<=2e-14*Math.max(1,mid))break;
  }
  return (low+high)/2;
}

function scenarioMeanSummary(values,options={}) {
  const confidenceLevel=options.confidenceLevel??options.confidence??.95;
  if(!Array.isArray(values)||values.length<2||values.some(value=>!Number.isFinite(value)))return null;
  const n=values.length,df=n-1,tCritical=scenarioStudentTCritical(confidenceLevel,df);
  if(tCritical===null)return null;
  // Center first to keep small differences accurate beside a large throughput offset.
  const origin=values[0],offset=values.reduce((sum,value)=>sum+(value-origin)/n,0),mean=origin+offset;
  const roundingFloor=32*Number.EPSILON*Math.max(1,...values.map(value=>Math.abs(value)));
  const zeroVariance=values.every(value=>Math.abs((value-origin)-offset)<=roundingFloor);
  const sumSquares=zeroVariance?0:values.reduce((sum,value)=>sum+((value-origin)-offset)**2,0);
  const standardDeviation=Math.sqrt(sumSquares/df),standardError=standardDeviation/Math.sqrt(n);
  if(!Number.isFinite(mean)||!Number.isFinite(standardDeviation))return null;
  const halfWidth=zeroVariance?null:tCritical*standardError;
  return {n,mean,standardDeviation,standardError,lower:halfWidth===null?null:mean-halfWidth,upper:halfWidth===null?null:mean+halfWidth,df,halfWidth,tCritical,confidenceLevel,zeroVariance,inferenceAvailable:!zeroVariance,reason:zeroVariance?'ZERO_OBSERVED_VARIANCE':null};
}

// Missing/untestable hypotheses retain their place in the planned family. Holm
// remains valid with correlated contrasts and does not claim simultaneous CIs.
function scenarioHolmAdjust(pValues) {
  if(!Array.isArray(pValues))return [];
  const result=pValues.map(()=>null),familySize=pValues.length;
  const ordered=pValues.map((p,index)=>({p,index})).filter(row=>Number.isFinite(row.p)&&row.p>=0&&row.p<=1).sort((a,b)=>a.p-b.p);
  let previous=0;
  ordered.forEach((row,index)=>{previous=Math.max(previous,Math.min(1,(familySize-index)*row.p));result[row.index]=previous;});
  return result;
}

function scenarioPairedSummary(base,candidate,options={}) {
  const confidenceLevel=options.confidenceLevel??options.confidence??.95;
  const a=base?.roundMetrics,b=candidate?.roundMetrics;
  const result={available:false,reason:null,n:Array.isArray(a)?a.length:0,metrics:{throughput:null,oee:null},metricReasons:{throughput:null,oee:null},confidenceLevel,seedIds:[],method:'PAIRED_SEED_DIFFERENCES',interpretation:'Intervals describe simulation replication uncertainty conditional on the model and inputs; independent seed streams and approximately normal mean differences are assumed.'};
  if(!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1)return {...result,reason:'INVALID_CONFIDENCE_LEVEL'};
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||a.length<2)return {...result,reason:'MATCHED_REPLICATIONS_REQUIRED'};
  if(a.some(row=>!Number.isFinite(row?.seed))||b.some(row=>!Number.isFinite(row?.seed)))return {...result,reason:'INVALID_SEED_IDS'};
  if(new Set(a.map(row=>row.seed)).size!==a.length||new Set(b.map(row=>row.seed)).size!==b.length)return {...result,reason:'DUPLICATE_SEED_IDS'};
  const bySeed=new Map(b.map(row=>[row.seed,row]));
  if(a.some(row=>!bySeed.has(row.seed)))return {...result,reason:'SEED_IDS_DO_NOT_MATCH'};
  result.seedIds=a.map(row=>row.seed);
  for(const metric of ['throughput','oee']) {
    if(a.some(row=>!Number.isFinite(row[metric])||!Number.isFinite(bySeed.get(row.seed)[metric]))) {
      result.metricReasons[metric]='MISSING_OR_NONFINITE_METRICS';
      continue;
    }
    const summary=scenarioMeanSummary(a.map(row=>bySeed.get(row.seed)[metric]-row[metric]),{confidenceLevel});
    result.metrics[metric]=summary;
    result.metricReasons[metric]=summary?.reason??(summary?null:'NONFINITE_DIFFERENCES');
  }
  result.available=Object.values(result.metrics).some(value=>value!==null);
  result.reason=result.available?null:'MISSING_OR_NONFINITE_METRICS';
  return result;
}

function planScenarioReplications(base,candidate,options={}) {
  const confidenceLevel=options.confidenceLevel??options.confidence??.95;
  const minRounds=options.minRounds??3,maxRounds=options.maxRounds??30,relativePrecision=options.relativePrecision??.005;
  const result={rounds:null,requiredRounds:null,capped:false,status:null,targetHalfWidth:null,pilotSeeds:[],pilotRounds:0,confidenceLevel,minRounds,maxRounds,confirmationMustExcludePilotSeeds:true,method:'FIXED_SAMPLE_SIZE_FROM_SEPARATE_PILOT',interpretation:'Fix the confirmation size before examining its outcomes and use new seeds. Precision is planned from pilot variance; it is not guaranteed, and no optional significance stopping is allowed.'};
  if(!Number.isInteger(minRounds)||minRounds<3||!Number.isInteger(maxRounds)||maxRounds<minRounds||!Number.isFinite(confidenceLevel)||confidenceLevel<=0||confidenceLevel>=1)return {...result,status:'INVALID_OPTIONS'};
  const paired=scenarioPairedSummary(base,candidate,{confidenceLevel});
  result.pilotSeeds=paired.seedIds;result.pilotRounds=paired.n;
  if(Array.isArray(options.confirmationSeeds)&&options.confirmationSeeds.some(seed=>result.pilotSeeds.includes(seed)))return {...result,status:'PILOT_CONFIRMATION_SEEDS_OVERLAP'};
  const baselineValues=Array.isArray(base?.roundMetrics)?base.roundMetrics.map(row=>row?.throughput):null;
  const baselineMean=baselineValues?.length&&baselineValues.every(Number.isFinite)?baselineValues.reduce((sum,value)=>sum+value/baselineValues.length,0):null;
  result.baselineMeanThroughput=baselineMean;
  const target=options.absolutePrecision!==undefined?options.absolutePrecision:(Number.isFinite(relativePrecision)&&relativePrecision>0&&Number.isFinite(baselineMean)?Math.abs(baselineMean)*relativePrecision:null);
  if(!Number.isFinite(target)||target<=0)return {...result,status:'POSITIVE_PRECISION_REQUIRED'};
  result.targetHalfWidth=target;
  if(!paired.available||!paired.metrics.throughput||paired.n<3)return {...result,rounds:maxRounds,status:'INSUFFICIENT_PILOT_EVIDENCE',reason:paired.reason??paired.metricReasons.throughput??'THREE_PILOT_ROUNDS_REQUIRED'};
  const sd=paired.metrics.throughput.standardDeviation;
  result.pilotStandardDeviation=sd;
  if(sd===0)return {...result,rounds:Math.min(maxRounds,Math.max(minRounds,6)),status:'ZERO_PILOT_VARIANCE',reason:'Zero observed pilot variance does not establish absence of stochastic noise; confirm descriptively with new seeds.'};
  const halfWidth=rounds=>scenarioStudentTCritical(confidenceLevel,rounds-1)*sd/Math.sqrt(rounds);
  let low=minRounds-1,high=minRounds;
  // The cap is numerical, not a claim that a larger design has been calculated.
  const numericalLimit=Math.max(1000000,maxRounds);
  while(halfWidth(high)>target&&high<numericalLimit)high=Math.min(numericalLimit,high*2);
  if(halfWidth(high)>target)return {...result,rounds:maxRounds,capped:true,status:'PRECISION_TARGET_EXCEEDS_CAP',requiredRoundsLowerBound:numericalLimit+1,plannedHalfWidth:halfWidth(maxRounds)};
  while(high-low>1) {
    const mid=Math.floor((low+high)/2);
    if(halfWidth(mid)<=target)high=mid;else low=mid;
  }
  const rounds=Math.min(maxRounds,high);
  return {...result,rounds,requiredRounds:high,capped:high>maxRounds,status:high>maxRounds?'PRECISION_TARGET_EXCEEDS_CAP':'PLANNED',plannedHalfWidth:halfWidth(rounds)};
}


const SCENARIO_SEARCH_PROFILES = Object.freeze({
  LIGHT: {explorationSeconds:300,confirmationSeconds:1800,maxCandidates:48,maxSearchMs:120000,maxWithoutImprovement:16,maxFactors:0,passes:1,finalists:4,fullHorizonFinalists:2},
  MEDIUM: {explorationSeconds:600,confirmationSeconds:1800,maxCandidates:128,maxSearchMs:300000,maxWithoutImprovement:32,maxFactors:3,passes:2,finalists:6,fullHorizonFinalists:2},
  HIGH: {explorationSeconds:900,confirmationSeconds:1800,maxCandidates:256,maxSearchMs:600000,maxWithoutImprovement:48,maxFactors:4,passes:3,finalists:6,fullHorizonFinalists:3}
});
function scenarioSearchSettings(raw) {
  return {speedProfile:['FAST','BALANCED','THOROUGH'].includes(raw?.speedProfile)?raw.speedProfile:'BALANCED'};
}
function scenarioSearchSettingsSignature(raw) {
  return JSON.stringify(['SCENARIO_SEARCH_SPEED_V1',scenarioSearchSettings(raw)]);
}
function scenarioSearchProfile(level,settings,context) {
  const profile=SCENARIO_SEARCH_PROFILES[level]||SCENARIO_SEARCH_PROFILES.MEDIUM;
  // Execution budgets are independent of factor depth and statistical acceptance.
  // Balanced deliberately preserves the existing search, including its adaptive budget.
  let selected;switch(scenarioSearchSettings(settings).speedProfile){
    case 'FAST':selected={...profile,explorationSeconds:Math.min(300,profile.explorationSeconds),confirmationSeconds:900,maxCandidates:Math.min(48,profile.maxCandidates),passes:1,fullHorizonFinalists:1,hardCandidateLimit:true};break;
    case 'THOROUGH':selected={...profile,explorationSeconds:Math.min(1800,profile.explorationSeconds*2),confirmationSeconds:3600,maxCandidates:profile.maxCandidates*2,passes:profile.passes+1,fullHorizonFinalists:Math.min(4,profile.fullHorizonFinalists+1)};break;
    default:selected=profile;
  }
  const run=context?.run,equipment=context?.equipment;
  if(!run||run.reliabilityEnabled===false||!Array.isArray(equipment))return selected;
  const categories=run.reliabilityCategories||{};
  const mtbf=equipment.filter(e=>e.type!=='CONVEYOR').flatMap(e=>{
    const split=e.processData?.equipment?.stopInputs;
    if(split&&['minor','major'].some(k=>split[k]))return ['minor','major'].filter(k=>categories[k]!==false&&split[k]?.mttrMinutes>0).map(k=>split[k]?.mtbfMinutes);
    return categories.general!==false&&e.noiseProfile?.reliability?.mttrMinutes>0?[e.noiseProfile.reliability.mtbfMinutes]:[];
  }).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  if(!mtbf.length)return selected;
  const median=mtbf.length%2?mtbf[(mtbf.length-1)/2]:(mtbf[mtbf.length/2-1]+mtbf[mtbf.length/2])/2;
  const full=Number(run.durationSeconds);
  if(!(full>selected.explorationSeconds))return selected;
  const floor=Math.min(1800,Math.max(900,Math.ceil(2*median*60/300)*300));
  const exploration=Math.min(full,Math.max(selected.explorationSeconds,floor));
  const confirmation=Math.min(full,Math.max(selected.confirmationSeconds,Math.min(3600,2*exploration)));
  return {...selected,explorationSeconds:exploration,confirmationSeconds:confirmation,
    fullHorizonFinalists:Math.max(2,selected.fullHorizonFinalists),
    horizonBasis:'RELIABILITY_AWARE_SCREENING',medianMtbfMinutes:median};
}
function scenarioSearchRun(run,level,confirmation=false,rounds=3,settings,equipment) {
  const profile=scenarioSearchProfile(level,settings,{run,equipment});
  // Independent What-If horizons; replay configuration and scheduled commands stay intact.
  const copy={...run,durationMode:'FIXED',durationSeconds:confirmation==='validation'?Math.max(1800,Number(run.durationSeconds)||0):confirmation?profile.confirmationSeconds:profile.explorationSeconds,rounds};
  delete copy.shiftSeconds;delete copy.shiftHours;delete copy.shiftCount;
  // A runtime-target stop changes calendar exposure as the candidate improves.
  // What-If compares complete equal calendar horizons and records that choice.
  delete copy.effectiveRuntimeTargetSeconds;
  return copy;
}

// The intermediate screen selects where to spend simulation time; it never
// certifies a gain. Selection and independent confirmation retain the full day.
function planScenarioFinalistRanking(run,level,candidateCount,options={}) {
  const settings=scenarioSearchSettings(options.searchSettings),profile=scenarioSearchProfile(level,settings,{run,equipment:options.equipment}),fullRun=scenarioSearchRun(run,level,'validation',3,settings,options.equipment);
  const limit=Math.max(1,Math.min(candidateCount,Number.isInteger(options.fullHorizonFinalists)?options.fullHorizonFinalists:profile.fullHorizonFinalists));
  const screenRun=scenarioSearchRun(run,level,true,3,settings,options.equipment);
  // A short prefix does not represent an entire shift/calendar/product program.
  // Keep every finalist when the run has explicit changes over time.
  const scheduled=!!(run.commands?.length||resolvePlannedStops({...run,tickSeconds:run.tickSeconds??.25}).events.length);
  const reason=scheduled?'SCHEDULED_CONDITIONS_REQUIRE_FULL_HORIZON':fullRun.durationSeconds<=2*screenRun.durationSeconds?'SHORT_CONFIGURED_HORIZON':candidateCount<=limit?'WITHIN_FULL_HORIZON_BUDGET':null;
  return {policy:'STAGED_FINALIST_RANKING_V1',staged:!reason,reason,screenRun,fullRun,fullHorizonFinalists:reason?candidateCount:limit,
    screeningSeedOffset:50003,rankingSeedOffset:100003,confirmationSeedOffset:1000003,
    interpretation:'A bounded intermediate screen may omit a configuration whose benefit emerges later. Final recommendations still require full-horizon ranking and independent confirmation; this is not a global optimum search.'};
}

function selectScenarioFinalists(screened,baseline,limit) {
  const valid=screened.filter(item=>item?.changes?.length&&Number.isFinite(item.result?.throughput)&&Number.isFinite(item.result?.oee));
  // Compare paired gains only within the common intermediate horizon. Prefer
  // valid engineering, then observed OEE non-regression and throughput gain.
  const score=item=>item.result.throughput-baseline.throughput;
  valid.sort((a,b)=>Number(!!a.result.warnings?.length)-Number(!!b.result.warnings?.length)||Number(a.result.oee<baseline.oee-1e-9)-Number(b.result.oee<baseline.oee-1e-9)||score(b)-score(a));
  const chosen=[],combinations=new Set();
  const key=item=>item.changes.map(c=>c.equipmentId+':'+c.path).sort().join('|');
  function add(item){if(item&&!chosen.includes(item)){chosen.push(item);combinations.add(key(item));}}
  // Reliability interventions may show no event in a short prefix. Preserve
  // them for long-horizon review rather than declaring no benefit from silence.
  valid.filter(item=>item.changes.some(c=>c.path.startsWith('noiseProfile.reliability.'))).forEach(add);
  add(valid[0]);
  for(const item of valid)if(chosen.length<limit&&!combinations.has(key(item)))add(item);
  for(const item of valid)if(chosen.length<limit)add(item);
  return chosen;
}
function scenarioConfirmationNeedsMore(base,candidate) {
  const a=base?.roundMetrics,b=candidate?.roundMetrics;
  if(!a||!b||a.length!==3||b.length!==3)return false;
  const differences=b.map((row,i)=>row.throughput-a[i].throughput);
  const mean=differences.reduce((sum,value)=>sum+value,0)/3;
  const sd=Math.sqrt(differences.reduce((sum,value)=>sum+(value-mean)**2,0)/2);
  // Paired 95% t interval, df=2. Extra rounds are confirmation, never winner selection.
  return mean-4.3026527299*sd/Math.sqrt(3)<=Math.max(.001,Math.abs(base.throughput)*.001);
}

function scenarioPairedEvidence(base,candidate) {
  const a=base?.roundMetrics,b=candidate?.roundMetrics;
  if(!a||!b||a.length!==b.length||a.length<6||a.some((r,i)=>r.seed!==b[i].seed))return {stable:false,reason:'MATCHED_SIX_ROUNDS_REQUIRED'};
  const deltas=b.map((r,i)=>r.throughput-a[i].throughput);
  if(deltas.some(x=>!Number.isFinite(x)))return {stable:false,reason:'INVALID_METRICS'};
  const mean=deltas.reduce((s,x)=>s+x,0)/deltas.length;
  const sd=Math.sqrt(deltas.reduce((s,x)=>s+(x-mean)**2,0)/(deltas.length-1));
  // Six paired replications; conservative t critical also for larger sample counts.
  const lower=mean-2.5705818366*sd/Math.sqrt(deltas.length),split=Math.floor(deltas.length/2);
  const blockMeans=[deltas.slice(0,split),deltas.slice(split)].map(v=>v.reduce((s,x)=>s+x,0)/v.length);
  const threshold=Math.max(.001,Math.abs(base.throughput)*.001);
  return {mean,lower,blockMeans,threshold,rounds:deltas.length,stable:lower>threshold&&blockMeans.every(x=>x>threshold)&&candidate.oee>=base.oee-1e-9,interpretation:'Exploratory paired interval and two seed blocks; no multiple-comparison adjustment or plant guarantee.'};
}

// Decide the confirmation sample size from the finalist-ranking pilot before
// looking at the independent confirmation. No optional stopping on its p-value.
function planScenarioConfirmation(base,candidate,methodology={}) {
  const issue=scenarioComparisonEvidenceIssue(base,candidate);
  if(issue)return {rounds:null,status:issue,policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const baseSeeds=base.roundMetrics.map(row=>row.seed),candidateSeeds=candidate.roundMetrics.map(row=>row.seed);
  if(!scenarioValidConfirmationPilotSeeds(baseSeeds)||!scenarioValidConfirmationPilotSeeds(candidateSeeds)||baseSeeds.length!==candidateSeeds.length||baseSeeds.some(seed=>!candidateSeeds.includes(seed)))return {rounds:null,status:'INVALID_PILOT_REPLICATIONS',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};
  const settings=methodology?.replications||{};
  const options={minRounds:settings.minimum??3,maxRounds:settings.maximum??30,
    confidenceLevel:settings.confidenceLevel??.95,relativePrecision:settings.relativePrecision??.005};
  if(settings.absolutePrecision!==undefined)options.absolutePrecision=settings.absolutePrecision;
  const plan=planScenarioReplications(base,candidate,options);
  let minimumPracticalGain;
  try{minimumPracticalGain=scenarioPracticalGain({throughput:plan.baselineMeanThroughput,unitOfFlow:base.unitOfFlow},methodology||{});}catch(error){return {...plan,rounds:null,status:error.message||'INVALID_CONFIRMATION_OBJECTIVE',policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION'};}
  return {...plan,policy:'FIXED_SAMPLE_INDEPENDENT_CONFIRMATION',comparisonDurationSeconds:base.durationSeconds,comparisonUnitOfFlow:base.unitOfFlow,
    pilotRole:'FINALIST_RANKING_ONLY',minimumPracticalGain,
    interpretation:'Sample size is fixed using separate pilot seeds. A capped plan may not achieve the requested precision; input and model uncertainty are not estimated by replication.'};
}

function scenarioPracticalGain(base,methodology={}) {
  const objective=methodology.objective||{},supplied=objective.minimumPracticalGain;
  if(supplied!==undefined&&(!Number.isFinite(supplied)||supplied<0))throw Error('SCENARIO_INVALID_PRACTICAL_GAIN');
  // OEE targets are in percentage points and must never become flow-rate limits.
  if(objective.metric&& !['throughput','oee'].includes(objective.metric))throw Error('SCENARIO_INVALID_OBJECTIVE_METRIC');
  if(supplied!==undefined&&objective.metric!=='oee'&&objective.unit){
    const unit=base?.unitOfFlow||'units';
    if(objective.unit!==unit+'/min'&&!(unit==='bottles'&&objective.unit==='bpm'))throw Error('SCENARIO_INVALID_OBJECTIVE_UNIT');
  }
  return Math.max(.001,Math.abs(base?.throughput||0)*.001,objective.metric==='oee'?0:supplied??0);
}

function assessScenarioConfirmation(base,candidate,plan,methodology={}) {
  const planIssue=scenarioConfirmationPlanIssue(plan,methodology);
  const evidenceIssue=scenarioComparisonEvidenceIssue(base,candidate,plan);
  const statisticalEvidence=scenarioPairedSummary(base,candidate,{confidenceLevel:plan?.confidenceLevel??methodology?.replications?.confidenceLevel??.95});
  const threshold=planIssue?null:plan.minimumPracticalGain,throughput=statisticalEvidence.metrics?.throughput,oee=statisticalEvidence.metrics?.oee;
  const pilotSeeds=Array.isArray(plan?.pilotSeeds)?plan.pilotSeeds:[];
  const independent=statisticalEvidence.available&&!(statisticalEvidence.seedIds||[]).some(seed=>pilotSeeds.includes(seed));
  const complete=!planIssue&&!evidenceIssue&&statisticalEvidence.available&&statisticalEvidence.n===plan?.rounds&&independent;
  const inference=throughput?.inferenceAvailable!==false&&Number.isFinite(throughput?.lower)&&Number.isFinite(throughput?.upper);
  const descriptive=throughput?.reason==='ZERO_OBSERVED_VARIANCE'&&statisticalEvidence.n>=Math.min(6,plan?.rounds||6);
  const nonRegression=Number.isFinite(oee?.mean)&&oee.mean>=-1e-9;
  const passed=!!(complete&&nonRegression&&(inference?throughput.lower>threshold:descriptive&&throughput.mean>threshold));
  const halfWidth=inference?(throughput.upper-throughput.lower)/2:null;
  return {passed,kind:inference?'PAIRED_CONFIDENCE_INTERVAL':descriptive?'DESCRIPTIVE_REPRODUCTION':'INFERENCE_UNAVAILABLE',
    reason:planIssue||evidenceIssue||(!independent?'INDEPENDENT_SEEDS_REQUIRED':!complete?'INCOMPLETE_CONFIRMATION':!nonRegression?'OEE_REGRESSION':passed?null:inference?'PRACTICAL_GAIN_NOT_ESTABLISHED':'INFERENCE_UNAVAILABLE'),
    threshold,statisticalEvidence,oeeGuard:{observedMeanDelta:oee?.mean??null,passed:nonRegression,statisticalNonInferiorityEstablished:false},precision:{targetHalfWidth:plan?.targetHalfWidth??null,achievedHalfWidth:halfWidth,
      met:halfWidth===null||!Number.isFinite(plan?.targetHalfWidth)||plan.targetHalfWidth<=0?null:halfWidth<=plan.targetHalfWidth,plannedRounds:plan?.rounds??null,requiredRounds:plan?.requiredRounds??null,capped:plan?.capped===true},
    interpretation:descriptive?'The gain repeated without observed variance; no confidence interval or statistical certainty is claimed.':
      'Paired independent confirmation applies to the simulated model and recorded conditions; it does not establish intervention feasibility, economic value or plant validation.'};
}

function scenarioValidConfirmationPilotSeeds(seeds) {
  return Array.isArray(seeds)&&seeds.length>=3&&seeds.every(Number.isInteger)&&new Set(seeds).size===seeds.length;
}

// A saved plan is evidence, not authority to reduce its own acceptance threshold.
// Reconstruct the minimum from its recorded pilot mean and current methodology;
// never derive a new threshold from the already-observed confirmation baseline.
function scenarioConfirmationPlanIssue(plan,methodology) {
  if(!plan||typeof plan!=='object'||Array.isArray(plan))return 'CONFIRMATION_PLAN_REQUIRED';
  if(plan.policy!=='FIXED_SAMPLE_INDEPENDENT_CONFIRMATION')return 'INVALID_CONFIRMATION_POLICY';
  if(!Number.isFinite(plan.baselineMeanThroughput)||plan.baselineMeanThroughput<0||!scenarioValidConfirmationPilotSeeds(plan.pilotSeeds))return 'INVALID_CONFIRMATION_PILOT';
  if(!Number.isInteger(plan.rounds)||plan.rounds<3)return 'INVALID_CONFIRMATION_SAMPLE_SIZE';
  if(!Number.isFinite(plan.confidenceLevel)||plan.confidenceLevel<=0||plan.confidenceLevel>=1)return 'INVALID_CONFIRMATION_CONFIDENCE';
  if(!Number.isFinite(plan.comparisonDurationSeconds)||plan.comparisonDurationSeconds<=0||typeof plan.comparisonUnitOfFlow!=='string'||!plan.comparisonUnitOfFlow.trim())return 'INVALID_CONFIRMATION_COMPARISON';
  if(!Number.isFinite(plan.minimumPracticalGain)||plan.minimumPracticalGain<0)return 'INVALID_PRACTICAL_GAIN_THRESHOLD';
  let minimum;
  try{minimum=scenarioPracticalGain({throughput:plan.baselineMeanThroughput,unitOfFlow:plan.comparisonUnitOfFlow},methodology||{});}catch(error){return error.message||'INVALID_CONFIRMATION_OBJECTIVE';}
  if(plan.minimumPracticalGain<minimum)return 'PRACTICAL_GAIN_THRESHOLD_REDUCED';
  return null;
}

// Shared by browser confirmation and the saved-evidence server path. Aggregates
// used in economics must describe the same complete observations as the tests.
function scenarioComparisonEvidenceIssue(base,candidate,plan) {
  if(!base||!candidate||!Number.isFinite(base.durationSeconds)||base.durationSeconds<=0||candidate.durationSeconds!==base.durationSeconds)return 'INCOMPATIBLE_CALENDAR_HORIZONS';
  if(typeof base.unitOfFlow!=='string'||!base.unitOfFlow||candidate.unitOfFlow!==base.unitOfFlow)return 'INCOMPATIBLE_FLOW_UNITS';
  if(plan?.comparisonDurationSeconds!==undefined&&plan.comparisonDurationSeconds!==base.durationSeconds)return 'CONFIRMATION_HORIZON_CHANGED';
  if(plan?.comparisonUnitOfFlow!==undefined&&plan.comparisonUnitOfFlow!==base.unitOfFlow)return 'CONFIRMATION_UNIT_CHANGED';
  for(const value of [base,candidate]){
    if(!Array.isArray(value.roundMetrics)||!value.roundMetrics.length)return 'MISSING_REPLICATION_METRICS';
    if(value.roundMetrics.some(row=>row?.durationSeconds!==value.durationSeconds))return 'INCOMPATIBLE_REPLICATION_HORIZONS';
    for(const metric of ['throughput','oee']){
      if(!Number.isFinite(value[metric])||value[metric]<0||value.roundMetrics.some(row=>!Number.isFinite(row[metric])||row[metric]<0))return 'INVALID_REPLICATION_METRICS';
      const mean=value.roundMetrics.reduce((sum,row)=>sum+row[metric],0)/value.roundMetrics.length;
      if(Math.abs(mean-value[metric])>1e-7*Math.max(1,Math.abs(mean)))return 'AGGREGATES_DO_NOT_MATCH_REPLICATIONS';
    }
  }
  return null;
}

// Scenario evidence is conditional on the model. Reported sources, quotations
// and pilots never become verified causes, feasible targets or plant validation.
// The standard study is technical: no budget amounts or financial ranking.
// The separate explicit economics API concerns the complete checked package.

const scenarioStudyEconomicNumbers = Object.freeze({
  investment: [0, Infinity], installationCost: [0, Infinity], implementationLoss: [0, Infinity],
  lifeYears: [1, 100], discountRate: [0, 1], annualOperatingMinutes: [0, 527040],
  contributionMarginPerUnit: [0, Infinity], annualIncrementalDemand: [0, Infinity],
  annualAvoidableSavings: [0, Infinity], annualIncrementalOpex: [0, Infinity], residualValue: [0, Infinity]
});
const scenarioStudyExcludedKeys = new Set(['__proto__', 'constructor', 'prototype', 'replay', 'study', 'trialHistory', 'roundMetrics', 'inputSignature']);

// Canonical technical inputs for cache/confirmation identity. Monetary sections
// are intentionally excluded only at the top level; qualitative intervention
// types and costClass, replication settings and all other technical data remain.
function scenarioTechnicalMethodology(methodology={}) {
  if(!scenarioStudyRecord(methodology))return {};
  const monetary=new Set(['economics','budget','capexBudget','investmentBudget']);
  function canonical(value,ancestors=new Set()){
    if(!value||typeof value!=='object')return value;
    if(ancestors.has(value))throw Error('SCENARIO_INVALID_METHODOLOGY_CYCLE');
    const next=new Set(ancestors);next.add(value);
    if(Array.isArray(value))return value.map(item=>canonical(item,next));
    return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key],next)]));
  }
  return canonical(Object.fromEntries(Object.entries(methodology).filter(([key])=>!monetary.has(key))));
}

function scenarioStudyText(value, limit = 2000) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}
function scenarioStudyNumber(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function scenarioStudyRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
// Bounded, JSON-safe copies also make externally supplied evidence non-recursive.
function scenarioStudyCopy(value, depth = 0, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object' || depth > 5 || ancestors.has(value)) return null;
  const next = new Set(ancestors); next.add(value);
  if (Array.isArray(value)) return value.slice(0, 64).map(item => scenarioStudyCopy(item, depth + 1, next));
  const copy = {};
  Object.keys(value).filter(key => !scenarioStudyExcludedKeys.has(key)).slice(0, 48).forEach(key => {
    copy[key] = scenarioStudyCopy(value[key], depth + 1, next);
  });
  return copy;
}
function scenarioStudyPick(value, keys) {
  const result = {};
  if (scenarioStudyRecord(value)) keys.forEach(key => {
    if (Object.hasOwn(value, key)) result[key] = scenarioStudyCopy(value[key]);
  });
  return result;
}
function scenarioStudyFlowUnit(value) {
  const unit = scenarioStudyText(value)?.toLowerCase();
  return { bottle: 'bottles', bottles: 'bottles', case: 'cases', cases: 'cases', pallet: 'pallets', pallets: 'pallets', unit: 'units', units: 'units' }[unit] || null;
}
function scenarioStudyGet(value, path) {
  if (typeof path !== 'string' || path.split('.').some(key => scenarioStudyExcludedKeys.has(key))) return undefined;
  return path.split('.').reduce((current, key) => current?.[key], value);
}
function scenarioStudyMetrics(value) {
  return { throughput: scenarioStudyNumber(value?.throughput), oee: scenarioStudyNumber(value?.oee) };
}
function scenarioStudyConfirmationPlan(value) {
  if (!scenarioStudyRecord(value)) return null;
  const plan = scenarioStudyPick(value, ['status', 'reason', 'rounds', 'requiredRounds', 'requiredRoundsLowerBound', 'capped',
    'targetHalfWidth', 'plannedHalfWidth', 'pilotSeeds', 'pilotRounds', 'confidenceLevel', 'minRounds', 'maxRounds',
    'confirmationMustExcludePilotSeeds', 'method', 'policy', 'pilotRole', 'minimumPracticalGain', 'comparisonBasis',
    'comparisonDurationSeconds', 'comparisonUnitOfFlow', 'baselineMeanThroughput', 'pilotStandardDeviation',
    'sourceEffectiveRuntimeTargetSeconds', 'interpretation']);
  if (value.pilotRun) plan.pilotRun = scenarioStudyPick(value.pilotRun, ['durationSeconds', 'rounds', 'seed', 'durationMode', 'engineId']);
  return plan;
}
function scenarioStudyDOEObservations(value) {
  const observations = Array.isArray(value) ? value : [];
  return observations.slice(0, 16).map(observation => {
    const responses = Array.isArray(observation?.roundMetrics) ? observation.roundMetrics :
      Array.isArray(observation?.roundResponses) ? observation.roundResponses : [];
    return {
      index: scenarioStudyNumber(observation?.index),
      levels: Array.isArray(observation?.levels) ? observation.levels.slice(0, 4).map(scenarioStudyNumber) : [],
      feasible: typeof observation?.feasible === 'boolean' ? observation.feasible : null,
      roundResponses: responses.slice(0, 100).map(response => ({ seed: scenarioStudyNumber(response?.seed),
        oee: scenarioStudyNumber(response?.oee), throughput: scenarioStudyNumber(response?.throughput) })),
      roundResponsesOmitted: Math.max(0, responses.length - 100)
    };
  });
}
function scenarioStudyChanges(evaluation) {
  return Array.isArray(evaluation?.evaluatedChanges) ? evaluation.evaluatedChanges : [];
}
function scenarioStudyPackageIdentity(evaluation) {
  const changes = scenarioStudyChanges(evaluation).map(change => ({
    equipmentId: scenarioStudyText(change?.equipmentId), path: scenarioStudyText(change?.path),
    before: scenarioStudyNumber(change?.before), after: scenarioStudyNumber(change?.after),
    unit: scenarioStudyText(change?.unit), interventionType: scenarioStudyText(change?.interventionType),
    external: change?.external === true, analysisOnly: change?.analysisOnly === true,
    replacementMaximumBpm: scenarioStudyNumber(change?.replacementMaximumBpm)
  })).sort((a, b) => {
    const left = JSON.stringify([a.equipmentId, a.path]), right = JSON.stringify([b.equipmentId, b.path]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const text = JSON.stringify(['ST_SCENARIO_PACKAGE_V1', scenarioStudyText(evaluation?.sourceSimulationId), scenarioStudyText(evaluation?.sourceSignature), changes]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return { id: 'scenario-package-' + (hash >>> 0).toString(16), signature: text };
}
function scenarioStudySourceIssues(simulation, evaluation) {
  const missingInputs = [], invalidInputs = [];
  if (!scenarioStudyText(evaluation?.sourceSignature)) missingInputs.push('evaluation.sourceSignature');
  if (!scenarioStudyText(evaluation?.sourceSimulationId)) missingInputs.push('evaluation.sourceSimulationId');
  else if (evaluation.sourceSimulationId !== simulation?.id) invalidInputs.push('evaluation.sourceSimulationId');
  const changes = scenarioStudyChanges(evaluation);
  if (!changes.length) missingInputs.push('evaluation.evaluatedChanges');
  if (changes.length > 64) invalidInputs.push('evaluation.evaluatedChanges');
  const seen = new Set();
  changes.forEach((change, index) => {
    const key = 'evaluation.evaluatedChanges[' + index + ']';
    const identity = change?.equipmentId + ':' + change?.path;
    if (!scenarioStudyText(change?.equipmentId) || !scenarioStudyText(change?.path) || seen.has(identity) ||
        scenarioStudyNumber(change?.before) === null || scenarioStudyNumber(change?.after) === null || change.before === change.after) {
      invalidInputs.push(key); return;
    }
    seen.add(identity);
    const equipment = (Array.isArray(simulation?.equipment) ? simulation.equipment : []).find(item => item?.id === change.equipmentId);
    if (!equipment || scenarioStudyGet(equipment, change.path) !== change.before) invalidInputs.push(key + '.baseline');
  });
  return { missingInputs, invalidInputs };
}
function scenarioStudyFinancialCase(deltaThroughput, config) {
  if (!Number.isFinite(deltaThroughput) || deltaThroughput < 0) return {
    status: 'NOT_EVALUATED', reason: 'NEGATIVE_THROUGHPUT_BOUND_REQUIRES_BASELINE_DEMAND', deltaThroughputPerMinute: deltaThroughput
  };
  const annualCapacityGain = deltaThroughput * config.annualOperatingMinutes;
  const annualUtilizedIncrement = Math.min(annualCapacityGain, config.annualIncrementalDemand);
  const annualProductionContribution = annualUtilizedIncrement * config.contributionMarginPerUnit;
  const annualNetBenefit = annualProductionContribution + config.annualAvoidableSavings - config.annualIncrementalOpex;
  const initialOutlay = config.investment + config.installationCost + config.implementationLoss;
  const cashFlows = [{ year: 0, amount: -initialOutlay, discountedAmount: -initialOutlay }];
  let npv = -initialOutlay;
  for (let year = 1; year <= config.lifeYears; year++) {
    const amount = annualNetBenefit + (year === config.lifeYears ? config.residualValue : 0);
    const discountedAmount = amount / (1 + config.discountRate) ** year;
    cashFlows.push({ year, amount, discountedAmount }); npv += discountedAmount;
  }
  const simplePaybackYears = initialOutlay > 0 && annualNetBenefit > 0 ? initialOutlay / annualNetBenefit : null;
  const simpleLifetimeRoi = initialOutlay > 0 ? (annualNetBenefit * config.lifeYears + config.residualValue - initialOutlay) / initialOutlay : null;
  const numbers = [annualCapacityGain, annualUtilizedIncrement, annualProductionContribution, annualNetBenefit, initialOutlay, npv,
    ...cashFlows.flatMap(row => [row.amount, row.discountedAmount])];
  if (numbers.some(value => !Number.isFinite(value)) || simplePaybackYears !== null && !Number.isFinite(simplePaybackYears) ||
      simpleLifetimeRoi !== null && !Number.isFinite(simpleLifetimeRoi)) return { status: 'NOT_EVALUATED', reason: 'NON_FINITE_CALCULATION' };
  return {
    status: 'ESTIMATED', deltaThroughputPerMinute: deltaThroughput, annualCapacityGain, annualUtilizedIncrement,
    annualUnutilizedCapacityGain: annualCapacityGain - annualUtilizedIncrement,
    annualProductionContribution, annualAvoidableSavings: config.annualAvoidableSavings,
    annualIncrementalOpex: config.annualIncrementalOpex, annualNetBenefit, initialOutlay, npv, cashFlows,
    simplePaybackYears, paybackWithinHorizon: simplePaybackYears === null ? null : simplePaybackYears <= config.lifeYears,
    simpleLifetimeRoi, npvPositive: npv > 0
  };
}

/**
 * Optional config is simulation.whatIf.methodology.economics by default.
 * Monetary inputs share `currency`; throughput and margin share `unitOfFlow`.
 * Costs/savings/residual and demand are explicit numbers, including zero.
 * packageSignature must equal buildScenarioStudy(...).evaluatedPackage.signature;
 * packageId may additionally be supplied and must match. Full canonical equality
 * prevents both hash collisions and inherited costs for a different package.
 * discountRate is a fraction, lifeYears an integer, all annual amounts are constant.
 * annualIncrementalDemand is unmet usable demand, not total plant demand.
 * contributionMarginPerUnit excludes incremental unit costs; annualAvoidableSavings
 * must exclude those costs and the added contribution, and OPEX must not be counted
 * again in margin or savings. Initial costs must not be counted in annual cash flow.
 */
function evaluateScenarioEconomics(simulation, evaluation, config) {
  const supplied = config === undefined ? simulation?.whatIf?.methodology?.economics : config;
  const economics = scenarioStudyRecord(supplied) ? supplied : {};
  const identity = scenarioStudyPackageIdentity(evaluation);
  const sourceIssues = scenarioStudySourceIssues(simulation, evaluation);
  const missingInputs = [...sourceIssues.missingInputs], invalidInputs = [...sourceIssues.invalidInputs];
  const check = evaluation?.independentCheck;
  const blockers = [];
  if (!scenarioStudyRecord(supplied)) missingInputs.push('economics');
  if (!scenarioStudyText(economics.packageSignature)) missingInputs.push('economics.packageSignature');
  else if (economics.packageSignature !== identity.signature) invalidInputs.push('economics.packageSignature');
  if (economics.packageId !== undefined && economics.packageId !== identity.id) invalidInputs.push('economics.packageId');
  for (const [key, [minimum, maximum]] of Object.entries(scenarioStudyEconomicNumbers)) {
    const value = economics[key];
    if (value === undefined || value === null || value === '') missingInputs.push('economics.' + key);
    else if (scenarioStudyNumber(value) === null || value < minimum || value > maximum || key === 'lifeYears' && !Number.isInteger(value)) invalidInputs.push('economics.' + key);
  }
  if (economics.annualOperatingMinutes === 0) invalidInputs.push('economics.annualOperatingMinutes');
  const currency = scenarioStudyText(economics.currency);
  if (!currency) missingInputs.push('economics.currency');
  else if (!/^[A-Z]{3}$/.test(currency)) invalidInputs.push('economics.currency');
  const unitOfFlow = scenarioStudyFlowUnit(economics.unitOfFlow);
  if (!scenarioStudyText(economics.unitOfFlow)) missingInputs.push('economics.unitOfFlow');
  else if (!unitOfFlow) invalidInputs.push('economics.unitOfFlow');
  const sourceUnit = scenarioStudyFlowUnit(evaluation?.unitOfFlow || simulation?.unitOfFlow);
  if (!sourceUnit) missingInputs.push('evaluation.unitOfFlow');
  else if (unitOfFlow && unitOfFlow !== sourceUnit) invalidInputs.push('economics.unitOfFlow');
  const providedUnits = [evaluation?.unitOfFlow, simulation?.unitOfFlow, check?.unitOfFlow, check?.baseline?.unitOfFlow, check?.candidate?.unitOfFlow].filter(value => value !== undefined && value !== null);
  if (providedUnits.some(value => !scenarioStudyFlowUnit(value) || scenarioStudyFlowUnit(value) !== sourceUnit)) invalidInputs.push('evaluation.unitOfFlow');
  for (const [key, required] of [['benefitBasis', 'INCREMENTAL_NON_OVERLAPPING'], ['annualizationBasis', 'REPRESENTATIVE_CONFIRMATION_RATE']]) {
    if (!scenarioStudyText(economics[key])) missingInputs.push('economics.' + key);
    else if (economics[key] !== required) invalidInputs.push('economics.' + key);
  }
  if (!check) missingInputs.push('evaluation.independentCheck');
  if (check?.passed !== true) blockers.push('INDEPENDENT_CONFIRMATION_NOT_PASSED');
  for (const key of ['baseline', 'candidate']) {
    const metric = scenarioStudyNumber(check?.[key]?.throughput);
    if (metric === null) missingInputs.push('evaluation.independentCheck.' + key + '.throughput');
    else if (metric < 0) invalidInputs.push('evaluation.independentCheck.' + key + '.throughput');
    const oee = scenarioStudyNumber(check?.[key]?.oee);
    if (oee === null) missingInputs.push('evaluation.independentCheck.' + key + '.oee');
    else if (oee < 0) invalidInputs.push('evaluation.independentCheck.' + key + '.oee');
    const rateUnit = check?.[key]?.throughputUnit || check?.throughputUnit;
    if (rateUnit !== undefined && !['per_minute', 'units/min', unitOfFlow + '/min', unitOfFlow === 'bottles' ? 'bpm' : null].includes(rateUnit)) invalidInputs.push('evaluation.independentCheck.' + key + '.throughputUnit');
  }
  if (!(scenarioStudyNumber(check?.durationSeconds) > 0)) missingInputs.push('evaluation.independentCheck.durationSeconds');
  if (!(Number.isInteger(check?.rounds) && check.rounds > 0)) missingInputs.push('evaluation.independentCheck.rounds');
  if (scenarioStudyNumber(check?.baseline?.oee) !== null && scenarioStudyNumber(check?.candidate?.oee) !== null && check.candidate.oee < check.baseline.oee - 1e-9) blockers.push('CONFIRMED_OEE_REGRESSION');
  const baselineThroughput = scenarioStudyNumber(check?.baseline?.throughput), candidateThroughput = scenarioStudyNumber(check?.candidate?.throughput);
  const delta = baselineThroughput !== null && candidateThroughput !== null ? candidateThroughput - baselineThroughput : null;
  if (delta !== null && delta < 0) blockers.push('CONFIRMED_THROUGHPUT_REGRESSION');
  const output = {
    version: 1, status: 'NOT_EVALUATED', scope: 'EVALUATED_PACKAGE', packageId: identity.id, packageSignature: identity.signature,
    missingInputs: [...new Set(missingInputs)], invalidInputs: [...new Set(invalidInputs)], blockers,
    currency, unitOfFlow, sourceSignature: scenarioStudyText(evaluation?.sourceSignature),
    basis: 'INDEPENDENT_CONFIRMATION_THROUGHPUT', inputs: scenarioStudyPick(economics, [...Object.keys(scenarioStudyEconomicNumbers), 'currency', 'unitOfFlow', 'benefitBasis', 'annualizationBasis']),
    inputEvidence: 'REPORTED_NOT_VERIFIED', plantValidated: false,
    contract: {
      annualization: 'Constant annual operating time and incremental unmet demand; confirmation rate is explicitly reported representative.',
      benefits: 'Incremental utilized output times contribution margin, plus separately avoidable savings, less non-overlapping incremental OPEX.',
      cashFlow: 'Initial investment, installation and implementation loss at year zero; constant annual net benefit at year end; residual at final year.',
      payback: 'Initial outlay divided by positive annual net benefit, undiscounted and excluding terminal residual; null for zero outlay or non-positive benefit.',
      roi: 'Undiscounted net benefit over the full life including residual, less initial outlay, divided by initial outlay; a fraction, not an annualized return.',
      limitations: 'No inferred sale of unused capacity, taxes, financing or inflation. Positive NPV is a conditional estimate, not investment approval or plant validation.'
    }
  };
  if (output.missingInputs.length || output.invalidInputs.length || blockers.length) return output;
  const estimate = scenarioStudyFinancialCase(delta, economics);
  Object.assign(output, estimate);
  if (estimate.status !== 'ESTIMATED') return output;
  output.confirmation = { baselineThroughput, candidateThroughput, durationSeconds: check.durationSeconds, rounds: check.rounds,
    kind: scenarioStudyText(check.confirmationKind || evaluation?.confirmationKind) || 'MODEL_REPRODUCTION' };
  const statistics = check.statisticalEvidence;
  const interval = statistics?.metrics?.throughput;
  output.sensitivity = { status: 'NOT_EVALUATED', reason: 'CONFIRMATION_INTERVAL_UNAVAILABLE' };
  if (statistics?.available === true && interval?.inferenceAvailable === true &&
      scenarioStudyNumber(interval.lower) !== null && scenarioStudyNumber(interval.upper) !== null &&
      interval.lower <= interval.upper && scenarioStudyNumber(interval.mean) !== null &&
      Math.abs(interval.mean - delta) <= Math.max(1e-8, Math.abs(delta) * 1e-8) && interval.lower <= delta && interval.upper >= delta &&
      scenarioStudyNumber(statistics.confidenceLevel) > 0 && statistics.confidenceLevel < 1) {
    output.sensitivity = {
      status: 'ESTIMATED', basis: 'CONFIRMATION_MEAN_THROUGHPUT_INTERVAL', confidenceLevel: statistics.confidenceLevel,
      lower: scenarioStudyFinancialCase(interval.lower, economics), upper: scenarioStudyFinancialCase(interval.upper, economics),
      interpretation: 'Only simulation mean uncertainty is propagated; input, engineering, demand, cost and plant-model uncertainty are not included.'
    };
  } else if (interval?.inferenceAvailable === true) output.sensitivity.reason = 'INVALID_OR_INCONSISTENT_CONFIRMATION_INTERVAL';
  return output;
}

function scenarioStudyHypotheses(simulation, evaluation, metadata) {
  const groups = new Map(), reported = Array.isArray(metadata?.interventions) ? metadata.interventions : [];
  scenarioStudyChanges(evaluation).slice(0, 64).forEach(change => {
    if (!scenarioStudyRecord(change) || !scenarioStudyText(change.equipmentId) || !scenarioStudyText(change.path)) return;
    const record = reported.find(item => item?.equipmentId === change.equipmentId && (!Array.isArray(item.paths) || item.paths.includes(change.path)));
    const exploratory = change.analysisOnly === true || change.interventionType === 'SENSITIVITY';
    const explicitType = scenarioStudyText(record?.type || change.interventionType);
    const classification = exploratory ? 'EXPLORATORY_SENSITIVITY' : explicitType ||
      (change.path?.startsWith('noiseProfile.reliability.') ? 'INTERVENTION_UNSPECIFIED' :
        change.path==='processData.geometry.lactMm' ? 'LINE_REDESIGN' : 'OPERATING_PARAMETER_ADJUSTMENT');
    const key = change.equipmentId + ':' + classification + ':' + (record?.id || '');
    if (!groups.has(key)) {
      const equipment = (Array.isArray(simulation?.equipment) ? simulation.equipment : []).find(item => item?.id === change.equipmentId);
      groups.set(key, {
        id: key, equipmentId: change.equipmentId, equipmentName: scenarioStudyText(equipment?.name), classification,
        classificationBasis: exploratory ? 'EXPLORATORY_TARGET' : explicitType ? 'REPORTED_INTERVENTION' : 'PARAMETER_TYPE_ONLY',
        costClass: ({ OPERATIONAL: 'NONE', MAINTENANCE: 'OPEX', RETROFIT: 'CAPEX', REPLACEMENT: 'CAPEX' })[classification] || 'UNASSIGNED',
        capexClassification: {tier:({OPERATIONAL:'ZERO',MAINTENANCE:'ZERO',RETROFIT:'MEDIUM',REPLACEMENT:'HIGH',LINE_REDESIGN:'HIGH',OPERATING_PARAMETER_ADJUSTMENT:'ZERO'})[classification]||'UNASSIGNED',
          basis:'INTERVENTION_SCOPE',budgetUsed:false},
        stopDataCoverage:scenarioStopDataCoverage(simulation,equipment),
        modeledStopEffect:{reliabilityParametersChanged:false,microStopParametersChanged:false,flowEffectsRequireSimulation:true},
        description: scenarioStudyText(record?.description || change.justification),
        diagnosticEvidence: (Array.isArray(evaluation?.lossDiagnosis?.equipment) ? evaluation.lossDiagnosis.equipment : []).filter(item => item?.equipmentId === change.equipmentId).slice(0, 1).map(item =>
          scenarioStudyPick(item, ['equipmentId', 'failureSeconds', 'microStopSeconds', 'minorFailureSeconds', 'majorFailureSeconds', 'generalFailureSeconds',
            'failureCategories', 'stopDataCoverage', 'starvedSeconds', 'blockedSeconds', 'dominantLoss', 'ownStopPercent'])),
        capacityEvidence: (Array.isArray(evaluation?.capacityDiagnosis?.limitingEquipment) ? evaluation.capacityDiagnosis.limitingEquipment : []).filter(item => item?.id === change.equipmentId).slice(0, 1).map(item =>
          scenarioStudyPick(item, ['id', 'name', 'bpm', 'maximumBpm'])),
        targetSource: { status: record?.targetSource || record?.sourceReference || change.targetSource || change.justification ? 'REPORTED_NOT_VERIFIED' : 'NOT_PROVIDED',
          reported: scenarioStudyCopy(record?.targetSource || change.targetSource || null), sourceReference: scenarioStudyCopy(record?.sourceReference || null) },
        rootCauseVerified: false, targetAchievabilityVerified: false, changes: [],
        reportedFeasibility: record?.feasibility === undefined ? null : { status: 'REPORTED_NOT_VERIFIED', reported: scenarioStudyCopy(record.feasibility) },
        reportedPilot: record?.pilot === undefined ? null : { status: 'REPORTED_NOT_VERIFIED', reported: scenarioStudyCopy(record.pilot) }
      });
    }
    const hypothesis=groups.get(key);
    if(change.path.startsWith('noiseProfile.reliability.')){
      hypothesis.modeledStopEffect.reliabilityParametersChanged=true;
      hypothesis.modeledStopEffect.reliabilityScope=hypothesis.stopDataCoverage.mode==='SPLIT'?'ALL_CONFIGURED_STOP_CLASSES':'GENERAL_UNCLASSIFIED';
      hypothesis.modeledStopEffect.interpretation='Aggregate MTBF/MTTR edits scale all configured reliability stop classes proportionally; the separate MICRO_STOP process is unchanged.';
    }else if(!hypothesis.modeledStopEffect.reliabilityParametersChanged){
      hypothesis.modeledStopEffect.interpretation='Operating or geometry changes affect line flow and recovery; they do not directly reduce the frequency or duration of configured reliability or MICRO_STOP events.';
    }
    hypothesis.changes.push(scenarioStudyPick(change, ['equipmentId', 'path', 'before', 'after', 'unit', 'external', 'analysisOnly', 'replacementMaximumBpm']));
  });
  return [...groups.values()];
}

/** Compact, immutable evidence chain for persisted evaluations and scenarios. */
function buildScenarioStudy(simulation, evaluation) {
  const metadata = scenarioStudyRecord(simulation?.whatIf?.methodology) ? simulation.whatIf.methodology : {};
  const check = evaluation?.independentCheck;
  const issues = scenarioStudySourceIssues(simulation, evaluation);
  const traceable = !issues.missingInputs.length && !issues.invalidInputs.length;
  const hypotheses = scenarioStudyHypotheses(simulation, evaluation, metadata);
  const pilots = hypotheses.filter(item => item.reportedPilot).map(item => ({ interventionId: item.id, ...item.reportedPilot }));
  const actualBase = scenarioStudyMetrics(check?.baseline), actualCandidate = scenarioStudyMetrics(check?.candidate);
  const validConfirmation = actualBase.throughput !== null && actualBase.throughput >= 0 && actualCandidate.throughput !== null &&
    actualCandidate.throughput >= actualBase.throughput && scenarioStudyNumber(check?.durationSeconds) > 0 &&
    Number.isInteger(check?.rounds) && check.rounds > 0 &&
    actualBase.oee !== null && actualBase.oee >= 0 && actualCandidate.oee !== null && actualCandidate.oee >= 0 &&
    actualCandidate.oee >= actualBase.oee - 1e-9;
  const stats = scenarioStudyPick(check?.statisticalEvidence, ['available', 'n', 'seedIds', 'confidenceLevel', 'metrics', 'reason']);
  const confirmationPlan = scenarioStudyConfirmationPlan(evaluation?.confirmationPlan);
  const rankingPlan=evaluation?.rankingPlan,finalistScreen=evaluation?.phaseAudit?.finalistScreening,ranking=evaluation?.phaseAudit?.ranking;
  const doe = evaluation?.doe;
  const fixedChanges = (Array.isArray(doe?.fixedChanges) ? doe.fixedChanges : []).slice(0, 64).map(change =>
    scenarioStudyPick(change, ['equipmentId', 'path', 'before', 'after', 'unit', 'external', 'analysisOnly', 'interventionType', 'replacementMaximumBpm']));
  const objective = scenarioStudyRecord(metadata.objective) ? scenarioStudyPick(metadata.objective, ['metric', 'target', 'unit', 'minimumPracticalGain', 'description']) : null;
  const objectiveMetric = objective?.metric === 'throughput' ? 'throughput' : objective?.metric === 'oee' ? 'oee' : null;
  const flowUnit = scenarioStudyFlowUnit(evaluation?.unitOfFlow || simulation?.unitOfFlow);
  const objectiveUnits = objectiveMetric === 'oee' ? ['%', 'percent'] : [flowUnit + '/min', ...(flowUnit === 'bottles' ? ['bpm'] : [])];
  const objectiveValid = objectiveMetric && scenarioStudyNumber(objective?.target) !== null && objective.target >= 0 &&
    (objectiveMetric !== 'oee' || objective.target <= 100) && objectiveUnits.includes(objective.unit) &&
    (objective.minimumPracticalGain === undefined || scenarioStudyNumber(objective.minimumPracticalGain) !== null && objective.minimumPracticalGain >= 0);
  const objectiveEvaluable = traceable && check?.passed === true && validConfirmation && objectiveValid && actualCandidate[objectiveMetric] !== null;
  const changes = scenarioStudyChanges(evaluation);
  const identity = scenarioStudyPackageIdentity(evaluation);
  const constraints = [
    'Observed equipment downtime and propagated starvation/blocking are not additive causal line losses.',
    'A simulated target does not establish the physical intervention, attainable reliability or supplier performance.',
    'DOE and independent confirmation support this model and evaluated package; they do not prove a global optimum or plant outcome.',
    'Minor/major stop classes require supplied data; general stops are not split by duration, and stop class does not establish root cause.',
    'CAPEX classification uses intervention type and scope; budget amounts and financial evaluation are outside the current technical study.',
    'Reported source references are not independently verified.'
  ];
  const confirmationStatus = !check ? 'NOT_EVALUATED' : !traceable ? 'UNTRACEABLE_EVIDENCE' : check.passed !== true ? 'NOT_REPRODUCED' :
    validConfirmation ? 'MODEL_REPRODUCED' : 'INVALID_OR_INCOMPLETE_CONFIRMATION';
  return {
    version: 1,
    analysisScope:{objective:'TECHNICAL_LINE_EFFICIENCY',capexClassificationBasis:'INTERVENTION_SCOPE',budgetAmountsUsed:false},
    source: {
      simulationId: scenarioStudyText(simulation?.id), sourceSimulationId: scenarioStudyText(evaluation?.sourceSimulationId),
      sourceSignature: scenarioStudyText(evaluation?.sourceSignature), status: traceable ? 'RECORDED' : 'INCOMPLETE_OR_MISMATCHED',
      signatureVerification: 'CALLER_MUST_VERIFY_CURRENT_SIGNATURE', missingInputs: issues.missingInputs, invalidInputs: issues.invalidInputs
    },
    evaluatedPackage: { ...identity, changeCount: changes.length, equipmentIds: [...new Set(changes.map(change => change?.equipmentId).filter(value => typeof value === 'string'))].slice(0, 64), scope: 'WHOLE_PACKAGE' },
    objective: { status: objective ? 'REPORTED' : 'NOT_DEFINED', reported: objective,
      assessment: objectiveEvaluable ? { status: 'MODEL_COMPARISON', achieved: actualCandidate[objectiveMetric], target: objective.target,
        targetMet: actualCandidate[objectiveMetric] >= objective.target,
        minimumPracticalGainMet: scenarioStudyNumber(objective.minimumPracticalGain) !== null && actualBase[objectiveMetric] !== null ? actualCandidate[objectiveMetric] - actualBase[objectiveMetric] >= objective.minimumPracticalGain : null } : { status: 'NOT_EVALUATED', reason: objective && !objectiveValid ? 'INVALID_OBJECTIVE_OR_UNIT' : 'OBJECTIVE_OR_CONFIRMATION_MISSING' } },
    baseline: { status: check?.baseline ? 'CONFIRMATION_BASELINE' : evaluation?.baseline ? 'SCREENING_BASELINE' : 'MISSING',
      metrics: check?.baseline ? actualBase : scenarioStudyMetrics(evaluation?.baseline), unitOfFlow: scenarioStudyFlowUnit(evaluation?.unitOfFlow || simulation?.unitOfFlow),
      run: scenarioStudyPick(check || evaluation?.run, ['durationSeconds', 'rounds', 'seed']) },
    diagnosis: {
      causalStatus: 'HYPOTHESES_ONLY',
      observedLosses: scenarioStudyPick(evaluation?.lossDiagnosis, ['status', 'reason', 'sourceStatus', 'provenance', 'referenceId', 'durationSeconds', 'durationBasis',
        'rounds', 'equipment', 'rankings', 'opportunities', 'stopDataQuality', 'attribution', 'interpretation']),
      capacity: scenarioStudyPick(evaluation?.capacityDiagnosis, ['reason', 'sourceStatus', 'referenceId', 'referenceBpm', 'minimumBpm', 'capacityCeilingPercent', 'limitingEquipment', 'achievedPercent', 'capacityGapPp', 'residualLossPp', 'accountingAvailable', 'interpretation']),
      reliabilitySensitivity: scenarioStudyPick(evaluation?.reliabilityTargetSearch, ['status', 'analysisOnly', 'classification', 'conditionalReliabilityGain', 'coverage', 'ranking', 'interpretation'])
    },
    hypotheses,
    evidence: {
      screening: { baseline: scenarioStudyMetrics(evaluation?.baseline), candidate: scenarioStudyMetrics(evaluation?.candidate), role: 'EXPLORATION_ONLY' },
      finalistSelection:{status:rankingPlan?'RECORDED':'NOT_RECORDED',role:'EXPLORATORY_SELECTION_NOT_CONFIRMATION',
        policy:scenarioStudyText(rankingPlan?.policy),staged:rankingPlan?.staged===true,reason:scenarioStudyText(rankingPlan?.reason),
        intermediateRun:scenarioStudyPick(finalistScreen?.run||rankingPlan?.screenRun,['durationSeconds','rounds','seed','engineId']),
        fullRun:scenarioStudyPick(ranking?.run||rankingPlan?.fullRun,['durationSeconds','rounds','seed','engineId']),
        candidatesScreened:Array.isArray(finalistScreen?.observations)?finalistScreen.observations.length:null,
        selected:scenarioStudyNumber(finalistScreen?.selected),omitted:scenarioStudyNumber(finalistScreen?.omitted),
        protectedReliabilityCandidates:scenarioStudyNumber(finalistScreen?.protectedReliabilityCandidates),
        fullHorizonFinalists:scenarioStudyNumber(ranking?.finalists)??scenarioStudyNumber(rankingPlan?.fullHorizonFinalists),
        shortScreenMayMissLateBenefits:rankingPlan?.staged===true,
        interpretation:scenarioStudyText(rankingPlan?.interpretation)||'Selection allocates simulation effort; only the full-horizon independent confirmation supports a reproduced improvement.'},
      experiment: {
        status: doe ? doe.analysis?.complete === true ? 'COMPLETE_DESIGN' : 'INCOMPLETE_DESIGN' : 'NOT_PERFORMED',
        type: scenarioStudyText(doe?.type || doe?.design?.type),
        factors: scenarioStudyCopy(doe?.factors || doe?.design?.factors || []),
        fixedChanges,
        effectScope: { conditionalOnFixedChanges: fixedChanges.length > 0,
          interpretation: 'Effects apply to the tested factor region conditional on these fixed changes and the saved baseline; they are not isolated causal shares or guarantees outside that region.' },
        combinations: scenarioStudyNumber(doe?.combinations) ?? (Array.isArray(doe?.observations) ? doe.observations.length : null),
        roundsPerCombination: scenarioStudyNumber(doe?.roundsPerCombination),
        run: doe ? scenarioStudyPick(doe.run || evaluation?.explorationRun, ['durationSeconds', 'durationMode', 'rounds', 'seed', 'engineId', 'sampleIntervalSeconds']) : {},
        observations: scenarioStudyDOEObservations(doe?.observations),
        observationsOmitted: Math.max(0, (Array.isArray(doe?.observations) ? doe.observations.length : 0) - 16),
        analysis: scenarioStudyPick(doe?.analysis, ['complete', 'reason', 'effects', 'interpretation']),
        anova: scenarioStudyPick(doe?.anova, ['complete', 'model', 'primaryInference', 'alpha', 'confidenceLevel', 'seedIds', 'replications', 'multiplicity', 'metrics', 'reason', 'interpretation']),
        replicationPlan: { status: metadata.replications ? 'REPORTED' : 'NOT_PROVIDED', reported: scenarioStudyPick(metadata.replications, ['minimum', 'maximum', 'confidenceLevel', 'relativePrecision', 'absolutePrecision']),
          actual: confirmationPlan ? { role: 'CONFIRMATION_NOT_DOE', source: 'evaluation.confirmationPlan', plan: confirmationPlan } : null }
      },
      confirmation: { status: confirmationStatus, reportedPassed: check?.passed === true,
        kind: scenarioStudyText(check?.confirmationKind || evaluation?.confirmationKind),
        baseline: actualBase, candidate: actualCandidate, run: scenarioStudyPick(check, ['durationSeconds', 'rounds', 'seed']),
        confirmationPlan,
        precision: scenarioStudyPick(check?.precision, ['targetHalfWidth', 'achievedHalfWidth', 'met', 'plannedRounds', 'requiredRounds', 'capped']),
        practicalThreshold: scenarioStudyNumber(check?.practicalThreshold), reason: scenarioStudyText(check?.reason),
        oeeGuard: scenarioStudyPick(check?.oeeGuard, ['observedMeanDelta', 'passed', 'statisticalNonInferiorityEstablished']),
        delta: { throughputPerMinute: actualBase.throughput !== null && actualCandidate.throughput !== null ? actualCandidate.throughput - actualBase.throughput : null,
          oeePercentagePoints: actualBase.oee !== null && actualCandidate.oee !== null ? actualCandidate.oee - actualBase.oee : null },
        statisticalEvidence: stats,
        interpretation: 'Independent simulation evidence; descriptive reproduction is distinct from statistical inference and plant validation.' }
    },
    feasibility: { status: 'REQUIRES_ENGINEERING_REVIEW', verified: false,
      exploratoryTargets: hypotheses.some(item => item.classification === 'EXPLORATORY_SENSITIVITY'),
      warnings: scenarioStudyCopy(evaluation?.warnings || []),
      reportedAcknowledgement: evaluation?.engineeringReviewAcknowledged === true,
      interpretation: 'Parameter checks or reported acknowledgement do not establish engineering feasibility, installation scope or target achievability.' },
    economics: {status:'NOT_EVALUATED',reason:'OUT_OF_SCOPE',scope:'TECHNICAL_SCENARIO_ANALYSIS',monetaryInputsRequired:false,
      usedForClassification:false,usedForRanking:false,missingInputs:[],invalidInputs:[],plantValidated:false,
      interpretation:'This study compares technical line performance and classifies the intervention scope. No budget amount is requested or used. Financial estimates require a separate explicit API call.'},
    plantValidation: { status: pilots.length ? 'REPORTED_NOT_VERIFIED' : 'NOT_EVALUATED', verified: false, reports: pilots },
    limitations: constraints
  };
}

return {equipmentReliability:equipmentReliabilityAssessment,equipmentAnalysis:analyzeEquipmentReliability,productVolumeUnits,normalizeFormatCatalog:normalizeFormatCatalog,validateFormatCatalog:validateFormatCatalog,plan:planScenarios,readiness:scenarioSourceReadiness,methodologyInputs:scenarioTechnicalMethodology,searchSettingsSignature:scenarioSearchSettingsSignature,efficiency:diagnoseLineEfficiency,diagnose:diagnoseScenarioLosses,apply:applyScenarioChanges,signature:scenarioSignature,audit:scenarioAudit,fields:SCENARIO_FIELDS,catalog:scenarioVariableCatalog,definitions:SCENARIO_DEFINITIONS,interventions:SCENARIO_INTERVENTIONS,categoryAllows:scenarioCategoryAllows,reliabilitySensitivity:reliabilitySensitivityCandidates,study:buildScenarioStudy,economics:evaluateScenarioEconomics,confirm:assessScenarioConfirmation,pairedSummary:scenarioPairedSummary};
})();
