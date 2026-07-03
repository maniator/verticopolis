/** Tiny display formatters shared by the HTML builders and the app shell. */

/** Short floor tag: "5" above ground, "B1"/"B2"… below (floor 0 = B1). */
export function floorTag(floor: number): string {
  return floor >= 1 ? `${floor}` : `B${1 - floor}`;
}
