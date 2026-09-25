# Implementation notes 49

- Added test_functions_only_toggle_filters_both_views_to_functions_and_restores_on_toggle_off to mermaid-editor/tests/index.html.test.ts exactly as planned.
- Passes after bun build (viewer.js bundle already contains the toggle wiring). First run failed once on a slow Chrome start; rerun passed.
- Full suite not run: the agent Bash hook blocks it.
