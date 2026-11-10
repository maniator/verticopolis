/**
 * The overview MAP window's views (#343 S6 to S9): the tabs over the map body,
 * in the original's order (Edit, Eval, Pricing, Hotel). Edit is today's map,
 * Hotel marks the rooms that need housekeeping (S6), and Eval and Pricing
 * color the rooms by the tiers the engine gives (S8). Each later view (the
 * Traffic and Occupancy tabs in S9) is one entry here plus its painter, so
 * the tab row needs no change. Every tab shows in both game modes, which the
 * Map draws the same way.
 */

/** A view the map can show. */
export type MapViewId = "edit" | "eval" | "pricing" | "hotel";

export interface MapViewEntry {
  readonly id: MapViewId;
  /** The tab's label. */
  readonly label: string;
}

/** Every view, in tab order. */
export const MAP_VIEWS: ReadonlyArray<MapViewEntry> = [
  { id: "edit", label: "Edit" },
  { id: "eval", label: "Eval" },
  { id: "pricing", label: "Pricing" },
  { id: "hotel", label: "Hotel" },
];

/** The view a new window starts on, as in the original. */
export const DEFAULT_MAP_VIEW: MapViewId = "edit";

/** The view's entry, or undefined for an id the list does not have. */
export function mapViewEntry(id: MapViewId, views: ReadonlyArray<MapViewEntry> = MAP_VIEWS): MapViewEntry | undefined {
  return views.find((view) => view.id === id);
}
