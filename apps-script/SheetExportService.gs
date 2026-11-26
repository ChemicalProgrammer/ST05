// Writes a new native Sheet; never changes the source used for import.
function exportEquipmentSheet_(request, user) {
  if (!request || typeof request !== 'object') throw createSimulatorError_('INVALID_SHEET_REQUEST','Equipment export inputs are required.');
  var mode=sheetRequestUiMode_(request);
  if(request.caseSnapshot)browserCaseSnapshot_(request,user);else getOwnedCaseFile_(request.caseId, user, true);
  if (!Array.isArray(request.equipment) || request.equipment.length > 1000) {
    throw createSimulatorError_('INVALID_SHEET_REQUEST','Export at most 1,000 equipment rows.');
  }
  var book,file,stage='PREPARE_EQUIPMENT';
  try {
    var equipment=normalizeEquipmentList_(request.equipment),metadata=normalizeCaseMetadata_(request.metadata);
    stage='PREPARE_CATALOG';
    var policy=sheetModeColumns_(mode),data=equipmentSheetData_(equipment,metadata,mode),catalog=STScenarioEngine_.normalizeFormatCatalog(metadata,equipment);
    STScenarioEngine_.validateFormatCatalog(catalog);
    var hasCatalog=catalog.products.length||catalog.formats.length;
    stage='VALIDATE_EQUIPMENT';
    var date=sheetAnalysisDate_(data.metadata[5])||sheetAnalysisDate_(data.metadata[6]);
    data.metadata[5]=date||'';
    if(hasCatalog)data.metadata.splice(2,3,'','','');
    data.metadata[6]=sheetResponsibleName_(data.metadata[6])||'';
    // Validate the same contract as Preview before creating a spreadsheet.
    var stopRows=equipment.map(function(unit){
      var inputs=unit.processData?.equipment?.stopInputs;
      return ['minor','major'].flatMap(function(kind){
        return ['mtbfMinutes','mttrMinutes'].map(function(field){return inputs?.[kind]?.[field]??'';});
      });
    });
    stopRows.forEach(function(row,index){if(row.some(function(value){return value!=='';}))data.rows[index].splice(3,2,'','');});
    var review=parseEquipmentSheet_(data.metadata,data.rows,[],data.layout,{mode:mode,nominalOnlyColumn:!policy.maximum,nominalSpeedRows:policy.maximum?equipment.map(function(unit){return [unit.nominalRatePerSecond*60];}):null,start:8,inlineStops:true,stopRows:stopRows,metadataCells:compactEquipmentMetadataCells_(),allowEmpty:true});
    if (!review.canImport) throw createSimulatorError_('INVALID_SHEET_EXPORT','Some values cannot be represented in the import format.',review.errors.map(function(issue){return issue.cell+': '+issue.message;}));
    stage='OPEN_EXPORTS_FOLDER';
    var folder=getWorkspaceFolders_().exports;
    var name=String(request.caseName||'Case').trim().slice(0,120)+' · '+String(request.simulationName||'Simulation').trim().slice(0,80)+' · Equipment';
    var primary=sheetExportColor_(request.theme?.primary,'#5485a4');
    var width=policy.maximum?35:policy.residence?34:32,slots=Math.min(1000,Math.max(100,equipment.length+50));
    stage='CREATE_SPREADSHEET';
    book=SpreadsheetApp.create(name,slots+7,width);
    stage='MOVE_TO_EXPORTS';
    file=DriveApp.getFileById(book.getId());
    file.moveTo(folder);
    stage='WRITE_VALUES';
    var sheet=book.getSheets()[0];sheet.setName('Equipment');

    var values=Array.from({length:slots+7},function(){return Array(width).fill('');});
    var labels=['Site','Packaging line','Format','Container size','Bottles per case','Date of analysis','By'];
    var cells=compactEquipmentMetadataCells_();
    labels.forEach(function(label,index){
      var value=data.metadata[index],cell=cells[index],row=Number(cell.slice(1))-1,column=cell.charCodeAt(0)-65;
      if(index>=2&&index<=4&&(hasCatalog||value==='NA'||value===''))return;
      values[row][column-1]=label;
      values[row][column]=index===5&&date?(Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000:sheetExportLiteral_(value);
    });
    sheet.getRange(3,2).setNumberFormat('dd mmm yyyy');
    sheet.getRange(4,2).setNumberFormat('@');
    values[0][29]='st-equipment-metadata-b-v7';
    var groups=[['Equipment',3,10],['Geometry',13,4],['Upstream',17,4],['Downstream',21,2],['Speed & Sensors',23,7]];
    if(policy.capacity)groups.push(['Machine capacity',31,1]);
    groups.push(['Upstream · Conveyor Analysis',32,policy.firstPackage?2:1]);
    if(policy.residence)groups.push(['Machine timing',34,1]);
    if(policy.maximum)groups.push(['Operating speed',35,1]);
    groups.forEach(function(group){values[5][group[1]-1]=group[0];});
    values[6]=sheetImportColumns_(data.layout).map(function(column){return sheetColumnHeading_(column[1]==='bottlesDischargedAtStop'?column[2]+' (bottles)':column[0]==='D'||column[0]==='E'?'General '+column[2]:column[2]);}).concat(['Equipment ID','Internal capacity\n[input bottles/cases]',sheetColumnHeading_(sheetDischargeVelocityHeading_()),sheetColumnHeading_(sheetRestartFirstPackageHeading_()),'Residence time [s]']);
    values[6].splice(3,0,'Minor MTBF\n[min]','Minor MTTR\n[min]','Major MTBF\n[min]','Major MTTR\n[min]');
    if(!policy.maximum)values[6][9]='Machine nominal speed\n[units/min]';
    if(!policy.capacity)values[6][30]='';
    if(!policy.firstPackage)values[6][32]='';
    if(!policy.residence)values[6][33]='';
    if(policy.maximum)values[6][34]='Machine nominal speed\n[units/min]';
    values[6]=values[6].slice(0,width);
    data.rows.forEach(function(row,index){
      var visible=row.slice(0,25);visible.splice(3,0,...stopRows[index]);
      var unit=equipment[index],conveyor=unit.type==='CONVEYOR';
      values[index+7]=visible.concat([unit.id],row.slice(25),[conveyor?unit.processData?.upstream?.dischargeVelocityMPerMinute??'':'',policy.firstPackage&&conveyor?unit.processData?.accumulation?.restartToFirstPackageSeconds??'':'',policy.residence&&!conveyor?unit.processData?.equipment?.residenceTimeSeconds??'':'',policy.maximum?unit.nominalRatePerSecond*60:'']).slice(0,width).map(sheetExportLiteral_);
    });
    for(var i=equipment.length;i<slots;i++)values[i+7][29]='slot-'+book.getId()+'-'+(i+1);
    sheet.getRange(8,30,slots,1).setNumberFormat('@');
    sheet.getRange(1,1,values.length,width).setValues(values).setFontFamily('Arial').setFontSize(10).setFontColor('#000000').setVerticalAlignment('middle');
    stage='WRITE_CATALOG';
    writeSheetCatalog_(book.insertSheet('Products & Formats',1),catalog,primary);
    if(policy.realData){
      stage='WRITE_REAL_DATA';
      writeSheetActuals_(book.insertSheet('Real Data',2),values.slice(7),primary,8);
    }
    book.setActiveSheet(sheet);
    stage='FORMAT_SHEET';
    cells.forEach(function(cell){
      var row=Number(cell.slice(1)),column=cell.charCodeAt(0)-64;
      if(values[row-1][column-2])sheet.getRange(row,column-1).setBackground(sheetExportTint_(primary));
      sheet.getRange(row,column-1).setFontWeight('bold');
    });
    groups.forEach(function(group){
      var band=sheet.getRange(6,group[1],1,group[2]);
      band.merge();
      band.setBackground(sheetExportTint_(primary,.38)).setFontWeight('bold').setHorizontalAlignment('center');
      sheetExportGroupDivider_(band,sheet.getRange(7,group[1],slots+1,1),primary);
    });
    sheet.hideColumns(30);
    if(!policy.capacity)sheet.hideColumns(31);
    if(!policy.firstPackage&&width>=33)sheet.hideColumns(33);
    var types=SpreadsheetApp.newDataValidation().requireValueInList(supportedEquipmentTypes_(),true).setAllowInvalid(false).build();
    sheet.getRange(8,1,slots,1).setDataValidation(types);
    var critical=SpreadsheetApp.newDataValidation().requireValueInList(['Y','N'],true).setAllowInvalid(false).build();
    sheet.getRange(8,3,slots,1).setDataValidation(critical).setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.getRange(7,1,1,width).setBackground(sheetExportTint_(primary)).setFontWeight('bold').setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle');
    if(data.rows.length){
      sheet.getRange(8,1,data.rows.length,29).setWrap(true);
      sheet.getRange(8,4,data.rows.length,26).setNumberFormat('0.########').setHorizontalAlignment('right');
      sheet.getRange(8,2,data.rows.length,1).setFontWeight('bold');
      sheet.setRowHeights(8,data.rows.length,28);
    }
    stage='FREEZE_HEADERS';sheet.setFrozenRows(7);sheet.setFrozenColumns(2);
    stage='SIZE_COLUMNS';
    sheet.setColumnWidths(1,width,130);sheet.setColumnWidth(2,220);sheet.setColumnWidth(3,120);
    sheet.setRowHeights(1,4,32);sheet.setRowHeight(5,16);sheet.setRowHeight(6,28);sheet.setRowHeight(7,68);
    stage='CREATE_FILTER';sheet.getRange(7,1,slots+1,width).createFilter();
    stage='FLUSH';
    SpreadsheetApp.flush();
    return {spreadsheetId:book.getId(),url:book.getUrl(),sheetName:sheet.getName(),equipmentCount:data.rows.length,
      uiMode:mode,tabNames:policy.realData?['Equipment','Products & Formats','Real Data']:['Equipment','Products & Formats'],
      sheetTemplateVersion:sheetTemplateVersion_()};
  } catch (error) {
    var details=['Exporter: equipment-actuals-catalog-v3','Stage: '+stage,'Service: '+safeSheetErrorDetail_(error)];
    // Only the new export belongs to this operation; clean up an incomplete export.
    if(book)try{(file||DriveApp.getFileById(book.getId())).setTrashed(true);}catch(cleanupError){details.push('The incomplete export could not be removed.');}
    if(error?.simulatorError){
      error.simulatorError.details=[...details.slice(0,2),...(error.simulatorError.details||[]),...details.slice(3)];
      throw error;
    }
    console.error(JSON.stringify({event:'SHEET_EXPORT_FAILED',stage:stage,message:safeSheetErrorDetail_(error)}));
    throw createSimulatorError_('SHEET_EXPORT_FAILED','Spreadsheet export could not be completed. See the technical details below.',details);
  }
}

function writeSheetActuals_(sheet,equipmentRows,primary,equipmentStart) {
  var count=equipmentRows.length,height=count+15,width=10;
  if(sheet.getMaxRows()<height)sheet.insertRowsAfter(sheet.getMaxRows(),height-sheet.getMaxRows());
  var rows=Array.from({length:height},function(){return Array(width).fill('');});
  rows[0][9]='st-real-inputs-v5';
  rows[0][0]='Line Time';rows[0][3]='Production';
  rows[7][3]='Indicators';
  ['Total time [min]','Business external downtime [min]','Plant available time [min]','Plant decision downtime [min]','Production available time [min]','Unplanned line downtime [min]','Reported run time [min]','Line rate loss [min]','Time balance [min]'].forEach(function(label,i){rows[i+1][0]=sheetColumnHeading_(label);});
  ['Shift 1 [cases]','Shift 2 [cases]','Shift 3 [cases]','Production [cases]','Production [bottles]'].forEach(function(label,i){rows[i+1][3]=sheetColumnHeading_(label);});
  ['AU [%]','UPDT [%]','Tolerance [%]','Equipment check'].forEach(function(label,i){rows[i+8][3]=sheetColumnHeading_(label);});
  rows[10][4]=.25;
  rows[11][4]='=IF(COUNTIF(I16:I'+height+',"REVIEW VARIANCE")+COUNTIF(I16:I'+height+',"REVIEW MINUTES")>0,"REVIEW",IF(COUNTIF(I16:I'+height+',"WITHIN TOLERANCE")=0,"PENDING",IF(COUNTIF(I16:I'+height+',"PENDING")>0,"PARTIAL CHECK","WITHIN TOLERANCE")))';
  rows[3][1]='=IF(COUNT(B2:B3)=2,B2-B3,"")';
  rows[5][1]='=IF(COUNT(B4:B5)=2,B4-B5,"")';
  rows[9][1]='=IF(COUNT(B6:B8)=3,B6-B7-B8,"")';
  rows[13][0]='Equipment Downtime';rows[13][3]='MTBF/MTTR Check';
  rows[14]=['Equipment','Reported downtime [min]','Reported downtime [%]','MTBF [min]','MTTR [min]','Expected downtime [min]','Expected − reported [min]','Variance [%]','Check','Equipment ID'].map(sheetColumnHeading_);
  // Bind editable actuals to stable slots so sorting Equipment cannot reassign captured values.
  equipmentRows.filter(function(row){return row[0]&&row[0]!=='CONVEYOR';})
    .concat(equipmentRows.filter(function(row){return row[0]==='CONVEYOR'||!row[0];}))
    .forEach(function(e,i){
      var line=i+16,row=rows[i+15],last=equipmentStart-1+count,key='MATCH(J'+line+',Equipment!$AD$'+equipmentStart+':$AD$'+last+',0)';
      var lookup=function(column){return 'INDEX(Equipment!$'+column+'$'+equipmentStart+':$'+column+'$'+last+','+key+')';};
      row[9]=e[29];
      var present='COUNTIFS(Equipment!$AD$'+equipmentStart+':$AD$'+last+',J'+line+',Equipment!$A$'+equipmentStart+':$A$'+last+',"<>",Equipment!$B$'+equipmentStart+':$B$'+last+',"<>")=1';
      row[0]='=IFERROR(IF(AND('+present+','+lookup('A')+'<>"CONVEYOR"),'+lookup('B')+',"") ,"")';
      var minorBf=lookup('D'),minorTr=lookup('E'),majorBf=lookup('F'),majorTr=lookup('G');
      var rate=function(bf){return 'IF('+bf+'>0,1/'+bf+',0)';};
      var total='('+rate(minorBf)+'+'+rate(majorBf)+')';
      var valid=function(bf,tr){return 'AND(NOT(ISBLANK('+bf+')),NOT(ISBLANK('+tr+')),ISNUMBER('+bf+'),ISNUMBER('+tr+'),OR(AND('+bf+'>0,'+tr+'>0),AND('+bf+'=0,'+tr+'=0)))';};
      var split='OR('+[minorBf,minorTr,majorBf,majorTr].map(function(cell){return 'AND(NOT(ISBLANK('+cell+')),ISNUMBER('+cell+'))';}).join(',')+')';
      var usable='AND('+valid(minorBf,minorTr)+','+valid(majorBf,majorTr)+','+total+'>0)';
      ['1/'+total,'('+rate(minorBf)+'*'+minorTr+'+'+rate(majorBf)+'*'+majorTr+')/'+total].forEach(function(aggregate,j){
        var general=lookup(j?'I':'H');
        row[3+j]='=IFERROR(IF(LEN(A'+line+')=0,"",IF('+split+',IF('+usable+','+aggregate+',"") ,IF(AND(ISNUMBER('+general+'),'+general+'>0),'+general+',""))),"")';
      });
      row[5]='=IF(AND(COUNT(D'+line+':E'+line+')=2,ISNUMBER($B$6),$B$6>0),$B$6*E'+line+'/(D'+line+'+E'+line+'),"")';
      row[6]='=IF(COUNT(B'+line+',F'+line+')=2,F'+line+'-B'+line+',"")';
      row[7]='=IF(AND(ISNUMBER(G'+line+'),B'+line+'>0),G'+line+'/B'+line+',"")';
      row[8]='=IF(LEN(A'+line+')=0,"",IF(OR(COUNT(B'+line+',F'+line+')<2,NOT(ISNUMBER($E$11)),$E$11<0),"PENDING",IF(OR(B'+line+'<0,B'+line+'>$B$6),"REVIEW MINUTES",IF(AND(ISNUMBER(H'+line+'),ABS(H'+line+')<=$E$11),"WITHIN TOLERANCE","REVIEW VARIANCE"))))';
    });
  sheet.getRange(1,1,height,width).setValues(rows).setFontFamily('Arial').setFontSize(10).setFontColor('#000000').setVerticalAlignment('middle');
  [[1,1,2],[1,4,2],[8,4,2],[14,1,3],[14,4,6]].forEach(function(group){
    sheet.getRange(group[0],group[1],1,group[2]).merge().setFontWeight('bold').setBackground(sheetExportTint_(primary,.38)).setHorizontalAlignment('center');
  });
  [sheet.getRange(2,1,9,1),sheet.getRange(2,4,5,1),sheet.getRange(9,4,4,1)].forEach(function(range){
    range.setBackground(sheetExportTint_(primary)).setFontWeight('bold').setWrap(true).setHorizontalAlignment('center');
  });
  sheet.getRange(15,1,1,9).setFontWeight('bold').setBackground(sheetExportTint_(primary)).setWrap(true).setHorizontalAlignment('center');
  [sheet.getRange(4,2),sheet.getRange(6,2),sheet.getRange(10,2),sheet.getRange(12,5),
    sheet.getRange(16,1,count,1),sheet.getRange(16,4,count,6)].forEach(function(range){
    sheetExportProtectFormula_(range,primary);
  });
  sheet.getRange(9,5,3,1).setNumberFormat('0.00%');
  sheet.getRange(16,3,count,1).setNumberFormat('0.00%');
  sheet.getRange(16,4,count,4).setNumberFormat('0.00');sheet.getRange(16,8,count,1).setNumberFormat('0.0%');
  sheet.setColumnWidths(1,width,135);sheet.setColumnWidth(1,250);sheet.setColumnWidth(9,175);
  sheet.setRowHeights(2,11,36);sheet.setRowHeight(15,50);sheet.setFrozenRows(15);sheet.hideColumns(10);
}

function equipmentSheetData_(equipment, metadata, mode) {
  function value(object,key){var v=object?.[key];return v===undefined||v===null||v===''?'NA':v;}
  function current(object,key,fallback,fallbackKey){return Object.prototype.hasOwnProperty.call(object,key)?value(object,key):value(fallback,fallbackKey||key);}
  var fields=['site','packagingLine','formatName','containerSize','bottlesPerCase','dateOfAnalysis','by'];
  var speeds=new Map();
  if(typeof STScenarioEngine_!=='undefined')try{STScenarioEngine_.audit({equipment:equipment}).forEach(function(row){var speed=row.engineering?.runtimeGeometry?.conveyorSpeedMmPerSecond;if(speed>0)speeds.set(row.equipmentId,speed);});}catch(ignore){}
  return {layout:'plant-sheet-v2',metadata:fields.map(function(key){return key==='containerSize'&&!Object.prototype.hasOwnProperty.call(metadata,key)&&metadata.containerSizeOz!=null?metadata.containerSizeOz+' oz':value(metadata,key);}),rows:equipment.map(function(unit){
    var d=unit.processData||{},e=d.equipment||{},g=d.geometry||{},u=d.upstream||{},down=d.downstream||{},s=d.speedAndSensors||{},a=d.accumulation||{};
    var reliability=unit.noiseProfile?.reliability||{},conveyor=unit.type==='CONVEYOR',c=unit.characteristics||{};
    var critical=!conveyor&&(typeof c.isPacemaker==='boolean'?c.isPacemaker:typeof c.criticalMachine==='boolean'?c.criticalMachine:['PACEMAKER','CRITICAL_MACHINE'].indexOf(d.role)>=0||unit.type==='PACEMAKER');
    var type=unit.type==='PACEMAKER'?(supportedEquipmentTypes_().includes(d.machineType)&&d.machineType!=='PACEMAKER'?d.machineType:'CUSTOM'):unit.type;
    var dischargeLength=g.actualDischargeMm??a.dischargeRunoutLengthMm,codingLength=g.actualCodingMm??a.rejectRunoutLengthMm;
    var row=[type,unit.name,critical?'Y':'N',value(reliability,'mtbfMinutes'),value(reliability,'mttrMinutes'),
      mode?(mode==='ADVANCE'?e.maximumSpeedBpm??'NA':unit.nominalRatePerSecond*60):(e.maximumSpeedBpm==null?unit.nominalRatePerSecond*60:e.maximumSpeedBpm),
      value(g,'lactMm'),value(g,'lpPrimeMm'),dischargeLength??'NA',codingLength??'NA',
      value(u,'packageLengthMm'),value(u,'dischargePitchMm'),value(u,'startupTimeSeconds'),conveyor?current(a,'bottlesDischargedAtStop',u):value(u,'bottlesDischargedAtStop'),
      value(down,'infeedPitchMm'),conveyor?current(a,'downstreamRampUpSeconds',down,'rampUpTimeSeconds'):value(down,'rampUpTimeSeconds'),
      conveyor?current(a,'conveyorSpeedFactorPercent',s,'conveyorSpeedFactorVsDischargeVelocityPercent'):value(s,'conveyorSpeedFactorVsDischargeVelocityPercent'),
      value(s,'codingConveyorSpeedFactorVsPreviousConveyorPercent'),value(s,'conveyorSpeedFactorVsPreviousConveyorPercent'),
      conveyor?current(a,'blockedTimeDelaySeconds',s):value(s,'blockedTimeDelaySeconds'),conveyor?current(a,'clearTimeDelaySeconds',s):value(s,'clearTimeDelaySeconds'),
      conveyor?current(a,'insuranceFactorUnits',s):value(s,'insuranceFactorUnits'),value(s,'overspeedVsInfeedScrewPercent')];
    var belt=a.speedMode==='MANUAL'&&a.targetPopulationPercent===undefined&&a.targetOverspeedPercent===undefined?a.conveyorSpeedMmPerSecond:speeds.get(unit.id);
    row.splice(6,0,conveyor&&belt>0?Number((belt*.06).toPrecision(12)):'NA',conveyor?value(a,'declaredAccumulationSeconds'):'NA');
    row.push(conveyor||mode==='MINIMAL'?'':e.internalCapacityBottles??'');
    return row;
  })};
}

function sheetExportLiteral_(value) {
  // setValues interprets a leading equals sign as a formula, even in a user name.
  if(typeof value==='string') {
    if(value.length>50000)throw createSimulatorError_('INVALID_SHEET_EXPORT','A worksheet value is too long.');
    return value.charAt(0)==='='?"'"+value:value;
  }
  return value;
}
function sheetExportColor_(value,fallback){return /^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;}
function sheetExportTint_(hex,weight){
  weight=weight??.24;
  return '#'+[1,3,5].map(function(offset){
    var channel=parseInt(hex.slice(offset,offset+2),16);
    return Math.round(255+(channel-255)*weight).toString(16).padStart(2,'0');
  }).join('');
}

function sheetColumnHeading_(label){
  return label.replace(/\s+(?:\(([^()]+)\)|\[([^\[\]]+)\])$/, function(match,parenthesized,bracketed){
    return '\n['+(parenthesized||bracketed)+']';
  });
}

function writeSheetCatalog_(sheet,catalog,primary){
  var units=STScenarioEngine_.productVolumeUnits,width=8;
  // Each Product owns the Format rows immediately below it, without a link column.
  var rows=[['st-material-sheet-v3','','','','','','',''],
    ['Catalog','','Volume','','Dimensions','','','Packing'],
    ['Type','Name','Volume','Volume Unit','Length\n[mm]','Width\n[mm]','Height\n[mm]','Bottles per Case']];
  var grouped=new Map();
  catalog.formats.forEach(function(format){
    if(!grouped.has(format.productId))grouped.set(format.productId,[]);
    grouped.get(format.productId).push(format);
  });
  catalog.products.forEach(function(product){
    var unit=product.volumeUnit||'mL',shape=product.bottle||{};
    rows.push(['Product',product.name,product.volumeMl===undefined?'':product.volumeMl/units[unit],unit,
      shape.lengthMm,shape.widthMm,shape.heightMm,'N/A'].map(function(value){return sheetExportLiteral_(value??'');}));
    (grouped.get(product.id)||[]).forEach(function(format){
      var shape=format.case||{};
      rows.push(['Format',format.name,'','',shape.lengthMm,shape.widthMm,shape.heightMm,format.bottlesPerCase]
        .map(function(value){return sheetExportLiteral_(value??'');}));
    });
  });
  sheet.hideRows(1);
  sheet.getRange(4,2,200,1).setNumberFormat('@');
  sheet.getRange(4,4,200,1).setNumberFormat('@');
  sheet.getRange(1,1,rows.length,width).setValues(rows);
  sheet.getRange(2,1,202,width).setFontFamily('Arial').setFontSize(10).setFontColor('#000000').setVerticalAlignment('middle');
  [[1,2],[3,2],[5,3]].forEach(function(group){sheet.getRange(2,group[0],1,group[1]).merge();});
  sheet.getRange(2,1,1,width).setBackground(sheetExportTint_(primary,.38)).setFontWeight('bold').setHorizontalAlignment('center');
  [[3,2],[5,3],[8,1]].forEach(function(group){
    sheetExportGroupDivider_(sheet.getRange(2,group[0],1,group[1]),sheet.getRange(3,group[0],201,1),primary);
  });
  sheet.getRange(3,1,1,width).setBackground(sheetExportTint_(primary)).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  [[1,['Product','Format']],[4,Object.keys(units)]].forEach(function(column){
    var validation=SpreadsheetApp.newDataValidation().requireValueInList(column[1],true).setAllowInvalid(false).build();
    sheet.getRange(4,column[0],200,1).setDataValidation(validation);
  });
  sheet.setColumnWidths(1,width,120);sheet.setColumnWidth(2,220);
  sheet.setRowHeight(3,50);sheet.setFrozenRows(3);
  sheet.getRange(3,1,201,width).createFilter();
}
function sheetExportGroupDivider_(band,columns,primary){
  var color=sheetExportTint_(primary,.65);
  [band,columns].forEach(function(range){
    range.setBorder(null,true,null,null,null,null,color,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });
}

function sheetExportProtectFormula_(range,primary){
  var protection=range.setBackground(sheetExportTint_(primary,.1)).protect().setDescription('Calculated values');
  protection.addEditor(Session.getEffectiveUser());
  var editors=protection.getEditors();
  if(editors.length)protection.removeEditors(editors);
  if(protection.canDomainEdit())protection.setDomainEdit(false);
}
