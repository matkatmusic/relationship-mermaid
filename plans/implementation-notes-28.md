## 2026-09-14:00:00:00 — Task 28: Add-choice action on the Decision inspector
Chat title: relationship-mermaid
Path to JSONL log: /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-relationship-mermaid/06d43eeb-0dab-47ea-ab2f-4764c8bf4bb2.jsonl

### References
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-28/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-28/plans/brief-28.md
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-28/plans/codex-review.json

### Design decisions
None — the plan already made every design decision (new `commitAddChoiceOnDecision`/`addChoiceOnDecision` functions instead of reusing `addChoice()`, button placement/order, focus handoff). Implemented as written.

### Deviations
Two test fixes beyond the plan's own diff, both in `tests/index.html.test.ts`:
- `test_inspector_add_after_controls_exist_only_for_static_and_choice_blocks` (a pre-existing test the plan did not touch) asserted a Decision's inspector shows only `remove` and `remove-choices`. That assertion describes exactly the behavior this task intentionally changes, so it was stale by construction once "Add choice" ships. Updated its expected action list to include `{ action: 'add-choice', text: 'Add choice', spanTwoColumns: false }` between `remove` and `remove-choices`, matching the new button order from viewer.ts Edit 3.
- The plan's own new test `test_add_choice_on_inspector_appends_a_new_terminal_choice_without_touching_existing_edges` asserted `source.includes('Q -- Yes --> Y')`, but the test's own fixture declares Q inline with the edge (`Q{"Q"} -- Yes --> Y["Y"]`), so that substring can never appear (the brace sits between `Q` and ` -- Yes`). The code under test was correct — the labelled edge line is genuinely left untouched — so this was a test bug, not a code bug. Fixed the assertion to `source.includes('Q{"Q"} -- Yes --> Y["Y"]')`, the actual preserved line, which still proves the labelled edge survives untouched.

### Tradeoffs
None beyond what the plan already decided.

### Open questions
None. Verification per the plan's own steps: `bun build viewer.ts --outfile viewer.js` succeeds; the full suite (via `taskTools:task-tests`) is 46/46 passing, including the four new tests (`test_add_choice_on_inspector_appends_a_new_terminal_choice_without_touching_existing_edges`, `test_add_choice_on_inspector_moves_focus_to_the_new_choices_destination`, `test_all_committed_diagrams_validate_with_mermaid`, `test_viewer_js_build_matches_committed_bundle`) and zero regressions elsewhere.
