import { Simulation } from "./engine/Simulation";
import { UndoHistory, towerStateSig } from "./engine/UndoHistory";
import { FACILITIES, GRID, facilityFloors, isElevatorKind, isHotelKind, maxCarsFor } from "./engine/facilities";
import { ECON, rentConfig, rentOf, resaleRefund, carResaleRefund, extendBill } from "./engine/econConfig";
import type { FacilityKind, Unit } from "./engine/types";
import { isOperational } from "./engine/types";
import { TowerEngine, type Picked } from "./render/excalibur/TowerEngine";
import { AudioEngine } from "./audio/Audio";
import { SaveGame } from "./storage/SaveGame";
import { loadPrefs, savePrefs, reducedMotionActive, type Prefs } from "./storage/Prefs";
import { trafficTier, TRAFFIC_LABELS, trafficGlyph, type TrafficTier } from "./engine/traffic";
import { parseTWR } from "./storage/twrImport";
import { UI, type Tool } from "./ui/UI";
import { escapeHtml } from "./ui/escape";
import { OnboardingController, shouldArm } from "./ui/Onboarding";
import { registerPWA } from "./pwa";

/** Game speeds → in-game minutes advanced per real second. */
const SPEEDS = [0, 10, 30, 120];

/** Tiles laid by a single tap/click of the Floor/Lobby tool (a drag extends). */
const STRUCTURE_BRUSH = 8;

/**
 * The game controller. Excalibur (via {@link TowerEngine}) owns the render
 * loop, scene, camera, panning, zooming and pointer input; this class supplies
 * the tool semantics through the engine's controller hooks, ticks the
 * simulation from the engine's per-frame `onUpdate`, and drives the DOM UI.
 */
class GameApp {
  sim: Simulation;
  engine: TowerEngine;
  audio = new AudioEngine();
  ui: UI;
  /** Lot geometry, exposed for tooling (e.g. the screenshot harness). */
  readonly grid = GRID;
  speed = 1;
  tool: Tool = { type: "inspect" };

