# Editing an imported line

Equipment and conveyor cards in the separated layout expose the existing Type and Name controls in both interface modes. The position selector (#1, #2, …) addresses the whole physical line, including hidden machines and conveyors. Drag and keyboard movements address the visible destination's physical index. Moving an item preserves the relative order of all other items.

Structural edits move actual card nodes and update their indices without validating every pending input. Saving and simulation retain their existing validation. Inconsistent or partially mounted editors are rejected. Adding a unit appends a card without replacing existing draft fields. The inspector moves actual field instances rather than swapping incomplete values and metadata.

Conveyor verdicts use the same format-aware worksheet as Conveyor Analysis Tool. Missing data remains NOT EVALUATED; click the pill to review details. No simulation is required.

Changing type or position can change line connectivity and invalidates previous simulation results. The application does not infer missing machines or correct the original import. Users must verify physical order and complete required inputs.

Tests: test/EquipmentDraftEditing.test.js. No simulation engine or server bundle changes.
