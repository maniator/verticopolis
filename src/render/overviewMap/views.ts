/**
 * The overview MAP window's views (#343 S6 to S9): the tabs over the map body,
 * in the original's order (Edit, Eval, Pricing, Hotel). Edit is today's map
 * and Hotel marks the rooms that need housekeeping (S6). Eval and Pricing wait
 * on the engine's per-room export (S7): until S8 gives them their painters,
 * each shows the Edit map under a "coming soon" note. Each later view (the
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
  /** A view with no painter yet shows the Edit map under this note instead
   *  of a legend (Eval and Pricing until S8). */
  readonly comingSoon?: string;
}

/** Every view, in tab order. */
export const MAP_VIEWS: ReadonlyArray<MapViewEntry> = [
  { id: "edit", label: "Edit" },
  { id: "eval", label: "Eval", comingSoon: "Eval view coming soon" },
  { id: "pricing", label: "Pricing", comingSoon: "Pricing view coming soon" },
  { id: "hotel", label: "Hotel" },
];

/** The view a new window starts on, as in the original. */
export const DEFAULT_MAP_VIEW: MapViewId = "edit";

/** The view's entry, or undefined for an id the list does not have. */
export function mapViewEntry(id: MapViewId, views: ReadonlyArray<MapViewEntry> = MAP_VIEWS): MapViewEntry | undefined {
  return views.find((view) => view.id === id);
}
