import type { GameApp } from "../main";
import type { FacilityKind } from "../engine/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import { FACILITIES, isFixedSpanTransport } from "../engine/facilities";
import { brushTiles, snapX, type PlaceOutcome } from "../ui/placement";
import { buildRefusalTemplate } from "../ui/templates/inspector";
import { isPaintKind } from "./gesture";
import { FLOOR } from "../render/scale";

/**
 * How far above the touch point a room's placement ghost floats, in SCREEN pixels
 * (about a fingertip). Touch has no hover, so a build used to drop blind under the
 * thumb; the offset lifts the ghost (and the placed room) to where the finger is
 * not covering it. See {@link touchBuildLiftFloors} for how it converts to floors.
 */
const TOUCH_BUILD_LIFT_PX = 46;

/** The MOST floors the ghost is lifted above the finger. The lift is a fixed screen
 *  distance, but when zoomed out a fingertip spans many floors, so an uncapped lift
 *  drifts the ghost far up the tower (reads as "too far"). Capping the FLOOR count
 *  keeps the ghost close to the finger in the world at any zoom. */
const TOUCH_BUILD_LIFT_MAX_FLOORS = 2;

/** The room-placement lift in FLOORS at the current zoom: a fingertip of screen
 *  distance, at least one floor so it always clears the thumb, and at most
 *  {@link TOUCH_BUILD_LIFT_MAX_FLOORS} so it never drifts far up when zoomed out.
 *  Touch build only; mouse hover is exact. */
export function touchBuildLiftFloors(app: GameApp): number {
  const floors = Math.round(TOUCH_BUILD_LIFT_PX / (FLOOR * app.engine.cam.zoom));
  return Math.max(1, Math.min(TOUCH_BUILD_LIFT_MAX_FLOORS, floors));
}

/**
 * Build-preview, placement, and pick resolution, split out of the `GameApp`
 * class as friend functions taking the app. They read `app.sim`/`app.engine`
 * live (never captured), so an `adoptSim` swap stays visible. Behavior unchanged
 * from the former methods.
 *
 * NOTE: src/tests/integration/gameControllers.integration.test.ts mirrors
 * `placeSimpleBuild` (and `pickedAt` / `isTransportTool`) to drive KeyboardPlay
 * headlessly, keep that mirror in sync when editing these.
 */

/** The inspectable/bulldozable entity at a cell (room or transport), if any. */
export function pickedAt(app: GameApp, floor: number, tile: number): Picked | null {
  const u = app.sim.tower.unitAt(floor, tile);
  if (u && u.kind !== "floor" && u.kind !== "lobby") return { type: "unit", id: u.id, kind: u.kind };
  const t = app.sim.tower.transports.find(
    // Use the shaft's OWN stored width (matches render + overlap checks), not
    // the catalog width, an old save keeps its stored width, so after a canon
    // width change (e.g. stairs 4→8) the catalog would give a phantom click zone.
    (tr) => tile >= tr.x && tile < tr.x + tr.width && floor >= tr.bottom && floor <= tr.top,
  );
  return t ? { type: "transport", id: t.id, kind: t.kind } : null;
}

/** The gesture-independent placement cases shared by tap, click, and the
 *  keyboard cursor: paint a structure strip, drop a fixed two-floor flight,
 *  or place a room. Returns null for drag-sized shafts, that anchor
 *  gesture belongs to the caller. */
