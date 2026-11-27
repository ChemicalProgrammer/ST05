# Minitab statistical export (ST_MINITAB_CSV_V1)

## User workflow
- Basic: complete the numerical simulation, then use Simulation → Export → Minitab (CSV ZIP).
- Standard / Advance: Results → Export → Minitab (CSV ZIP). The same option is available in What-If.
- Select the active simulation. The export uses the entire saved result, not the selected/averaged results view. When a richer matching live recording is available, the existing captureCaseNumerical guard enriches a cloned snapshot only. No external service, Drive write, or simulation rerun is required.
- Extract the ZIP. Start with 00_README.txt and 00_index.csv. Open individual CSV files in Minitab with comma delimiter, dot decimal separator, UTF-8, header row and double-quoted text. Missing values are blank; booleans are 1/0. Dangerous spreadsheet formula-like text is escaped. The original values remain in raw_simulation.json.

## Analysis sequence
1. 04_line_rounds.csv: descriptive statistics on actual independent replications. One saved round is not a sample of repeated independent observations.
2. 05_equipment_rounds.csv and 06_equipment_states.csv: Pareto of losses. Prefer exclusive states; do not add overlapping downtime across equipment as if it were line downtime.
3. 07_failure_episodes.csv: modeled reliability episodes, exposure and observed repair time. The configured MTTR and the sampled exponential failure exposure are model inputs/process draws, not evidence of the real plant distribution.
4. 13_line_intervals.csv, 14_equipment_intervals.csv, 15_conveyor_samples.csv: throughput trend and diagnostic relationships with state/inventory/controls. Retained time intervals may differ, and samples within a trajectory are autocorrelated.
5. DOE_*.csv: one saved design per file, actual replicate responses, coded factor columns, seed blocks. 25_DOE_factors.csv and 26_DOE_factor_changes.csv identify physical changes; imported CSV is not a native Minitab design object. Define the custom factorial design before analysis.
6. 27_DOE_effects.csv contains saved paired-contrast and ANOVA summaries. 30_DOE_seed_contrasts.csv contains computed high-minus-low contrasts for complete two-level seed blocks. One-sample inference across independent seed contrasts is distinct from pooled-error factorial ANOVA. Multiple comparisons and low replicate count require care.
7. 20–29 CAPEX tables retain stage/fidelity/duration/seed and engineering warnings. Use 23_CAPEX_paired_deltas.csv for matched comparisons only. The original-horizon verification is descriptive; a fluid-screening result is approximate.

## Data scope
Only retained data are exported. No missing replay, failure history, sample, event, round or experiment is invented. 12_recording_coverage.csv records availability and known engine/save-time truncation; 00_index.csv distinguishes files with rows, header-only files and absent tables. All nested arrays and uncommon fields are kept in raw_simulation.json along with numerical results, equipment, run settings and scenario evidence. Assistant conversations, source import metadata, plant real-data records and unrelated simulations are intentionally excluded. Executed equipment/settings are recovered from the result input signature when available, otherwise explicitly labeled unverified.

The ZIP writer is dependency-free and local, uses stored entries with CRC-32 and UTF-8 names, and has a 512 MB browser archive limit. Export does not change simulation physics or scenario decisions. Full resolution means recorded samples, not every internal numerical timestep.
