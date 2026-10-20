/**
 * Runs `body` for each scenario in order, each after `fresh(scenario)`. The
 * harness uses it so no scenario is measured in a page that an earlier
 * scenario already ran in: the JIT state one tower leaves in a page slowed the
 * next tower's TypeScript engine about 2x (1,441 ms after medium against 705 ms
 * in a fresh page for the large tower on the PC). A `body` that returns
 * `false` stops the loop, for a block whose precondition failed (audio that
 * would not start).
 */
export async function eachScenarioFresh<T extends { name: string }>(scenarios: readonly T[], fresh: (sc: T) => Promise<void>, body: (sc: T) => Promise<void | false>): Promise<void> {
  for (const sc of scenarios) {
    await fresh(sc);
    if ((await body(sc)) === false) return;
  }
}