export function placeSimpleBuild(app: GameApp, kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null {
  if (kind === "floor" || kind === "lobby") {
    const r = app.build.paintBrush(kind, tile, floor);
    return { what: "paint", ok: r.placed > 0, reason: r.reason };
  }
  if (isFixedSpanTransport(kind)) {
    const r = app.build.tryBuildTransport(kind, snapX(kind, tile), floor, floor + 1);
    return { what: "flight", ok: r.ok, reason: r.reason };
  }
  if (isTransportTool(app)) return null;
  const before = app.sim.tower.units.length;
  app.build.tryBuild(kind, floor, snapX(kind, tile));
  return { what: "room", ok: app.sim.tower.units.length > before };
}

export function isTransportTool(app: GameApp): boolean {
  return app.tool.type === "build" && !!FACILITIES[app.tool.kind].transport;
}

/** Whether the active tool drag-paints a run (floor/lobby/parking), see
 *  {@link isPaintKind}. Used by the touch deferral in onActionDown. */
export function isPaintTool(app: GameApp): boolean {
  return app.tool.type === "build" && isPaintKind(app.tool.kind);
}

export function updateBuildPreview(app: GameApp, tile: number, floor: number, showReasonCard = true): void {
  if (app.tool.type !== "build") {
    app.engine.preview = null;
    app.engine.transportPreview = null;
    clearBuildRefusal(app);
    return;
  }
  const kind = app.tool.kind;
  if (isTransportTool(app)) {
    const x = snapX(kind, tile);
    if (isFixedSpanTransport(kind)) {
      // Stairs/escalators place as a fixed two-floor unit on tap, so the
      // ghost shows the real footprint and the real validity.
      const valid = app.sim.isUnlocked(kind) && app.sim.tower.placeTransportDryRun(kind, x, floor, floor + 1);
      app.engine.transportPreview = { kind, x, bottom: floor, top: floor + 1, valid };
      app.engine.preview = null;
    } else {
      app.engine.transportPreview = null;
      app.engine.preview = { kind, floor, x, valid: app.sim.isUnlocked(kind) };
    }
    clearBuildRefusal(app);
  } else if (kind === "floor" || kind === "lobby") {
    // These tools lay a centered brush strip, not a single tile, so the
    // shadow must span the same run a click will build.
    const tiles = brushTiles(tile);
    const left = tiles[0];
    const span = tiles[tiles.length - 1] - left + 1;
    const can = app.sim.canBuild(kind, floor, snapX(kind, tile));
    const reason = !can.ok && app.sim.rules.showsPreviewReason ? can.reason : undefined;
    app.engine.preview = { kind, floor, x: left, span, valid: can.ok, reason };
    app.engine.transportPreview = null;
    if (showReasonCard) updateBuildRefusal(app, reason, floor, left + Math.floor(span / 2));
    else clearBuildRefusal(app);
  } else {
    const x = snapX(kind, tile);
    // Rooms auto-lay their own floor, so validity comes from canBuild (which
    // accounts for the floor tiles and their cost), not raw canPlace.
    const can = app.sim.canBuild(kind, floor, x);
    // Modern surfaces the refusal reason on the preview so a hover teaches the
    // rule before the click; Classic keeps the '94 click-to-refuse pedagogy.
    const reason = !can.ok && app.sim.rules.showsPreviewReason ? can.reason : undefined;
    app.engine.preview = { kind, floor, x, valid: can.ok, reason };
    app.engine.transportPreview = null;
    if (showReasonCard) updateBuildRefusal(app, reason, floor, x + Math.floor(FACILITIES[kind].width / 2));
    else clearBuildRefusal(app);
  }
}

/** Surface a Modern-mode build-refusal reason via the hover inspector DOM
 *  surface, or clear it if no reason applies. The inspector card is dormant
 *  in build mode (only the inspect tool drives it), so the build-preview path
 *  can safely borrow the same DOM element without racing a legit inspector
 *  card. `buildRefusalShowing` tracks ownership so a switch back to the inspect
 *  tool doesn't stomp a fresh card. */
export function updateBuildRefusal(app: GameApp, reason: string | undefined, floor: number, anchorX: number): void {
  if (reason) {
    app.inspectAnchor = { x: anchorX, floor };
    // The template wraps the tooltip in the standard <h4 class="win-title">
    // so UI.showInspector attaches its mobile-only ✕ close. On desktop the
    // tooltip clears as soon as the pointer moves off an invalid cell, but
    // on the phone tier there is no such hover trail, so a pinned card
    // needs an explicit dismiss affordance.
    app.ui.showInspector(buildRefusalTemplate(reason));
    app.buildRefusalShowing = true;
  } else {
    clearBuildRefusal(app);
  }
}

/** Hide the Modern build-refusal tooltip, but only if the build-preview path
 *  is the one that put it up (so a live inspect-tool card is never stomped). */
export function clearBuildRefusal(app: GameApp): void {
  if (!app.buildRefusalShowing) return;
  app.ui.showInspector(null);
  app.inspectAnchor = null;
  app.buildRefusalShowing = false;
}
