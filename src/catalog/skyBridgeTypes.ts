/**
 * The Sky Bridge tool's rule in the catalog's `rules` block
 * (`engine-rs/src/catalog/rules.rs`, `SkyBridgeRule`): when the tool opens,
 * how far a bridge reaches and what a tile costs. `CatalogRules` in
 * `catalogTypes.ts` extends it. The engine's `quoteSkyBridge` prices a gap.
 */

/** The `CatalogRules` field the Sky Bridge tool reads. */
export interface CatalogSkyBridgeRules {
  /** The Sky Bridge tool, or null where the mode builds no bridges (Classic,
   *  as in 1994). */
  readonly skyBridge: CatalogSkyBridge | null;
}

/** What the Sky Bridge tool shows. One click lays the whole gap between two
 *  sky lobbies, or nothing. */
export interface CatalogSkyBridge {
  /** The star rating the tool opens at. */
  readonly minStar: number;
  /** The most tiles of open air one bridge spans. */
  readonly maxSpan: number;
  /** The price of one bridge tile over open air. */
  readonly tileCost: number;
  /** The looks a bridge can wear, in the order the tool lists them; the first
   *  is the plain lobby. A bridge's look is its index here. */
  readonly looks: readonly string[];
}