  private canvas: HTMLCanvasElement;
  private accMinutes = 0;
  private lastUiUpdate = 0;
  /** Throttle for the per-frame error log, so a repeating throw can't spam. */
  private lastTickErrorLog = 0;
  private shownWin = false;
  /** Whether the emergency-choice modal is currently open. */
  private shownChoice = false;
  /** Last star rating we played a promotion jingle for (so 2★–5★ promotions
   * each get the jingle FR-58 promises, not only the final TOWER win). */
  private lastStar = 1;
  /** In-progress transport drag (anchor tile/floor). */
  private transportStart: { x: number; floor: number } | null = null;
  /** Last cell painted while dragging a floor/lobby, so a fast drag lays one
   *  continuous run instead of scattered slabs. */
  private paint: { tile: number; floor: number } | null = null;
  /** Currently selected facility for the edit panel. */
  private selected: { type: "unit" | "transport"; id: number } | null = null;
  /** World cell the hover inspector tooltip is describing, so it can be
   *  anchored to that spot on screen and ride the tower when the camera moves. */
  private inspectAnchor: { x: number; floor: number } | null = null;
  /** The facility the inspector card currently describes. */
  private inspectTarget: { type: "unit" | "transport"; id: number } | null = null;
  /** ✕-dismissed target: stays hidden while the pointer keeps picking the same
   *  facility (otherwise the next hover event would instantly re-open the
   *  card). Cleared as soon as the pick moves to anything else — hovering the
   *  facility afresh is new intent, like any tooltip. */
  private inspectDismissed: { type: "unit" | "transport"; id: number } | null = null;
  /** Cached so per-frame anchoring doesn't construct a MediaQueryList each tick. */
  private mobileMq = window.matchMedia("(max-width: 860px)");
  /** First-run splash + onboarding (pure DOM chrome). */
  private onboarding!: OnboardingController;
  /** Whether the panels currently carry an inline anchor (so the mobile branch
   *  only resets them once, not every frame). */
  private panelsAnchored = false;
  /** High-water mark of a shaft's extent during an extend-arrow drag, so a
   *  back-and-forth wiggle is only charged for floors genuinely added. */
  private extendHwm: { id: number; top: number; bottom: number } | null = null;
  /** Per-device accessibility preferences (localStorage, off the save). */
  private prefs: Prefs = loadPrefs();
  private reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Last shown traffic tier (for boundary hysteresis, so the chip doesn't flicker). */
  private lastTrafficTier: TrafficTier = 0;
  /** Keyboard build cursor + a pending transport anchor (mouse-free play). */
  private kbCursor: { tile: number; floor: number } | null = null;
  private kbAnchor: { tile: number; floor: number } | null = null;

  /** Undo/redo: snapshot-based history (see {@link UndoHistory}). Built in the
   *  constructor once `sim`/`ui` exist; its ports close over `this` so they
   *  always see the live sim across an adoptSim() swap. */
  private history!: UndoHistory;

  constructor() {
    this.canvas = document.getElementById("view") as HTMLCanvasElement;
    this.sim = SaveGame.load() ?? Simulation.newGame(Date.parse("2024-01-01"));
    this.engine = new TowerEngine(this.canvas, this.sim);
    this.ui = new UI({
      onSelectTool: (t) => {
        this.tool = t;
        this.kbAnchor = null; // don't carry a pending transport anchor across tools
        this.engine.preview = null;
        this.engine.transportPreview = null;
      },
      onSpeed: (s) => {
        this.speed = s;
        this.engine.paused = SPEEDS[s] === 0;
      },
      onSave: () => this.save(),
      onLoad: () => this.load(),
      onExport: () => this.ui.showExport(SaveGame.export(this.sim)),
      onImport: (json) => this.importGame(json),
      onImportLegacy: (buf, name) => this.importLegacy(buf, name),
      onNew: () => this.newGame(),
      onToggleAudio: () => {
        this.audio.start();
        this.audio.setMuted(!this.audio.muted);
        return this.audio.muted;
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onEditAction: (action, root) => this.handleEditAction(action, root),
      onToggleReducedMotion: () => {
        this.prefs.reducedMotion = !this.prefs.reducedMotion;
        savePrefs(this.prefs);
        this.applyReducedMotion();
        return reducedMotionActive(this.prefs, this.reduceMq.matches);
      },
      onReplayOnboarding: () => {
        if (document.getElementById("splash")) return; // never arm behind the splash
        OnboardingController.clearOnboarded();
        this.ui.closeModal();
        if (!this.onboarding.arm(this.sim)) {
          this.ui.toast("You've already completed Getting Started.", "info");
        }
      },
      onRenameTower: (name) => (this.sim.tower.towerName = name),
      onShowStats: () => this.ui.showStats(this.buildStatsHtml()),
      onInspectorClose: () => {
        // Latch the dismissal so the next hover pick over the same facility
        // doesn't instantly re-open the card the user just closed.
        this.inspectDismissed = this.inspectTarget;
        this.inspectTarget = null;
        this.inspectAnchor = null;
        this.ui.showInspector(null);
      },
      onShowSaves: () => this.ui.showSaves(SaveGame.listSlots()),
      onSaveSlot: (n) => {
        SaveGame.saveSlot(n, this.sim);
        this.ui.toast(`Saved to slot ${n}.`, "good");
      },
      onLoadSlot: (slot) => {
        const loaded = slot === "auto" ? SaveGame.load() : SaveGame.loadSlot(slot);
        if (loaded) {
          this.adoptSim(loaded);
          this.ui.toast("Tower loaded.", "good");
        } else {
          this.ui.toast("That slot is empty or corrupt.", "bad");
        }
      },
      onDeleteSlot: (n) => {
        SaveGame.deleteSlot(n);
        this.ui.toast(`Deleted slot ${n}.`, "info");
      },
    });

    // Undo/redo history — ports close over `this` so snapshot / signature /
    // restore always target the *current* sim (adoptSim swaps it).
    this.history = new UndoHistory({
      snapshot: () => JSON.stringify(this.sim.serialize()),
      restore: (snap) => this.adoptSim(Simulation.deserialize(JSON.parse(snap)), true),
      signature: () => towerStateSig(this.sim.tower, this.sim.money),
      notify: (msg) => this.ui.toast(msg, "info"),
    });

    this.wireEngine();
    this.bindKeys();
    void this.engine.start();

    // Accessibility: apply reduced motion now and whenever the OS pref flips.
    this.applyReducedMotion();
    this.reduceMq.addEventListener("change", () => this.applyReducedMotion());

    // First-run splash + onboarding (chrome only; the engine is untouched).
    this.onboarding = new OnboardingController({
      mq: this.mobileMq,
      showHelp: () => this.ui.showHelp(),
      pauseForSplash: (paused) => {
        this.speed = paused ? 0 : 1;
        this.engine.paused = paused;
        document.querySelectorAll("#speed button[data-speed]").forEach((b) =>
          b.classList.toggle("active", Number((b as HTMLElement).dataset.speed) === this.speed),
        );
      },
      chime: () => this.audio.sfx("promote"),
    });
    this.onboarding.showSplash({
      hasSave: SaveGame.hasSave(),
      onContinue: () => {
        /* sim already loaded at construction; splash teardown resumes the engine */
      },
      onNewTower: (dismiss) => {
        // Guard the same data-loss as the toolbar's New button: starting fresh
        // overwrites the single autosave slot. Keep the splash up (paused) behind
        // the confirmation — only dismiss + start once the player accepts, so a
        // cancel leaves the title screen intact and no time passes.
        if (SaveGame.hasSave()) {
          this.ui.confirmModal("Start a new tower?", "This abandons your current tower (it is not auto-saved).", () => {
            dismiss();
            this.newGame();
          });
        } else {
          dismiss();
          this.newGame();
        }
      },
    });

    // Autosave periodically — but never while the first-run splash is up, so an
    // idle first visit can't persist the throwaway boot sim (which would flip
    // hasSave() true for a tower the player never started).
    window.setInterval(() => {
      if (!document.getElementById("splash")) this.save(true);
    }, 30000);
  }

  // ---- Keyboard play (mouse-free build cursor) ---------------------------

  /** Announce to the screen-reader live region. */
  private announce(msg: string): void {
    const el = document.getElementById("a11y-live");
    if (el) el.textContent = msg;
  }

  /** The inspectable/bulldozable entity at a cell (room or transport), if any. */
  private pickedAt(floor: number, tile: number): Picked | null {
    const u = this.sim.tower.unitAt(floor, tile);
    if (u && u.kind !== "floor" && u.kind !== "lobby") return { type: "unit", id: u.id, kind: u.kind };
    const t = this.sim.tower.transports.find(
      (tr) => tile >= tr.x && tile < tr.x + FACILITIES[tr.kind].width && floor >= tr.bottom && floor <= tr.top,
    );
    return t ? { type: "transport", id: t.id, kind: t.kind } : null;
  }

  private moveCursor(dTile: number, dFloor: number): void {
    const c = this.kbCursor ?? { tile: Math.floor(GRID.width / 2), floor: 1 };
    this.kbCursor = {
      tile: Math.max(0, Math.min(GRID.width - 1, c.tile + dTile)),
      floor: Math.max(GRID.minFloor, Math.min(GRID.maxFloor, c.floor + dFloor)),
    };
    this.engine.ensureVisible(this.kbCursor.tile, this.kbCursor.floor);
    this.refreshCursorPreview();
    this.announceCursor();
  }

  private refreshCursorPreview(): void {
    const c = this.kbCursor;
    if (!c) return;
    if (this.kbAnchor && this.tool.type === "build" && this.isTransportTool()) {
      const kind = this.tool.kind;
      const bottom = Math.min(this.kbAnchor.floor, c.floor);
      const top = Math.max(this.kbAnchor.floor, c.floor);
      this.engine.transportPreview = {
        kind,
        x: this.kbAnchor.tile,
        bottom,
        top,
        valid: this.sim.tower.placeTransportDryRun(kind, this.kbAnchor.tile, bottom, top) && this.sim.isUnlocked(kind),
      };
      this.engine.preview = null;
    } else {
      this.updateBuildPreview(c.tile, c.floor);
    }
  }

  private announceCursor(): void {
    const c = this.kbCursor;
    if (!c) return;
    const loc = c.floor >= 1 ? `floor ${c.floor}` : `basement ${1 - c.floor}`;
    const here = this.pickedAt(c.floor, c.tile);
    this.announce(`Cursor: ${loc}, column ${c.tile} — ${here ? FACILITIES[here.kind].name : "empty"}`);
  }

  private commitCursor(): void {
    if (!this.kbCursor) {
      this.moveCursor(0, 0); // first press: just reveal the cursor
      return;
    }
    const c = this.kbCursor;
    if (this.tool.type === "inspect") {
      const p = this.pickedAt(c.floor, c.tile);
      this.selectPicked(p);
      this.announce(p ? `Selected ${FACILITIES[p.kind].name}` : "Nothing to inspect here");
      return;
    }
    if (this.tool.type === "bulldoze") {
      this.bulldozeCursor();
      return;
    }
    if (this.tool.type !== "build") return;
    const kind = this.tool.kind;
    if (kind === "floor" || kind === "lobby") {
      this.paintBrush(kind, c.tile, c.floor);
      this.announce(`Placed ${FACILITIES[kind].name} on floor ${c.floor}`);
      this.refreshCursorPreview();
    } else if (this.isTransportTool()) {
      if (!this.kbAnchor) {
        // Snap the anchor column like the mouse path, so a wide shaft near the
        // right edge places instead of failing.
        this.kbAnchor = { tile: this.snapX(kind, c.tile), floor: c.floor };
        this.refreshCursorPreview();
        this.announce(`${FACILITIES[kind].name} anchored at floor ${c.floor}. Move to the other end and press Enter.`);
      } else {
        const bottom = Math.min(this.kbAnchor.floor, c.floor);
        const top = Math.max(this.kbAnchor.floor, c.floor);
        const res = this.sim.buildTransport(kind, this.kbAnchor.tile, bottom, top);
        this.kbAnchor = null;
        this.engine.transportPreview = null;
        if (res.ok) {
          this.audio.sfx("build");
          this.announce(`${FACILITIES[kind].name} built, floors ${bottom} to ${top}`);
        } else {
          this.audio.sfx("error");
          if (res.reason) this.ui.toast(res.reason, "bad");
          this.announce(res.reason ?? "Can't build there");
        }
        this.refreshCursorPreview();
      }
    } else {
      const x = this.snapX(kind, c.tile);
      const before = this.sim.tower.units.length;
      this.tryBuild(kind, c.floor, x);
      this.announce(
        this.sim.tower.units.length > before ? `Placed ${FACILITIES[kind].name}` : `Can't place ${FACILITIES[kind].name} here`,
      );
    }
  }

  private bulldozeCursor(): void {
    const c = this.kbCursor;
    if (!c) return;
    const p = this.pickedAt(c.floor, c.tile);
    if (!p) {
      this.announce("Nothing to bulldoze here");
      return;
    }
    const name = FACILITIES[p.kind].name;
    this.bulldozePicked(p);
    this.announce(`Bulldozed ${name}`);
    this.refreshCursorPreview();
  }

  /** Color-blind-safe traffic cue: word + shape-coded bar glyph (never color
   *  alone), driven by the same congestion value the engine reads, with boundary
   *  hysteresis so it doesn't flicker. */
  private updateTraffic(): void {
    const cong = this.sim.congestion();
    const B = [1.0, 1.25, 1.6]; // tier boundaries
    const raw = trafficTier(cong);
    if (raw > this.lastTrafficTier && cong >= B[this.lastTrafficTier] + 0.03) this.lastTrafficTier = raw;
    else if (raw < this.lastTrafficTier && cong <= B[this.lastTrafficTier - 1] - 0.03) this.lastTrafficTier = raw;
    const tier = this.lastTrafficTier;
    const label = TRAFFIC_LABELS[tier];
    const glyphEl = document.getElementById("traffic-glyph");
    const labelEl = document.getElementById("traffic-label");
    const wrapEl = document.getElementById("traffic");
    if (glyphEl && glyphEl.textContent !== trafficGlyph(tier)) glyphEl.textContent = trafficGlyph(tier);
    if (labelEl && labelEl.textContent !== label) {
      labelEl.textContent = label;
      wrapEl?.setAttribute("aria-label", `Traffic: ${label}`);
      wrapEl?.classList.toggle("traffic-warn", tier >= 2); // red is a redundant cue, not the only one
    }
  }

  /** Push the effective reduced-motion state (OS pref OR user pref) to the DOM
   *  (a class CSS keys off) and the engine (freezes ambient canvas motion). */
  private applyReducedMotion(): void {
    const on = reducedMotionActive(this.prefs, this.reduceMq.matches);
    document.documentElement.classList.toggle("reduce-motion", on);
    this.engine.setReducedMotion(on);
  }

  // ---- Engine wiring (all input/camera goes through Excalibur) ------------

  private wireEngine(): void {
    // Decide whether a press pans the camera or performs the active tool.
    this.engine.classifyDown = (button, touch, space) => {
      if (button > 0 || space) return "pan"; // middle/right button or held space
      if (this.tool.type === "inspect") return "pan"; // inspect: drag pans, tap selects
      if (touch && !this.isTransportTool()) return "pan"; // one finger pans; tap acts
      return "action";
    };

    // A press-without-drag: select (inspect) or, on touch, run the tool. The
    // picked entity comes from Excalibur's collider hit-testing.
    this.engine.onTap = (tile, floor, touch, picked) => {
      this.audio.start();
      if (this.tool.type === "inspect") {
        this.selectPicked(picked);
        return;
      }
      if (!touch) return; // mouse pan-taps with a build/bulldoze tool do nothing
      this.captureUndo(this.tool.type === "bulldoze" ? "Bulldoze" : `Build ${FACILITIES[this.tool.kind].name}`);
      if (this.tool.type === "bulldoze") this.bulldozePicked(picked);
      else if (this.tool.type === "build" && !this.isTransportTool()) {
        if (this.tool.kind === "floor" || this.tool.kind === "lobby") {
          this.paintBrush(this.tool.kind, tile, floor); // wider strip per tap
        } else {
          this.tryBuild(this.tool.kind, floor, this.snapX(this.tool.kind, tile));
        }
      }
      this.commitUndo();
    };

    this.engine.onActionDown = (tile, floor, _touch, picked) => {
      this.audio.start();
      if (this.tool.type === "bulldoze" || this.tool.type === "build") {
        this.captureUndo(this.tool.type === "bulldoze" ? "Bulldoze" : `Build ${FACILITIES[this.tool.kind].name}`);
      }
      if (this.tool.type === "bulldoze") {
        this.bulldozePicked(picked);
      } else if (this.tool.type === "build") {
        if (this.isTransportTool()) {
          this.transportStart = { x: this.snapX(this.tool.kind, tile), floor };
        } else if (this.tool.kind === "floor" || this.tool.kind === "lobby") {
          // A click lays a wider strip; dragging then extends it.
          this.paintBrush(this.tool.kind, tile, floor);
        } else {
          this.tryBuild(this.tool.kind, floor, this.snapX(this.tool.kind, tile));
        }
      }
    };

    this.engine.onActionMove = (tile, floor, picked) => {
      if (this.tool.type === "bulldoze") {
        this.bulldozePicked(picked, true); // drag: blocked tiles fail silently
        return;
      }
      if (this.tool.type !== "build") return;
      const kind = this.tool.kind;
      if (this.isTransportTool() && this.transportStart) {
        const bottom = Math.min(this.transportStart.floor, floor);
        const top = Math.max(this.transportStart.floor, floor);
        const x = this.transportStart.x;
        const valid = this.sim.tower.placeTransportDryRun(kind, x, bottom, top) && this.sim.isUnlocked(kind);
        this.engine.transportPreview = { kind, x, bottom, top, valid };
        this.engine.preview = null;
      } else if (kind === "floor" || kind === "lobby") {
        this.paintFloorRun(kind, tile, floor);
      }
    };

    this.engine.onActionUp = () => {
      this.paint = null;
      if (this.tool.type === "build" && this.isTransportTool()) {
        const tp = this.engine.transportPreview;
        if (tp) {
          if (tp.valid) {
            const res = this.sim.buildTransport(tp.kind, tp.x, tp.bottom, tp.top);
            this.audio.sfx(res.ok ? "build" : "error");
            if (!res.ok && res.reason) this.ui.toast(res.reason, "bad");
          } else {
            // Explain *why* it won't go here instead of failing silently.
            this.audio.sfx("error");
            this.ui.toast(this.transportReason(tp.kind, tp.x, tp.bottom, tp.top), "bad");
          }
          this.engine.transportPreview = null;
        } else if (this.transportStart) {
          // Pressed without dragging — teach the drag-to-size gesture.
          this.ui.toast(`Drag up or down to set the ${FACILITIES[this.tool.kind].name.toLowerCase()}'s height.`, "info");
        }
      }
      this.transportStart = null;
      this.commitUndo();
    };

    this.engine.onHover = (tile, floor, picked) => {
      if (this.tool.type === "build") {
        this.updateBuildPreview(tile, floor);
      } else {
        this.engine.preview = null;
        this.engine.transportPreview = null;
        if (this.tool.type === "inspect") this.inspectPicked(picked);
      }
    };

    // Right-click inspects whatever's under the cursor, whatever tool is held.
    this.engine.onSecondary = (picked) => this.selectPicked(picked);
    // In-world extend arrows on the selected elevator: drag an end to grow or
    // shrink the shaft floor-by-floor.
    this.engine.onExtendTo = (end, target) => this.extendSelectedTo(end, target);
    this.engine.onExtendEnd = () => {
      this.extendHwm = null;
      this.commitUndo();
    };
    // Suppress the browser context menu so right-click is ours to use.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Per-frame: advance the sim and (throttled) refresh DOM/audio.
    this.engine.onUpdate = (ms) => {
      // A thrown frame must NEVER escape to Excalibur: its game loop calls
      // stop() on any uncaught exception, which freezes the whole game dead
      // (seen at high speed, where far more sim work runs per frame). Contain it
      // here so a transient error skips one frame instead of halting play.
      try {
        this.update(ms);
      } catch (err) {
        // Throttle the log so a per-frame throw can't spam the console at
        // frame-rate (which would itself tank performance).
        const now = globalThis.performance ? performance.now() : 0;
        if (now - this.lastTickErrorLog > 2000) {
          this.lastTickErrorLog = now;
          console.error("[tick] frame error — continuing:", err);
        }
      }
    };

    // The GPU dropped the WebGL context (mobile browsers reset it under memory
    // pressure / after backgrounding). Recover for the player instead of
    // Excalibur's dead-end "please refresh the page" card.
    this.engine.onContextLost = () => this.recoverFromContextLoss();
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      // Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or +Y) — handled BEFORE the
      // modifier bail below so it isn't swallowed; skipped while typing in a field
      // (which keeps its own edit history, e.g. the rename box).
      {
        const el = document.activeElement;
        const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
        if (!typing && (e.ctrlKey || e.metaKey)) {
          const k = e.key.toLowerCase();
          if (k === "z" && !e.shiftKey) {
            e.preventDefault();
            return this.undo();
          }
          if ((k === "z" && e.shiftKey) || k === "y") {
            e.preventDefault();
            return this.redo();
          }
        }
      }
      // Never hijack other browser/OS shortcuts (Ctrl/Cmd/Alt + key).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Typing controls swallow every game key.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable))
        return;
      // A focused button / palette item owns Enter/Space activation — don't ALSO
      // fire the build cursor on those keys. Movement/zoom/bulldoze keys still get
      // through, so keyboard play flows right after picking a tool from the palette.
      const onControl = !!ae && (ae.tagName === "BUTTON" || ae.tagName === "A" || ae.getAttribute("role") === "button");
      const activationKey = e.key === "Enter" || e.key === " " || e.key === "Spacebar";
      if (onControl && activationKey) return;
      if ((document.getElementById("modal") as HTMLDialogElement | null)?.open) return;
      // Don't let game keys run the paused engine behind the first-run splash.
      if (document.getElementById("splash")) return;
      if (e.key >= "0" && e.key <= "3") {
        this.speed = Number(e.key);
        this.engine.paused = SPEEDS[this.speed] === 0;
        document.querySelectorAll("#speed button[data-speed]").forEach((b) =>
          b.classList.toggle("active", (b as HTMLElement).dataset.speed === e.key),
        );
        return;
      }

      // Keyboard play (F50–52): a virtual build cursor moved with arrows/WASD,
      // committed with Enter, bulldozed with Delete/X — full mouse-free play.
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": this.moveCursor(-step, 0); break;
        case "ArrowRight": case "d": case "D": this.moveCursor(step, 0); break;
        case "ArrowUp": case "w": case "W": this.moveCursor(0, step); break;
        case "ArrowDown": case "s": case "S": this.moveCursor(0, -step); break;
        case "Enter": case " ": case "Spacebar": this.commitCursor(); break;
        case "Delete": case "Backspace": case "x": case "X": this.bulldozeCursor(); break;
        case "+": case "=": this.engine.zoomBy(1.15); return;
        case "-": case "_": this.engine.zoomBy(1 / 1.15); return;
        case "c": case "C":
          if (this.kbCursor) this.engine.ensureVisible(this.kbCursor.tile, this.kbCursor.floor);
          else this.engine.center();
          return;
        case "Escape":
          this.kbAnchor = null;
          this.engine.transportPreview = null;
          this.refreshCursorPreview();
          this.announce("Cancelled");
          return;
        default:
          return; // not a game key — let it through
      }
      e.preventDefault(); // consumed a movement/commit/bulldoze key
    });
    // First interaction starts audio (browser autoplay policy).
    const kick = () => this.audio.start();
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
  }

  private isTransportTool(): boolean {
    return this.tool.type === "build" && !!FACILITIES[this.tool.kind].transport;
  }

  private updateBuildPreview(tile: number, floor: number): void {
    if (this.tool.type !== "build") {
      this.engine.preview = null;
      this.engine.transportPreview = null;
      return;
    }
    const kind = this.tool.kind;
    if (this.isTransportTool()) {
      const x = this.snapX(kind, tile);
      this.engine.transportPreview = null;
      this.engine.preview = { kind, floor, x, valid: this.sim.isUnlocked(kind) };
    } else if (kind === "floor" || kind === "lobby") {
      // These tools lay a centered brush strip, not a single tile — so the
      // shadow must span the same run a click will build.
      const tiles = this.brushTiles(tile);
      const left = tiles[0];
      const span = tiles[tiles.length - 1] - left + 1;
      const valid = this.sim.canBuild(kind, floor, this.snapX(kind, tile)).ok;
      this.engine.preview = { kind, floor, x: left, span, valid };
      this.engine.transportPreview = null;
    } else {
      const x = this.snapX(kind, tile);
      // Rooms auto-lay their own floor, so validity comes from canBuild (which
      // accounts for the floor tiles and their cost), not raw canPlace.
      const valid = this.sim.canBuild(kind, floor, x).ok;
      this.engine.preview = { kind, floor, x, valid };
      this.engine.transportPreview = null;
    }
  }

  // ---- Per-frame simulation + UI -----------------------------------------

  private update(dtMs: number): void {
    // While an emergency choice is open, freeze time (canon: the modal pauses the
    // game) so the engine can't auto-resolve the choice out from under the player.
    if (this.shownChoice) {
      this.accMinutes = 0;
      return;
    }
    const minutesPerSecond = SPEEDS[this.speed] ?? 0;
    this.accMinutes += (dtMs / 1000) * minutesPerSecond;
    // Step the simulation in small chunks so hourly/daily boundaries fire.
    let guard = 0;
    while (this.accMinutes >= 1 && guard++ < 2000) {
      const step = Math.min(20, this.accMinutes);
      this.sim.tick(step);
      this.accMinutes -= step;
    }

    // Throttle the comparatively expensive DOM/audio updates (~6Hz) so a busy
    // tower never makes panning feel sluggish.
    const now = globalThis.performance ? performance.now() : 0;
    if (now - this.lastUiUpdate > 160) {
      this.lastUiUpdate = now;
      this.audio.update(this.engine.focus());
      this.ui.update(this.sim);
      this.updateTraffic();
      this.onboarding.tick(); // advance the first-run checklist on real progress (no-op when inactive)
      // Keep the open editor's live stats fresh. Refresh now patches only the
      // volatile cells in place (never the buttons or rename input), so this is
      // safe while renaming; the pointer guard still skips the rare full rebuild
      // during an active press.
      if (this.selected && this.ui.isEditorOpen() && !this.ui.isEditorBusy()) {
        this.refreshEditor();
      }
      // A jingle on every star promotion (2★–5★), not just the TOWER win.
      if (this.sim.star > this.lastStar) {
        this.lastStar = this.sim.star;
        if (this.sim.star < 6) this.audio.sfx("promote");
      }
      // Interactive emergency choice (fire rescue / bomb ransom).
      const pc = this.sim.pendingChoice;
      if (pc && !this.shownChoice) {
        this.shownChoice = true;
        this.audio.sfx("error");
        this.ui.showEventChoice(pc.message, `$${pc.cost.toLocaleString()}`, (opt) => {
          this.sim.resolveChoice(opt);
          this.shownChoice = false;
        });
      } else if (!pc && this.shownChoice) {
        this.shownChoice = false; // engine auto-resolved it (player ignored the modal)
      }
      if (this.sim.evaluatedTower && !this.shownWin) {
        this.shownWin = true;
        this.audio.sfx("promote");
        this.ui.congratsTower();
      }
    }

    // World-anchor the editor card and inspector tooltip every frame (cheap —
    // just writes left/top), so they ride the tower as the camera pans/zooms.
    this.positionPanels();
  }

  /** Keep the world-attached DOM panels (selected-facility editor, hover
   *  inspector) pinned to their facility's on-screen position. On mobile they
   *  keep the docked CSS layout instead, to avoid the bottom palette strip. */
  private positionPanels(): void {
    if (this.mobileMq.matches) {
      if (this.panelsAnchored) {
        this.ui.clearPanelAnchors();
        this.panelsAnchored = false;
      }
      return;
    }
    const vw = this.engine.viewWidth;
    const vh = this.engine.viewHeight;
    if (this.selected && this.ui.isEditorOpen()) {
      const r = this.selectedScreenRect();
      if (r) {
        this.ui.anchorEditor(r, vw, vh);
        this.panelsAnchored = true;
      }
    }
    if (this.inspectAnchor && this.ui.isInspectorOpen()) {
      const sx = this.engine.worldToScreenX(this.inspectAnchor.x);
      const sy = this.engine.worldToScreenY(this.inspectAnchor.floor);
      this.ui.anchorInspector(sx, sy, vw, vh);
      this.panelsAnchored = true;
    }
  }

  /** Screen-space rect (top edge) of the currently selected unit/transport,
   *  for the editor card to anchor beside. */
  private selectedScreenRect(): { x: number; y: number; w: number } | null {
    if (!this.selected) return null;
    let left: number, right: number, topFloor: number;
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return null;
      left = u.x;
      right = u.x + u.width;
      topFloor = u.floor + facilityFloors(u.kind) - 1;
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return null;
      left = t.x;
      right = t.x + t.width;
      topFloor = t.top;
    }
    const sx = this.engine.worldToScreenX(left);
    return { x: sx, y: this.engine.worldToScreenY(topFloor), w: this.engine.worldToScreenX(right) - sx };
  }

  // ---- Selection & per-facility editing ---------------------------------

  /** Select whatever Excalibur reported under the pointer (rooms/transports). */
  private selectPicked(p: Picked | null): void {
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      this.clearSelection();
      return;
    }
    this.selected = { type: p.type, id: p.id };
    this.refreshEditor();
  }

  private clearSelection(): void {
    this.selected = null;
    this.engine.selectedId = null;
    this.ui.hideEditor();
  }

  private refreshEditor(): void {
    if (!this.selected) return;
    // The render key encodes the editor's SHAPE (not its live values): same key
    // → patch the volatile fields in place; different key → full rebuild. The
    // shape only changes when a control appears/disappears (a condo sells and
    // loses its price adjuster; a car button hits its disabled bound), so
    // rebuilds are rare and the buttons/input survive every stat tick.
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return this.clearSelection();
      this.engine.selectedId = u.id;
      const adjuster = !!rentConfig(u.kind) && !(u.kind === "condo" && u.everOccupied);
      // The Booking button label lives in the built HTML, so fold the policy into
      // the key — cycling it bumps the key and rebuilds the button.
      const film = u.kind === "cinema" ? `:${u.filmPolicy ?? "auto"}` : "";
      this.ui.renderEditor(`unit:${u.id}:${adjuster ? "r" : ""}${film}`, () => this.unitEditorHtml(u), this.unitEditorVolatile(u));
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return this.clearSelection();
      this.engine.selectedId = t.id; // outlines the shaft + shows extend arrows
      const maxCars = maxCarsFor(t.kind);
      const shape = `${t.cars <= 1 ? "-" : ""}${t.cars >= maxCars ? "+" : ""}`;
      this.ui.renderEditor(`transport:${t.id}:${shape}`, () => this.transportEditorHtml(t), this.transportEditorVolatile(t));
    }
  }

  /** The values in the unit editor that change while it stays open, keyed by the
   *  `data-field` on their cell. These are patched in place each refresh so the
   *  buttons and rename input are never rebuilt out from under a click. */
  private unitEditorVolatile(u: import("./engine/types").Unit): Record<string, string> {
    const f = FACILITIES[u.kind];
    const served = this.sim.tower.isFloorServed(u.floor);
    const evalPct = Math.round(u.satisfaction * 100);
    const vol: Record<string, string> = {
      status: u.state,
      served: `<span style="color:${served ? "var(--good)" : "var(--bad)"}">${served ? "Yes" : "No"}</span>`,
      eval: `<span class="evalbar"><span style="width:${evalPct}%"></span></span> ${evalPct}%`,
    };
    if (f.population) vol.occupants = `${u.occupants}/${f.population}`;
    if (rentConfig(u.kind)) {
      vol.rent = `$${rentOf(u).toLocaleString()}${isHotelKind(u.kind) ? "/night" : ""}`;
    }
    if (u.kind === "cinema") {
      // A mid-build / burning / gutted cinema books no film — show "—", not a fake feature.
      vol.showing = !isOperational(u) ? "—" : this.sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature";
    }
    return vol;
  }

  private unitEditorHtml(u: import("./engine/types").Unit): string {
    const f = FACILITIES[u.kind];
    const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
    const canRename = u.kind === "office" || u.kind === "condo";
    const rcfg = rentConfig(u.kind);
    const vol = this.unitEditorVolatile(u);
    const rows: string[] = [
      `<span class="k">Location</span><span class="v">${floorLabel}</span>`,
      `<span class="k">Status</span><span class="v" data-field="status">${vol.status}</span>`,
    ];
    if (f.population) rows.push(`<span class="k">Occupants</span><span class="v" data-field="occupants">${vol.occupants}</span>`);
    rows.push(`<span class="k">Elevator access</span><span class="v" data-field="served">${vol.served}</span>`);
    rows.push(`<span class="k">Eval</span><span class="v" data-field="eval">${vol.eval}</span>`);
    if (rcfg) {
      const label = u.kind === "condo" ? "Sale price" : isHotelKind(u.kind) ? "Room rate" : "Quarterly rent";
      rows.push(`<span class="k">${label}</span><span class="v" data-field="rent">${vol.rent}</span>`);
    }
    if (u.kind === "cinema" && isOperational(u)) {
      // A gutted/burning/under-construction cinema books no film — omit the row.
      rows.push(`<span class="k">Now showing</span><span class="v" data-field="showing">${vol.showing}</span>`);
    }
    if (u.state === "gutted") {
      rows.push(`<span class="k">Scrap value</span><span class="v">$0</span>`);
      rows.push(`<span class="k">⚠</span><span class="v">Gutted — bulldoze and rebuild.</span>`);
    } else {
      rows.push(`<span class="k">Resale value</span><span class="v">$${resaleRefund(f.kind).toLocaleString()}</span>`);
    }

    let actions = "";
    if (canRename) {
      actions += `<div class="ed-row"><input data-edit="noop" id="ed-name" value="${escapeHtml(u.label)}" /><button data-edit="rename">Rename</button></div>`;
    }
    // Price adjuster: offices/hotels any time, condos only while still unsold.
    if (rcfg && !(u.kind === "condo" && u.everOccupied)) {
      const what = u.kind === "condo" ? "price" : "rent";
      actions += `<div class="ed-row"><button data-edit="rentDown">– ${what}</button><button data-edit="rentUp">+ ${what}</button></div>`;
      // Batch-price every unit of this kind at once (no per-room grind).
      actions += `<div class="ed-row"><button data-edit="batchKind">Set all ${FACILITIES[u.kind].name.toLowerCase()}s…</button></div>`;
    }
    if (u.kind === "cinema") {
      const pol = { auto: "Auto", feature: "Feature", blockbuster: "Blockbuster" }[u.filmPolicy ?? "auto"];
      actions += `<div class="ed-row"><button data-edit="filmPolicy">Booking: ${pol} ▸</button></div>`;
    }
    actions += `<div class="ed-row"><button class="danger" data-edit="sell">Sell / Bulldoze</button></div>`;

    return (
      `<h4>${f.name}<span class="ed-close">✕</span></h4>` +
      `<div class="ed-stats">${rows.join("")}</div>` +
      actions
    );
  }

  private transportEditorVolatile(t: import("./engine/types").Transport): Record<string, string> {
    const isEl = isElevatorKind(t.kind);
    const maxCars = maxCarsFor(t.kind);
    const skipped = t.skipFloors?.length ?? 0;
    const vol: Record<string, string> = {
      serves: `${floorTag(t.bottom)} – ${floorTag(t.top)}`,
      height: `${t.top - t.bottom + 1} floors`,
    };
    if (isEl) {
      vol.cars = `${t.cars} / ${maxCars} max`;
      vol.capacity = `${this.sim.transportCapacity(t)} riders/trip`;
      vol.stops = skipped ? `express · skips ${skipped}` : "all floors";
    }
    return vol;
  }

  private transportEditorHtml(t: import("./engine/types").Transport): string {
    const f = FACILITIES[t.kind];
    const isEl = isElevatorKind(t.kind);
    const maxCars = maxCarsFor(t.kind);
    const vol = this.transportEditorVolatile(t);
    const rows: string[] = [
      `<span class="k">Serves floors</span><span class="v" data-field="serves">${vol.serves}</span>`,
      `<span class="k">Height</span><span class="v" data-field="height">${vol.height}</span>`,
    ];
    if (isEl) {
      rows.push(`<span class="k">Cars</span><span class="v" data-field="cars">${vol.cars}</span>`);
      rows.push(`<span class="k">Capacity</span><span class="v" data-field="capacity">${vol.capacity}</span>`);
      rows.push(`<span class="k">Stops</span><span class="v" data-field="stops">${vol.stops}</span>`);
    }
    rows.push(`<span class="k">Resale value</span><span class="v">$${resaleRefund(f.kind).toLocaleString()}</span>`);

    let actions = "";
    if (isEl) {
      actions += `<div class="ed-row"><button data-edit="removecar"${t.cars <= 1 ? " disabled" : ""}>– Car</button><button data-edit="addcar"${t.cars >= maxCars ? " disabled" : ""}>+ Car</button></div>`;
      actions += `<div class="ed-row"><button data-edit="stops">Configure stops…</button></div>`;
      actions += `<div class="ed-row"><button data-edit="express">Express (lobbies)</button><button data-edit="allstops">All stops</button></div>`;
    }
    actions += `<div class="ed-row"><button data-edit="extendDown">▼ Extend down</button><button data-edit="extendUp">▲ Extend up</button></div>`;
    actions += `<div class="ed-row"><button class="danger" data-edit="sell">Sell / Bulldoze</button></div>`;

    return (
      `<h4>${f.name}<span class="ed-close">✕</span></h4>` +
      `<div class="ed-stats">${rows.join("")}</div>` +
      actions
    );
  }

  /** Open the per-floor stop-configuration dialog for the selected elevator. */
  private openStopsDialog(): void {
    if (!this.selected || this.selected.type !== "transport") return;
    const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
    if (!t) return;
    const lobbies = new Set(this.sim.tower.lobbyFloors());
    const floors: { floor: number; stop: boolean; lobby: boolean }[] = [];
    for (let fl = t.top; fl >= t.bottom; fl--) {
      floors.push({ floor: fl, stop: this.sim.tower.stopsAt(t, fl), lobby: lobbies.has(fl) });
    }
    this.ui.showStopsDialog(FACILITIES[t.kind].name, floors, (floor, stop) => {
      // Each toggle is its own undo step (the surrounding handleEditAction
      // commit already fired before the dialog mutated anything).
      this.captureUndo("Elevator stops");
      this.sim.tower.setStop(t.id, floor, stop);
      this.commitUndo();
      this.refreshEditor();
    });
  }

  /** Drag-extend the selected shaft so `end` reaches `targetFloor`. Charges
   *  $5,000 per floor, but only for floors beyond the drag's high-water mark
   *  (so dragging out and back doesn't bill twice). Shrinking is free. */
  private extendSelectedTo(end: "up" | "down", targetFloor: number): void {
    if (!this.selected || this.selected.type !== "transport") return;
    const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
    if (!t || !isElevatorKind(t.kind)) return; // only lifts have extend handles / billing
    if (!this.extendHwm || this.extendHwm.id !== t.id) {
      this.extendHwm = { id: t.id, top: t.top, bottom: t.bottom };
      this.captureUndo("Extend");
    }
    // Bill only floors past the gesture's high-water mark, clamped to what the
    // player can afford — a fast drag grows as far as the budget allows (matching
    // a slow drag), and a broke drag simply stops growing (no per-frame toast).
    const { nb, nt, added } = extendBill(
      { bottom: t.bottom, top: t.top },
      this.extendHwm,
      end,
      targetFloor,
      this.sim.money,
      ECON.transportFloorCost,
    );
    if (nb === t.bottom && nt === t.top) return; // nothing changed this step

    const res = this.sim.tower.resizeTransport(t.id, nb, nt);
    if (res.ok) {
      this.sim.money -= added * ECON.transportFloorCost;
      this.extendHwm.top = Math.max(this.extendHwm.top, nt);
      this.extendHwm.bottom = Math.min(this.extendHwm.bottom, nb);
      this.audio.sfx(added > 0 ? "build" : "click");
      this.refreshEditor();
    }
    // A blocked step (cap reached, no structure, another shaft in the way) is
    // silent so a drag doesn't spam toasts; the shaft simply stops growing.
  }

  /** Open the batch-pricing dialog pre-scoped to `kind`, wired to the engine's
   *  pure preview + mutating apply (what you preview is what commits). */
  private openBatchPricing(kind: FacilityKind): void {
    const band = rentConfig(kind);
    if (!band) return;
    this.ui.showBatchPricingDialog(
      { kind, kindLabel: FACILITIES[kind].name, band },
      {
        preview: (target, opts) => this.sim.previewRentBatch(kind, target, opts)!,
        apply: (target, opts) => {
          // Capture BEFORE the mutation (the dialog applies asynchronously, so the
          // synchronous captureUndo in handleEditAction is stale) → an undoable batch.
          this.captureUndo("Set prices");
          const r = this.sim.applyRentBatch(kind, target, opts)!;
          this.commitUndo();
          return r;
        },
        onApplied: (summary) => {
          this.audio.sfx("build");
          this.ui.toast(summary, "good");
          this.announce(summary);
          this.refreshEditor();
        },
      },
    );
  }

  private handleEditAction(action: string, root: HTMLElement): void {
    if (!this.selected) return;
    const UNDO_LABELS: Record<string, string> = {
      sell: "Sell",
      rename: "Rename",
      rentUp: "Rent change",
      rentDown: "Rent change",
      addcar: "Elevator cars",
      removecar: "Elevator cars",
      stops: "Elevator stops",
      express: "Elevator stops",
      allstops: "Elevator stops",
      extendUp: "Extend",
      extendDown: "Extend",
      filmPolicy: "Film policy",
    };
    this.captureUndo(UNDO_LABELS[action] ?? "Edit");
    if (this.selected.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === this.selected!.id);
      if (!u) return this.clearSelection();
      if (action === "sell") {
        if (!this.tryRemoveUnit(u, "sell")) return;
        this.audio.sfx("sell");
        this.commitUndo();
        return this.clearSelection();
      }
      if (action === "rename") {
        const input = root.querySelector<HTMLInputElement>("#ed-name");
        if (input) u.label = input.value.trim() || FACILITIES[u.kind].name;
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "rentUp" || action === "rentDown") {
        if (this.sim.adjustRent(u.id, action === "rentUp" ? 1 : -1) !== null) {
          this.audio.sfx("click");
          this.refreshEditor();
        }
      } else if (action === "filmPolicy") {
        const order = ["auto", "feature", "blockbuster"] as const;
        const next = order[(order.indexOf(u.filmPolicy ?? "auto") + 1) % order.length];
        this.sim.setFilmPolicy(u.id, next);
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "batchKind") {
        this.openBatchPricing(u.kind);
      }
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === this.selected!.id);
      if (!t) return this.clearSelection();
      if (action === "sell") {
        this.sim.tower.removeTransport(t.id);
        this.sim.money += resaleRefund(t.kind);
        this.audio.sfx("sell");
        this.commitUndo();
        return this.clearSelection();
      }
      if (action === "addcar") {
        // Cap check first: at max cars the button is disabled anyway, but a
        // money toast here would blame the wrong constraint.
        if (t.cars >= maxCarsFor(t.kind)) return;
        if (this.sim.money < ECON.addCarCost) {
          this.audio.sfx("error");
          this.ui.toast("Not enough money.", "bad");
          return;
        }
        if (this.sim.tower.setCars(t.id, t.cars + 1)) this.sim.money -= ECON.addCarCost;
        this.audio.sfx("build");
        this.refreshEditor();
      } else if (action === "removecar") {
        // A removed car is a sale, so it pays out like one (half back).
        if (this.sim.tower.setCars(t.id, t.cars - 1)) this.sim.money += carResaleRefund();
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "stops") {
        this.openStopsDialog();
      } else if (action === "express") {
        this.sim.tower.setExpressStops(t.id);
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "allstops") {
        this.sim.tower.clearStops(t.id);
        this.audio.sfx("click");
        this.refreshEditor();
      } else if (action === "extendUp" || action === "extendDown") {
        const nb = action === "extendDown" ? t.bottom - 1 : t.bottom;
        const nt = action === "extendUp" ? t.top + 1 : t.top;
        const cost = ECON.transportFloorCost;
        if (this.sim.money < cost) {
          this.audio.sfx("error");
          this.ui.toast("Not enough money.", "bad");
          return;
        }
        const res = this.sim.tower.resizeTransport(t.id, nb, nt);
        if (res.ok) {
          this.sim.money -= cost;
          this.audio.sfx("build");
        } else if (res.reason) {
          this.audio.sfx("error");
          this.ui.toast(res.reason, "bad");
        }
        this.refreshEditor();
      }
    }
    this.commitUndo();
  }

  private buildStatsHtml(): string {
    const s = this.sim.stats();
    const c = this.sim.clock;
    const next = this.sim.nextStarThreshold;
    const fmt = (n: number) => n.toLocaleString();
    // Modal-only diagnostics — a full scan and a flood-fill, computed here at
    // modal-build time so they never run on the ~6 Hz HUD stats() path.
    const ratingPop = this.sim.ratingPopulation();
    const parkingWorking = this.sim.tower.functionalParkingSet().size;
    const stranded = this.sim.strandedFloors().length; // BFS-bearing
    // Only when hotels have dropped out of the rating (3★+) and actually diverge.
    const ratingRow =
      s.star >= 3 && ratingPop < s.population
        ? `<span class="k">Counts toward stars</span><span class="v">${fmt(ratingPop)}</span>`
        : "";
    return `<div class="stats-grid">
      <div class="stats-section">Overview</div>
      <div class="col">
        <span class="k">Tower name</span><span class="v">${escapeHtml(this.sim.tower.towerName)}</span>
        <span class="k">Rating</span><span class="v stars">${s.star >= 6 ? "TOWER" : s.star + "★"}</span>
        <span class="k">Population</span><span class="v">${fmt(s.population)}</span>
        ${ratingRow}
        <span class="k">Next star at</span><span class="v">${next ? fmt(next) : "—"}</span>
        <span class="k">Funds</span><span class="v ${this.sim.money < 0 ? "loss" : "money"}">$${fmt(Math.round(this.sim.money))}</span>
        <span class="k">Date</span><span class="v">${c.dayName}, day ${c.day + 1}</span>
      </div>
      <div class="col">
        <span class="k">Floors above</span><span class="v">${s.floors}</span>
        <span class="k">Basements</span><span class="v">${s.basements}</span>
        <span class="k">Elevators</span><span class="v">${s.elevators}</span>
        <span class="k">All transports</span><span class="v">${s.transports}</span>
      </div>
      <div class="stats-section">Tenancy</div>
      <div class="col">
        <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
        <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
        <span class="k">Vacancies</span><span class="v">${s.vacant}</span>
      </div>
      <div class="col">
        <span class="k">Hotel rooms in use</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
        <span class="k">Rooms to clean</span><span class="v">${s.dirty}</span>
        <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
        <span class="k">On fire</span><span class="v" style="color:${s.fires ? "var(--bad)" : "var(--good)"}">${s.fires || "None"}</span>
      </div>
      <div class="stats-section">Transport &amp; access</div>
      <div class="col">
        <span class="k">Stranded floors</span><span class="v" style="color:${stranded ? "var(--bad)" : "var(--good)"}">${stranded || "None"}</span>
        ${
          s.parkingSpaces > 0
            ? `<span class="k">Parking spaces</span><span class="v" style="color:${parkingWorking < s.parkingSpaces ? "var(--bad)" : "var(--good)"}">${parkingWorking} / ${s.parkingSpaces} working</span>`
            : ""
        }
      </div>
      ${
        stranded || ratingRow
          ? `<div class="col">${
              stranded
                ? `<span class="k" style="color:var(--muted);grid-column:1/-1">Stranded = leased floors 3+ rides from the lobby; they earn rating but draw no visitors. Add a sky-lobby transfer.</span>`
                : ""
            }${
              ratingRow
                ? `<span class="k" style="color:var(--muted);grid-column:1/-1">Hotel guests count toward your star rating only until 3★.</span>`
                : ""
            }</div>`
          : ""
      }
      ${this.buildMilestonesHtml()}
    </div>`;
  }

  /** The optional-goals checklist for the stats modal. */
  private buildMilestonesHtml(): string {
    const mp = this.sim.milestoneProgress();
    const half = Math.ceil(mp.list.length / 2);
    const col = (items: typeof mp.list) =>
      `<div class="col ms">${items
        .map(
          (m) =>
            `<span class="k${m.done ? " ms-done" : ""}">${m.done ? "✓" : "·"} ${escapeHtml(m.label)}</span>` +
            `<span class="v">${escapeHtml(m.desc)}</span>`,
        )
        .join("")}</div>`;
    const pct = mp.total ? Math.round((mp.achieved / mp.total) * 100) : 0;
    return (
      `<div class="stats-section">🏅 Milestones (${mp.achieved}/${mp.total})` +
      `<span class="evalbar"><span style="width:${pct}%"></span></span></div>` +
      col(mp.list.slice(0, half)) +
      col(mp.list.slice(half))
    );
  }

  private snapX(kind: FacilityKind, tile: number): number {
    const w = FACILITIES[kind].width;
    return Math.max(0, Math.min(GRID.width - w, tile));
  }

  // ---- Actions -----------------------------------------------------------

  private tryBuild(kind: FacilityKind, floor: number, x: number, quiet = false): void {
    const res = this.sim.build(kind, floor, x);
    if (res.ok) {
      if (!quiet) this.audio.sfx("build");
    } else if (!quiet && res.reason) {
      this.audio.sfx("error");
      this.ui.toast(res.reason, "bad");
    }
  }

  /** Human-readable reason an elevator/stairs span can't be placed. */
  private transportReason(kind: FacilityKind, x: number, bottom: number, top: number): string {
    if (!this.sim.isUnlocked(kind)) {
      return `${FACILITIES[kind].name} unlocks at ${FACILITIES[kind].minStar}★.`;
    }
    const v = this.sim.tower.validateTransport(kind, x, bottom, top);
    return v.reason ?? "A shaft can't go here — leave a clear column through built floors.";
  }

  /**
   * Paint a continuous floor/lobby run as the pointer drags, filling every cell
   * between the last painted tile and this one — so dragging lays one long floor
   * (as in the original) instead of scattered slabs when the drag moves fast.
   * Cells are built outward from the anchor so each is adjacent to existing
   * structure; midair cells simply fail to place, exactly as you'd expect.
   */
  /** Lay a wider centered run of floor/lobby from a single tap, building in
   *  passes so each tile is reached once it has a supported neighbor. */
  /** The tiles a single floor/lobby tap paints — a strip centered on the
   *  cursor, clamped to the lot. Shared by the placement and its preview so the
   *  shadow always matches what a click lays down. */
  private brushTiles(tile: number): number[] {
    const clampX = (x: number) => Math.max(0, Math.min(GRID.width - 1, x));
    const half = Math.floor(STRUCTURE_BRUSH / 2);
    const tiles: number[] = [];
    for (let d = -half; d < STRUCTURE_BRUSH - half; d++) tiles.push(clampX(tile + d));
    return tiles;
  }

  private paintBrush(kind: FacilityKind, tile: number, floor: number): void {
    const tiles = this.brushTiles(tile);
    let progress = true;
    while (progress) {
      progress = false;
      for (const tx of tiles) {
        // Skip tiles already carrying this kind — but let the lobby brush
        // upgrade plain floor in place (the sky-lobby conversion).
        const existing = this.sim.tower.structureKindAt(floor, tx);
        if (existing === kind || (existing !== undefined && kind !== "lobby")) continue;
        if (this.sim.build(kind, floor, tx).ok) progress = true;
      }
    }
    this.paint = { tile, floor };
  }

  private paintFloorRun(kind: FacilityKind, tile: number, floor: number): void {
    const clampX = (x: number) => Math.max(0, Math.min(GRID.width - 1, x));
    if (!this.paint || this.paint.floor !== floor) {
      this.tryBuild(kind, floor, clampX(tile), true);
      this.paint = { tile, floor };
      return;
    }
    const step = tile >= this.paint.tile ? 1 : -1;
    for (let x = this.paint.tile + step; x !== tile + step; x += step) {
      this.tryBuild(kind, floor, clampX(x), true);
    }
    this.paint = { tile, floor };
  }

  /**
   * Shared player-removal gauntlet: burning and load-bearing units refuse —
   * with an error toast unless `quiet` (drag steps stay silent, like build
   * drags). Removes with the usual refund and returns true on success.
   */
  private tryRemoveUnit(u: Unit, verb: "sell" | "bulldoze", quiet = false): boolean {
    const blocked =
      u.state === "fire"
        ? `You can't ${verb} a burning unit — call fire rescue or let it burn out.`
        : this.sim.tower.removalReason(u.id);
    if (blocked) {
      if (!quiet) {
        this.audio.sfx("error");
        this.ui.toast(blocked, "bad");
      }
      return false;
    }
    this.sim.tower.removeUnit(u.id);
    // A gutted shell has no salvage value; everything else refunds half.
    this.sim.money += u.state === "gutted" ? 0 : resaleRefund(u.kind);
    return true;
  }

  /** Bulldoze whatever Excalibur reported under the pointer, with a refund.
   *  `quiet` suppresses blocked-removal feedback on the drag path, so sweeping
   *  across load-bearing floors doesn't machine-gun toasts and error sfx. */
  private bulldozePicked(p: Picked | null, quiet = false): void {
    if (!p) return;
    if (p.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === p.id);
      if (!u) return;
      if (!this.tryRemoveUnit(u, "bulldoze", quiet)) return;
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === p.id);
      if (!t) return;
      this.sim.tower.removeTransport(t.id);
      this.sim.money += resaleRefund(t.kind);
    }
    this.audio.sfx("sell");
    if (this.selected && this.selected.id === p.id) this.clearSelection();
  }

  private inspectPicked(p: Picked | null): void {
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      this.clearInspector();
      return;
    }
    if (this.inspectDismissed && this.inspectDismissed.type === p.type && this.inspectDismissed.id === p.id) {
      return; // ✕-dismissed and the pointer never left it — stay closed
    }
    this.inspectDismissed = null;
    if (p.type === "unit") {
      const u = this.sim.tower.units.find((x) => x.id === p.id);
      if (!u) {
        this.clearInspector();
        return;
      }
      this.inspectAnchor = { x: u.x + u.width, floor: u.floor + facilityFloors(u.kind) - 1 };
      this.inspectTarget = { type: p.type, id: p.id };
      const f = FACILITIES[u.kind];
      // Access — the whole truth, not just "served": a floor can be connected yet
      // sit 3+ rides from the lobby, in which case no commuter ever comes. Only
      // shown for units that actually draw commuters/visitors (tenants + venues);
      // parking/service work via ramp-chaining/coverage, not passenger trips, so
      // an access warning on them would be a false alarm.
      const needsAccess = f.population > 0 || ECON.dailyTrafficIncome[u.kind] !== undefined;
      const served = this.sim.tower.isFloorServed(u.floor);
      const access = !needsAccess
        ? ""
        : !served
          ? `<div style="color:var(--bad)">Access: not connected — no elevator or stair reaches this floor.</div>`
          : this.sim.floorReachable(u.floor)
            ? `<div style="color:var(--good)">Access: reachable (≤2 rides from the lobby).</div>`
            : `<div style="color:var(--bad)">Access: too far — 3+ rides from the lobby, so no one travels here. Add a sky-lobby transfer.</div>`;
      // Silent rule: hotel guests stop counting toward the star rating at 3★.
      const hotel = isHotelKind(u.kind)
        ? this.sim.hotelsCountTowardRating()
          ? `<div style="color:var(--good)">Counts toward next star: yes.</div>`
          : `<div style="color:var(--bad)">Counts toward stars: no — hotel guests stop counting at 3★ (they still earn income).</div>`
        : "";
      // Silent rule: a parking space only works when it chains to a ramp. Skip
      // the verdict while it's still building (or on fire) — "Status" covers that.
      const parking =
        u.kind === "parking" && isOperational(u)
          ? this.sim.tower.functionalParkingSet().has(u.id)
            ? `<div style="color:var(--good)">Ramp access: connected.</div>`
            : `<div style="color:var(--bad)">Ramp access: none — this space is dead (no relief). Chain it to a Parking Ramp.</div>`
          : "";
      this.ui.showInspector(
        `<h4>${f.name}</h4>` +
          `<div>${u.label !== f.name ? escapeHtml(u.label) + "<br>" : ""}${u.floor >= 1 ? "Floor " + u.floor : "B" + (1 - u.floor)}</div>` +
          `<div>Status: ${u.state}</div>` +
          (f.population ? `<div>Occupants: ${u.occupants}/${f.population}</div>` : "") +
          access +
          hotel +
          parking +
          `<div>Satisfaction: ${Math.round(u.satisfaction * 100)}%</div>`,
      );
    } else {
      const t = this.sim.tower.transports.find((x) => x.id === p.id);
      if (!t) {
        this.clearInspector();
        return;
      }
      this.inspectAnchor = { x: t.x + t.width, floor: t.top };
      this.inspectTarget = { type: p.type, id: p.id };
      const f = FACILITIES[t.kind];
      this.ui.showInspector(
        `<h4>${f.name}</h4><div>Serves floors ${floorTag(t.bottom)}–${floorTag(t.top)}</div>` +
          (isElevatorKind(t.kind) ? `<div>Cars: ${t.cars}</div>` : ""),
      );
    }
  }

  /** Hide the inspector and forget what it described. The pick moved off the
   *  facility, so any ✕-dismissal latch is spent too. */
  private clearInspector(): void {
    this.inspectAnchor = null;
    this.inspectTarget = null;
    this.inspectDismissed = null;
    this.ui.showInspector(null);
  }

  // ---- Save / load / new --------------------------------------------------

  /** Swap in a freshly loaded/created simulation and point the engine at it. */
  private adoptSim(sim: Simulation, preserveHistory = false): void {
    this.sim = sim;
    this.clearSelection();
    this.shownWin = false;
    this.lastStar = sim.star;
    this.accMinutes = 0;
    this.engine.setSim(sim);
    if (!preserveHistory) {
      // A *different* tower (New Tower / Load / a slot / Import) invalidates the
      // undo trail — otherwise Undo could resurrect an unrelated old tower and a
      // later autosave persist it. Undo/redo restores pass preserveHistory.
      this.history.clear();
    }
  }

  // ---- Undo / redo (state + logic live in engine/UndoHistory) -------------
  // Thin delegators kept so the many gesture call sites read unchanged.

  private captureUndo(label: string): void {
    this.history.capture(label);
  }

  private commitUndo(): void {
    this.history.commit();
  }

  private undo(): void {
    this.history.undo();
  }

  private redo(): void {
    this.history.redo();
  }

  private save(silent = false): void {
    SaveGame.save(this.sim);
    if (!silent) this.ui.toast("Tower saved.", "good");
  }

  /**
   * Called by the PWA layer the instant a new version is ready, just before it
   * reloads onto the new assets. Flush the tower to the autosave slot so the
   * imminent reload can't cost the player any progress, and tell them what's
   * happening through the existing toast rail.
   */
  onUpdateReady(): void {
    this.save(true);
    this.ui.toast("New version ready — saved your tower, updating…", "info");
  }

  /**
   * The WebGL context is gone and Excalibur can't rebuild its GPU resources in
   * place, so recovery is the same as a manual refresh: flush the tower to the
   * autosave slot, then reload onto a fresh context — automatically, so the
   * player never sees a dead screen. Two guards keep this safe:
   * - a sessionStorage timestamp stops a GPU that dies on every boot from
   *   reload-looping (second loss within 90s falls back to a manual card), and
   * - a hidden tab defers the reload until it's visible again, so we don't
   *   re-boot the renderer in the background just to have the GPU reap it anew.
   */
  private recoverFromContextLoss(): void {
    // Same guard as the autosave timer: never persist the throwaway boot sim
    // while the first-run splash is still up.
    if (!document.getElementById("splash")) this.save(true);

    const KEY = "vc-gl-lost-reload";
    let lastReload = 0;
    try {
      lastReload = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      /* storage may be unavailable; treat as first loss */
    }
    if (Date.now() - lastReload < 90_000) {
      // Auto-reload didn't stick — hand control back to the player.
      showBootMessage(
        "The graphics driver crashed twice in a row.<br>Your tower is saved — close other tabs or apps and try again.",
        true,
      );
      return;
    }

    const reload = () => {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* best effort */
      }
      location.reload();
    };
    if (document.visibilityState === "hidden") {
      document.addEventListener("visibilitychange", function onVis() {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVis);
          reload();
        }
      });
    } else {
      reload();
    }
  }
  private load(): void {
    const loaded = SaveGame.load();
    if (loaded) {
      this.adoptSim(loaded);
      this.ui.toast("Tower loaded.", "good");
    } else {
      this.ui.toast("No saved tower found.", "bad");
    }
  }
  private importGame(json: string): void {
    try {
      this.adoptSim(SaveGame.import(json));
      this.ui.toast("Tower imported.", "good");
    } catch (err) {
      this.ui.toast("Import failed: " + (err as Error).message, "bad");
    }
  }

  private importLegacy(buffer: ArrayBuffer, filename: string): void {
    try {
      const data = parseTWR(buffer);
      this.adoptSim(Simulation.deserialize(data));
      this.ui.toast("Imported original SimTower save.", "good");
    } catch (err) {
      // Expected today: the .TWR decoder is a planned v2 feature.
      this.ui.toast((err as Error).message, "info");
      void filename;
    }
  }
  private newGame(): void {
    this.adoptSim(Simulation.newGame(Date.now() & 0x7fffffff));
    this.ui.toast("New tower founded. Good luck!", "good");
    // Auto-arm onboarding only for a genuine first-timer. A returning player (a
    // save exists) is treated as already onboarded even if the localStorage flag
    // was cleared, so they're never re-onboarded unexpectedly (Replay via Help
    // still re-arms explicitly).
    if (shouldArm(true) && !SaveGame.hasSave()) this.onboarding.arm(this.sim);
  }
}

