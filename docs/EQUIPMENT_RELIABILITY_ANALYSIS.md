# Equipment reliability analysis
The same assessment is shared by the browser and server planner. It is available as a clickable evaluation pill in Equipment, numerical simulation and 2D. Conveyors retain their existing geometry verdict.

Default **screening** thresholds: availability 95%, MTBF 60 minutes, MTTR 10 minutes. Below availability target = FAIL; frequent and/or long failures with availability target met = REVIEW; meeting all three = PASS. Missing, disabled or explicitly inactive inputs = NOT EVALUATED. These are provisional engineering references, not industry standards. A FAIL is not a replacement authorization.

For enabled minor/major categories, combined MTBF is the reciprocal of the sum of rates and MTTR is the rate-weighted repair duration. General stops are not reclassified; independent micro-stops are excluded. A long individual failure class merits review even with a short weighted mean.

FCR uses the engine's design-population anti-block/anti-starve estimates for connected conveyors; it is not a measurement of live inventory. A line boundary or missing geometry remains unevaluated. Capacity comparisons require common material units; the availability-only rate is not simulated throughput.

A numerical playback frame and 2D run show their own elapsed observed losses. A compatible completed numerical result may provide replication means through the same shared analyzer. A saved, current-source CAPEX per-machine failure-removal experiment may be shown as exploratory line impact. Opening the worksheet does not trigger extra simulations. The existing reliability search already runs matched failure-removal, MTBF, MTTR and joint experiments; the planner now carries reliability assessments and uses them as supporting selection evidence. CAPEX categories and independent confirmation remain unchanged. Neither screening nor simulated gain establishes feasible intervention scope, replacement requirement, or financial benefit.

Tests: test/EquipmentReliabilityAnalysis.test.js. Regenerate browser/server bundles with scripts/build-browser-engine.mjs when changing the source planner.

## Analysis dialog presentation

Both analysis dialogs use the existing `STSubsection.create({variant:'B', native:true})` control for collapsible groups. The equipment dialog opens with an intervention matrix: MTBF and MTTR in minutes on real logarithmic axes, screening boundaries taken from the assessment, and the configured availability target line `MTTR = MTBF * (1 - Ai) / Ai`. The equipment marker represents the effective active reliability model (combined classes when applicable). Invalid or disabled inputs do not receive a fabricated marker. The plot does not change the assessment or start any simulation. A long individual class can warrant a different intervention from the aggregate point, so the displayed recommendation remains authoritative.
