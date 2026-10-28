import { catalogBuildKind, catalogFacility, type Catalog } from "../engine/catalogTypes";
import type { FacilityKind } from "../engine/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import type { UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import type { EnginePort } from "../simport/enginePort";
import { outcome, type PortCodes } from "../simport/portCodes";
import type { BrushKind } from "../simport/commands";
import type { ViewReader } from "../simport/viewReader";
import { brushTiles, dragRunTiles, isOffLot, snapX } from "../ui/placement";
import { quoteShaft } from "./portAccess";

/**
 * The money boundary of the game shell: every gesture that buys, paints, or
 * sells (mouse, touch, keyboard cursor, editor buttons) funnels through this
 * controller, so the charge/refund rules live in exactly one place. Split out
 * of the GameApp class so those paths can be unit-tested against the real
 * Simulation without a DOM game shell or a running engine.
 *
 * Every command goes through the engine port and the caller reads only its
 * record, so the engine behind the port accepts or refuses it. The port is
 * synchronous: a method that issues a command returns its outcome once the
 * feedback (sound, toast) has played. The engine, its codes and the reader
 * are getters, read per call and never captured, since adoptSim() swaps the
 * tower and a later PR swaps the engine.
 */
export interface BuildActionsDeps {
  /** The engine every command goes through. */
  enginePort(): EnginePort;
  /** The code tables a kind passes through (`portCodes.kind`). */
  portCodes(): PortCodes;
  /** The shared reader: the tower reads, current as of its last `update()`. */
  reader(): ViewReader;
  /** The live tower's catalog for the reader's mode (`portAccess.catalogOf`). */
  catalog(): Catalog;
  /** The one read the port cannot answer (`portAccess.isUnlocked`). */
  isUnlocked(kind: FacilityKind): boolean;
  ui: Pick<UI, "toast">;
  audio: Pick<AudioEngine, "sfx">;
  /** Id of the facility selected in the editor card, if any. Compared without
   *  a unit/transport type — sound only because the tower issues both from ONE
   *  shared id counter (Tower.nextId), so ids never collide across types. If
   *  allocation ever splits per type, this dep must carry the type too. */
  selectedId(): number | null;
  clearSelection(): void;
}

export class BuildActions {
  /** Last cell painted while dragging a floor/lobby, so a fast drag lays one
   *  continuous run instead of scattered slabs. */
  private paint: { tile: number; floor: number } | null = null;

  constructor(private readonly deps: BuildActionsDeps) {}

  /** Drop the paint-run anchor (the pointer was released). */
  clearPaint(): void {
    this.paint = null;
  }

  /** Build one facility; true when the engine placed it. */
  tryBuild(kind: FacilityKind, floor: number, x: number, quiet = false): boolean {
    const port = this.deps.enginePort();
    const res = outcome(port, port.buildAt(this.deps.portCodes().kind(kind), floor, x));
    if (res.ok) {
      if (!quiet) this.deps.audio.sfx("build");
    } else if (!quiet && res.reason) {
      this.deps.audio.sfx("error");
      this.deps.ui.toast(res.reason, "bad");
    }
    return res.ok;
  }

  /** Place a transport span with the usual build/error feedback. On a refusal
   *  it prefers the build's own reason (e.g. "Not enough money.") and falls
   *  back to the placement diagnosis when the build didn't say why; a placed
   *  span is not diagnosed. Returns the outcome (with the shown reason) for
   *  callers that also announce it. */
  tryBuildTransport(kind: FacilityKind, x: number, bottom: number, top: number): { ok: boolean; reason: string } {
    const port = this.deps.enginePort();
    const res = outcome(port, port.buildShaft(this.deps.portCodes().kind(kind), x, bottom, top));
    this.deps.audio.sfx(res.ok ? "build" : "error");
    const reason = res.reason ?? (res.ok ? "" : this.transportReason(kind, x, bottom, top));
    if (!res.ok) this.deps.ui.toast(reason, "bad");
    return { ok: res.ok, reason };
  }

  /** Human-readable reason an elevator/stairs span can't be placed. */
  transportReason(kind: FacilityKind, x: number, bottom: number, top: number): string {
    if (!this.deps.isUnlocked(kind)) {
      const f = catalogFacility(this.deps.catalog(), kind);
      return `${f.name} unlocks at ${f.minStar}★.`;
    }
    const v = quoteShaft(this.deps.enginePort(), this.deps.portCodes(), kind, x, bottom, top);
    return v.reason ?? "A shaft can't go here. Leave a clear column through built floors.";
  }

