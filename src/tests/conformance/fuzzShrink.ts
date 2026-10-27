/**
 * Shrink a failing fuzzer scenario: delta debugging (Zeller's ddmin) over the
 * command list. `scripts/fuzz-shrink.ts` supplies the predicate, which runs a
 * candidate on both engines; the search itself is pure so it can be tested
 * without either one.
 */

export interface DdminResult<T> {
  /** The reduced list. Still fails when the search was not cut short. */
  kept: T[];
  /** How many times the predicate ran. */
  tests: number;
  /** True when `maxTests` stopped the search before it settled, so `kept` may
   *  not be minimal. */
  exhausted: boolean;
}

/** Reduce `items` to a list that still `fails`, by trying chunks and their
 *  complements at growing granularity. The result is 1-minimal when the search
 *  settles: dropping any one item makes it stop failing. `fails(items)` must
 *  already be true; the predicate decides what counts (a scenario the Rust
 *  engine refuses does not). Deterministic for a deterministic predicate. */
export function ddmin<T>(items: readonly T[], fails: (candidate: readonly T[]) => boolean, maxTests = 500): DdminResult<T> {
  let kept = [...items];
  let tests = 0;
  const test = (candidate: T[]): boolean | null => {
    if (tests >= maxTests) return null;
    tests++;
    return fails(candidate);
  };
  let n = 2;
  while (kept.length >= 2) {
    const size = Math.ceil(kept.length / n);
    const chunks: T[][] = [];
    for (let i = 0; i < kept.length; i += size) chunks.push(kept.slice(i, i + size));
    let reduced = false;
    for (const chunk of chunks) {
      const r = test(chunk);
      if (r === null) return { kept, tests, exhausted: true };
      if (r) {
        kept = chunk;
        n = 2;
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      for (let i = 0; i < chunks.length; i++) {
        const complement = chunks.filter((_, j) => j !== i).flat();
        const r = test(complement);
        if (r === null) return { kept, tests, exhausted: true };
        if (r) {
          kept = complement;
          n = Math.max(n - 1, 2);
          reduced = true;
          break;
        }
      }
    }
    if (!reduced) {
      if (n >= kept.length) break;
      n = Math.min(kept.length, n * 2);
    }
  }
  // A single item left may itself be droppable (an empty list still fails).
  if (kept.length === 1) {
    const r = test([]);
    if (r === null) return { kept, tests, exhausted: true };
    if (r) kept = [];
  }
  return { kept, tests, exhausted: false };
}
