---
title: 'Stats readout review cleanups'
type: 'refactor'
created: '2026-07-03'
status: 'done'
route: 'one-shot'
---

# Stats readout review cleanups

## Intent

**Problem:** The `/gds-code-review` pass over the merged stats-readout feature (PR #111) surfaced two harmless cosmetic issues: `floorHeatmap()` carried two per-floor accumulator fields (`occupied`, `present`) that were always incremented together (dead redundancy), and `buildIncomeHtml()`'s "Net" line summed every category while the visible rows were filtered to non-zero-rounded, so a hidden sub-$0.50/day line could nudge Net away from what the rows show.

**Approach:** Collapse the redundant accumulator to a single `present` field (pure no-op — occupancy `1 - present/total`, satisfaction `1 - satSum/present` unchanged), and make Net sum only the displayed `rows`. Add a focused `statsHtml` test for the Net consistency; existing `heatmap.test.ts` already locks the occupancy/satisfaction behavior.

## Suggested Review Order

1. [`src/engine/Simulation.ts` — floorHeatmap accumulator collapse](../../src/engine/Simulation.ts) — verify `occupied`→`present` is a true no-op; no other reader of the old field.
2. [`src/ui/statsHtml.ts` — buildIncomeHtml Net](../../src/ui/statsHtml.ts) — Net now sums the filtered rows; comment scoped to hidden-line exclusion (not per-row rounding).
3. [`src/tests/statsHtml.test.ts` — Net consistency test](../../src/tests/statsHtml.test.ts) — discriminating assertion (old code renders `$1,001`, new renders `$1,000`); separator-agnostic match.
