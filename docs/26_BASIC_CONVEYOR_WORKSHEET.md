# Basic conveyor worksheet

The selected conveyor uses the same Input/Results tabs for every connection.
The reference photograph's Blowmolder → Pucker connection is a silo, which
explains its different fields. ST keeps its configured physical conveyor model;
it does not infer a silo from a machine name.

Machine cards expose Speed (BPM), MTBF and MTTR (minutes). These are persisted
engine inputs. Basic enables failures. Buffer post is the following conveyor's
packed physical capacity divided by the next machine's BPM. Avail (%) is
100 × MTBF / (MTBF + MTTR). Both values are calculated outputs. Simulation is
started from the Simulation section.

## Input mapping

| Group | Controls | Stored fields |
| --- | --- | --- |
| UPSTREAM | Package length; discharge pitch; startup time; bottles at stop | `processData.upstream.packageLengthMm`, `dischargePitchMm`, `startupTimeSeconds`; `processData.accumulation.bottlesDischargedAtStop` |
| DOWNSTREAM | Infeed pitch; ramp-up time | `processData.downstream.infeedPitchMm`, `rampUpTimeSeconds`; ramp is also synchronized to `processData.accumulation.downstreamRampUpSeconds` |
| GEOMETRY | Lact; Lp; discharge actual; coding actual | `processData.geometry.lactMm`, `lpPrimeMm`, `actualDischargeMm`, `actualCodingMm`; actual lengths are synchronized to the engine's discharge/coding runout fields |
| Speed & Sensors | Conveyor speed in m/min; discharge, coding and accumulation factors; block/clear delays; insurance; overspeed | Existing `processData.speedAndSensors` factors and `processData.accumulation` sensor fields |

Basic exposes Conveyor speed (m/min) in Speed & Sensors. A previously automatic
conveyor starts with its current calculated speed; a manual conveyor preserves
its speed. Editing and saving stores MANUAL speed in mm/s (m/min ÷ 0.06).
It controls physical travel and transfer capacity. Basic retains existing moving-gap
and Back-up overrides; absent overrides remain derived. Advance uses the same stored
manual speed in its mm/s control. Basic design calculations use the BPM shown in
the machine cards. Stage factors and design populations remain calculated design
references; manual speed overrides the runtime accumulating belt velocity.

Rates inside the engine are mm/s. Worksheet rates are converted to m/min by
multiplying by 0.06. Package velocity uses upstream BPM × discharge pitch / 60;
B2B output uses upstream BPM × package length / 60. The displayed downstream
consumption uses downstream BPM × infeed pitch / 60. Packed-material demand in
the accumulation equations uses package length instead of infeed pitch.

Discharge speed is package velocity × (1 + discharge factor/100). Coding speed
adds its factor to discharge speed; accumulation speed adds its factor to coding
speed. Zone population is packed B2B output divided by each zone speed × 100.
The percentage bars are these **design populations**, not live inventory.
The engine uses the accumulating speed for its one physical conveyor zone.

Overflow (F8) is the calculated overflow product reserve. Lbu (D8 + E8 + F8)
adds actual discharge and coding lengths. Lba = Lact − Lbu − Lp. The existing
physical bounds and package-spacing validation still apply.

## Results

Static design outputs include anti-starve/anti-block seconds, Lba, Lrec, required
overflow, minimum length and minimum infeed speed. Lba min rampup is the linear
ramp integral: full packed downstream consumption × ramp seconds / 2. Lmin is
Lbu + Lp + this ramp reserve. Lact vs Lmin is PASS at or above that minimum,
FAIL below it, or NOT EVALUATED for missing inputs. It is a model-specific
length check, not a full design certification. Minimum infeed speed uses the
configured overspeed margin, defaulting to the existing 5% when absent.

The engine records connection blocking and starving equivalent seconds at every
tick, including partial-capacity losses and the initial empty-line period.
Conv Loss (%) is the integrated larger blocking/starving weight per tick divided
by run duration, so concurrent constraints are counted once. YES/NO indicates
whether that connection accumulated a nonzero loss. Lost seconds per hour are
equivalent seconds × 3600 / simulated duration. These are observed results,
independent of the design PASS/FAIL and design population bars.

