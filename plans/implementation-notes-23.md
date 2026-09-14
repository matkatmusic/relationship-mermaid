## 2026-09-13:00:00:00 — Task 23: floating node-inspector shell

Chat title: relationship-mermaid taskTools run (task-23 implement step)
Path to JSONL log: n/a (spawned as a taskTools IMPLEMENT_TASK subagent, no direct conversation JSONL handle)

### References

/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-23/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-23/plans/brief-23.md
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-23/plans/task-22-node-inspector-and-destinations.md
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-23/plans/task-22-mockup.png

### Design decisions

Implemented every plan.json section exactly as written, in order: index.html markup/CSS, viewer.ts render/position/commit/dismiss wiring, and the tests/index.html.test.ts edits (Edit A appended new helpers + 9 tests, Edit B rewrote the two inline-edit tests to drive the inspector). No decisions were left open by the plan; nothing was improvised.

### Deviations

One bug fix beyond the plan's literal text: `positionNodeInspector` originally used a fixed 320px card width and only picked a side when the full width fit. At the test suite's fixed 900x1000 CDP viewport, the Q1 decision diamond (277px wide) leaves only ~215-239px on either side inside `#output`, so a fixed 320px card always overlapped the node, failing `test_clicking_a_question_opens_a_decision_block_inspector` (`besideNode` false). Fixed by sizing the card's width to `min(320, max(spaceLeft, spaceRight))` before choosing a side, so the card always fits fully beside the node. This is a root-cause fix inside `positionNodeInspector`, the single function every render/select/scroll/resize path already calls — no caller-side patch was needed. All other edits were applied verbatim as specified, matching the exact pre-edit line numbers the plan cited.

### Tradeoffs

Considered a caller-side clamp (e.g. capping card width only for narrow-node cases) versus always computing available space in `positionNodeInspector`. Always computing is one code path instead of two, and still yields the full 320px whenever there's room — true for every other node in the suite.

### Open questions

None. The earlier port-3000-conflict blocker noted in an earlier draft of this file has since cleared; the full browser suite now runs and passes.

**Verification performed:**
- `bun build viewer.ts --outfile viewer.js` — exit 0.
- `rg -c 'nodeInspector|nodeActions|editorUndoBtn' viewer.js` — 15 matches (>= 3 expected).
- `node --test tests/index.html.test.ts` — pass 29 / fail 0.
- `node --test tests/viewer.test.ts` — pass 1 / fail 0.
- `node --test tests/viewer.js.test.ts` — pass 1 / fail 0 (committed viewer.js matches a fresh build byte-for-byte).
- `npm test` — all passing.
