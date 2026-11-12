/** Tiny display formatters shared by the HTML builders and the app shell. */

/** Short floor tag: "5" above ground, "B1"/"B2"… below (floor 0 = B1). */
export function floorTag(floor: number): string {
  return floor >= 1 ? `${floor}` : `B${1 - floor}`;
}

/** The ordinal suffix by last digit, where it is not "th". */
const ORDINAL_SUFFIX: Readonly<Record<number, string>> = { 1: "st", 2: "nd", 3: "rd" };

/** An English ordinal for a whole number: 1st, 2nd, 3rd, 11th, 100th, 121st. */
export function ordinal(n: number): string {
  const lastTwo = Math.abs(n) % 100;
  const teen = lastTwo >= 11 && lastTwo <= 13;
  const suffix = teen ? "th" : (ORDINAL_SUFFIX[Math.abs(n) % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Compact money for the palette cost chips (e.g. 12k, 1.5M). */
export function shortMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

/** One shared formatter, so no call builds its own. */
const US_DIGITS = new Intl.NumberFormat("en-US");

/**
 * A whole number with its digits grouped the US way (12,345); a fraction
 * keeps at most three decimals. The UI is English, so it groups as
 * English does in any browser locale; the top bar's fixed chips are sized
 * for this grouping too.
 */
export function groupDigits(n: number): string {
  return US_DIGITS.format(n);
}
