/**
 * The Modern placement tools' rules in the catalog's `rules` block
 * (`engine-rs/src/catalog/rules.rs`): the Sky Bridge tool's (`SkyBridgeRule`:
 * when the tool opens, how far a bridge reaches and what a tile costs; the
 * engine's `quoteSkyBridge` prices a gap) and the row of rooms (#646; the
 * engine's `quoteRoomRow` prices a row). `CatalogRules` in `catalogTypes.ts`
 * extends both.
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
}

/** The `CatalogRules` field the row of rooms reads (#646). */
export interface CatalogRoomRowRules {
  /** Whether one drag along a floor places a row of the same room
   *  (`quoteRoomRow`, `buildRoomRow`). When false a room is placed one click at
   *  a time (Classic, as in 1994). */
  readonly roomRows: boolean;
}
