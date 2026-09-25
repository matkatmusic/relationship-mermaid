# Implementation notes 47 (2026-09-24)

## References
- /var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/taskTools-wt/relationship-mermaid-dd53a9ae/task-47/plans/plan.json

## Design decisions
- Guarded `sliceIds` in graph-slice.ts: `focusNodeId` is null and `last` is undefined when `state.functionsOnly` is true.

## Deviations
- The bundle-regeneration section is skipped. The reviewer note says viewer.js is not owned by this task.

## Tradeoffs
- None.

## Open questions
- viewer.js bundle is stale until someone rebuilds it.
