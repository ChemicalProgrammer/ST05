/** Default presentation mode; a local browser preference may override this default. */
function getInterfaceMode_() {
  var value = String(PropertiesService.getScriptProperties().getProperty('ST_UI_MODE') || '').trim().toUpperCase();
  // BASIC used to be the deployment default; explicit Standard preserves that workspace.
  return ['ADVANCE','ADVANCED'].includes(value)?'ADVANCE':['STANDARD','LEGACY_BASIC'].includes(value)?'BASIC':'MINIMAL';
}
