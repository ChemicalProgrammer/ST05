# Saved CAPEX analysis and mixed flow units

## Completed searches remain results

`NO_DEMONSTRATED_IMPROVEMENT` is a completed analysis outcome. Its message,
progress, elapsed time, counters and individual steps must survive a case save
and reload just as a winning result does. A later negative result must not fall
back to a winner from an earlier evaluation.

`ScenarioExplorer` separates the saved analysis from permission to use it with
the current inputs. When the source signature, comparison policy or numerical
readiness no longer matches, the card keeps the previous outcome and trace
visible with a saved-analysis notice. It does not permit creating a scenario
from obsolete evidence. A new complete baseline can enable a new search while
the old analysis remains historical.

The `evaluations()` consumer still returns only entries matching the current
source signature. Keeping history visible does not broaden evidence reuse,
relax source validation, or reinterpret interrupted steps as completed.

When an automatically generated target changes, restoration adopts the new
default only if the saved target equals the old proposed default and has no
explicit feasible limit. User-edited targets, explicit limits, selections and
DOE levels are retained. The previous analysis becomes historical until the
new targets are evaluated; rendering never rewrites the saved evaluation.

The save path continues to capture committed equipment and run inputs rather
than reading display controls when numerical results exist. Empty reliability
metadata, including explicit `null` values on a virtual inlet, is preserved.
The regression test exercises the full opening, saving and reopening cycle
using the actual client and server normalization code, with only transport and
storage replaced. It cannot prove behavior of a particular deployed Apps Script
version or Google transport session.

## Planning in the active product format

Conveyor engineering now applies the active product profile to a detached copy
of the equipment, matching the simulation runtime before resolving geometry.
Machine output rates remain in their native units in the source case. For a
12-bottle case, a Case Packer producing 19 cases/min requires 228 bottles/min at
its bottle input; a downstream conveyor carrying cases still uses 19 cases/min.

Capacity and availability screening also compares like units in the active
format. It must not request equipment replacement merely because a numerical
case rate is lower than a bottle rate.

If incomplete worksheet data prevents calculating a recommended Back-up sensor
position, a valid installed sensor can still produce a bounded exploratory
hypothesis. This fallback respects the installed conveyor length, Prime and
restart positions. Its evidence identifies `EXISTING_SENSOR_RANGE` and leaves
the missing engineering data missing. It is not a calculated design approval.

These changes affect candidate generation and presentation. The simulation
mathematics, provenance namespace, practical-gain threshold and independent
confirmation requirements remain unchanged. A small numerical gain, or a
positive short screening result, does not establish an accepted improvement or
prove a global optimum.

## Diagnostic comparison: case G, 2026-11-24

The supplied case already contains the negative outcome, 32 search trials,
43 simulation batches, 17 minutes 21 seconds, and eight completed trace steps.
Its saved source signature and equipment match the completed numerical result.
Opening, saving and reopening that exact file in the local full-app harness
kept its MTBF/MTTR null values and source readiness. The reported MTBF mismatch
was therefore not reproduced in the current code; the historical display fix
also covers cases that genuinely become stale.

One diagnostic candidate changes only FIL-CAS conveyor speed from
680.666666666667 to 758.1 mm/s (40.84 to 45.486 m/min). The unchanged simulation
engine measured it for 86,400 seconds with seeds 20361127, 20361128 and 20361129.
The comparison baseline below is the exact saved batch using those same seeds.

| Mean across three replications | Saved baseline | Corrected speed |
| --- | ---: | ---: |
| Throughput, bottles/min | 117.469444 | 117.538889 |
| Line OEE, percent | 53.395202 | 53.426768 |
| Overflow, bottles | 3239.666667 | 0 |

The candidate produced 169356, 169212 and 169200 bottles, against the saved
169344, 169128 and 168996. The mean gain is 100 bottles per 24-hour run,
0.069444 bottles/min, or 0.059117% relative. It remains below the existing
0.1% practical threshold (0.117469 bottles/min for this baseline). No independent
confirmation was performed, and this candidate is not an approved improvement.

An additional bounded screening compared eleven combinations over 600 seconds
and three seeds (20261124 through 20261126): each Back-up sensor separately,
combinations with the corrected speed, all Back-up targets, and all nine ZERO
targets. None exceeded the corrected-speed candidate in that short screen.
This is diagnostic coverage, not a complete optimization or proof that no
better zero-CAPEX alternative exists.

## Source and regression coverage

- `apps-script/ScenarioExplorer.html`: saved outcome and historical trace.
- `src/analysis/ScenarioPlanner.js`: active-format planning and sensor fallback.
- `src/analysis/FlowFactorScreening.js` and `ReliabilityTargetSearch.js`: retain
  the progress counters previously present in the deployed browser bundle so a
  rebuild cannot remove them.
- `test/ScenarioRestore.test.js`: negative outcomes, historical winners,
  interrupted steps and action gating.
- `test/ScenarioCaseRoundtrip.test.js`: full save/reopen integration.
- `test/CaseSaveSnapshot.test.js`: detached snapshots and committed evidence.
- `test/ScenarioPlannerUnits.test.js`: format selection, conversion, source
  immutability and valid sensor bounds.
- Search and methodology integration harnesses load the current shared UI
  modules. Seven older presentation assertions still fail identically on the
  preceding main revision; they are not new functional failures of this change.

Regenerate `apps-script/SimulationEngine.html` and `apps-script/ScenarioEngine.gs`
with `npm run build:browser-engine` after changing planner sources.
