# Scenario progress capsules

The scenario card and each individual step use the same capsule renderer
in `apps-script/ScenarioExplorer.html`. The step view does not repeat the
main progress bar.

## Presentation

Each capsule displays the percentage and elapsed time inside the track, for
example `42.0% · 1m 05s`. Text uses `--font-micro` (9 px at the default
interface scale). The track uses `--progress-capsule-height` (16 px), with
pill-shaped ends, no border or shadow, and a solid colored fill.

The unfilled track is light in both themes so its black text remains readable.
A full-width colored layer contains a second copy of the text in white. One
rounded `clip-path` masks that layer to the current percentage, including its
text, so the white/black boundary follows the fill during transitions. The
two copies keep identical alignment; neither is centered within a shrinking
content box.

The fill interpolates through saturated red, orange, amber and green, with
green at 100%. It is independent of the application's accent color. Cancelled,
failed and interrupted work stays red at its recorded percentage. A completed
search with no improvement still reaches 100%: completion describes the work,
while the existing result message describes whether a better scenario was found.

An adaptive step without a known denominator displays `—` and its elapsed
time. It does not invent a percentage or fill the entire track. Its accessible
value omits `aria-valuenow`. Known percentages are clamped to the 0–100 range.
Both visual text copies are hidden from assistive technology; the progressbar
provides a single accessible name and value with time and execution state.

## Step view and navigation

The original `scenario-card-header` and CAPEX tag remain visible when the
step view opens. The tag is neither cloned nor reconstructed, preserving its
translation, tier and identity. The old analysis-progress heading is removed.

The `back` icon button belongs to that original header. It is visible only
while the step view is open, has a translated accessible name and remains
usable during a calculation. Returning restores focus to the main progress
capsule. Step `<details>` nodes are preserved during live updates, including
manual expansion and focus.

## Elapsed time and compatibility

Live searches store their elapsed wall-clock duration as
`progressTrace.summary.elapsedMs`. Updates do not depend on a percentage change
or on the step view being open. The final value is retained after completion,
cancellation or an error.

Restoration uses a finite, nonnegative saved total, including an explicit
zero. Older records without that value fall back to the sum of finite,
nonnegative step durations. Reading history and opening the step view do not
start a timer, derive duration from the current date, parse translated strings
or rewrite the saved evidence. Deleting and undoing a result uses the same
capsule updater as normal loading.

## Verification

`test/ScenarioProgressCapsule.test.js` covers saved totals, legacy fallback,
unknown percentages, terminal states, accessible values, tag identity, icon
navigation, focus, deletion/undo and the live clock using controlled time and
a held simulator response. No long simulation is needed to exercise the clock.

`ScenarioRestore.test.js` preserves the existing historical-result checks with
the original CAPEX header. `ScenarioCaseRoundtrip.test.js` verifies that saving
and reopening keeps a saved two-minute total even when step times sum to a
different value.

```bash
node --test test/ScenarioProgressCapsule.test.js \
  test/ScenarioRestore.test.js test/ScenarioCaseRoundtrip.test.js
```

The implementation session verified DOM behavior and the assembled application
CSS. A rendered screenshot review was unavailable: the local Chromium process
could not create its socket and the available browser rejected local preview
files. These checks do not claim a deployed browser inspection.

For the borderless progress and hover-spacing update, synchronize
`apps-script/ScenarioExplorer.html` and `apps-script/UiStandards.html`.
Basic mode retains horizontal scrolling and reserves shared spacing inside
the scrollport for card hover. No engine bundle regeneration is required.
