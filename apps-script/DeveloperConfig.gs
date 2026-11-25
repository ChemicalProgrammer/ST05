// Edit developer contacts here. This file is independent of interface text and layout.
var ST_APP_DEVELOPERS = [
  {
    "name": "Developer 1",
    "email": "developer1@example.com"
  },
  {
    "name": "Developer 2",
    "email": "developer2@example.com"
  },
  {
    "name": "Developer 3",
    "email": "developer3@example.com"
  }
];

function getAppDevelopers_() {
  return ST_APP_DEVELOPERS.map(function(developer) {
    return {name:String(developer.name || ''),email:String(developer.email || '').trim()};
  });
}


// Set a single approved support mailbox before deployment.
// Leave empty to let the user enter a recipient in Gmail; never use a fake
// developer address or send a report automatically.
var ST_ERROR_REPORT_EMAIL = '';

function getErrorReportEmail_() {
  var email=String(ST_ERROR_REPORT_EMAIL||'').trim();
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)?email:'';
}