No current run means measured values are unavailable. Older saved results that
lack the new counters also display unavailable values until rerun. Editing
inputs invalidates the previous result through the existing autosave pipeline.

## Optional Population and LBA inputs

Both modes display the calculated accumulation Population and LBA. Enable the
checkbox beside either value to supply a target Population or a manual LBA.
`processData.accumulation.targetPopulationPercent` accepts values greater than
0 through 100. The target overrides accumulation belt speed and moving gap:
velocity = upstream BPM × package length / (60 × target/100), and moving pitch
= package length / (target/100). Existing speed and gap values are retained
for use when the target is disabled. Discharge/coding stage populations stay
separate calculated references. Above 50%, an advisory suggests considering
50% or less and checking belt speed/infeed capacity; this is not a universal
safety limit or an automatic clamp.

`processData.accumulation.manualLbaMm` must be positive and no greater than
Lact − Prime reserve − required overflow. Back-up (including its restart
position) becomes Prime position − manual LBA. Physical installed length and
packed capacity stay unchanged. Disabling the checkbox restores calculated
LBA. Both settings are persisted with conveyor inputs and simulation records.
Basic conveyor cards display only the configured conveyor name; detailed
outputs remain in the selected conveyor's Results tab.

## Derived runtime geometry with incomplete design fields

The import template does not need separate moving pitch, installed Back-up or
restart-position columns. Explicit valid moving spacing and applicable sheet
design pitch retain precedence. If the existing worksheet cannot resolve pitch
but a positive actual belt speed, package length and upstream native package
rate are available, the runtime uses a modeled moving pitch:

`max(packed pitch, actual belt speed / upstream packages per second)`.

The packed-pitch lower bound represents a capacity-limited belt rather than
negative spacing. It is not a measured gap. Missing Back-up position is derived
from the existing engine overflow calculation with the resolved pitch:

`Lbu = discharge + coding + (packages during block delay + residual + insurance) × pitch`.

The existing optional zero-default policy for the overflow terms is retained.
An installed Back-up override wins when provided, subject to manual LBA
precedence. Without a separate restart position, the model uses the Back-up
position and its clear-time delay. No sensor position is clamped into an
undersized conveyor. Missing genuinely necessary physical inputs and infeasible
geometry remain validation errors, with the conveyor identified by name.
Editor placeholders distinguish calculated values from installed overrides.

This fallback changes only the previously unresolved derivatives. It does not
modify source sheet cells or substitute calculated positions for measurements.

## Worksheet native machine-flow correction

The Conveyor Analysis Tool uses the resolved engineering input native
upstream output and downstream input rates (packages/min), or the configured
machine rates if those engineering fields are unavailable. In a resolved
bottle-to-case profile, the downstream input rate is in bottles/min, not
cases/min. Bottle-equivalent rates are presentation values only; physical
flow, consumption and overflow calculations use native packages.

When AF is absent, discharge velocity = native upstream nominal output
rate × discharge pitch / 1000 (m/min). Explicit AF remains a local velocity
override, never a replacement for the machine's nominal package rate.
Population = native upstream output rate × package length / (1000 × belt
speed in m/min). True saturation still makes the worksheet overflow
calculation unresolved. A discharge pitch equal to package length does not
by itself imply that the accumulation belt is fully populated.

Minimum infeed speed = native downstream input rate × infeed pitch / 1000
× (1 + overspeed percent / 100). JSON exports carry
`calculationRevision: "NATIVE_MACHINE_FLOW_V2"`.

This correction aligns the worksheet's flow and speed basis with the
engineering engine. It does not yet reconcile the different overflow,
recovery and accumulation reserve equations or change runtime geometry.
It does not restore historical geometry or change the installed speed,
pitch, sensor positions, or stop statistics. The worksheet PASS still
denotes its recovery-length criterion, not comprehensive engineering
approval.
