# Conveyor spacing policy (cache version 35)

- Moving pitch = max(package length, normal belt speed / nominal native upstream package rate). Moving gap = moving pitch minus package length. Dynamic speed mode uses its resolved normal speed for design geometry. Manual speed, automatic speed and population/overspeed target modes retain their existing speed inputs.
- Packed pitch = package length, so accumulated gap is always zero. It is not an editor field in any mode.
- Basic (internal MINIMAL) hides moving gap; Standard and Advance display a read-only calculation. Products & Formats show it only when one unambiguous effective format value can be calculated. Discharge and infeed pitches remain independent engineering inputs.
- Historical moving/accumulated gap and pitch overrides are ignored by the geometry resolver. Legacy material imports are accepted and the active catalog strips obsolete gap inputs. Existing Google Sheet columns do not change; old imports no longer copy discharge gap into moving gap. Configuration comparison excludes obsolete inputs.
- Previous result signatures are invalidated. The previous conveyor trajectory fixture is retained; a new fixture records the changed physical model and is not external plant validation.
- The existing validation requirement of at least one moving pitch in the installed conveyor remains unchanged.
