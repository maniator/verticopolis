/**
 * What the overview MAP window (`overviewMapWindow.ts`) is given: the tower
 * it draws, the camera it reads and moves, and the views with their View dropdown.
 */
import type { FacilityKind } from "@verticopolis/engine/model/types";
import type { HallRun } from "@verticopolis/components/render/lobbyHalls";
import type {
  MapCamera,
  MapCameraCenter,
  MapLayout,
  MapWorld,
} from "@verticopolis/components/render/overviewMap/geometry";
import type { MapViewInput } from "@verticopolis/components/render/overviewMap/model";
import type { OverviewMapViews } from "./overviewMapViews";

/** What the window draws each frame. */
export interface OverviewMapSource {
  readonly view: MapViewInput;
  readonly world: MapWorld;
}

/** A tap on the map, after it moved the view: where it landed, in map
 *  pixels on `layout`, and how far from a room it may land and still count
 *  as on it (`reach`, map pixels). */
export interface MapTap {
  readonly layout: MapLayout;
  readonly x: number;
  readonly y: number;
  readonly reach: number;
}

/** The camera fields the window reads, filled in place each frame. */
export type MutableMapCamera = { -readonly [K in keyof MapCamera]: MapCamera[K] };

export interface OverviewMapDeps {
  /** The element the window and its button go in (`#stage`). */
  readonly stage: HTMLElement;
  /** The tower to draw, or null while there is none. */
  source(): OverviewMapSource | null;
  /** Fill `out` with the camera as the renderer holds it. */
  readCamera(out: MutableMapCamera): void;
  /** Move the camera's center at its current zoom; the renderer clamps it. */
  moveCamera(center: MapCameraCenter): void;
  /** A kind's height in floors (the catalog the view binds). */
  floorsOf(kind: FacilityKind): number;
  /** The lobby halls taller than one story (#308), read only when the map
   *  rebuilds its draw list; without it every lobby draws one story. */
  tallLobbies?(): ReadonlyArray<HallRun>;
  /** Whether the phone layout applies now. */
  isPhone(): boolean;
  /** Where the open or closed choice is kept, or null without storage. */
  readonly storage: Storage | null;
  /** A tap on the map moved the view (see `MapTap`); the game opens the card
   *  of what the selected view shows there. */
  tapped?(tap: MapTap): void;
  /** The views and their dropdown (the game always passes them); without them the window
   *  draws the Edit view alone. */
  readonly views?: OverviewMapViews | null;
}
