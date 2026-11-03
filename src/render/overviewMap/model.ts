/**
 * The overview MAP window's state between frames (#343, CAP-6): it decides when
 * the draw list must be rebuilt and when the camera rectangle must be redrawn,
 * so the window does neither on a frame where nothing changed. No canvas and no
 * DOM, so the rules are unit-tested on their own.
 *
 * - The draw list is rebuilt only when the identity of `structure`, `rooms` or
 *   `tower.transports` changes, or the theme, the box or the extent does (a
 *   Modern band crossed). `tower.revision` alone is not a reason: a host can
 *   repeat a revision over other units (#1296).
 *   The band check is constant work on every sync (a couple of small extent
 *   objects and a few comparisons), never a walk.
 * - The camera placement is recomputed only when the camera's center, zoom or
 *   viewport size, or the layout, changes, and once after each rebuild (so the
 *   window can redraw the rectangle with the tower). Neither check walks the
 *   tower.
 *
 * The identity rule assumes the view hands over new arrays when their contents
 * change, as both view readers do (`SimView` rebuilds `rooms`, `structure` and
 * `tower.transports` together); a host that edited an array in place would
 * leave the map stale. The caller must pass the view's own arrays, never a copy
 * made per frame, or every sync would rebuild.
 */
import type { FacilityKind } from "../../engine/types";
import { buildMapDrawList, shaftLineWidth as normalShaftLine, type MapMark, type MapSource } from "./drawList";
import { themeExtent, sameExtent, viewPlacement, type BuiltFloors, type ViewPlacement } from "./extent";
import { fitLayout, type MapCamera, type MapLayout, type MapWorld } from "./geometry";
import type { MapTheme } from "./style";

/** What the map reads from the view on each sync. Only identities and two
 *  numbers are compared, never the arrays' contents. */
export interface MapViewInput {
  readonly structure: MapSource["structure"];
  readonly rooms: MapSource["rooms"];
  readonly tower: BuiltFloors & { readonly transports: MapSource["transports"] };
}

export interface MapFrameInput {
  readonly view: MapViewInput;
  readonly world: MapWorld;
  readonly theme: MapTheme;
  readonly skyFloors: number;
  /** The drawing box in map (device) pixels: the canvas's backing-store size. */
  readonly boxWidth: number;
  readonly boxHeight: number;
  /** How wide Classic draws a shaft line, in map (device) pixels; the window
   *  passes `CLASSIC_SHAFT_LINE_CSS` times the device pixel ratio. Modern
   *  ignores it. */
  readonly classicShaftLine: number;
  /** A kind's height in floors. It is not part of the rebuild key: the catalog
   *  is bound per tower, and a new tower comes with new arrays. */
  floorsOf(kind: FacilityKind): number;
}

/** Classic draws shafts as lines this many CSS pixels wide (one pixel of the
 *  retail map), so a high-density screen still shows them. */
export const CLASSIC_SHAFT_LINE_CSS = 1;

/** A box size as `fitLayout` reads it: a positive finite number, or 1. */
function boxSide(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export class OverviewMapModel {
  private structure: unknown = null;
  private rooms: unknown = null;
  private transports: unknown = null;
  private theme: MapTheme | null = null;
  private boxWidth = NaN;
  private boxHeight = NaN;
  private shaftLine = NaN;
  private cam: MapCamera | null = null;
  private placementLayout: MapLayout | null = null;
  layout: MapLayout | null = null;
  marks: readonly MapMark[] = [];
  placement: ViewPlacement | null = null;

  /**
   * Bring the layout and draw list up to date. Returns true when the draw list
   * was rebuilt, so the window repaints the tower layer only then. After a
   * rebuild the next `syncCamera` gives the placement again even if the camera
   * has not moved, so a window that redraws the rectangle with the tower (or
   * restyles it for a new theme) has it. A new layout clears `placement` until
   * that call.
   */
  sync(input: MapFrameInput): boolean {
    const extent = themeExtent(input.theme, input.world, input.view.tower, input.skyFloors);
    // Keyed on the values the build actually uses, so a NaN box or a line width
    // that rounds the same never rebuilds on every frame.
    const line = input.theme === "classic" ? normalShaftLine(input.classicShaftLine) : 0;
    const boxWidth = boxSide(input.boxWidth);
    const boxHeight = boxSide(input.boxHeight);
    const sameGeometry = this.layout !== null && this.boxWidth === boxWidth && this.boxHeight === boxHeight && sameExtent(this.layout.extent, extent);
    const same =
      sameGeometry &&
      this.structure === input.view.structure &&
      this.rooms === input.view.rooms &&
      this.transports === input.view.tower.transports &&
      this.theme === input.theme &&
      this.shaftLine === line;
    if (same) return false;
    this.structure = input.view.structure;
    this.rooms = input.view.rooms;
    this.transports = input.view.tower.transports;
    this.theme = input.theme;
    this.boxWidth = boxWidth;
    this.boxHeight = boxHeight;
    this.shaftLine = line;
    this.cam = null;
    // A tower edit inside the same geometry keeps the layout object; only the
    // one placement the rebuild re-arms is recomputed for it.
    if (!sameGeometry || this.layout === null) {
      this.layout = fitLayout(extent, boxWidth, boxHeight);
      this.placement = null;
    }
    const source: MapSource = {
      structure: input.view.structure,
      rooms: input.view.rooms,
      transports: input.view.tower.transports,
      floorsOf: (kind) => input.floorsOf(kind),
    };
    this.marks = buildMapDrawList(this.layout, source, { shaftLineWidth: line });
    return true;
  }

  /**
   * The camera's placement on the current layout, or null when it has not
   * changed since the last call (same center, zoom and viewport on the same
   * layout, and no rebuild in between), so the window redraws the rectangle
   * only when it moved or the tower was redrawn. Null too before the first
   * `sync`.
   */
  syncCamera(cam: MapCamera): ViewPlacement | null {
    const layout = this.layout;
    if (!layout) return null;
    const prev = this.cam;
    if (
      prev !== null &&
      this.placementLayout === layout &&
      Object.is(prev.posX, cam.posX) &&
      Object.is(prev.posY, cam.posY) &&
      Object.is(prev.zoom, cam.zoom) &&
      Object.is(prev.viewWidth, cam.viewWidth) &&
      Object.is(prev.viewHeight, cam.viewHeight)
    ) {
      return null;
    }
    this.cam = { posX: cam.posX, posY: cam.posY, zoom: cam.zoom, viewWidth: cam.viewWidth, viewHeight: cam.viewHeight };
    this.placementLayout = layout;
    this.placement = viewPlacement(layout, cam);
    return this.placement;
  }
}
