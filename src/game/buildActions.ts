import type { Simulation } from "../engine/Simulation";
import { FACILITIES, facilityFloors } from "../engine/facilities";
import { resaleRefund } from "../engine/econConfig";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import type { UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import { brushTiles, dragRunTiles, isOffLot, snapX } from "../ui/placement";
import { gameplaySession } from "../analytics";

/**
 * The money boundary of the game shell: every gesture that buys, paints, or
 * sells (mouse, touch, keyboard cursor, editor buttons) funnels through this
 * controller, so the charge/refund rules live in exactly one place. Split out
 * of the GameApp class so those paths can be unit-tested against the real
 * Simulation without a DOM game shell or a running engine.
 *
 * The sim is a guest, not a resident: adoptSim() swaps the live Simulation at
 * runtime, so this module never stores one — every method asks `deps.getSim()`
 * fresh.
 */
export interface BuildActionsDeps {
  /** The live simulation (never cached — adoptSim swaps the instance). */
  getSim(): Simulation;
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

  tryBuild(kind: FacilityKind, floor: number, x: number, quiet = false): void {
    const res = this.deps.getSim().build(kind, floor, x);
    if (res.ok) {
      // Report the TOP occupied story for the session peak: a multi-story room
      // (cinema, party hall) reaches floor + its height - 1, not just its base.
      gameplaySession.noteBuild(kind, floor + facilityFloors(kind) - 1); // funnel + depth
      if (!quiet) this.deps.audio.sfx("build");
    } else if (!quiet && res.reason) {
      this.deps.audio.sfx("error");
      this.deps.ui.toast(res.reason, "bad");
    }
  }

  /** Place a transport span with the usual build/error feedback. Prefers the
   *  build's own failure reason (e.g. "Not enough money.") and falls back to
   *  the placement diagnosis when the build didn't say why. Returns the
   *  outcome (with the shown reason) for callers that also announce it. */
  tryBuildTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): { ok: boolean; reason: string } {
    const res = this.deps.getSim().buildTransport(kind, x, bottom, top);
    if (res.ok) gameplaySession.noteBuild(kind, top); // a shaft counts too; top is its reach
    this.deps.audio.sfx(res.ok ? "build" : "error");
    const reason = res.reason ?? this.transportReason(kind, x, bottom, top);
    if (!res.ok) this.deps.ui.toast(reason, "bad");
    return { ok: res.ok, reason };
  }

  /** Human-readable reason an elevator/stairs span can't be placed. */
  transportReason(kind: FacilityKind, x: number, bottom: number, top: number): string {
    const sim = this.deps.getSim();
    if (!sim.isUnlocked(kind)) {
      return `${FACILITIES[kind].name} unlocks at ${FACILITIES[kind].minStar}★.`;
    }
    const v = sim.tower.validateTransport(kind, x, bottom, top);
    return v.reason ?? "A shaft can't go here. Leave a clear column through built floors.";
  }

  /** Lay a brush strip; returns how many tiles were actually placed and, when
   *  zero, why. Zero is always the not-placed path for callers — the reason
   *  just distinguishes a harmless no-op (the strip already carries this
   *  kind: "already built here") from a real refusal (no support, no money),
   *  which carries the engine's reason. */
  paintBrush(kind: FacilityKind, tile: number, floor: number): { placed: number; reason?: string } {
    const sim = this.deps.getSim();
    const tiles = brushTiles(tile);
    let placed = 0;
    let reason: string | undefined;
    let progress = true;
    while (progress) {
      progress = false;
      for (const tx of tiles) {
        // Skip tiles already carrying this kind — but let the lobby brush
        // upgrade plain floor in place (the sky-lobby conversion).
        const existing = sim.tower.structureKindAt(floor, tx);
        if (existing === kind || (existing !== undefined && kind !== "lobby")) continue;
        const r = sim.build(kind, floor, tx);
        if (r.ok) {
          placed++;
          progress = true;
        } else {
          reason = r.reason;
        }
      }
    }
    if (placed > 0) gameplaySession.noteBuild(kind, floor, placed); // brush lays `placed` tiles
    this.paint = { tile, floor };
    if (placed === 0) {
      const alreadyAll = tiles.every((tx) => sim.tower.structureKindAt(floor, tx) === kind);
      // A press aimed past the lot line arrives clamped onto the edge column
      // (see isOffLot), so against a built-out edge it laid nothing and, before
      // this, said nothing: the canon 375-tile boundary read as a dead click.
      // The boundary is the story only when nothing else blocked the press: an
      // engine reason (say, "Not enough money.") on still-empty edge tiles
      // keeps precedence, and an on-lot press keeps today's quiet channels.
      if (isOffLot(tile) && (alreadyAll || reason === undefined)) {
        const edge = "That's the edge of the lot.";
        this.deps.audio.sfx("error"); // every refusal toast pairs with the sfx
        this.deps.ui.toast(edge, "bad");
        return { placed, reason: edge };
      }
      if (alreadyAll) return { placed, reason: `${FACILITIES[kind].name} already built here` };
    }
    return { placed, reason };
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
    const seedX = snapX(kind, tile);
    this.tryBuild(kind, floor, seedX);
    this.paint = { tile: seedX, floor };
  }

  /**
   * Paint a continuous floor/lobby run as the pointer drags, filling every cell
   * between the last painted tile and this one — so dragging lays one long floor
   * (as in the original) instead of scattered slabs when the drag moves fast.
   * Cells are built outward from the anchor so each is adjacent to existing
   * structure; midair cells simply fail to place, exactly as you'd expect.
   */
  paintFloorRun(kind: FacilityKind, tile: number, floor: number): void {
    if (!this.paint || this.paint.floor !== floor) {
      // snapX (not clampTile) so a wide unit's FOOTPRINT stays on-lot: a tap at
      // the right edge left-shifts to fit instead of silently failing off-lot.
      // For width-1 floor/lobby this is identical to clampTile.
      // Record the SNAPPED anchor (what was actually placed), so a later drag-run
      // extends from the placed unit, not an off-lot raw tile near the edge.
      const seedX = snapX(kind, tile);
      this.tryBuild(kind, floor, seedX, true);
      this.paint = { tile: seedX, floor };
      return;
    }
    for (const x of dragRunTiles(this.paint.tile, tile)) {
      // snapX each column so a WIDE unit near the right edge still lands on-lot
      // (its footprint would otherwise run off; width-1 floor/lobby is unchanged).
      this.tryBuild(kind, floor, snapX(kind, x), true);
    }
    // Record the SNAPPED anchor (what actually landed), not the raw pointer tile:
    // for a wide kind near the right edge snapX left-shifts the placement, so a
    // raw anchor would make the next drag step recompute from an off-lot column
    // and misfire. Identical to `tile` for width-1 floor/lobby.
    this.paint = { tile: snapX(kind, tile), floor };
  }

  /**
   * Shared player-removal gauntlet: burning and load-bearing units refuse —
   * with an error toast unless `quiet` (drag steps stay silent, like build
   * drags). Removes with the usual refund and returns true on success.
   */
  tryRemoveUnit(u: Unit, verb: "sell" | "bulldoze", quiet = false): boolean {
    const sim = this.deps.getSim();
    const blocked =
      u.state === "fire"
        ? `You can't ${verb} a burning unit. Call fire rescue or let it burn out.`
        : sim.tower.removalReason(u.id);
    if (blocked) {
      if (!quiet) {
        this.deps.audio.sfx("error");
        this.deps.ui.toast(blocked, "bad");
      }
      return false;
    }
    sim.tower.removeUnit(u.id);
    // A gutted shell has no salvage value; everything else refunds half.
    sim.money += u.state === "gutted" ? 0 : resaleRefund(u.kind);
    return true;
  }

  /** Tear out a shaft and pay its resale — the ONE refund path shared by the
   *  editor's Sell and the bulldozer, so the payout can't drift. */
  removeTransportWithRefund(t: Transport): void {
    const sim = this.deps.getSim();
    sim.tower.removeTransport(t.id);
    sim.money += resaleRefund(t.kind);
  }

  /** Charge guard for editor actions: false (with error sfx + toast) if the
   *  player can't pay. */
  canAfford(cost: number): boolean {
    if (this.deps.getSim().money >= cost) return true;
    this.deps.audio.sfx("error");
    this.deps.ui.toast("Not enough money.", "bad");
    return false;
  }

  /** Bulldoze whatever Excalibur reported under the pointer, with a refund.
   *  `quiet` suppresses blocked-removal feedback on the drag path, so sweeping
   *  across load-bearing floors doesn't machine-gun toasts and error sfx. */
  bulldozePicked(p: Picked | null, quiet = false): void {
    if (!p) return;
    const sim = this.deps.getSim();
    if (p.type === "unit") {
      const u = sim.tower.getUnit(p.id);
      if (!u) return;
      if (!this.tryRemoveUnit(u, "bulldoze", quiet)) return;
    } else {
      const t = sim.tower.getTransport(p.id);
      if (!t) return;
      this.removeTransportWithRefund(t);
    }
    this.deps.audio.sfx("sell");
    if (this.deps.selectedId() === p.id) this.deps.clearSelection();
  }
}
