# Basic discrete service and Prime authorization

## Problem and scope

Before the `0.20.8` correction, a Basic machine processed a complete package
while that package still occupied the conveyor outlet. Removing it at service
completion made the next package move one accumulated pitch toward the outlet.
During that movement, the outlet-anchored `waitingUnits` count became zero,
even with a compact queue behind it. The machine interpreted that transfer as
starvation, rearmed Prime and requested another startup ramp.

This coupled two losses: a repeated ramp and transfer time added after every
service cycle. A 19-case/min example with 310 mm cases, a 541.5 mm/s belt and a
2 s ramp repeatedly produced a roughly 4.733 s cycle. Changing Prime primarily
changed the initial reserve instead of removing that imposed steady-state
cycle. The defect was reproduced without failures or Back-up.

The correction applies to the numerical ST physical engine and its numerical
playback cursor. It preserves the measured inputs, Basic's exclusion of
advanced machine design, and the UI/card layout. The independent 2D engine has
its own physical contract and checkpoint signature; it is not a replay of
numerical output counts.

## Service contract

A Basic machine separates material admission, work in process, service and
discharge. Material admitted to its current output lot belongs to the machine
until the completed output is discharged. This allows the next conveyor
package to advance while the machine works. The service rate retains its
meaning as the configured sustained production rate with adequate supply and
downstream space.

The work-in-process lot is an execution requirement, not an advanced storage
capacity or a synthesized residence time. It must not enable or silently use
the advanced internal capacity, positions, residence or recovery measurements.
All inventory participates in material accounting. For a case packer, partial
admission and the conversion from input bottles to a complete output case
must preserve integer input packages and the active format's pack factor.

Prime authorizes the initial start only after the required physical reserve
fills. A passing product alone is insufficient. Normal progress of a package
already being processed must not rearm Prime. Actual depletion, with no work
in process and no physically available feed, can rearm it. Total product
somewhere on the conveyor is not sufficient evidence of available feed.

Pause, stop, failure, Back-up and calendar controls retain their explicit
priorities. Completed packages held by an unavailable outlet remain real
inventory. Format changes account for cleared material using the old format's
conversion before the new format is installed.

## Sensor and loss diagnostics

The physical beam, accumulated reserve, latched start authorization and
debounce timers are different observations. A moving compact queue must not
be reported as an empty line merely because its front is between outlet
positions. Back-up diagnostics must distinguish accumulated occupancy from
an isolated passing pulse; the labels do not override the real beam timer.

In PAC-PAL's audited configuration, a normal pulse lasts
`310 / 541.5 = 0.57248384 s`, exceeding the supplied 0.5 s blocked delay. The
configured discrete control can therefore respond to a passing package. The
engineering `SENSOR_DEBOUNCE` warning remains applicable. This correction does
not increase the delay or assume an undocumented PLC accumulation condition.

Time spent in a ramp is not identical to equivalent production loss. Discrete
service may accrue fractional work during a ramp and discharge the completed
package later. A zero count of completed packages in the ramp must not erase
that service or imply that the whole phase was lost. Diagnostic loss counters
and completed output must retain their stated, separate bases.

When the final numerical machine uses Basic discrete service, the result
summary marks its phase accounting with
`lineRatePhaseLossBasis = 'DISCRETE_SERVICE_CREDIT_BEFORE_REFERENCE_RATE_RECOVERY'`.
These phase losses measure service credit against the reference rate before
later recovery. They are not additive components of the final net rate loss.
For example, a palletizer with nominal capacity of 228 bottles/min can later
recover part of a ramp deficit against a 220 bottles/min line reference.
The accumulated phase deficit may therefore exceed the final net deficit
without implying lost or duplicated material. Inspect phase losses to locate
when service was constrained; use final output and the active format's
reference production to calculate the aggregate rate balance. In the result,
`lineNetRateBalanceSeconds = lineRunSeconds - lineEffectiveRuntimeSeconds`.
This rate balance uses eligible productive time; the reported line OEE has
the separate ideal-output denominator over the full simulation horizon.

## Provenance and historical results

`SIMULATION_PROVENANCE_VERSION` is
`ST_CURRENT:0.20.8/DES:0.5.0/cache:36`. It is included in the canonical input
signature, cache keys, scenario source readiness and scenario source hashes.
Old calculations remain stored evidence, but they cannot be reused as current
baselines or accepted current-input optimization results. Recalculate the
physical baseline before running Zero CAPEX on the corrected engine.

