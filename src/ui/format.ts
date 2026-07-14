/** Tiny display formatters shared by the HTML builders and the app shell. */

/** Short floor tag: "5" above ground, "B1"/"B2"… below (floor 0 = B1). */
export function floorTag(floor: number): string {
  return floor >= 1 ? `${floor}` : `B${1 - floor}`;
}

/** Compact money for the palette cost chips (e.g. 12k, 1.5M). */
export function shortMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}
