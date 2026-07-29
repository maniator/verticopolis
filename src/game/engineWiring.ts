import type { GameApp } from "../main";
import { TowerEngine } from "../render/excalibur/TowerEngine";
import { FACILITIES, isFixedSpanTransport } from "../engine/facilities";
import { snapX } from "../ui/placement";
import { classifyGesture, isPaintKind } from "./gesture";
import { placeSimpleBuild, isTransportTool, isPaintTool, updateBuildPreview, touchBuildLiftFloors, clearBuildRefusal } from "./buildPreview";
import { runFrame, SPEEDS } from "./frameLoop";
import { applyReducedMotion } from "./audioPrefs";

/**
 * Engine wiring and post-context-loss engine rebuild, split out of the `GameApp`
 * class. All input/camera goes through Excalibur; these functions install the
 * controller hooks on `app.engine` and rebuild it after a WebGL context loss.
 * They reach `app` live per callback (never captured), so an `adoptSim` swap and
 * an engine rebuild stay visible. Behavior unchanged from the former methods.
 */

/** Ring-buffer depth for tick-guard failures included in a crash report. */
const MAX_FRAME_ERRORS = 5;

export function wireEngine(app: GameApp): void {
  // Decide whether a press pans the camera or performs the active tool.
  // Pan vs act is pure routing in ./game/gesture (unit-tested). On touch a
  // paint tool (floor/lobby/parking) owns the one-finger drag so mobile can
  // paint a run; panning is via the inspect tool or a two-finger drag (which
  // also zooms). Before this, a floor/lobby/parking drag only ever panned on
  // touch, so mobile couldn't paint a run at all. On mouse the pan key
  // (Space or Shift, resolved in towerInputCamera) pans with any tool armed.
  app.engine.classifyDown = (button, touch, panKey) => classifyGesture(app.tool, button, touch, panKey);

  // A press-without-drag: select (inspect) or, on touch, run the tool. The
  // picked entity resolves transports by collider hit-test and units by the
  // tower's grid lookup (pickEntityAt).
  app.engine.onTap = (tile, floor, touch, picked) => {
    app.audio.start();
    if (app.tool.type === "inspect") {
      // Touch has no hover stream, so mobile shows ONE panel: the tap opens
      // the editor, which folds in the inspector card's diagnostics on mobile
      // (see refreshEditor / templates/editor). The floating card stays a
      // desktop-hover affordance and is never raised on touch.
      app.selectPicked(picked);
      return;
    }
    if (!touch) return; // mouse pan-taps with a build/bulldoze tool do nothing
    app.captureUndo(app.tool.type === "bulldoze" ? "Bulldoze" : `Build ${FACILITIES[app.tool.kind].name}`);
    if (app.tool.type === "bulldoze") app.build.bulldozePicked(picked);
    else if (app.tool.type === "build") {
      // Touch taps land here for every simple placement, including the
      // stairway/escalator flight (classifyDown routes them through the
      // pan/tap gesture so a finger-down can still pan). Drag-sized shafts
      // return null, they never place on a tap.
      placeSimpleBuild(app, app.tool.kind, tile, floor);
    }
    app.commitUndo();
  };

  app.engine.onActionDown = (tile, floor, touch, picked) => {
    app.audio.start();
    // A fresh gesture: drop any anchor/run a cancelled pinch left behind. The
    // pinch-cancel path skips onActionUp (which clears these), so without this
    // a resumed paint drag would extend from the abandoned anchor across the gap.
    app.paintAnchor = null;
    app.buildAnchor = null;
    app.build.clearPaint();
    if (app.tool.type === "bulldoze" || app.tool.type === "build") {
      app.captureUndo(app.tool.type === "bulldoze" ? "Bulldoze" : `Build ${FACILITIES[app.tool.kind].name}`);
    }
    if (app.tool.type === "bulldoze") {
      app.build.bulldozePicked(picked);
    } else if (app.tool.type === "build") {
      // Simple placements (strip paint, two-floor flight, room) happen on
      // the press; a drag-sized shaft instead anchors here and sizes with
      // the drag. A TOUCH paint tool defers to move/up (see paintAnchor) so a
      // two-finger pan/zoom never drops a paid-for strip on its first finger.
      if (touch && isPaintTool(app)) {
        app.paintAnchor = { tile, floor };
      } else if (touch && !isTransportTool(app)) {
        // Touch ROOM build: defer to the release. Preview at the FINGER on the
        // press so a precise tap places exactly there; the lift only engages once
        // you drag (onActionMove), floating the ghost above the thumb to aim.
        app.buildAnchor = { tile, floor, oTile: tile, oFloor: floor, lifting: false };
        updateBuildPreview(app, tile, floor, false); // false: red ghost carries validity, no DOM reason card on touch
      } else if (placeSimpleBuild(app, app.tool.kind, tile, floor) === null) {
        app.transportStart = { x: snapX(app.tool.kind, tile), floor };
      }
    }
  };

  app.engine.onActionMove = (tile, floor, picked) => {
    if (app.tool.type === "bulldoze") {
      app.build.bulldozePicked(picked, true); // drag: blocked tiles fail silently
      return;
    }
    if (app.tool.type !== "build") return;
    const kind = app.tool.kind;
    if (isTransportTool(app) && app.transportStart) {
      const bottom = Math.min(app.transportStart.floor, floor);
      const top = Math.max(app.transportStart.floor, floor);
      const x = app.transportStart.x;
      const valid = app.sim.tower.placeTransportDryRun(kind, x, bottom, top) && app.sim.isUnlocked(kind);
      app.engine.transportPreview = { kind, x, bottom, top, valid };
      app.engine.preview = null;
    } else if (isPaintKind(kind)) {
      if (app.paintAnchor) {
        // First move of a deferred touch paint: stamp the same brush strip a
        // desktop press lays at the press point, then extend from it.
        app.build.seedPaint(kind, app.paintAnchor.tile, app.paintAnchor.floor);
        app.paintAnchor = null;
      }
      // For a wide unit (parking) each tile-step re-attempts a build; overlaps
      // fail silently, so successful placements land flush → a contiguous chain.
      app.build.paintFloorRun(kind, tile, floor);
    } else if (app.buildAnchor) {
      // Touch room-build drag. The lift latches once this is a deliberate drag
      // (moved to a different floor, or a couple of tiles across), not a tap's
      // jitter; once lifted, the ghost floats above the finger to aim. Nothing
      // places until release.
      const a = app.buildAnchor;
      const lifting = a.lifting || floor !== a.oFloor || Math.abs(tile - a.oTile) >= 2;
      const target = lifting ? floor + touchBuildLiftFloors(app) : floor;
      app.buildAnchor = { tile, floor: target, oTile: a.oTile, oFloor: a.oFloor, lifting };
      updateBuildPreview(app, tile, target, false);
    }
  };

  app.engine.onActionUp = () => {
    // A deferred touch paint that never moved is a TAP: lay the same brush
    // strip a desktop click lays (a drag already laid its run via
    // onActionMove and cleared the anchor).
    if (app.paintAnchor) {
      if (app.tool.type === "build") app.build.seedPaint(app.tool.kind, app.paintAnchor.tile, app.paintAnchor.floor);
      app.paintAnchor = null;
    }
    // Touch room-build release: commit the room where the ghost sits (the lifted
    // anchor), only if the preview was valid: releasing over a red spot cancels,
    // the ghost was the warning, so no failure toast. Then clear the ghost.
    if (app.buildAnchor) {
      const a = app.buildAnchor;
      const valid = app.engine.preview?.valid ?? false;
      app.buildAnchor = null;
      app.engine.preview = null;
      if (valid && app.tool.type === "build") placeSimpleBuild(app, app.tool.kind, a.tile, a.floor);
    }
    app.build.clearPaint();
    // Only drag-sized transports (elevators) commit on release. Stairs and
    // escalators already placed on the DOWN event, and their hover ghost
    // also lives in transportPreview, treating it as a drag commit here
    // would double-place on every desktop click.
    if (app.tool.type === "build" && isTransportTool(app) && !isFixedSpanTransport(app.tool.kind)) {
      const tp = app.engine.transportPreview;
      if (tp) {
        // The helper explains failures (invalid spot, not enough money)
        // instead of failing silently.
        app.build.tryBuildTransport(tp.kind, tp.x, tp.bottom, tp.top);
        app.engine.transportPreview = null;
      } else if (app.transportStart) {
        // Pressed without dragging, teach the drag-to-size gesture.
        app.ui.toast(`Drag up or down to set the ${FACILITIES[app.tool.kind].name.toLowerCase()}'s height.`, "info");
      }
    }
    app.transportStart = null;
    app.commitUndo();
  };

  app.engine.onHover = (tile, floor, picked) => {
    if (app.tool.type === "build") {
      updateBuildPreview(app, tile, floor);
    } else {
      app.engine.preview = null;
      app.engine.transportPreview = null;
      // The floating card is a desktop affordance only: on a phone-width
      // viewport we show ONE panel (the editor, with diagnostics folded in),
      // so a hybrid mouse+touch device never raises the card there either.
      if (app.tool.type === "inspect" && !app.mobileMq.matches) app.inspector.inspectPicked(picked);
    }
  };

  // Touch long-press: peek the facility under the finger, the touch equivalent
  // of desktop hover-inspect. A held finger raises the same inspector card a
  // mouse hover does; lifting dismisses it, while a quick tap still opens the
  // editor. The card anchors to its facility on every tier (panelAnchoring pins
  // the inspector card on mobile too), so the peek tracks the room like a hover.
  app.engine.onLongPress = (_tile, _floor, picked) => {
    // A peek is a glance, never a placement: drop any pending touch build/paint
    // gesture so the release commits nothing, and DISCARD any pending undo
    // capture. Nothing legitimate can be pending here: on touch, only build
    // tools capture at the press (onActionDown), and their mutations happen at
    // the release the peek swallows; bulldoze and inspect are pan gestures that
    // act on the tap, which the peek also swallows. A commit instead would mint
    // a bogus entry whenever a sim income tick moved money during the 450ms
    // hold (money is in the signature), or resurrect a stale capture a
    // pinch-canceled gesture left behind (pinch-start skips onActionUp).
    app.paintAnchor = null;
    app.buildAnchor = null;
    app.transportStart = null;
    app.engine.preview = null;
    app.engine.transportPreview = null;
    app.build.clearPaint();
    app.discardUndo();
    // Release the build-refusal card's ownership of the shared inspector surface
    // before the peek borrows it, so a hover-tier refusal card (hybrid touch +
    // mouse device) can't leave buildRefusalShowing stale. No-op on pure touch.
    clearBuildRefusal(app);
    // Reuse the hover inspector card (unit or transport). armLongPress only fires
    // over a real facility; a null/floor/lobby pick reaching here anyway just
    // hides the card (inspectPicked's own guard, pinned by the wiring test).
    // Mark it a peek so the card is exactly the desktop hover tooltip (no manual
    // ✕: lifting the finger dismisses it, like mouse-away on desktop).
    app.inspector.inspectPicked(picked);
    app.ui.setInspectorPeek(true);
  };
  app.engine.onLongPressEnd = () => app.inspector.hide();

  // Right-click inspects whatever's under the cursor, whatever tool is held.
  app.engine.onSecondary = (picked) => app.selectPicked(picked);
  // In-world extend arrows on the selected elevator: drag an end to grow or
  // shrink the shaft floor-by-floor.
  app.engine.onExtendTo = (end, target) => app.editor.extendSelectedTo(end, target);
  app.engine.onExtendEnd = () => {
    app.editor.endExtend();
    app.commitUndo();
  };
  // Suppress the browser context menu so right-click is ours to use.
  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Per-frame: advance the sim and (throttled) refresh DOM/audio.
  app.engine.onUpdate = (ms) => {
    // A thrown frame must NEVER escape to Excalibur: its game loop calls
    // stop() on any uncaught exception, which freezes the whole game dead
    // (seen at high speed, where far more sim work runs per frame). Contain it
    // here so a transient error skips one frame instead of halting play.
    try {
      runFrame(app, ms);
    } catch (err) {
      // Throttle the log so a per-frame throw can't spam the console at
      // frame-rate (which would itself tank performance).
      const now = globalThis.performance ? performance.now() : 0;
      if (now - app.lastTickErrorLog > 2000) {
        app.lastTickErrorLog = now;
        console.error("[tick] frame error, continuing:", err);
        // Same throttle for the crash-report ring buffer: a repeating throw
        // records one entry per window, not one per frame.
        app.frameErrors.push({
          at: new Date().toISOString(),
          message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.trim() : String(err),
        });
        if (app.frameErrors.length > MAX_FRAME_ERRORS) app.frameErrors.shift();
      }
    }
  };

  // The GPU dropped the WebGL context (mobile browsers reset it under memory
  // pressure / after backgrounding). Recover for the player instead of
  // Excalibur's dead-end "please refresh the page" card.
  app.engine.onContextLost = () => app.saveLoad.recoverFromContextLoss();
}

