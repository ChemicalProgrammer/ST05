# Subsección B and conveyor scenario configuration

## Dialog grouping

`STSubsection` accepts `variant: 'B'` for the compact dialog presentation:

```js
const group = STSubsection.create({
  title: 'Conveyor variables',
  description: 'Select variables, targets and feasible limits.',
  variant: 'B',
  native: false,
  tools: existingToolbar,
  content: existingTable
});
```

The same API supports native `<details>` and classic fold controls. The body,
tools, open state, focus and input values retain their existing behavior.

Subsections without an explicit variant use B inside `dialog` and
`[role="dialog"]`. This is a CSS context rule, so a component created before
its dialog is attached also works. Moving the same component back into an
inline editor restores the regular presentation. This covers the scenario,
spreadsheet import and Products dialogs without changing the inline Products
editor or other page subsections.

Use `variant: 'A'`, or `data-subsection-variant="A"` on enhanced markup, when
a dialog intentionally demonstrates the regular control. The design catalog
keeps its regular and native examples as A and includes a separate B example.

### Visual tokens

- Header padding above and below: `--space-2` (8 px at the default scale).
- Title: `--font-body` (13 px at the default scale).
- Title-to-description gap: half `--space-1` (2 px).
- Title, fold arrow and description: `--secondary-text`, the readable secondary
  tone from the current theme.
- Header separator: `--secondary`.
- Horizontal insets and the full-width header gradient remain shared with the
  regular control. Toolbar and body colors are not replaced by the B variant.

The `--subsection-b-*` tokens in `DesignTokens.html` define these values.
Each subsection resets its header variables before a variant applies, so
an explicit A nested inside B does not inherit the compact presentation.

## Conveyor configuration

The pre-subsection scenario configuration at commit
`21466768de08df990d2749a34fbbb6971d96f9b5` had the same ten table columns as
the current data model, with DOE suggestion tools above the conveyor table.
The later grouping moved those tools into Search. DOE, Low and High also
disappeared whenever DOE was off or search depth was Light.

The conveyor table now keeps all ten columns visible:

1. Use
2. Equipment
3. Parameter
4. Current
5. Target / Proposed
6. Unit
7. Feasible limit
8. DOE
9. Low
10. High

DOE factor and level inputs remain disabled while DOE is off or depth is
Light. A compact message explains how to enable them. The suggestion button,
factor count and progress indicator sit above the table, and the DOE toggle
sits in the same subsection header. The factor count remains visible when
DOE is off; progress appears when DOE can be used.

If the current scope has no conveyors, these same live controls move back
into Search so machine-only configurations still have access. Switching
scope moves nodes instead of copying or rebuilding them. Existing factor
limits, input validation, selections, feasible bounds and saved values
continue to apply. The table scrolls horizontally within its own container
when the available width is insufficient.

This presentation change does not alter the planner, simulator, physical
units or the stored scenario evidence. Rows still represent the applicable
changes supplied by the planner, including available Back-up and Prime
sensor targets.

## Verification and deployment

Relevant checks:

```bash
node --test test/Subsection.test.js test/SubsectionB.test.js \
  test/ScenarioConveyorConfiguration.test.js \
  test/ScenarioRestore.test.js test/ScenarioCaseRoundtrip.test.js
```

The B tests exercise both fold forms, accessibility relationships, late
insertion, inline/dialog movement, explicit A and preservation of live input
nodes and event listeners. Conveyor tests exercise the visible table,
disabled states, DOE selection and control placement. The restore and
round-trip tests protect saved scenario results and settings.

The implementation session could not perform a rendered visual inspection:
local Chromium was unable to create its process socket and the available
browser rejected local-file preview URLs. DOM behavior and CSS inspection
are not a substitute for a screenshot review in the deployed application.

Apps Script files to synchronize:

- `DesignTokens.html`
- `Subsection.html`
- `UiStandards.html`
- `ScenarioExplorer.html`
- `DesignReference.html`

No browser engine bundle needs regeneration for these UI changes. Updating
the Git repository does not deploy the Apps Script application.
