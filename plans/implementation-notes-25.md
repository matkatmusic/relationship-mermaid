## 2026-09-13:22:20:00 — Task 25: Add-after actions and New static/Decision creation via Destination
Chat title: relationship-mermaid task 25 implementation
Path to JSONL log: /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-relationship-mermaid/06d43eeb-0dab-47ea-ab2f-4764c8bf4bb2.jsonl

### References
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-25/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-25/plans/brief-25.md
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-25/plans/codex-review.json

### Design decisions
Followed the plan's diffs verbatim for index.html (dedicated `#nodeInspectorActions` grid), viewer.ts (`commitNewStaticAfter`, `commitNewDecisionAfter`, `applyDestination`, the one-shot `advanceAfterDecisionText`/`focusDestinationAfterTextId` focus state, `renderNodeInspector`/`inspectorActionButton`, and the delegated `nodeInspectorActions` click listener), and the browser test additions.

### Deviations
Applied the plan's own `codexNotes` amendment on the `browser-coverage-and-generated-bundle` section: changed `test_new_static_button_and_destination_option_have_identical_terminal_orphan_results`'s fixture from a plain static node ("A") to an explicit choice (`Q{"Q"} --> Q_A["A"]`, `Q_A --> B["B"]`), clicked `Q_A` instead of `A`, and updated the `A --> ...` assertions to `Q_A --> ...`. This was necessary because `add-static-after` only renders for choice-kind nodes, so the original plain-block fixture would never expose that button.

### Tradeoffs
None beyond the above — every other plan diff (HTML markup, viewer.ts helpers/listeners/rendering, and the remaining new-decision/new-static tests) was applied exactly as specified.

### Open questions
None. `bun build viewer.ts --outfile viewer.js`, `node --test tests/index.html.test.ts` (40/40 pass), `node --test tests/viewer.test.ts` and `node --test tests/viewer.js.test.ts` (1/1 pass each), and `npm test` all pass.
