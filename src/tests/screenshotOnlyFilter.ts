/**
 * Resolve the ONLY= scene filter for the screenshot generator
 * (scripts/screenshots.ts). Lives under src/tests (not scripts/) so the unit
 * tier can pin the unmatched-filter contract without importing across the
 * tsconfig rootDir, the same direction the generator already depends on
 * src/tests/fixtures. Kept dependency-free and ERASABLE (type annotations
 * only, see scripts/screenshot-env.ts) so node runs it directly via native
 * type-stripping.
 */

export interface OnlyFilterResult {
  /** Scene ids to render: the matched subset, or every id when no filter is set. */
  selected: string[];
  /** Non-empty filter entries that matched no known scene id (typos, removed scenes). */
  unmatched: string[];
}

/**
 * Parse a raw ONLY value ("id-a,id-b", possibly with whitespace or empty
 * segments) against the known scene ids. The CALLER decides what unmatched
 * entries mean; the generator treats a filter that selects nothing as a hard
 * error, because "rendered zero scenes" reported as success is how a typo'd
 * ONLY quietly skips real work (audit finding AUD-033).
 */
export function resolveOnlyFilter(availableIds: readonly string[], raw: string | undefined): OnlyFilterResult {
  const requested = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) return { selected: [...availableIds], unmatched: [] };
  const available = new Set(availableIds);
  return {
    selected: availableIds.filter((id) => requested.includes(id)),
    unmatched: requested.filter((id) => !available.has(id)),
  };
}
