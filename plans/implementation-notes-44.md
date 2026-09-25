# Task 44 — fix implement task tests

## FIX_IMPLEMENT_TASK_TESTS

Own test `mermaid-editor/tests/function-routing.test.ts` passes: 3 pass, 0 fail.

The reported "new failing" tests all live in `mermaid-editor/tests/index.html.test.ts`,
which is not in my editable paths:
- test_functions_only_toggle_exists_and_is_unchecked_by_default
- test_remove_block_deletes_the_selected_terminal_block
- test_remove_block_deletes_the_selected_block_and_reconnects_its_neighbors

Root cause of every `index.html.test.ts` failure is one shared-setup error:
`port 36382 did not open within 5000ms` at `waitForPort(CDP_PORT)` (line 134).
Headless Chrome's remote-debugging port does not open within the 5000ms limit
when the full suite runs many browser test files at once. It is a launch-timeout,
not a code defect.

Proof: run in isolation, all three pass.
- `node --test --test-name-pattern='test_functions_only_toggle_...' tests/index.html.test.ts` -> 1 pass
- both remove_block tests together -> 2 pass

The defect (too-short `waitForPort` timeout / Chrome contention) sits in
`index.html.test.ts`'s setup, outside the paths I own. No edit made there.
No defect exists in `function-routing.ts` or `viewer.js`.
