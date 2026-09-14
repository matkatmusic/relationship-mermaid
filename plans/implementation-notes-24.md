## 2026-09-13:21:53:00 — Task 24: Destination select for static/choice inspectors
Chat title: relationship-mermaid task 24 implementation
Path to JSONL log: /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-relationship-mermaid/06d43eeb-0dab-47ea-ab2f-4764c8bf4bb2.jsonl

### References
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-24/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-24/plans/brief-24.md
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-24/plans/codex-review.json

### Design decisions
Followed the plan's diffs verbatim for index.html, viewer.ts, and the browser test additions, including the codexNotes amendment to fixture line `B --> C` -> `B --> C["C"]` in `test_destination_accepts_descendants_and_current_value_is_a_no_op`.

### Deviations
One assertion in the plan's own `test_dirty_text_then_destination_creates_two_ordered_undo_entries` was unsatisfiable given the plan's own `commitNodeText` diff: after a text-only rename, the renamed node stays inline with its edge (e.g. `A["Renamed A"] --> B["B"]`), so the literal substring `A --> B` never appears — `commitNodeText` only substitutes the declaration token in place, it never splits the line. Changed that one assertion to check for the actual post-rename line (`A["Renamed A"] --> B["B"]`) instead of the bare-edge substring the plan specified; no production code changed for this.

### Tradeoffs
None beyond the above — every other plan diff (HTML markup, viewer.ts helpers/listeners/rendering, and the remaining five destination tests) was applied exactly as specified.

### Open questions
None. `bun build viewer.ts --outfile viewer.js`, `node --test tests/index.html.test.ts`, `node --test tests/viewer.test.ts tests/viewer.js.test.ts`, and `npm test` all pass.
