# Google Sheets equipment template

Equipment → Export → Spreadsheet creates a **new native Google Sheet** in the workspace's SimulatorTemplate Exports folder. It never overwrites a previously imported source. Current unsaved equipment edits are exported without running or saving the simulation.

## Tabs by interface mode

| Mode | Export | Import |
|---|---|---|
| **Basic** | Equipment; Products & Formats | Equipment and Products & Formats only, even if a Real Data sheet or legacy actuals are present |
| **Advance** | Equipment; Products & Formats; Real Data | All three tabs, when Real Data is available |

The browser passes its **current** Basic/Advance setting in both operations because the interface mode may have been changed locally. For backward compatibility, older clients that do not send a mode retain the previous three-tab behavior.

## Equipment tab

- Compact metadata occupy B1, B2, E1, E2, E3, B3 and B4. The equipment group header is on row 6; headers are on row 7; equipment begins on row 8.
- **Column C: Critical machine** accepts only **Y or N**, using a visible Google Sheets dropdown in each of the editable equipment rows.
- **Cell F4 is empty**. The obsolete explanatory note and F4:O4 merge are removed.
- Column A has the supported equipment-type dropdown; internal equipment IDs are hidden and preserved for safe reimport, including reordered rows.
- The 34-column contract includes General/Minor/Major reliability, conveyor geometry and speed, sensors, internal capacity and machine timing. Real Data in Advance retains formulas that reference stable Equipment IDs.
- Optional unavailable values use NA. Metadata and rows are validated before a new spreadsheet is created. User-entered strings beginning with '=' are escaped to avoid inadvertent formulas.

## Products & Formats tab: eight-column version 3

The Linked product column is removed. The new columns are **Type, Name, Volume, Volume Unit, Length [mm], Width [mm], Height [mm], Bottles per Case**.

Each **Product** is immediately followed by all **Format** rows that belong to it. On import, a Format is linked to the nearest preceding Product. To keep that relationship correct, place a new Format directly below its parent Product and before the next Product. A Format without an earlier Product is rejected. This grouping supports several products and formats without an extra relationship column.

The tab uses marker **st-material-sheet-v3**. Existing v1/v2 templates still import; v2's explicit Linked product value is interpreted unchanged. Individual format overrides and full simulation snapshots remain available in JSON.

## Applying an import

Preview imports first and checks the equipment and catalog values without modifying the case. The user reviews selections and confirms Apply. Basic does not expose or import Real Data from the source, even when a three-tab workbook was created in Advance. Advance also supports supported legacy inline Real Data formats.

The import client/server handshake is **sheet-import-20261123-8**. Changes to SheetExportService.gs, SheetImportService.gs, ClientCases.html and SheetImport.html must be deployed together. After updating main, push the apps-script files with clasp; update the Apps Script deployment if appropriate.