/** Short floor tag: "5" above ground, "B1"/"B2"… below (floor 0 = B1). */
function floorTag(floor: number): string {
  return floor >= 1 ? `${floor}` : `B${1 - floor}`;
}

/** The renderer needs WebGL; some in-app file viewers don't provide it. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function showBootMessage(msg: string, withReload = false): void {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif"><div>${msg}</div></div>`;
  if (withReload) {
    const btn = document.createElement("button");
    btn.textContent = "Reload";
    btn.style.cssText = "padding:8px 24px;font:inherit;cursor:pointer";
    btn.addEventListener("click", () => location.reload());
    stage.firstElementChild!.appendChild(btn);
  }
}

// Bootstrap once the DOM is ready.
if (typeof document !== "undefined") {
  const boot = () => {
    if (!hasWebGL()) {
      showBootMessage(
        "This viewer can't run WebGL, which Verticopolis needs to draw the tower.<br><br>Open this page in <b>Safari</b>, <b>Chrome</b>, or another full web browser to play.",
      );
      return;
    }
    try {
      const app = new GameApp();
      // Expose for screenshot tooling / debugging.
      (window as unknown as { game: GameApp }).game = app;
      // Register the service worker so the game is installable and offline-ready.
      // On a new build: quick-save the tower, then swap to the latest assets.
      registerPWA({ onUpdateReady: () => app.onUpdateReady() });
    } catch (err) {
      showBootMessage("Something went wrong starting the game: " + (err as Error).message);
      throw err;
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

export { GameApp };
