/**
 * The overview MAP window's draw list (#343): every mark the tower layer shows,
 * as a kind and a rectangle in map pixels. A pure function of the view and a
 * layout, so the window rebuilds it only when the identity of `rooms`,
 * `structure` or `transports` or the layout changes (not on `tower.revision`
 * alone, since a host can repeat a revision, #1296), and the list is
 * unit-tested without a canvas.
 *
 * The list is as long as the tower has structure runs, rooms and shafts (about
 * 3,000 marks for the large perf fixture's 43,000 units), because the view
 * already joins floor and lobby tiles into runs.
 *
 * Painting order is the list's order: structure first, then rooms over it, then
 * shafts and stairs over both. The unit of a rectangle is the map's device pixel
 * (see `geometry.ts`).
 */
import type { FacilityKind } from "../../engine/types";
import type { StructureRunView, TransportView, UnitView } from "../../simport/view";
import { snappedBlock, type MapLayout, type MapRect } from "./geometry";

/** Which painting layer a mark belongs to. */
export type MapLayer = "structure" | "room" | "transport";

export interface MapMark {
  readonly layer: MapLayer;
  readonly kind: FacilityKind;
  /** In map (device) pixels, snapped to whole pixels, inside the map. */
  readonly rect: MapRect;
}

/** What the draw list reads from the view. `floorsOf` is the kind's height in
 *  floors, read from the engine's catalog by the caller through
 *  `findViewKind(kind)?.floors` in `src/presentation/viewKinds.ts` (the map
 *  holds no facility table of its own). It is asked once per kind per build. */
export interface MapSource {
  readonly structure: ReadonlyArray<Pick<StructureRunView, "kind" | "floor" | "x" | "width" | "count">>;
  readonly rooms: ReadonlyArray<Pick<UnitView, "kind" | "floor" | "x" | "width">>;
  readonly transports: ReadonlyArray<Pick<TransportView, "kind" | "x" | "width" | "bottom" | "top">>;
  floorsOf(kind: FacilityKind): number;
}

/**
 * The kind's height in floors, as the caller's catalog read answers it. A
 * non-finite or sub-floor answer (a kind the catalog does not list) draws as
 * one floor.
 */
function floorsFor(source: MapSource, kind: FacilityKind, memo: Map<FacilityKind, number>): number {
  let floors = memo.get(kind);
  if (floors === undefined) {
    const asked = source.floorsOf(kind);
    floors = Number.isFinite(asked) && asked >= 1 ? Math.floor(asked) : 1;
    memo.set(kind, floors);
  }
  return floors;
}

/**
 * Build the draw list for a source and a layout. An entry that cannot be drawn
 * (a non-finite coordinate, no width, wholly off the map) is dropped; nothing
 * throws on odd input.
 *
 * Within the structure and room layers the marks are grouped by kind, so the
 * painter changes its fill style about once per kind instead of once per room.
 * Rooms and floor runs do not overlap inside a layer, so the grouping changes no
 * pixel. Shafts keep their order, since a stairway can cross a shaft's column.
 * The layers still paint in order: structure, rooms, then shafts.
 */
export function buildMapDrawList(layout: MapLayout, source: MapSource): MapMark[] {
  const heights = new Map<FacilityKind, number>();
  const structure = new Map<FacilityKind, MapMark[]>();
  const rooms = new Map<FacilityKind, MapMark[]>();
  const transports: MapMark[] = [];
  const bucket = (into: Map<FacilityKind, MapMark[]>, kind: FacilityKind): MapMark[] => {
    let list = into.get(kind);
    if (!list) into.set(kind, (list = []));
    return list;
  };
  for (const run of source.structure) {
    // A run's width is its tile width times its tile count; a bad count draws nothing.
    if (!(run.count >= 1) || !Number.isFinite(run.count)) continue;
    const rect = snappedBlock(layout, run.x, run.width * run.count, run.floor, 1);
    if (rect) bucket(structure, run.kind).push({ layer: "structure", kind: run.kind, rect });
  }
  for (const room of source.rooms) {
    const rect = snappedBlock(layout, room.x, room.width, room.floor, floorsFor(source, room.kind, heights));
    if (rect) bucket(rooms, room.kind).push({ layer: "room", kind: room.kind, rect });
  }
  for (const t of source.transports) {
    // A shaft serves every floor from `bottom` to `top`, both included, whichever
    // way round the two come.
    const lo = Math.min(t.bottom, t.top);
    const hi = Math.max(t.bottom, t.top);
    const rect = snappedBlock(layout, t.x, t.width, lo, hi - lo + 1);
    if (rect) transports.push({ layer: "transport", kind: t.kind, rect });
  }
  return [...structure.values(), ...rooms.values()].flat().concat(transports);
}
