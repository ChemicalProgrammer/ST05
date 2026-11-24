# Editing an imported line

Equipment and conveyor cards in the separated layout expose the existing Type and Name controls in both interface modes. Reorder using the drag handle or its Up/Down arrow keys; there is no position combobox. In a machine-only or conveyor-only view (separate tabs or a combined-view filter), the moved group is reordered while the other group's relative order is preserved. The physical line is reconstructed as M1, C1, M2, C2, ... beginning with a machine whenever one exists. Unmatched trailing items are retained without inventing or deleting equipment. In the unfiltered combined view, a drag directly changes the physical order without automatic interleaving. Merely changing the view does not reorder the line.

Structural edits move actual card nodes and update their indices without validating every pending input. Saving and simulation retain their existing validation. Inconsistent or partially mounted editors are rejected. Adding a unit appends a card without replacing existing draft fields. The inspector moves actual field instances rather than swapping incomplete values and metadata.

Conveyor verdicts use the same format-aware worksheet as Conveyor Analysis Tool. Missing data remains NOT EVALUATED; click the pill to review details. No simulation is required.

Changing type or position can change line connectivity and invalidates previous simulation results. The application does not infer missing machines or correct the original import. Users must verify physical order and complete required inputs.

Tests: test/EquipmentDraftEditing.test.js. No simulation engine or server bundle changes.
