# Ideal Line Benchmark V1

Separate exploratory engineering study; not a fourth CAPEX recommendation. Open Basic → Optimization → Ideal Line Benchmark, or Standard/Advance → Results/What-If → Ideal Line Benchmark. Select a 15/30/60 min measurement window and a 90/95/99% production target. The selected source must be a current completed ST_CURRENT simulation with a constant reference rate and one operating format. Dynamic balancing and scheduled format changes are excluded for now.

The reference is the saved pacemaker rate, in reported output units/min. Target attainment = simulated throughput / original reference × 100. OEE remains the engine's own OEE relative to the experimental configuration. Attainment may exceed 100%; it is not clipped. Zero overflow is required to call a target attained. Engineering feasibility is not established by this condition.

## Method
- Use exact executed input provenance; no edits to the active case. Cold starts count. Technical tests remove scheduled stops and explicitly enable or disable reliability.
- Measure the matched original geometry, failure-free performance, and a continuous/no-residence diagnostic. Compare FAST with PRECISE without changing the physical engine.
- Deterministic full 2^3 factorial: machine rates 1×/1.5×, conveyor lengths 1×/2×, belt speed 1×/1.5×, with a shared control margin and failures disabled. Report descriptive contrasts only: one trajectory per cell is not an inferential ANOVA.
- Additional finite stress cases: larger buffers (4×/8×), reduced ramps, revised photoeye debounce/positions, speed factors 0.5×–2×, and enlarged machine capacities. Invalid physical inputs are retained as invalid, not silently repaired.
- Reverse optimization restores groups toward their original values and tests intermediate levels. Rank zero-overflow designs by target attainment and a dimensionless change-effort heuristic. Also keep a separate candidate with original pacemaker capacity. The search is bounded and does not establish a global minimum or optimum. RSM and broader continuous optimization are future refinements, not performed by V1.
- Confirm the selected and fixed-pacemaker designs using PRECISE at ≥30 min. Restore the original reliability and, if necessary, test a hypothetical MTBF ×4 / MTTR ×0.25 case; FAST 3-seed results that meet the target on all tested seeds proceed to independent PRECISE confirmation. This is finite replication evidence, not a claim of a confidence bound.
- Optional original-horizon verification (up to six original replications) uses the original schedule, duration, resolution and seed block, with the selected reliability assumptions. Variable effective-runtime targets are not supported for this verification. It may be substantially slower.
- JSON and CSV export the study locally. CSV contains actual seed rows and coded factorial factors; avoid pooling different stages/model assumptions, and distinguish cached/reused factorial points. The dialog is a separate session: download evidence before closing/reopening. No changes to CAPEX rankings, stored source, or motor equations.

The Minitab buttons now download directly in all three modes. Basic no longer closes an export details element on transient saving state. The existing JSON/PDF export menus remain.