Numerical playback checks the recorded and current provenance namespaces
before creating a calculation cursor. A historical or unsigned completed
archive remains inspectable through its recorded replay; it is not silently
reconstructed with new mathematics. The existing playback status identifies
historical playback. A changed input signature also replaces a prior cursor
even when case, simulation, round and seed identifiers remain the same.
Live progress callbacks carry the exact current execution signature before
playback reads them, preserving the cursor identity when the first round
finishes.

The browser and Apps Script server share the provenance module. Running
`npm run build:apps-script` regenerates both
`apps-script/SimulationEngine.html` and `apps-script/ScenarioEngine.gs`.
Both generated files must be deployed together with the client playback guard.

## Retained G validation results

The baseline is commit `1a7ec70a15479d666f1bab0a5eefe0e05f3a0ce5`.
The corrected runs use `0.20.8-basicservice1-stoprefill1` and provenance
`ST_CURRENT:0.20.8/DES:0.5.0/cache:36`. Each before/after pair uses the same
retained source configuration, seed `20260909` and horizon. G5 identifies
`Equipment-complete (5)`; G6 identifies `Equipment-complete (6)`. The active
format contains 12 bottles per case. Basic retains nominal speeds, measured
geometry and the original sensor delays, including the 0.5 s delay above.

| Measure | G5, 8 h baseline | G5, 8 h corrected | G6, 24 h baseline | G6, 24 h corrected |
|---|---:|---:|---:|---:|
| Final output, bottles | 68,784 | 69,096 | 205,284 | 205,752 |
| Final output, complete cases | 5,732 | 5,758 | 17,107 | 17,146 |
| Reported line OEE, % | 65.136364 | 65.431818 | 64.799242 | 64.946970 |
| Palletizer startup ramp count | 5,733 | 1,410 | 17,108 | 388 |
| Palletizer startup ramp time, s | 11,464.050000 | 2,817.375000 | 34,206.891669 | 776.000000 |
| Overflow, bottle equivalents | 444 | 1,464 | 1,327 | 4,366 |
| Final inventory, bottle equivalents | 709 | 661 | 853 | 668 |
| Material-balance residual, bottles | 0 | 0 | 0 | 0 |

The corrected G5 run produces 312 more bottles (26 cases), with a reported
line OEE change of 0.295454 percentage points. G6 produces 468 more bottles
(39 cases), with a change of 0.147728 percentage points. Ramp time in this
table is observed time in that phase, not an equivalent production loss.
For example, corrected G5 records 1,359.719478 s of phase ramp service
deficit and 751.311364 s of net rate loss. Adding the phase deficit to that
net loss would count part of the same effect twice and ignore recovery.
The corrected balances close as follows, with zero clearout in both runs:

- G5: `71,221 input = 69,096 output + 661 inventory + 1,464 overflow`.
- G6: `210,786 input = 205,752 output + 668 inventory + 4,366 overflow`.

A separate G5 diagnostic pair disables stochastic reliability in both engine
versions while retaining the same physical controls and eight-hour horizon:

| Measure | Baseline, failures disabled | Corrected, failures disabled |
|---|---:|---:|
| Final output, bottles | 72,648 | 73,980 |
| Final output, complete cases | 6,054 | 6,165 |
| Reported line OEE, % | 68.795455 | 70.056818 |
| Palletizer startup ramp count | 6,055 | 1,623 |
| Palletizer startup ramp time, s | 12,109.216667 | 3,246.000000 |
| Overflow, bottle equivalents | 475 | 1,728 |
| Final inventory, bottle equivalents | 1,679 | 656 |
| Material-balance residual, bottles | 0 | 0 |

Its corrected balance is
`76,364 input = 73,980 output + 656 inventory + 1,728 overflow`.
The remaining starts and overflow require examination of the unchanged
controls, reserve and supply; the correction does not eliminate those
physical constraints. The increased overflow is part of the corrected
physical simulation with the original timers, not merely a renamed counter.

Each condition has one seed. These are reproducible regression observations,
not estimates of an expected gain or statistical confidence. Reliability
uses a productive-exposure clock, so changed production states can move
failure events to different calendar times even with the same seed. The
reliability-disabled pair helps expose the physical effect without that
interaction; it remains a diagnostic condition rather than plant operation.

### Evidence identities

