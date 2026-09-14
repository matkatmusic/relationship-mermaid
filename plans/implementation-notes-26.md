## 2026-09-13:23:30:00 — Task 26: Remove and Remove-choices actions on the inspector
Chat title: relationship-mermaid
Path to JSONL log: /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-relationship-mermaid/06d43eeb-0dab-47ea-ab2f-4764c8bf4bb2.jsonl

### References
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-26/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-26/plans/brief-26.md
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-26/plans/codex-review.json

### Design decisions
None — the plan already made every design decision (control order, relocated preview-button ids, `.inspector-grid:not([hidden])` CSS fix). Implemented as written.

### Deviations
Applied the codexNotes revision on the `viewer-ts-edits` section's Edit 4 (`removeChoices`): for each immediate explicit choice node, the function now removes every graph edge with `inner.from === choiceNodeId || inner.to === choiceNodeId` (both directions), preserving an inline declaration only for the surviving opposite endpoint — not just the choice node's outgoing edges as the plan's original "NEW" code sample showed. This matches the existing `removeChoice` function's incident-edge handling and covers a choice node with more than one incoming edge (e.g. shared by another node).

### Tradeoffs
None beyond what the plan already decided.

### Open questions
None. All plan verification commands passed: `bun run build` and `bun run test` (44/44 tests pass), including the updated `test_inspector_add_after_controls_exist_only_for_static_and_choice_blocks`, the new `test_inspector_remove_button_dispatches_removal_by_node_kind`, and the new `test_inspector_remove_choices_button_orphans_every_outgoing_branch` (extended per codexNotes with a shared-choice-node fixture proving an extra incoming edge to an immediate choice node is removed while its other endpoint remains).