  /** Lay a brush strip; answers how many tiles were actually placed and,
   *  when zero, why. Zero is always the not-placed path for callers; the
   *  reason just distinguishes a harmless no-op (the strip already carries
   *  this kind: "already built here") from a real refusal (no support, no
   *  money), which carries the engine's reason. The strip is one port command
   *  (`paintTiles`), so no step falls between its tiles. */
  paintBrush(kind: BrushKind, tile: number, floor: number): { placed: number; reason?: string } {
    const tiles = brushTiles(tile);
    this.paint = { tile, floor };
    const port = this.deps.enginePort();
    const codes = this.deps.portCodes();
    const rec = port.paintTiles(codes.kind(kind), floor, Float64Array.from(tiles));
    const placed = codes.slot(rec, "paintTiles", "placed");
    const res = outcome(port, rec);
    // Ground floor is lobby-only: the Floor tool on floor 1 auto-converts to a
    // lobby (permanent, and pricier than a floor tile), so confirm what happened
    // once per gesture. The preview already showed a lobby ghost and the lobby
    // price; this is the belt-and-braces spoken confirmation. Keyed off the
    // catalog's ground-floor rule (catalogBuildKind), the same rule the preview
    // and the tool card use.
    const catalog = this.deps.catalog();
    const laid = catalogBuildKind(catalog, kind, floor);
    if (placed > 0 && laid !== kind) {
      const f = catalogFacility(catalog, laid);
      this.deps.ui.toast(
        `The ground floor is a ${f.name.toLowerCase()}, so a ${f.name.toLowerCase()} ($${f.cost.toLocaleString()}/tile) went here.`,
        "info",
      );
    }
    if (placed === 0) {
      // Nothing was laid, so the structure stands as the last pass read it,
      // unless a press moments ago changed it: read again once, on this path.
      const reader = this.deps.reader();
      reader.update();
      const tower = reader.tower;
      const alreadyAll = tiles.every((tx) => tower.structureKindAt(floor, tx) === kind);
      // A press aimed past the lot line arrives clamped onto the edge column
      // (see isOffLot), so against a built-out edge it laid nothing and, before
      // this, said nothing: the canon 375-tile boundary read as a dead click.
      // The boundary is the story only when nothing else blocked the press: an
      // engine reason (say, "Not enough money.") on still-empty edge tiles
      // keeps precedence, and an on-lot press keeps today's quiet channels.
      if (isOffLot(tile) && (alreadyAll || res.reason === undefined)) {
        const edge = "That's the edge of the lot.";
        this.deps.audio.sfx("error"); // every refusal toast pairs with the sfx
        this.deps.ui.toast(edge, "bad");
        return { placed, reason: edge };
      }
      if (alreadyAll) return { placed, reason: `${catalogFacility(catalog, kind).name} already built here` };
    }
    return { placed, reason: res.reason };
  }

  /**
   * Open a paint gesture at the press point, matching what a desktop click
   * lays: floor/lobby stamp the full {@link brushTiles} strip (the touch paths
   * used to seed a single 1-wide tile here, so phones built one brick at a
   * time), while parking keeps its single-module seed. Either way the run
   * anchors at the stamp, so a following drag extends from it with no gap.
   */
  seedPaint(kind: FacilityKind, tile: number, floor: number): void {
    if (kind === "floor" || kind === "lobby") {
      this.paintBrush(kind, tile, floor); // records the run anchor itself
      return;
    }
    // snapX (not clampTile) so a wide unit's footprint stays on-lot: a tap at
    // the right edge left-shifts to fit instead of silently failing off-lot.
    // Loud, like the desktop press it mirrors: a tap deserves the build sfx
    // and the refusal toast. Drag steps stay quiet in paintFloorRun.
    const seedX = snapX(this.deps.catalog(), kind, tile);
    this.paint = { tile: seedX, floor };
    this.tryBuild(kind, floor, seedX);
  }

