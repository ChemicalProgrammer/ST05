// Bounded, lossless transport. Cache entries are scoped to the authenticated
// user and expire after ten minutes. A lost cache entry fails the request;
// it never saves a truncated case or modifies the previous saved revision.
var ST_CASE_TRANSFER_={maxBytes:32*1024*1024,partChars:64*1024,maxParts:768,batch:8,ttl:600,directChars:2*1024*1024};
function caseTransferError_(message){throw createSimulatorError_('CASE_TRANSFER_FAILED',message||'The case transfer is incomplete or expired. Retry; your draft is retained.');}
function caseTransferToken_(token,count){
  if(typeof token!=='string'||!/^[a-f0-9]{32}$/.test(token)||!Number.isInteger(count)||count<1||count>ST_CASE_TRANSFER_.maxParts)caseTransferError_('Invalid case transfer.');
  return 'st-case-transfer:'+token+':';
}
function caseTransferFormat_(format,bytes){
  if(!['gzip-base64','json-base64'].includes(format)||!Number.isInteger(bytes)||bytes<1||bytes>ST_CASE_TRANSFER_.maxBytes)caseTransferError_('Invalid case transfer format or size.');
}
function discardCaseTransfer_(token,count){
  var prefix=caseTransferToken_(token,count),cache=CacheService.getUserCache();
  cache.removeAll([prefix+'meta'].concat(Array.from({length:count},function(_,i){return prefix+i;})));
}
function stageCaseTransfer_(request,user){
  var r=request||{},prefix=caseTransferToken_(r.token,r.count);caseTransferFormat_(r.format,r.bytes);
  if(!Number.isInteger(r.start)||r.start<0||!Array.isArray(r.parts)||!r.parts.length||r.parts.length>ST_CASE_TRANSFER_.batch||r.start+r.parts.length>r.count)caseTransferError_('Invalid case transfer segment.');
  var cache=CacheService.getUserCache(),key=prefix+'meta',old=cache.get(key),meta=old?JSON.parse(old):null;
  if(r.start===0){if(meta)caseTransferError_('Case transfer token already exists.');meta={owner:user.email,count:r.count,format:r.format,bytes:r.bytes,next:0};}
  if(!meta||meta.owner!==user.email||meta.count!==r.count||meta.format!==r.format||meta.bytes!==r.bytes||meta.next!==r.start)caseTransferError_();
  var values={};r.parts.forEach(function(part,i){
    var index=r.start+i,last=index===r.count-1;
    if(typeof part!=='string'||!part.length||part.length>ST_CASE_TRANSFER_.partChars||(!last&&part.length!==ST_CASE_TRANSFER_.partChars)||!/^[A-Za-z0-9+/]+={0,2}$/.test(part)||(!last&&part.includes('=')))caseTransferError_('Invalid case transfer segment.');
    values[prefix+index]=part;
  });
  meta.next+=r.parts.length;values[key]=JSON.stringify(meta);cache.putAll(values,ST_CASE_TRANSFER_.ttl);
  return {received:meta.next,total:meta.count};
}
function decodeCasePayload_(payload,user){
  if(!payload||payload.__stCaseTransfer!==1){
    if(payload){var raw=JSON.stringify(payload),limit=ST_CASE_TRANSFER_.maxBytes;if(raw.length>limit||(raw.length>Math.floor(limit/3)&&Utilities.newBlob(raw).getBytes().length>limit))caseTransferError_('The case exceeds the 32 MB transfer limit.');}
    return payload;
  }
  caseTransferFormat_(payload.format,payload.bytes);
  var encoded=payload.data;
  if(payload.token!==undefined){
    var prefix=caseTransferToken_(payload.token,payload.count),cache=CacheService.getUserCache();
    try{
      var metadata=cache.get(prefix+'meta'),meta=metadata?JSON.parse(metadata):null;
      if(!meta||meta.owner!==user.email||meta.count!==payload.count||meta.next!==meta.count||meta.bytes!==payload.bytes||meta.format!==payload.format)caseTransferError_();
      var keys=Array.from({length:meta.count},function(_,i){return prefix+i;}),parts=cache.getAll(keys);
      if(keys.some(function(key){return typeof parts[key]!=='string';}))caseTransferError_();
      encoded=keys.map(function(key){return parts[key];}).join('');
    }finally{try{discardCaseTransfer_(payload.token,payload.count);}catch(ignore){}}
  }else if(typeof encoded!=='string'||encoded.length>ST_CASE_TRANSFER_.directChars)caseTransferError_('Invalid direct case transfer.');
  if(typeof encoded!=='string'||encoded.length>ST_CASE_TRANSFER_.maxParts*ST_CASE_TRANSFER_.partChars||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))caseTransferError_('Invalid case transfer data.');
  try{
    var bytes=Utilities.base64Decode(encoded),blob;
    if(payload.format==='gzip-base64'){
      // gzip stores the uncompressed length in its final four bytes.
      // Reject mismatched or over-limit claims before decompression.
      if(bytes.length<18)caseTransferError_('Invalid compressed case.');
      var n=bytes.length,size=(bytes[n-4]&255)+(bytes[n-3]&255)*256+(bytes[n-2]&255)*65536+(bytes[n-1]&255)*16777216;
      if(size!==payload.bytes)caseTransferError_('Invalid compressed case size.');
      blob=Utilities.ungzip(Utilities.newBlob(bytes,'application/gzip'));
    }else blob=Utilities.newBlob(bytes,'application/json');
    if(blob.getBytes().length!==payload.bytes)caseTransferError_('Case transfer size mismatch.');
    var value=JSON.parse(blob.getDataAsString('UTF-8'));
    if(!value||typeof value!=='object'||Array.isArray(value))caseTransferError_('Invalid case transfer JSON.');
    return value;
  }catch(error){if(error?.simulatorError)throw error;caseTransferError_('The case transfer could not be decoded. Retry; your draft is retained.');}
}
