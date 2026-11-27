// Create a Gmail draft only after the user selects the case attachment.
// No email is sent by this endpoint. Gmail permission/API availability is
// optional at runtime; the browser falls back to a local sanitized download.
function errorReportCaseJson_(value,user){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.simulations)||value.ownerEmail&&value.ownerEmail!==user.email)throw createSimulatorError_('ERROR_REPORT_CASE','The case attachment is unavailable.');
  return JSON.stringify(value,function(key,item){return /^(geminiHistory|geminiMessages|geminiConversation|geminiChatHistory)$/i.test(key)?undefined:item;});
}
function createErrorReportDraft_(request,user){
  if(!request||!request.attachment)throw createSimulatorError_('ERROR_REPORT_CASE','The case attachment is unavailable.');
  var value=decodeCasePayload_(request.attachment,user),json=errorReportCaseJson_(value,user);
  var name=String(value.name||value.id||'case').replace(/[^A-Za-z0-9._-]/g,'-').slice(0,90)||'case';
  var attachment=Utilities.newBlob(json,'application/json',name+'-complete.json');
  if(attachment.getBytes().length>12*1024*1024)attachment=Utilities.zip([attachment],name+'-complete.zip');
  if(attachment.getBytes().length>18*1024*1024)throw createSimulatorError_('ERROR_REPORT_SIZE','Automatic attachment unavailable.');
  var recipient=getErrorReportEmail_(),subject='SimuLine · '+String(request.title||'Error details').replace(/[\r\n]+/g,' ').slice(0,180);
  var message=[request.title,request.message,request.details].filter(v=>typeof v==='string'&&v).join('\n\n');
  if(message.length>256*1024)throw createSimulatorError_('ERROR_REPORT_SIZE','Automatic draft unavailable.');
  var boundary='st-report-'+Utilities.getUuid().replace(/-/g,'');
  function b64(blob){return Utilities.base64Encode(blob.getBytes()).replace(/.{1,76}/g,'$&\r\n').trim();}
  var headers=['MIME-Version: 1.0',...(recipient?['To: '+recipient]:[]),'Subject: =?UTF-8?B?'+Utilities.base64Encode(subject,Utilities.Charset.UTF_8)+'?=','Content-Type: multipart/mixed; boundary="'+boundary+'"'];
  var raw=headers.join('\r\n')+'\r\n\r\n--'+boundary+'\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+b64(Utilities.newBlob(message,'text/plain'))+'\r\n--'+boundary+'\r\nContent-Type: '+attachment.getContentType()+'\r\nContent-Disposition: attachment; filename="'+attachment.getName()+'"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+b64(attachment)+'\r\n--'+boundary+'--\r\n';
  var response;
  try{response=UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts',{
    method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
    payload:JSON.stringify({message:{raw:Utilities.base64EncodeWebSafe(raw,Utilities.Charset.UTF_8).replace(/=+$/,'')}}),muteHttpExceptions:true
  });}catch(error){throw createSimulatorError_('ERROR_REPORT_DRAFT','Automatic draft unavailable.');}
  if(response.getResponseCode()<200||response.getResponseCode()>=300)throw createSimulatorError_('ERROR_REPORT_DRAFT','Automatic draft unavailable.');
  var draft=JSON.parse(response.getContentText());
  if(!draft?.id)throw createSimulatorError_('ERROR_REPORT_DRAFT','Automatic draft unavailable.');
  return {attached:true};
}
