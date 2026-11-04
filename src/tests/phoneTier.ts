/**
 * The phone tier's bounds, the same numbers as `mobileMq` in src/main.ts and
 * the phone block in styles.css (phoneTierBounds.test.ts keeps the three in
 * step): up to 767px wide, or up to 1023 by 599. The screenshot generator
 * (scripts/screenshot-env.ts) reads it to decide which scenes present as a
 * touch device. Lives under src/tests (not scripts/) so the unit tier can
 * import it without crossing the tsconfig rootDir, like screenshotOnlyFilter.ts,
 * and stays ERASABLE (type annotations only) so node runs it directly.
 */

export const PHONE_TIER = { maxWidth: 767, shortMaxWidth: 1023, shortMaxHeight: 599 } as const;

/** Whether a viewport takes the phone layout, in either orientation. */
export function isPhoneViewport(vp: { width: number; height: number }): boolean {
  const short = vp.width <= PHONE_TIER.shortMaxWidth && vp.height <= PHONE_TIER.shortMaxHeight;
  return vp.width <= PHONE_TIER.maxWidth || short;
}
