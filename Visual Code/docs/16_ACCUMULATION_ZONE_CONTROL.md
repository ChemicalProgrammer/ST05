# Physical conveyor control and FlowPilot design audit

## Model rule

Every conveyor is a physical accumulation zone. There is no abstract buffer,
`bufferAfterCapacity`, or `accumulationZone` override in a new Case.

A valid section of line alternates:

```text
Machine → Conveyor → Machine → Conveyor → Machine
```

The simulator infers the controlled upstream and downstream machines from that
sequence. Geometry is always active: it is not a switch that can be disabled.

## Inputs entered for each conveyor

The editor uses the terms from the FlowPilot / CAT worksheet. All lengths are
in millimetres and all times are in seconds.

| Input | Role in the simulation |
|---|---|
| `L_act` (`geometry.lactMm`) | Installed conveyor length. |
| `L_p` (`geometry.lpPrimeMm`) | Reserved Prime/infeed length. Prime is derived as `L_act − L_p`. |
| Package length + upstream discharge pitch | Establish the product population and the derived pitch on the belt. |
| Conveyor speed factor | Converts upstream discharge velocity into belt speed. |
| Discharge/reject runout, blocked delay, residual bottles, insurance | Calculate the required overflow length `L_bu`. |
| Installed Back-up position | Is checked against `L_bu`; it is not silently replaced. |
| Back-up blocked / clear delay | Debounce physical photocell occupancy and clearance. In discrete transport, a passing package can activate the stop timer if its pulse is longer than the configured blocked delay. |
| Downstream high speed, infeed pitch, ramp-up | Calculate downstream consumption and recovery margin. |

The Case stores the raw inputs. The engine derives belt speed, pitch, capacity,
Prime position, material travel, Back-up requirement, and accumulation time
from them on every run.

## Controls represented by the engine

Positions are measured from upstream discharge toward downstream infeed.

- **Normal photoeye pulses:** a moving product blocks a photocell for
  `package length ÷ conveyor speed`; its normal clear gap is
  `product gap ÷ conveyor speed`. These are calculated from geometry and are
  visible in the conveyor panel. A product stream therefore does not look like
  a permanently blocked sensor.
- **Prime reserve:** the machine starts only after the physical reserve from
  the infeed back to `L_act − L_p` has filled. A passing package alone is not
  sufficient. The start authorization remains latched during normal service
  and transfers; it is rearmed after actual starvation or a control that
  requires a new start. `WAITING_FOR_PRIME` is different from processing a
  package already admitted to the machine.
- **Back-up photocell:** a queue that physically reaches the installed
  Back-up position holds the photocell continuously blocked. In the discrete
  model, both accumulated product and a passing package obstruct the same
  physical beam. Occupancy lasting `Blocked_Time_Delay` sends an upstream
  stop request. Pulse/queue diagnostics do not override the actual beam or its
  timers. The continuous legacy route distinguishes transient pulses from a
  queue; it must not be used to infer the discrete control response.
- **Residual discharge:** the upstream machine may still discharge its declared
  residual bottles after the stop request.
- **Clear delay:** after product clears Back-up, the signal must remain
  continuously clear for `Clear_Time_Delay` before the upstream stop request
  is released. A normal passing product resets the clear timer. This is why
  restart propagates through the line instead of being instantaneous.

`Blocked_Time_Delay` and `Clear_Time_Delay` are not universal constants. A
controls engineer, OEM or commissioning team chooses them from measured belt
speed, package dimensions/gaps, photocell response and PLC logic. The simulator
audits whether they are longer than the normal calculated product pulse and
gap; the demo values remain synthetic assumptions.

The line begins empty. A downstream machine remains `WAITING_FOR_PRIME` (and
has zero effective speed) until the required reserve has physically filled.
A stopped conveyor freezes product travel; it never teleports material to
the next machine. Advancing the next package during a machine's processing
cycle does not itself mean the supply was exhausted. See
[`docs/PRIME_DISCRETE_SERVICE.md`](../../docs/PRIME_DISCRETE_SERVICE.md) for the
Basic admission/service contract and validation requirements.

## Derived engineering quantities

The audit shown after a run includes these values for each conveyor:

| Quantity | Meaning |
|---|---|
| `L_bu` | Required overflow length: runout sections plus product emitted during blocked-delay, stop residual and insurance. |
| `L_ba` | Usable accumulation length: `L_act − L_p − L_bu`. |
| `L_rec` | Recovery margin after a Back-up release. Positive is a smooth-restart margin; zero or negative indicates stuttering risk. |
| Anti-starve / anti-block time | Physical accumulation time available to protect downstream / upstream equipment. |
| Capacity | `floor(L_act / derived product pitch)`, in equivalent packages. |
| Normal sensor pulse / clear gap | Expected photoeye occupied / clear duration from package length, pitch and calculated belt speed. |
| Recommended infeed speed | Downstream high speed × infeed pitch with the worksheet's 5% margin. |

Five automatic goals are evaluated: usable inputs, smooth recovery (`L_rec >
0`), installed length (`L_act > L_p + L_bu`), installed Back-up position
(`Back-up ≥ L_bu`) and sensor debounce (both delays longer than a normal pulse
or gap). A warning is a design question, not an automatic plant recommendation.

## Calibration boundary

The public 13-unit demo contains complete **synthetic** FlowPilot inputs so it
can run immediately. Its results demonstrate the model; they are not plant
measurements, a sensor-placement prescription, or a CAPEX recommendation.

For a real Case, validate the result against observed starts, stops, sensor
timing and measured belt speed before using a What-If result to choose a
physical modification.
