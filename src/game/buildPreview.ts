import type { GameApp } from "../main";
import type { FacilityKind } from "../shared/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import { catalogBuildKind, catalogFacility, catalogTileCost, type Catalog } from "../catalog/catalogTypes";
import { brushTiles, snapX, type PlaceOutcome } from "../ui/placement";
import { buildRefusalTemplate } from "../ui/templates/inspector";
import { isPaintKind } from "./gesture";
import { FLOOR } from "../render/scale";
import { catalogOf, isUnlocked, quoteBuild, quoteShaft, type BuildQuote } from "./portAccess";
import { NOT_ENOUGH_MONEY } from "../simport/request";

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
 * class as friend functions taking the app. They read the shared reader and
 * `app.engine` live (never captured), so an `adoptSim` swap stays visible. Behavior unchanged
 * from the former methods.
 *
 * NOTE: src/tests/integration/gameControllers.integration.test.ts mirrors
 * `placeSimpleBuild` (and `pickedAt` / `isTransportTool`) to drive KeyboardPlay
 * headlessly, keep that mirror in sync when editing these.
 */

/** The inspectable/bulldozable entity at a cell (room or transport), if any. */
export function pickedAt(app: GameApp, floor: number, tile: number): Picked | null {
  // The reader answers every story a room covers, as the tower does.
  const u = app.reader.tower.unitAt(floor, tile);
  if (u && u.kind !== "floor" && u.kind !== "lobby") return { type: "unit", id: u.id, kind: u.kind };
  const t = app.reader.tower.transports.find(
    // Use the shaft's OWN stored width (matches render + overlap checks), not
    // the catalog width, an old save keeps its stored width, so after a canon
    // width change (e.g. stairs 4→8) the catalog would give a phantom click zone.
    (tr) => tile >= tr.x && tile < tr.x + tr.width && floor >= tr.bottom && floor <= tr.top,
  );
  return t ? { type: "transport", id: t.id, kind: t.kind } : null;
}

/** The gesture-independent placement cases shared by tap, click, and the
 *  keyboard cursor: paint a structure strip, drop a fixed two-floor flight,
 *  or place a room, each a command through the port. Returns null for
 *  drag-sized shafts (that anchor gesture belongs to the caller), and
 *  otherwise the engine's outcome. */