/**
 * Swap in a fresh renderer after a WebGL context loss, once the browser has
 * restored GPU access (see attemptContextRecovery). The simulation and the
 * whole DOM shell stay put; only the Excalibur engine and its canvas are
 * replaced. Resolves when the new engine is running with the player's
 * camera, selection, overlay, speed and motion prefs carried over.
 */
export function rebuildEngine(app: GameApp): Promise<void> {
  // Read the CPU-side view state before tearing the old engine down.
  // viewState always stamps zoom; the default only satisfies the save
  // schema's optional field (a TDT import carries no zoom).
  const { tile, floor, zoom = 0.9 } = app.engine.viewState();
  const overlay = app.engine.overlayMode;
  // Silence the dying engine BEFORE dispose: its canvas can outlive the
  // swap (a detached canvas keeps its restored GL context), and a later
  // eviction of that zombie context would otherwise fire onContextLost and
  // throw a crash screen over a perfectly healthy rebuilt game.
  const old = app.engine;
  old.onContextLost = null;
  old.onContextRestored = null;
  old.dispose();
  // A canvas whose WebGL context was lost hands the same dead context back
  // from getContext() forever, so the rebuild needs a fresh element.
  // cloneNode copies the id and attributes but no listeners; wireEngine
  // re-binds ours below, and the old element's listeners die with it.
  const oldCanvas = app.canvas;
  const fresh = oldCanvas.cloneNode(false) as HTMLCanvasElement;
  oldCanvas.replaceWith(fresh);
  // Release the zombie context's GPU hold. The restore that triggered this
  // rebuild revived the OLD context too; explicitly losing it frees its
  // GPU memory now and keeps recovered sessions from creeping toward the
  // browser's per-page context cap. An extension-forced loss never
  // auto-restores, and the engine's hooks were nulled above, so this can't
  // re-enter the recovery flow.
  try {
    // A lost canvas hands back whichever context type it was created with, so
    // probe WebGL2 then WebGL1 to free the GPU hold regardless of which the
    // engine was running on.
    const dead =
      (oldCanvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (oldCanvas.getContext("webgl") as WebGLRenderingContext | null);
    dead?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* best effort; some drivers refuse the extension */
  }
  // The loss severed any in-flight gesture (the old canvas's pointerup
  // died with it), so drop gesture state that would otherwise linger: a
  // stale transportStart suppresses the update prompt session-long, and a
  // stale paint anchor would extend the next touch drag across the gap.
  app.paintAnchor = null;
  app.buildAnchor = null;
  app.transportStart = null;
  app.build.clearPaint();
  // Release the refusal card's ownership latch BEFORE the blanket hide: hide()
  // clears the shared card but not buildRefusalShowing, and a leaked latch
  // offsets the next card's anchor a floor down (panelAnchoring reads it).
  clearBuildRefusal(app);
  app.inspector.hide(); // drop a peek card the severed touch can no longer dismiss
  app.commitUndo(); // close the severed gesture's pending capture (no-op when clean)
  app.canvas = fresh;
  app.engine = new TowerEngine(fresh, app.sim);
  if (!app.engine.rendersWithWebGL()) {
    // Excalibur silently fell back to Canvas2D: the GPU is still wedged.
    // That mode is degraded AND blind to further context losses, so treat
    // it as a failed recovery (the crash screen path takes over).
    app.engine.dispose();
    throw new Error("webgl unavailable after context restore");
  }
  wireEngine(app);
  applyReducedMotion(app);
  app.engine.paused = SPEEDS[app.speed] === 0;
  app.engine.overlayMode = overlay;
  app.engine.selectedId = app.selected?.id ?? null;
  return app.engine.start().then(() => {
    // start() adopted the sim's saved view (stamped by the pre-crash
    // flush); re-apply the live camera exactly so the player can't tell
    // the renderer changed.
    app.engine.setCamera(tile, floor, zoom);
  });
}
