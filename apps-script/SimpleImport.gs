// Link-only import. Persist the compatible worksheet as one new draft; never
// create an empty placeholder before reading/recognizing its layout.
function simpleImportedCase_(preview){
  var source=preview.source||{},metadata=preview.metadata||{},equipment=JSON.parse(JSON.stringify(preview.equipment||[]));
  var issues=(preview.errors||[]).slice(),warnings=(preview.warnings||[]).slice();
  function issue(message){issues.push({cell:'',message:message});}
  equipment.forEach(function(e,i){
    e.characteristics=e.characteristics||{};
    if(!e.name||!e.name.trim())e.name='Equipment row '+(e.characteristics.sourceSheetRow||i+1);
    if(!(Number.isFinite(e.nominalRatePerSecond)&&e.nominalRatePerSecond>0)){
      e.nominalRatePerSecond=null;e.characteristics.importedMissingNominalRate=true;issue('Missing nominal rate: '+e.name);
    }
    e.processData=e.processData||{};
  });
  var catalog=null,initialFormatId,packers=equipment.filter(e=>e.type==='CASE_PACKER'),packIndex=equipment.indexOf(packers[0]);
  if(preview.materialCatalog){
    if(preview.materialCatalog.errors?.length){preview.materialCatalog.errors.forEach(issue);}
    else{
      catalog=JSON.parse(JSON.stringify(preview.materialCatalog.catalog));
      // Legacy exported profiles identify equipment by the original row ID.
      var idMap=new Map((preview.sourceRows||[]).map(r=>[r.equipmentId,equipment.find(e=>e.characteristics.sourceSheetRow===r.row)?.id]).filter(p=>p[0]&&p[1]));
      for(var kind of ['products','formats'])for(var record of catalog[kind]||[]){
        var remapped={};
        Object.entries(record.equipment||{}).forEach(function(pair){
          var id=idMap.get(pair[0])||equipment.find(e=>e.id===pair[0])?.id;
          if(id)remapped[id]=pair[1];else issue('Unmapped format equipment: '+pair[0]);
        });
        record.equipment=remapped;
      }
      initialFormatId=preview.materialCatalog.initialFormatId||catalog.formats.find(f=>f.name===metadata.formatName)?.id||catalog.formats[0]?.id;
    }
  }
  var initial=catalog?.formats?.find(f=>f.id===initialFormatId),pack=initial?.bottlesPerCase??metadata.bottlesPerCase;
  var validPack=Number.isInteger(pack)&&pack>0&&pack<=10000;
  if(packers.length>1)issue('Multiple packing transitions require format review.');
  if(packers.length===1&&(!validPack||catalog&&!initial))issue('Select a valid initial packing format and bottles per case.');
  if(packers.length===1&&validPack&&(!catalog||initial)){
    if(!catalog){
      var product={id:'sheet-product',name:String(metadata.containerSize||'Imported product'),bottle:{},equipment:{}};
      initial={id:'sheet-format',name:String(metadata.formatName||'Imported format'),productId:product.id,bottlesPerCase:pack,case:{},equipment:{}};
      catalog={version:3,products:[product],formats:[initial]};initialFormatId=initial.id;
    }
    // Marked app-exported templates contain native equipment rates. The legacy
    // unmarked plant sheet declares bottle-equivalent machine rates.
    var native=/^st-equipment-metadata-b-v[1-7]$/.test(source.templateMarker||'');
    equipment.forEach(function(e,i){
      var explicit=e.processData?.flowUnits,profile=initial?.equipment?.[e.id];
      var input=explicit?.input||profile?.inputUnit||(i<=packIndex?'BOTTLES':'CASES'),output=explicit?.output||profile?.outputUnit||(i<packIndex?'BOTTLES':'CASES');
      e.processData.flowUnits={input:input,output:output};e.unitOfFlow=output.toLowerCase();
      if(e.type!=='CONVEYOR')e.characteristics.rateBasis=output==='CASES'?'cases per minute':'bottles per minute';
      if(output==='CASES'&&!native){
        if(e.nominalRatePerSecond!==null)e.nominalRatePerSecond/=pack;
        if(e.processData.equipment?.maximumSpeedBpm!=null)e.processData.equipment.maximumSpeedBpm/=pack;
      }
      catalog.formats.forEach(function(f){f.equipment=f.equipment||{};f.equipment[e.id]=Object.assign({},f.equipment[e.id]||{},{inputUnit:input,outputUnit:output});});
    });
    warnings.push({cell:'F',message:native?'Imported native rates from marked template.':'Converted legacy bottle-equivalent rates after Case Packer using bottles per case.'});
  }else if(!packers.length){
    equipment.forEach(function(e){if(!e.processData.flowUnits)e.processData.flowUnits={input:'BOTTLES',output:'BOTTLES'};e.unitOfFlow=e.processData.flowUnits.output.toLowerCase();});
  }
  if(catalog){try{STScenarioEngine_.validateFormatCatalog(catalog);}catch(error){issue(error.message);catalog=null;initialFormatId=undefined;}}
  if(equipment.length<2)issue('At least two equipment units are required for simulation.');
  var name=[metadata.packagingLine,metadata.formatName].filter(v=>v!=null&&String(v).trim()).join(' · ')||source.spreadsheetName||source.sheetName||'Imported case';
  var run={durationMode:'SHIFTS',durationSeconds:28800,shiftHours:8,shiftCount:1,rounds:1,tickSeconds:.25,sampleEverySeconds:5,calculationMode:'FAST',calculationPreference:'FAST',machineDesignEnabled:false,machineMaximumSpeedEnabled:false,engineId:'ST_CURRENT',seed:20260909,eventsEnabled:false,includePlantCalendar:false};
  if(initialFormatId){run.initialFormatId=initialFormatId;run.initialProductId=initialFormatId;}
  return {name:String(name).trim().slice(0,120)||'Imported case',unitOfFlow:'bottles',equipment:equipment,metadata:{workspaceMode:'MINIMAL',dataClassification:'USER_PROVIDED',...(catalog?{formatCatalog:catalog}:{})},
    simulations:[{id:'simulation-a',name:'Simulation A',equipment:equipment,dynamicConfig:run,results:null,sourceImport:{source:source,metadata:metadata,rows:preview.sourceRows||[],warnings:warnings,notes:preview.notes||[],simpleImportIssues:issues,...(preview.materialCatalog?.errors?.length?{unresolvedMaterialCatalog:preview.materialCatalog}:{})}}]};
}
