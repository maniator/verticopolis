/**
 * The overview MAP window's views (#343 S6 to S9), in the View dropdown's
 * order: the original's four (Edit, Eval, Pricing, Hotel), then Traffic and
 * Occupancy. Edit is today's map, Hotel marks the rooms that need
 * housekeeping (S6), Eval and Pricing color the rooms by the tiers the engine
 * gives (S8), and Traffic and Occupancy color each floor by the engine's
 * congestion and occupancy (S9), the two Floor heatmap modes the Map took
 * over from the sidebar. A view is one entry here plus its painter, so the
 * dropdown needs no change. Every view shows in both game modes (owner,
 * 2026-11-10), which the Map draws the same way.
 */

/** A view the map can show. */
export type MapViewId = "edit" | "eval" | "pricing" | "hotel" | "traffic" | "occupancy";

export interface MapViewEntry {
  readonly id: MapViewId;
  /** The view's name in the dropdown. */
  readonly label: string;
}

/** Every view, in the dropdown's order. */
export const MAP_VIEWS: ReadonlyArray<MapViewEntry> = [
  { id: "edit", label: "Edit" },
  { id: "eval", label: "Eval" },
  { id: "pricing", label: "Pricing" },
  { id: "hotel", label: "Hotel" },
  { id: "traffic", label: "Traffic" },
  { id: "occupancy", label: "Occupancy" },
];

/** The view a new window starts on, as in the original. */
export const DEFAULT_MAP_VIEW: MapViewId = "edit";

/** The view's entry, or undefined for an id the list does not have. */
export function mapViewEntry(id: MapViewId, views: ReadonlyArray<MapViewEntry> = MAP_VIEWS): MapViewEntry | undefined {
  return views.find((view) => view.id === id);
}