The paired audit records have identical `run` objects and source-file hashes
within each pair. The retained source SHA-256 values are
`bf4af6371a1f38d9e7d015638c1e94a1adbb60094db68dacf1dedf80d9cfe256` (G5) and
`6d4c97a2fbfe1e3b63a84eb96f1d43d61456edcf0c8e87a4c300b4e9d181266c` (G6).
The SHA-256 values below identify the exact audit JSON records used for the
tables; these records are evidence, not runtime fixtures.

| Audit record | SHA-256 |
|---|---|
| `G5-28800s.json` | `d8667676cb1b8509ea7f749754925a004c78afd3a6c2a0619a9da8ab485a7876` |
| `corrected-G5-28800s.json` | `d5f51260e3fde29c921d2bd1a47b3453be55279da5a9c8c0c594434016a0a63d` |
| `G6-86400s.json` | `df9bb1151b0c424733a8fc8df2ccf5883a4e4565ab19ba00a1a52c1f673b7bec` |
| `corrected-G6-86400s.json` | `7d42f0a33660a49ea87c6edd03facabb296d7e9932a1c985921faca3447cbe65` |
| `G5-28800s-no-failures.json` | `218dfdddd20e0a5a7ccc4f73798c1ff73e5b9eb5c809a0e4c1443a5e73b698ee` |
| `corrected-G5-28800s-no-failures.json` | `f9377269dedb5ae3b87ae29d6abd37e508f069334a379ae01a51730170fa40da` |

### Interpretation

The retained G configurations provide regression checks of the corrected
engine with unchanged plant inputs. Their output establishes the effect of
the model correction; it does not establish an optimized sensor arrangement
or an improvement already achieved in the plant. Sensor optimization must
start from a newly calculated baseline under the same corrected contract.

Report output, overflow, remaining inventory and the material-balance residual
together. A rise in output can coexist with increased overflow, which must
remain visible in the comparison and in any later scenario acceptance rule.
An exactly closed material balance verifies accounting, not the suitability
of the controls or the predicted plant performance.

Keep the aggregate net rate balance separate from the phase service deficits
described above. Compare historical numerical totals with their own stored
inputs and version. Numerical results and independent 2D runs also require
their own validation; sharing a seed or a visual line layout does not make
their timing or output equivalent.

## Acceptance checks

- The initial Prime reserve is required; a passing pulse cannot start a machine.
- A sufficiently supplied Basic machine sustains its nominal rate within the
  tick and finite-window counting tolerance, without a ramp for every package.
- Real starvation rearms Prime and waits for the required reserve before restart.
- Work in process is conserved through pause, failure and blocked discharge.
- Case packing and format changes retain package counts and bottle equivalents.
- Numeric results, asynchronous runs and numerical playback use the same core.
- Historical signatures cannot enter current calculation caches, scenario
  confirmation or a current-engine playback cursor.
- Original measured rates, lengths, sensor positions, delays and reliability
  inputs remain unchanged by the correction.

The focused release gate passed 48 tests across
`BasicDiscreteService.test.js`, `DiscreteSensorDiagnostics.test.js`,
`PlaybackProvenanceGuard.test.js`, `SimulationProvenance.test.js` and
`ScenarioReadiness.test.js`, plus `RampAccounting.test.js`. The eight ramp
checks retain their original numerical expectations; one fixture's belt
length was corrected to accommodate its derived 500,000 mm moving pitch.

| Validation group | Corrected result | Baseline comparison |
|---|---|---|
| Six focused release files | 48 passed, 0 failed | Targeted release gate |
| Eight adjacent regression files | 64 passed, 3 failed | Same three failures already present in the baseline |
| Five older playback/UI test files | 11 passed, 29 failed | Same 29 failures already present in the baseline |

The three adjacent regression failures concern an old numerical-resolution
snapshot, a repair-restart tick/ramp fixture, and an omitted DOM helper in a
split-stop reliability fixture. Their expectations were not relaxed to
claim a passing release. Conveyor photoeye fixture updates change 26 sensor
labels; its 38 numerical checkpoints retain the original expectations.
These scoped checks do not assert that the full repository suite passes.

A 300 s run of the real G configuration produced identical summaries,
equipment metrics and accumulation-zone metrics in the source JavaScript
engine and the generated Apps Script browser bundle: 408 bottles and a zero
material-balance residual. The retained full-horizon pairs are tabulated
above. A closed material balance is necessary, but does not alone validate
the timing or the plant prediction.
