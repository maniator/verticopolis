/**
 * Canon wall and picture look tables for the tenant-room kinds, split out of
 * `residential.ts` so the enriched dollhouse draw code has room to grow under
 * the 500-line ceiling without touching this data (mirrors the
 * `food.looks.ts` / `shop.looks.ts` pattern). Imported by `residential.ts`.
 *
 * geoVariant indexes these by array position, so the ORDER and LENGTH are
 * load-bearing: the anchor is listed twice (double-weighted) so the classic
 * look stays the most common, and every wall variant holds within about 10 per
 * RGB channel of its anchor (index 0) so the night scrim and heatmap tint never
 * make a variant ambiguous. Hue varies, luminance holds. No value equals a
 * reserved state color (the residential luminance/reserved guard pins this).
 */

/** Office walls: warm cream plaster (art bible pillar: cream or warm-gray, never
 *  cool blue-gray). Anchor is the canon `warmWall` cream; the lit/unlit read is
 *  carried by the downlights and the empty-at-night scrim, not a wall swap. */
export const OFFICE_WALLS = ["#ECDFC2", "#ECDFC2", "#ECDCC0", "#E8E0C6", "#EEDCBE"];

/** Condo walls: warm home plaster, anchor double-weighted, variants within 10
 *  per channel (variety comes from the three layouts, not the wall hue). */
export const CONDO_WALLS = ["#C8A88C", "#C8A88C", "#C4A890", "#CCA688", "#C6AC90"];

/** Condo framed-picture subjects: the same frame slot, muted and hue-varied (a
 *  portrait, a cityscape, a landscape). These are picture contents, not a wall
 *  tint, so they carry hue variety by design; they only have to stay muted and
 *  non-reserved. */
export const CONDO_PICTURES = ["#7A5A44", "#7A5A44", "#5A6E7A", "#6E7A5A"];

/** Hotel linen walls (single / double) and the suite's own warmer gold band, so
 *  the grade tell survives. Anchors double-weighted, variants within 10 per
 *  channel of each band's anchor. */
export const HOTEL_WALLS = ["#D8C49A", "#D8C49A", "#DACA9E", "#DCC098"];
export const SUITE_WALLS = ["#C8A86A", "#C8A86A", "#C4AC72", "#CCA462"];
