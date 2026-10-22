import type { Simulation } from "../engine/Simulation";
import { catalogBuildKind, catalogFacility } from "../engine/catalogTypes";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import type { UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import type { SimPort } from "../simport/port";
import type { BrushKind } from "../simport/commands";
import { brushTiles, dragRunTiles, isOffLot, snapX } from "../ui/placement";
import { towerCatalog } from "../engine/towerCatalog";

/**
 * The money boundary of the game shell: every gesture that buys, paints, or
 * sells (mouse, touch, keyboard cursor, editor buttons) funnels through this
 * controller, so the charge/refund rules live in exactly one place. Split out
 * of the GameApp class so those paths can be unit-tested against the real
 * Simulation without a DOM game shell or a running engine.
 *
 * Every command goes through the port (AD-9) and the caller reads only its
 * answer, so the engine behind the port accepts or refuses it. A method that
 * issues a command returns a promise that settles once the answer is in and
 * its feedback (sound, toast) has played; drag steps fire and forget, and the
 * port runs them in issue order. `getSim()` remains for the catalog and the
 * queries slice 4 moves onto the port; it is re-read per call, since
 * adoptSim() swaps the live Simulation.
 */
export interface BuildActionsDeps {
  /** The live simulation (never cached — adoptSim swaps the instance). */
  getSim(): Simulation;
  /** The port every command goes through; it follows adoptSim itself. */
  port: SimPort;
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

  /** Build one facility; resolves to whether the engine placed it. */
  async tryBuild(kind: FacilityKind, floor: number, x: number, quiet = false): Promise<boolean> {
    const res = await this.deps.port.command({ op: "build", kind, floor, x });
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
  async tryBuildTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): Promise<{ ok: boolean; reason: string }> {
    const res = await this.deps.port.command({ op: "buildTransport", kind, x, bottom, top });
    this.deps.audio.sfx(res.ok ? "build" : "error");
    const reason = res.reason ?? (res.ok ? "" : await this.transportReason(kind, x, bottom, top));
    if (!res.ok) this.deps.ui.toast(reason, "bad");
    return { ok: res.ok, reason };
  }

  /** Human-readable reason an elevator/stairs span can't be placed. */
  async transportReason(kind: FacilityKind, x: number, bottom: number, top: number): Promise<string> {
    if (!(await this.deps.port.query({ op: "isUnlocked", kind }))) {
      const f = catalogFacility(towerCatalog(this.deps.getSim()), kind);
      return `${f.name} unlocks at ${f.minStar}★.`;
    }
    const v = this.deps.getSim().tower.validateTransport(kind, x, bottom, top);
    return v.reason ?? "A shaft can't go here. Leave a clear column through built floors.";
  }

  /** Lay a brush strip; resolves to how many tiles were actually placed and,
   *  when zero, why. Zero is always the not-placed path for callers; the
   *  reason just distinguishes a harmless no-op (the strip already carries
   *  this kind: "already built here") from a real refusal (no support, no
   *  money), which carries the engine's reason. The strip is one port command
   *  (`paintBrush`), so no step falls between its tiles. */
  async paintBrush(kind: BrushKind, tile: number, floor: number): Promise<{ placed: number; reason?: string }> {
    const tiles = brushTiles(tile);
    // The run anchor is gesture state, set as the press lands so a drag step
    // that arrives before the answer extends from it.
    this.paint = { tile, floor };
    const res = await this.deps.port.command({ op: "paintBrush", kind, floor, tiles });
    const { placed } = res;
    // Ground floor is lobby-only: the Floor tool on floor 1 auto-converts to a
    // lobby (permanent, and pricier than a floor tile), so confirm what happened
    // once per gesture. The preview already showed a lobby ghost and the lobby
    // price; this is the belt-and-braces spoken confirmation. Keyed off the
    // catalog's ground-floor rule (catalogBuildKind), the same rule the preview
    // and the tool card use.
    const catalog = towerCatalog(this.deps.getSim());
    const laid = catalogBuildKind(catalog, kind, floor);
    if (placed > 0 && laid !== kind) {
      const f = catalogFacility(catalog, laid);
      this.deps.ui.toast(
        `The ground floor is a ${f.name.toLowerCase()}, so a ${f.name.toLowerCase()} ($${f.cost.toLocaleString()}/tile) went here.`,
        "info",
      );
    }
    if (placed === 0) {
      const tower = this.deps.port.view.tower;
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
  async seedPaint(kind: FacilityKind, tile: number, floor: number): Promise<void> {
    if (kind === "floor" || kind === "lobby") {
      await this.paintBrush(kind, tile, floor); // records the run anchor itself
      return;
    }
    // snapX (not clampTile) so a wide unit's footprint stays on-lot: a tap at
    // the right edge left-shifts to fit instead of silently failing off-lot.
    // Loud, like the desktop press it mirrors: a tap deserves the build sfx
    // and the refusal toast. Drag steps stay quiet in paintFloorRun.
    const seedX = snapX(towerCatalog(this.deps.getSim()), kind, tile);
    this.paint = { tile: seedX, floor };
    await this.tryBuild(kind, floor, seedX);
  }

  /**
   * Paint a continuous floor/lobby run as the pointer drags, filling every cell
   * between the last painted tile and this one — so dragging lays one long floor
   * (as in the original) instead of scattered slabs when the drag moves fast.
   * Cells are built outward from the anchor so each is adjacent to existing
   * structure; midair cells simply fail to place, exactly as you'd expect.
   * Settles once the engine has answered every step; the anchor moves at once.
   */
  paintFloorRun(kind: FacilityKind, tile: number, floor: number): Promise<void> {
    if (!this.paint || this.paint.floor !== floor) {
      // snapX (not clampTile) so a wide unit's FOOTPRINT stays on-lot: a tap at
      // the right edge left-shifts to fit instead of silently failing off-lot.
      // For width-1 floor/lobby this is identical to clampTile.
      // Record the SNAPPED anchor (what was actually placed), so a later drag-run
      // extends from the placed unit, not an off-lot raw tile near the edge.
      const seedX = snapX(towerCatalog(this.deps.getSim()), kind, tile);
      const seeded = this.tryBuild(kind, floor, seedX, true);
      this.paint = { tile: seedX, floor };
      return seeded.then(() => undefined);
    }
    // Quiet drag steps: issued in order before any answer, so the port runs
    // them back to back and the anchor below moves at once.
    const steps: Promise<boolean>[] = [];
    for (const x of dragRunTiles(this.paint.tile, tile)) {
      // snapX each column so a WIDE unit near the right edge still lands on-lot
      // (its footprint would otherwise run off; width-1 floor/lobby is unchanged).
      steps.push(this.tryBuild(kind, floor, snapX(towerCatalog(this.deps.getSim()), kind, x), true));
    }
    // Record the SNAPPED anchor (what actually landed), not the raw pointer tile:
    // for a wide kind near the right edge snapX left-shifts the placement, so a
    // raw anchor would make the next drag step recompute from an off-lot column
    // and misfire. Identical to `tile` for width-1 floor/lobby.
    this.paint = { tile: snapX(towerCatalog(this.deps.getSim()), kind, tile), floor };
    return Promise.all(steps).then(() => undefined);
  }

  /**
   * Shared player-removal path: the engine's `removeFacility` refuses a
   * burning unit or load-bearing structure (with an error toast unless
   * `quiet`; drag steps stay silent, like build drags) and pays the refund.
   * Returns true on success.
   */
  async tryRemoveUnit(u: Unit, verb: "sell" | "bulldoze", quiet = false): Promise<boolean> {
    const res = await this.deps.port.command({ op: "removeFacility", id: u.id, method: verb });
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

  /** Tear out a shaft through the engine's `removeFacility`, which pays its
   *  resale: the ONE refund path shared by the editor's Sell and the
   *  bulldozer. `verb` is the sell-vs-bulldoze telemetry detail (the
   *  caller's gesture), which the engine reports as the removal's method.
   *  False when the engine refused (the shaft is already gone), so the caller
   *  plays no sale. */
  async removeTransportWithRefund(t: Transport, verb: "sell" | "bulldoze"): Promise<boolean> {
    return (await this.deps.port.command({ op: "removeFacility", id: t.id, method: verb })).ok;
  }

  /** Bulldoze whatever Excalibur reported under the pointer, with a refund.
   *  `quiet` suppresses blocked-removal feedback on the drag path, so sweeping
   *  across load-bearing floors doesn't machine-gun toasts and error sfx.
   *  Returns true only when the engine removed the picked facility. */
  async bulldozePicked(p: Picked | null, quiet = false): Promise<boolean> {
    if (!p) return false;
    const sim = this.deps.getSim();
    if (p.type === "unit") {
      const u = sim.tower.getUnit(p.id);
      if (!u) return false;
      if (!(await this.tryRemoveUnit(u, "bulldoze", quiet))) return false;
    } else {
      const t = sim.tower.getTransport(p.id);
      if (!t) return false;
      if (!(await this.removeTransportWithRefund(t, "bulldoze"))) return false;
    }
    this.deps.audio.sfx("sell");
    if (this.deps.selectedId() === p.id) this.deps.clearSelection();
    return true;
  }
}
