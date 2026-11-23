# Settings categories

Settings uses five keyboard-accessible tabs. Arrow keys, Home and End move between
tabs, and each panel preserves its controls while hidden. Closing with Done, the
close icon or Escape applies pending settings through the existing save pipeline.

| Tab | Options | Scope |
| --- | --- | --- |
| Case | Name, include What-If DOE, equipment chart colors, JSON-field visibility | Case JSON; normal case save policy |
| Appearance | Language (English / Español), theme, accent palette, text size; existing restricted interface-mode selector | Browser preferences |
| Simulation | Autosave and interval, fixed/random seed policy | Browser preferences; seed policy in both modes; autosave only in Advance, Basic saves manually |
| Gemini | Model, private API key, mode-specific prompt sections and inclusion checkboxes | Google account User Properties |
| Storage | Drive workspace root folder | Google account settings |

The Case tab requires an open case. DOE uses `metadata.includeDOE`; older cases
fall back to the previous browser preference until explicitly set. A card's DOE
toggle and Settings edit the same option and retain the existing factor selection
and evaluation behavior. Different cases can therefore retain different DOE
policies. This option controls future evaluations, not an automatic search.

Chart colors use `metadata.chartColors`, with up to 13 equipment-series slots.
Only explicitly changed colors override the light/dark theme palette. The first
series also colors line output; equipment beyond 13 repeat these series. Reset
removes the overrides. Colors apply immediately, survive opening the saved case,
and clear when returning to the gallery. These display changes mark the case
pending without invalidating simulation results or changing simulation inputs.

Appearance includes **Language**, with **English** selected by default and **Español** available. The choice is browser-local (`st.ui.v1.language`), applies without recalculation or reopening cases and persists after reload. The localized UI uses the shared `Language.html` vocabulary for static and dynamically inserted labels, titles, placeholders and button accessibility text. Case names, simulation names and user-supplied data are excluded. Some technical strings without translated entries retain their source wording; add translations to the dictionary rather than translating identifiers or JSON keys. Reset app restores English.

Appearance applies immediately in this browser. Text size offers 80%, 90%, 100%,
110% and 125% of the shared Advance typography. Advance defaults to 100%, Basic
to 110%, with no second mode multiplier. Explicit choices are remembered per mode
in this browser; legacy explicit font preferences are respected until replaced.
Accent choices retain their accessible labels and tooltips, but the selected color
name is no longer repeated beside the field label.

Account settings retain their existing debounced save and retry behavior; prompt
checkboxes do not discard text. Case changes follow manual/automatic case saving,
and closing Settings does not implicitly save a Basic case. See
`30_GEMINI_PROMPTS_AND_CHAT.md` for prompt composition, persistence and budgets.

Settings has a fixed 920px maximum width and 720px height, capped to the viewport.
Its content scrolls inside the dialog without changing size between tabs.
In Advance, equipment chart colors appear in a table in line order with complete
wrapping names, circular swatches and HEX values. Only actual equipment is listed.
V-Graph series colors are edited directly in the V-Graph legend: Current and
Recommended each have a clickable circular swatch that opens the same series-color
dialog (color map, hue, RGB, HEX and Apply/Cancel). The picker also has
**Reset default** for the selected V-Graph series, replacing the old global reset.
The former V-Graph Series Colors section has been removed from Settings > Case.
Colors retain the existing
`metadata.vgraphColors.current` / `metadata.vgraphColors.recommended` fields;
saved cases keep their overrides, and the legend and graph use the same color
tokens. The equipment color table in Settings retains its separate Reset colors
action. Case deletion is available only from the gallery, with the existing
confirmation dialog. JSON visibility uses `metadata.showJsonFields`, shared
across modes; older cases use the legacy browser preference until set.

Both modes use the six-section header navigation. Advance retains its own equipment
editor; the former sidebar is hidden, and comparison, Settings, close-case and
sign-out actions remain accessible as header icons. Basic Gemini shows two editable
prompts (personality and combined CAPEX definitions), while preserving Advance
prompt drafts. Model and API-key connection settings remain accessible in both.
