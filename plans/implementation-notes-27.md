## 2026-09-14:00:00:00 — Task 27: Insert-before actions on Decision and static inspectors
Chat title: relationship-mermaid task-27 (taskTools pipeline run)
Path to JSONL log: /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-relationship-mermaid/06d43eeb-0dab-47ea-ab2f-4764c8bf4bb2.jsonl

### References
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-27/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-27/plans/brief-27.md
/Users/matkatmusicllc/Programming/relationship-mermaid/plans/task-22-node-inspector-and-destinations.md

### Design decisions
Implemented `insertStaticBefore` and `insertDecisionBefore` in viewer.ts exactly as specified in plan.json: gather every incoming EditorEdge of the selected node, redirect each to the new node preserving its own label (`edge.from -- "label" --> newId` vs `edge.from --> newId`), and add the new node's own unlabelled edge to the selected node.

### Deviations
None from the plan's code sections. One test-ordering fix was needed (see Tradeoffs) that the plan's own test code did not account for.

### Tradeoffs
The plan's verification section wrote the three new undo-assertion tests as: assert single history entry -> `assertEditorSourceIsSavedAndValid()` -> undo -> assert restored. That ordering fails because `assertEditorSourceIsSavedAndValid()` calls `loadDiagram()`, which resets `editorHistory` to a single entry (the just-saved state), turning the subsequent `undoEditorAction()` call into a no-op (`editorHistoryIndex <= 0` guard). The existing passing test `test_dirty_text_then_destination_creates_two_ordered_undo_entries` establishes the correct convention: undo first, then `assertEditorSourceIsSavedAndValid()` last. Reordered the three new tests (`test_insert_static_block_before_splices_incoming_edges_with_their_labels`, `test_insert_static_block_before_a_root_node_becomes_the_new_root`, `test_insert_decision_before_adds_one_leading_choice_and_splices_incoming_edges`) to match that convention. No production code changed for this fix — test-only.

### Open questions
None.