export function placeSimpleBuild(app: GameApp, kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null {
  const catalog = catalogOf(app);
  if (kind === "floor" || kind === "lobby") {
    const r = app.build.paintBrush(kind, tile, floor);
    return { what: "paint", ok: r.placed > 0, reason: r.reason };
  }
  if (catalogFacility(catalog, kind).fixedSpan) {
    const r = app.build.tryBuildTransport(kind, snapX(catalog, kind, tile), floor, floor + 1);
    return { what: "flight", ok: r.ok, reason: r.reason };
  }
  if (isTransportTool(app)) return null;
  return { what: "room", ok: app.build.tryBuild(kind, floor, snapX(catalog, kind, tile)) };
}

export function isTransportTool(app: GameApp): boolean {
  return app.tool.type === "build" && catalogFacility(catalogOf(app), app.tool.kind).transport;
}

/** Whether the active tool drag-paints a run (floor/lobby/parking), see
 *  {@link isPaintKind}. Used by the touch deferral in onActionDown. */
export function isPaintTool(app: GameApp): boolean {
  return app.tool.type === "build" && isPaintKind(app.tool.kind);
}

/** A structure kind the tower reads at a tile, or undefined where none is built. */
type BuiltAt = ReturnType<GameApp["reader"]["tower"]["structureKindAt"]>;

/** Whether the `kind` brush passes over a tile that holds `built`, as
 *  paintTiles does: a Lobby brush skips lobby tiles (it turns plain floor into
 *  lobby), a Floor brush any structure, on the ground floor too. */
function brushSkips(kind: "floor" | "lobby", built: BuiltAt): boolean {
  return kind === "lobby" ? built === "lobby" : built !== undefined;
}

/** Whether the engine refuses the `kind` brush's tile at `(floor, x)`, which
 *  holds `built`, because a room stands on that plain floor (`room_span_free`).
 *  An old save can hold one on the ground floor; the brush lays past it. On a
 *  sky lobby floor any room refuses every lobby tile, which the quote names. */
function roomBlocks(app: GameApp, kind: "floor" | "lobby", built: BuiltAt, floor: number, x: number): boolean {
  return kind === "lobby" && built === "floor" && app.reader.roomAt(floor, x) !== undefined;
}

/** Whether a tile laid at `(floor, x)` would have what holds it up: above the
 *  ground floor, the story below it (`Tower::is_supported`). Lower down a tile
 *  is held by its neighbors, which the brush's own passes lay. */
function heldUp(app: GameApp, groundFloor: number, floor: number, x: number): boolean {
  return floor <= groundFloor || app.reader.tower.structureKindAt(floor - 1, x) !== undefined;
}

/** Whether a tile at `(floor, x)` stands against built structure, so it stands
 *  with bridging off: plain floor the Lobby brush lays over, a built tile beside
 *  it on its row, or on the ground floor and below one over or under it, the
 *  support `Tower::is_supported` reads there. */
function touchesTower(app: GameApp, groundFloor: number, floor: number, x: number): boolean {
  const t = app.reader.tower;
  if (t.structureKindAt(floor, x) !== undefined) return true;
  if (t.structureKindAt(floor, x - 1) !== undefined || t.structureKindAt(floor, x + 1) !== undefined) return true;
  return floor <= groundFloor && (t.structureKindAt(floor - 1, x) !== undefined || t.structureKindAt(floor + 1, x) !== undefined);
}

/** What a quote of the tile at `at` lays besides that tile: `extra`, the price
 *  of its bridge, which lays the brush tiles strictly between `from` and `to`
 *  (`at` aside). A bridge scans each way to the nearest structure on the row
 *  and, when that is of its own kind, lays the held-up tiles in between
 *  (`bridge_fill_plan`), so the view's nearest structure says where each side
 *  of it ends. */
function quotedBridge(
  app: GameApp,
  catalog: Catalog,
  kind: FacilityKind,
  floor: number,
  at: number,
  quote: BuildQuote,
): { at: number; extra: number; from: number; to: number } {
  const own = catalogTileCost(catalog, kind, app.reader.tower.structureKindAt(floor, at) === undefined ? "no floor yet" : "a floor tile");
  // A refusal for money still carries the full price, bridge and all.
  const priced = quote.ok || quote.reason === NOT_ENOUGH_MONEY;
  const extra = priced ? quote.cost - own : 0;
  if (extra <= 0) return { at, extra: 0, from: at, to: at };
  const substrate = kind === "lobby" ? "lobby" : "floor";
  const left = app.reader.structureBeside(floor, at, -1);
  const right = app.reader.structureBeside(floor, at, 1);
  return { at, extra, from: left?.kind === substrate ? left.x : at, to: right?.kind === substrate ? right.x : at };
}

/** Whether `span`'s bridge lays the brush tile at `x`. */
const bridgeLays = (span: { at: number; from: number; to: number } | undefined, x: number) =>
  span !== undefined && x !== span.at && x > span.from && x < span.to;

export function updateBuildPreview(app: GameApp, tile: number, floor: number, showReasonCard = true): void {
  if (app.tool.type !== "build") {
    app.engine.preview = null;
    app.engine.transportPreview = null;
    clearBuildRefusal(app);
    return;
  }
  const kind = app.tool.kind;
  const catalog = catalogOf(app);
  if (isTransportTool(app)) {
    const x = snapX(catalog, kind, tile);
    if (catalogFacility(catalog, kind).fixedSpan) {
      // Stairs/escalators place as a fixed two-floor unit on tap, so the
      // ghost shows the real footprint and the real validity.
      const valid = isUnlocked(app, kind) && quoteShaft(app.enginePort, app.portCodes, kind, x, floor, floor + 1).ok;
      app.engine.transportPreview = { kind, x, bottom: floor, top: floor + 1, valid };
      app.engine.preview = null;
    } else {
      app.engine.transportPreview = null;
      app.engine.preview = { kind, floor, x, valid: isUnlocked(app, kind) };
    }
    clearBuildRefusal(app);
  } else if (kind === "floor" || kind === "lobby") {
    // These tools lay a centered brush strip, not a single tile, so the
    // shadow must span the same run a click will build.
    const tiles = brushTiles(tile);
    const left = tiles[0];
    const span = tiles[tiles.length - 1] - left + 1;
    // The ground floor is lobby-only: the Floor tool on floor 1 lays a lobby, so
    // the ghost previews a lobby, priced with the floor it lays.
    const ghostKind = catalogBuildKind(catalog, kind, floor);
    // Whole-brush affordability: the brush charges per tile, so the ghost goes
    // green only when the money covers every tile a click lays and the bridges
    // they bring. paintTiles builds the tiles in order, each with a bridge to
    // the nearest built tile on either side, laid when that tile is of its
    // kind. A bridge inside the brush lays tiles the brush lays anyway, at the
    // same price, so only the bridges past its ends add to the strip: one from
    // the run at each end. One tile is quoted for its refusal: the first the
    // brush lays that stands against built structure (it stands with bridging
    // off), or else the first it lays; when it lays nothing, the last it
    // tries, whose refusal a click reports (the anchor when it tries none).
    // Plain floor the Lobby brush lays over last can take its place (below).
    // Where a built tile stops that quote's scan before an end run, that run
    // is quoted too, from a tile whose scan back into the brush stops at a
    // built tile, so no two quotes scan the same side past the brush. Every
    // tile laid is priced from the catalog (catalogTileCost) unless a quoted
    // bridge lays it, and each quote adds its bridge. Dedupe first: brushTiles
    // clamps to the lot edge and can repeat a column.
    const brush = new Set(tiles);
    const groundFloor = catalog.world.groundFloor;
    const builtAt = (x: number) => app.reader.tower.structureKindAt(floor, x);
    let tried = snapX(catalog, kind, tile);
    let firstLaid: number | undefined;
    let touching: number | undefined;
    // A built tile left of the first tile laid, so no bridge from that run
    // reaches past the brush's left end.
    let builtBeforeFirst = false;
    // The first built tile past the first tile laid: where the first run ends.
    let firstRunEnd: number | undefined;
    // The last built tile, the one before it, and whether the brush lays over
    // it (plain floor under the Lobby brush).
    let lastBuilt: number | undefined;
    let builtBeforeLast: number | undefined;
    let lastBuiltLaid = false;
    // The first tile laid past the last built tile.
    let lastRunStart: number | undefined;
    for (const tx of brush) {
      const built = builtAt(tx);
      if (built !== undefined) {
        builtBeforeLast = lastBuilt;
        lastBuilt = tx;
        lastBuiltLaid = false;
        lastRunStart = undefined;
        if (firstLaid !== undefined) firstRunEnd ??= tx;
      }
      if (brushSkips(kind, built)) {
        if (firstLaid === undefined) builtBeforeFirst = true;
        continue;
      }
      tried = tx;
      const blocked = roomBlocks(app, kind, built, floor, tx);
      if (blocked && firstLaid === undefined) builtBeforeFirst = true;
      if (blocked || !heldUp(app, groundFloor, floor, tx)) continue;
      firstLaid ??= tx;
      if (built === undefined) lastRunStart ??= tx;
      else lastBuiltLaid = true;
      if (touching === undefined && touchesTower(app, groundFloor, floor, tx)) touching = tx;
    }
    let quoted = touching ?? firstLaid ?? tried;
    // Plain floor the Lobby brush lays over last, with no tile laid after it
    // and nothing built back to the quoted tile: its quote scans everything
    // the quoted tile's would and its own right side, so it is quoted alone.
    const nothingBuiltBackToQuoted = (builtBeforeLast ?? -Infinity) < quoted;
    if (lastBuilt !== undefined && lastBuiltLaid && lastRunStart === undefined && lastBuilt > quoted && nothingBuiltBackToQuoted) {
      quoted = lastBuilt;
    }
    const quote = (x: number) => quoteBuild(app.enginePort, app.portCodes, ghostKind, floor, x);
    const can = quote(quoted);
    const near = quotedBridge(app, catalog, ghostKind, floor, quoted, can);
    // The first run, when a built tile past its first tile stops the quoted
    // tile's scan left: its first tile scans right only to that built tile.
    const leftEnd = !builtBeforeFirst && firstRunEnd !== undefined && firstRunEnd < quoted ? firstLaid : undefined;
    // The last run, when a built tile stops the quoted tile's scan right: the
    // first tile laid past the last built tile, whose scan left stops at it,
    // or else that built tile when the brush lays over it. Here a built tile
    // stands between it and the quoted tile (else it is the quoted tile), and
    // its scan left stops there.
    let rightEnd: number | undefined;
    if (lastBuilt !== undefined && quoted < lastBuilt) rightEnd = lastRunStart ?? (lastBuiltLaid ? lastBuilt : undefined);
    const farLeft = leftEnd === undefined ? undefined : quotedBridge(app, catalog, ghostKind, floor, leftEnd, quote(leftEnd));
    const farRight = rightEnd === undefined ? undefined : quotedBridge(app, catalog, ghostKind, floor, rightEnd, quote(rightEnd));
    const overFloor = catalogTileCost(catalog, ghostKind, "a floor tile");
    const noFloorYet = catalogTileCost(catalog, ghostKind, "no floor yet");
    let laid = 0;
    let stripCost = near.extra + (farLeft?.extra ?? 0) + (farRight?.extra ?? 0);
    for (const tx of brush) {
      const built = builtAt(tx);
      if (brushSkips(kind, built) || roomBlocks(app, kind, built, floor, tx) || !heldUp(app, groundFloor, floor, tx)) continue;
      laid++;
      if (bridgeLays(near, tx) || bridgeLays(farLeft, tx) || bridgeLays(farRight, tx)) continue;
      stripCost += built === undefined ? noFloorYet : overFloor;
    }
    if (laid === 0) stripCost = 0;
    const affordsStrip = app.reader.header.money >= stripCost;
    // A brush that lays nothing is never green, even where the anchor alone
    // would take a lobby (plain floor on the ground floor, from an old save).
    const valid = laid > 0 && can.ok && affordsStrip;
    let reason: string | undefined;
    if (!valid && catalog.rules.previewNamesRefusal && (!can.ok || laid > 0)) reason = can.ok ? NOT_ENOUGH_MONEY : can.reason;
    app.engine.preview = { kind: ghostKind, floor, x: left, span, valid, reason };
    app.engine.transportPreview = null;
    if (showReasonCard) updateBuildRefusal(app, reason, floor, left + Math.floor(span / 2));
    else clearBuildRefusal(app);
  } else {
    const x = snapX(catalog, kind, tile);
    // Rooms auto-lay their own floor, so validity comes from the build quote
    // (which accounts for the floor tiles and their cost), not raw canPlace.
    const can = quoteBuild(app.enginePort, app.portCodes, kind, floor, x);
    // Modern surfaces the refusal reason on the preview so a hover teaches the
    // rule before the click; Classic keeps the '94 click-to-refuse pedagogy.
    // The catalog states which (`rules.previewNamesRefusal`).
    const reason = !can.ok && catalog.rules.previewNamesRefusal ? can.reason : undefined;
    app.engine.preview = { kind, floor, x, valid: can.ok, reason };
    app.engine.transportPreview = null;
    if (showReasonCard) updateBuildRefusal(app, reason, floor, x + Math.floor(catalogFacility(catalog, kind).width / 2));
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
    // A zero-width anchor at the strip's midpoint: the card prefers its right,
    // flipping to its left at the viewport edge like the facility cards do.
    app.inspectAnchor = { x: anchorX, left: anchorX, floor };
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
