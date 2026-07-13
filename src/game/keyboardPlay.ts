import type { Simulation } from "../engine/Simulation";
import { FACILITIES } from "../engine/facilities";
import type { FacilityKind } from "../engine/types";
import type { Picked, TowerEngine } from "../render/excalibur/TowerEngine";
import type { Tool, UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import { announceForPlacement, snapX, stepCursor, type PlaceOutcome } from "../ui/placement";
import type { BuildActions } from "./buildActions";

/**
 * Keyboard play (F50–52): the virtual build cursor moved with arrows/WASD,
 * committed with Enter, bulldozed with Delete/X — full mouse-free play. Split
 * out of the GameApp class so the cursor's commit/announce behavior can be
 * unit-tested without a DOM game shell. The keydown switch itself stays in
 * GameApp (bindKeys) and delegates here; placements route through the same
 * {@link BuildActions} and placeSimpleBuild paths as mouse and touch, so all
 * three gestures stay pinned to one contract.
 *
 * Never stores a Simulation — adoptSim() swaps the live instance, so every
 * method asks `deps.getSim()` fresh.
 */
export interface KeyboardPlayDeps {
  /** The live simulation (never cached — adoptSim swaps the instance). */
  getSim(): Simulation;
  /** The live renderer (never cached: context-loss recovery swaps the
   *  instance, same contract as getSim). */
  engine(): Pick<TowerEngine, "ensureVisible" | "preview" | "transportPreview">;
  audio: Pick<AudioEngine, "sfx">;
  ui: Pick<UI, "toast">;
  /** Bulldoze shares the pointer path's refund/feedback rules. */
  build: Pick<BuildActions, "bulldozePicked">;
  /** The active tool (lives in GameApp — the palette writes it). */
  tool(): Tool;
  isTransportTool(): boolean;
  /** Screen-reader live-region announcer (GameApp owns the one throat). */
  announce(msg: string): void;
  /** Undo bracketing — the same contract the mouse gestures get: capture at
   *  the press, commit after. A capture whose commit changes nothing self-heals
   *  into a no-op entry, so anchoring a shaft (first Enter) is safe to bracket.
   *  Known interleave: Enter mid-mouse-drag overwrites the drag's pending
   *  capture (UndoHistory.capture replaces `pending` by design), fusing the
   *  pre-Enter drag below the new boundary — accepted, same family as the
   *  Ctrl+Z-mid-gesture semantics. */
  captureUndo(label: string): void;
  commitUndo(): void;
  /** The inspectable/bulldozable entity at a cell (room or transport), if any. */
  pickedAt(floor: number, tile: number): Picked | null;
  selectPicked(p: Picked | null): void;
  /** The gesture-independent placement shared with tap and click. */
  placeSimpleBuild(kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null;
  updateBuildPreview(tile: number, floor: number): void;
}

export class KeyboardPlay {
  /** Keyboard build cursor + a pending transport anchor (mouse-free play). */
  private kbCursor: { tile: number; floor: number } | null = null;
  private kbAnchor: { tile: number; floor: number } | null = null;

  constructor(private readonly deps: KeyboardPlayDeps) {}

  /** The cursor cell, if the cursor has been revealed (for camera recentering). */
  cursor(): { tile: number; floor: number } | null {
    return this.kbCursor;
  }

  /** Drop a pending transport anchor (tool switch / Escape) so it isn't
   *  carried into the next gesture. */
  resetAnchor(): void {
    this.kbAnchor = null;
  }

  moveCursor(dTile: number, dFloor: number): void {
    this.kbCursor = stepCursor(this.kbCursor, dTile, dFloor);
    this.deps.engine().ensureVisible(this.kbCursor.tile, this.kbCursor.floor);
    this.refreshCursorPreview();
    this.announceCursor();
  }

  refreshCursorPreview(): void {
    const c = this.kbCursor;
    if (!c) return;
    const tool = this.deps.tool();
    if (this.kbAnchor && tool.type === "build" && this.deps.isTransportTool()) {
      const sim = this.deps.getSim();
      const kind = tool.kind;
      const bottom = Math.min(this.kbAnchor.floor, c.floor);
      const top = Math.max(this.kbAnchor.floor, c.floor);
      this.deps.engine().transportPreview = {
        kind,
        x: this.kbAnchor.tile,
        bottom,
        top,
        valid: sim.tower.placeTransportDryRun(kind, this.kbAnchor.tile, bottom, top) && sim.isUnlocked(kind),
      };
      this.deps.engine().preview = null;
    } else {
      this.deps.updateBuildPreview(c.tile, c.floor);
    }
  }

  private announceCursor(): void {
    const c = this.kbCursor;
    if (!c) return;
    const loc = c.floor >= 1 ? `floor ${c.floor}` : `basement ${1 - c.floor}`;
    const here = this.deps.pickedAt(c.floor, c.tile);
    this.deps.announce(`Cursor: ${loc}, column ${c.tile}. ${here ? FACILITIES[here.kind].name : "Empty"}.`);
  }

  commitCursor(): void {
    if (!this.kbCursor) {
      this.moveCursor(0, 0); // first press: just reveal the cursor
      return;
    }
    const c = this.kbCursor;
    const tool = this.deps.tool();
    if (tool.type === "inspect") {
      const p = this.deps.pickedAt(c.floor, c.tile);
      this.deps.selectPicked(p);
      this.deps.announce(p ? `Selected ${FACILITIES[p.kind].name}` : "Nothing to inspect here");
      return;
    }
    if (tool.type === "bulldoze") {
      this.bulldozeCursor();
      return;
    }
    if (tool.type !== "build") return;
    const kind = tool.kind;
    // Undo parity with the mouse path (onActionDown captures, onActionUp
    // commits): without this, Ctrl+Z fused a keyboard build into the previous
    // mouse gesture and keyboard builds were never individually undoable.
    this.deps.captureUndo(`Build ${FACILITIES[kind].name}`);
    const placed = this.deps.placeSimpleBuild(kind, c.tile, c.floor);
    if (placed) {
      this.deps.announce(announceForPlacement(placed, kind, c.floor));
      this.refreshCursorPreview();
    } else if (this.deps.isTransportTool()) {
      if (!this.kbAnchor) {
        // Snap the anchor column like the mouse path, so a wide shaft near the
        // right edge places instead of failing.
        this.kbAnchor = { tile: snapX(kind, c.tile), floor: c.floor };
        this.refreshCursorPreview();
        this.deps.announce(`${FACILITIES[kind].name} anchored at floor ${c.floor}. Move to the other end and press Enter.`);
      } else {
        const bottom = Math.min(this.kbAnchor.floor, c.floor);
        const top = Math.max(this.kbAnchor.floor, c.floor);
        const res = this.deps.getSim().buildTransport(kind, this.kbAnchor.tile, bottom, top);
        this.kbAnchor = null;
        this.deps.engine().transportPreview = null;
        if (res.ok) {
          this.deps.audio.sfx("build");
          this.deps.announce(`${FACILITIES[kind].name} built, floors ${bottom} to ${top}`);
        } else {
          this.deps.audio.sfx("error");
          if (res.reason) this.deps.ui.toast(res.reason, "bad");
          this.deps.announce(res.reason ?? "Can't build there");
        }
        this.refreshCursorPreview();
      }
    }
    this.deps.commitUndo();
  }

  bulldozeCursor(): void {
    const c = this.kbCursor;
    if (!c) return;
    const p = this.deps.pickedAt(c.floor, c.tile);
    if (!p) {
      this.deps.announce("Nothing to bulldoze here");
      return;
    }
    const name = FACILITIES[p.kind].name;
    this.deps.captureUndo("Bulldoze");
    this.deps.build.bulldozePicked(p);
    this.deps.commitUndo();
    this.deps.announce(`Bulldozed ${name}`);
    this.refreshCursorPreview();
  }
}
