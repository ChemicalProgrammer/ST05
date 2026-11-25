# Compact application errors

Application, sign-in, case saving, gallery refresh, Settings, Gemini, Sheet import,
configuration import and scenario errors use the shared `STErrors` presenter in
`Dialogs.html`. Each source retains its existing message node and reset behavior.
A single compact error-circle icon appears in the header immediately before Save;
the original inline text is hidden. The header groups currently active errors.
Sign-in and modal forms retain local access because the main header is unavailable
behind authentication or a modal dialog.
Clicking or keyboard-activating the icon opens an accessible shared dialog with
message, code, available details and the available local technical trace. Closing
restores focus. Warnings and normal progress/status text remain unchanged.

Static sources declare `data-error-notice` and their context title. Scenario cards
register their dynamic status node explicitly. Each source has its own observer;
there is no whole-page observer scanning charts during playback. Rich errors use
`STErrors.capture(source,error)` before asynchronous transport information is lost.
Uncaught runtime errors and rejected promises also use the application notice.

Details are shown as text, never model/remote HTML. Each message, details and
trace is bounded to 16,000 characters; nested details have depth/item limits and
repeated-reference handling. No case snapshot or request payload is collected.
Missing technical details are explicitly reported. Opening a dialog makes no
server or Gemini call. Existing retry, cancel and validation behavior is retained.
The dialog has an icon-only Copy error button. It copies the title, message and
technical details. Clipboard API failure uses a temporary textarea copy fallback;
if unavailable, the dialog reports manual copying. No error is sent to a server.

The confirmed onFirstRound Invalid string length failure is fixed in Client.html:
the JSON viewer serializes a bounded aggregate summary, not the full result or
replay. All preview update paths use the same 64,000-character helper. Coverage
reports omitted replay/events and equipment. Engine calculations, live frames,
round statistics and persisted replay are unchanged by this preview reduction.


## Report an error by email

Set `ST_ERROR_REPORT_EMAIL` in `apps-script/DeveloperConfig.gs` to the approved support mailbox, then deploy the updated app. The checked-in value is intentionally empty; the application opens Gmail without a recipient and shows a prompt to enter one until configured. Invalid or multiple addresses are rejected.

Every error-details dialog offers **Report by email**. It opens Gmail with the error title, message, code, details and available trace. No automatic sending, new Gmail OAuth scope or server-side draft creation is performed. The user reviews and sends the message. For long errors, the compose URL is bounded and the existing Copy error action provides the full diagnostic to paste into Gmail.

**Attach complete case (JSON)** is unchecked by default and disabled when no case is open. Selecting it requests a local download of the detached current case snapshot, enriched with compatible live numerical recording and 2D checkpoint when available. This is a diagnostic snapshot, not a new calculation or cloud save; uncommitted invalid editor fields are not forced into the case. The user must attach the downloaded file manually in Gmail, which cannot accept attachments in a compose URL. It may contain confidential saved case data, including observations and conversations. Review before attaching; no case data is uploaded automatically. Large files are subject to the user's Gmail/Workspace attachment limits.
