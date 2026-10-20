/**
 * Runs `body` for each scenario in order, each after `fresh(scenario)`. The
 * harness uses it so no scenario is measured in a page that an earlier
 * scenario already ran in: whatever one tower leaves in a page (most likely
 * JIT type feedback) slowed the next tower's TypeScript engine about 2x on the
 * owner's PC, 1,441 ms for the large tower after medium in the #1051 before
 * pass (main 06a6dcb, 1x, bare engine, 2026-10-20) against 705 ms in a page of
 * its own with `perf:worker` (issue #1162). A reload in the same tab keeps the
 * renderer process, so the cause is not settled. A `body` that returns
 * `false` stops the loop, for a block whose precondition failed (audio that
 * would not start).
 */
export async function eachScenarioFresh<T extends { name: string }>(scenarios: readonly T[], fresh: (sc: T) => Promise<void>, body: (sc: T) => Promise<void | false>): Promise<void> {
  for (const sc of scenarios) {
    await fresh(sc);
    if ((await body(sc)) === false) return;
  }
}