  /**
   * Paint a continuous floor/lobby run as the pointer drags, filling every cell
   * between the last painted tile and this one — so dragging lays one long floor
   * (as in the original) instead of scattered slabs when the drag moves fast.
   * Cells are built outward from the anchor so each is adjacent to existing
   * structure; midair cells simply fail to place, exactly as you'd expect.
   * Every step is answered before this returns; the anchor moves with it.
   */
  paintFloorRun(kind: FacilityKind, tile: number, floor: number): void {
    if (!this.paint || this.paint.floor !== floor) {
      // snapX (not clampTile) so a wide unit's FOOTPRINT stays on-lot: a tap at
      // the right edge left-shifts to fit instead of silently failing off-lot.
      // For width-1 floor/lobby this is identical to clampTile.
      // Record the SNAPPED anchor (what was actually placed), so a later drag-run
      // extends from the placed unit, not an off-lot raw tile near the edge.
      const seedX = snapX(this.deps.catalog(), kind, tile);
      this.tryBuild(kind, floor, seedX, true);
      this.paint = { tile: seedX, floor };
      return;
    }
    // Quiet drag steps, run in order.
    const catalog = this.deps.catalog();
    for (const x of dragRunTiles(this.paint.tile, tile)) {
      // snapX each column so a WIDE unit near the right edge still lands on-lot
      // (its footprint would otherwise run off; width-1 floor/lobby is unchanged).
      this.tryBuild(kind, floor, snapX(catalog, kind, x), true);
    }
    // Record the SNAPPED anchor (what actually landed), not the raw pointer tile:
    // for a wide kind near the right edge snapX left-shifts the placement, so a
    // raw anchor would make the next drag step recompute from an off-lot column
    // and misfire. Identical to `tile` for width-1 floor/lobby.
    this.paint = { tile: snapX(catalog, kind, tile), floor };
  }

  /**
   * Shared player-removal path: the engine's `demolish` refuses a
   * burning unit or load-bearing structure (with an error toast unless
   * `quiet`; drag steps stay silent, like build drags) and pays the refund.
   * Returns true on success.
   */
  tryRemoveUnit(u: { readonly id: number }, verb: "sell" | "bulldoze", quiet = false): boolean {
    const port = this.deps.enginePort();
    const res = outcome(port, port.demolish(u.id, verb === "bulldoze"));
    if (!res.ok) {
      if (!quiet && res.reason) {
        this.deps.audio.sfx("error");
        this.deps.ui.toast(res.reason, "bad");
      }
      return false;
    }
    // The engine reports the removal (`facility_removed`, with `verb` as its
    // method), and the analytics bridge sends it as `demolish`.
    return true;
  }

  /** Tear out a shaft through the engine's `demolish`, which pays its
   *  resale: the ONE refund path shared by the editor's Sell and the
   *  bulldozer. `verb` is the sell-vs-bulldoze telemetry detail (the
   *  caller's gesture), which the engine reports as the removal's method.
   *  False when the engine refused (the shaft is already gone), so the caller
   *  plays no sale. */
  removeTransportWithRefund(t: { readonly id: number }, verb: "sell" | "bulldoze"): boolean {
    const port = this.deps.enginePort();
    return outcome(port, port.demolish(t.id, verb === "bulldoze")).ok;
  }

  /** Bulldoze whatever Excalibur reported under the pointer, with a refund.
   *  `quiet` suppresses blocked-removal feedback on the drag path, so sweeping
   *  across load-bearing floors doesn't machine-gun toasts and error sfx.
   *  Returns true only when the engine removed the picked facility. */
  bulldozePicked(p: Picked | null, quiet = false): boolean {
    if (!p) return false;
    // The reader lags the tower by up to one UI pass, so a miss reads again
    // once before it calls the pick stale.
    const reader = this.deps.reader();
    const find = () => (p.type === "unit" ? reader.tower.getUnit(p.id) : reader.tower.getTransport(p.id));
    let found = find();
    if (!found) {
      reader.update();
      found = find();
    }
    if (!found) return false;
    if (p.type === "unit") {
      if (!this.tryRemoveUnit(found, "bulldoze", quiet)) return false;
    } else if (!this.removeTransportWithRefund(found, "bulldoze")) return false;
    this.deps.audio.sfx("sell");
    if (this.deps.selectedId() === p.id) this.deps.clearSelection();
    return true;
  }
}
