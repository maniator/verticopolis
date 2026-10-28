import { catalogFacility, type Catalog } from "../engine/catalogTypes";
import type { FacilityKind } from "../engine/types";
import type { Picked, TowerEngine } from "../render/excalibur/TowerEngine";
import type { Tool, UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import { announceForPlacement, snapX, stepCursor, type PlaceOutcome } from "../ui/placement";
import type { BuildActions } from "./buildActions";
import type { EnginePort } from "../simport/enginePort";
import { outcome, type PortCodes } from "../simport/portCodes";
import type { ViewReader } from "../simport/viewReader";
import { quoteShaft } from "./portAccess";

/**
 * Keyboard play (F50–52): the virtual build cursor moved with arrows/WASD,
 * committed with Enter, bulldozed with Delete/X — full mouse-free play. Split
 * out of the GameApp class so the cursor's commit/announce behavior can be
 * unit-tested without a DOM game shell. The keydown switch itself stays in
 * GameApp (bindKeys) and delegates here; placements route through the same
 * {@link BuildActions} and placeSimpleBuild paths as mouse and touch, so all
 * three gestures stay pinned to one contract.
 *
 * Commands go through the engine port, which answers synchronously: a commit
 * or bulldoze has its answer and its undo step closed when it returns. Never
 * stores the engine or the reader: they are getters, read per call, since
 * adoptSim() swaps the tower.
 */
export interface KeyboardPlayDeps {
  /** The engine every command and quote goes through. */
  enginePort(): EnginePort;
  /** The code tables a kind passes through. */
  portCodes(): PortCodes;
  /** The shared reader (the tower reads). */
  reader(): ViewReader;
  /** The live tower's catalog for the reader's mode (`portAccess.catalogOf`). */
  catalog(): Catalog;
  /** The one read the port cannot answer (`portAccess.isUnlocked`). */
  isUnlocked(kind: FacilityKind): boolean;
  /** The live renderer (never cached: context-loss recovery swaps the
   *  instance, same contract as the getters above). */
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
  /** The gesture-independent placement shared with tap and click: null for
   *  a drag-sized shaft, otherwise the engine's outcome. */
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
      const kind = tool.kind;
      const bottom = Math.min(this.kbAnchor.floor, c.floor);
      const top = Math.max(this.kbAnchor.floor, c.floor);
      // Capture the live renderer once: the instance can swap under a
      // context-loss recovery, so both writes must target the SAME engine.
      const engine = this.deps.engine();
      engine.transportPreview = {
        kind,
        x: this.kbAnchor.tile,
        bottom,
        top,
        valid:
          quoteShaft(this.deps.enginePort(), this.deps.portCodes(), kind, this.kbAnchor.tile, bottom, top).ok &&
          this.deps.isUnlocked(kind),
      };
      engine.preview = null;
    } else {
      this.deps.updateBuildPreview(c.tile, c.floor);
    }
  }

  private announceCursor(): void {
    const c = this.kbCursor;
    if (!c) return;
    const loc = c.floor >= 1 ? `floor ${c.floor}` : `basement ${1 - c.floor}`;
    const here = this.deps.pickedAt(c.floor, c.tile);
    this.deps.announce(`Cursor: ${loc}, column ${c.tile}. ${here ? catalogFacility(this.deps.catalog(), here.kind).name : "Empty"}.`);
  }

  commitCursor(): void {
    if (!this.kbCursor) {
      this.moveCursor(0, 0); // first press: just reveal the cursor
      return;
    }
    const catalog = this.deps.catalog();
    const c = this.kbCursor;
    const tool = this.deps.tool();
    if (tool.type === "inspect") {
      const p = this.deps.pickedAt(c.floor, c.tile);
      this.deps.selectPicked(p);
      this.deps.announce(p ? `Selected ${catalogFacility(catalog, p.kind).name}` : "Nothing to inspect here");
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
    this.deps.captureUndo(`Build ${catalogFacility(catalog, kind).name}`);
    const placing = this.deps.placeSimpleBuild(kind, c.tile, c.floor);
    if (placing) {
      this.deps.announce(announceForPlacement(placing, catalog, kind, c.floor));
      this.refreshCursorPreview();
    } else if (this.deps.isTransportTool()) {
      if (!this.kbAnchor) {
        // Snap the anchor column like the mouse path, so a wide shaft near the
        // right edge places instead of failing.
        this.kbAnchor = { tile: snapX(catalog, kind, c.tile), floor: c.floor };
        this.refreshCursorPreview();
        this.deps.announce(`${catalogFacility(catalog, kind).name} anchored at floor ${c.floor}. Move to the other end and press Enter.`);
      } else {
        const bottom = Math.min(this.kbAnchor.floor, c.floor);
        const top = Math.max(this.kbAnchor.floor, c.floor);
        const x = this.kbAnchor.tile;
        this.kbAnchor = null;
        this.deps.engine().transportPreview = null;
        const port = this.deps.enginePort();
        const res = outcome(port, port.buildShaft(this.deps.portCodes().kind(kind), x, bottom, top));
        if (res.ok) {
          this.deps.audio.sfx("build");
          this.deps.announce(`${catalogFacility(catalog, kind).name} built, floors ${bottom} to ${top}`);
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
    const name = catalogFacility(this.deps.catalog(), p.kind).name;
    this.deps.captureUndo("Bulldoze");
    const removed = this.deps.build.bulldozePicked(p);
    this.deps.commitUndo();
    this.deps.announce(removed ? `Bulldozed ${name}` : `Could not bulldoze ${name}`);
    this.refreshCursorPreview();
  }
}
