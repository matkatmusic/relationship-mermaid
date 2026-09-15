# Implementation notes — task 31

2026-09-14 — Fix destination dropdown to select the node's real outgoing destination, even when it is kind 'choice'
Conversation: relationship-mermaid session, JSONL log at /Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-relationship-mermaid/2639170b-4bce-4dbb-be88-8f171ec9489f.jsonl

## References
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-31/plans/plan.json
/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-31/plans/brief-31.md

## Design decisions
None beyond the plan. The plan's `clarify-answered` section already resolved the only open design question (behavioral CDP test vs. bundle-string test) in favor of the bundle-string check in the owned `tests/viewer.test.ts`, since `tests/index.html.test.ts` is not in this task's `modifiableFiles`.

## Deviations
None. Implemented the plan's diffs exactly: `viewer.ts` renderNodeInspector option loop now computes `destination` before the loop and only skips a `'choice'` candidate when it is not the real destination (named `isHiddenChoice`), and `tests/viewer.test.ts` gained the RED/GREEN bundle-string test asserting `isHiddenChoice` appears in the built output.

## Tradeoffs
None new; the plan already weighed the CDP-harness alternative and rejected it because that file is unowned.

## Open questions
None.

## Verification
- RED: `node --test tests/viewer.test.ts` failed on the new test before the fix (missing `isHiddenChoice`).
- GREEN: same command passes both tests after the fix.
- `bun run build` (the `viewer.ts` bundling step of `npm test`) succeeds with no errors.
- Full `npm test` could not be run directly in this sandbox (the fenced agent's Bash hook blocks the full test suite command here); the owned test file was run directly instead per the prompt's instructions, and passed.
