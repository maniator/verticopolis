import type { GameApp } from "../main";
import type { FacilityKind } from "../shared/types";
import { dragRemoves } from "./bulldozeDrag";
import { TowerEngine } from "../render/excalibur/TowerEngine";
import { catalogFacility } from "../catalog/catalogTypes";
import { snapX } from "../ui/placement";
import { classifyGesture, isPaintKind } from "./gesture";
import { placeSimpleBuild, isTransportTool, isPaintTool, updateBuildPreview, touchBuildLiftFloors, clearBuildRefusal } from "./buildPreview";
import { runFrame, SPEEDS } from "./frameLoop";
import { applyReducedMotion } from "./audioPrefs";
import { catalogOf, isUnlocked, quoteShaft } from "./portAccess";
import { noteFrameError } from "./frameErrors";
import { engineTrapped, noteEngineThrow } from "./engineFault";
import { appPlacementPaused, refuseAppPlacementWhilePaused } from "./pausedBuild";
import { pickPersonAt } from "../render/excalibur/personFocus";

/**
 * Engine wiring and post-context-loss engine rebuild, split out of the `GameApp`
 * class. All input/camera goes through Excalibur; these functions install the
 * controller hooks on `app.engine` and rebuild it after a WebGL context loss.
 * They reach `app` live per callback (never captured), so an `adoptSim` swap and
 * an engine rebuild stay visible. Behavior unchanged from the former methods.
 */

/** Close the gesture's undo step once the editor's commands it issued have
 *  been answered, or at once when it issued none, so the step holds their
 *  effect on any port. A rejected command skips the commit: the open capture
 *  is replaced by the next gesture's, so no half step is recorded, and the
 *  rejection is left unhandled for the error tracking (`analyticsErrors.ts`)
 *  to report. The promise is returned so a test can await the gesture. The
 *  build commands answer at once and close their own step above. */
function commitAfter(app: GameApp, pending: Promise<unknown> | null): Promise<void> | undefined {
  if (!pending) {
    app.commitUndo();
    return undefined;
  }
  return pending.then(() => app.commitUndo());
}

/** The gesture a build or bulldoze drag's press opened, and the tower it
 *  opened on. */
interface DragGesture {
  gesture: number;
  generation: number;
  /** The drag's paint run stopped because the game paused in a mode that
   *  refuses building while paused (#1936), and said so once. */
  pausedNoted?: boolean;
  /** The kind a bulldoze drag first touched (#644). Unless the Bulldoze card
   *  says a drag clears everything, the drag removes only this kind, so a
   *  sweep across a floor's tiles leaves the elevator it crosses. */
  bulldozes?: FacilityKind;
}

export function wireEngine(app: GameApp): void {
  // A drag changes the tower only inside the gesture its press opened. An
  // undo or a redo taken mid-drag closes that gesture, and so does another
  // gesture opened over it (keyboard play) or a tower swapped in; the engine
  // records an edit only while its gesture is open, so from then on the drag
  // stops changing the tower until its release.
  let drag: DragGesture | null = null;
  const dragActs = (): boolean =>
    drag !== null && app.undoGesture() === drag.gesture && app.enginePort.generation() === drag.generation;

  // Decide whether a press pans the camera or performs the active tool.
  // Pan vs act is pure routing in ./game/gesture (unit-tested). On touch a
  // paint tool (floor/lobby/parking) owns the one-finger drag so mobile can
  // paint a run; panning is via the inspect tool or a two-finger drag (which
  // also zooms). Before this, a floor/lobby/parking drag only ever panned on
  // touch, so mobile couldn't paint a run at all. On mouse the pan key
  // (Space or Shift, resolved in towerInputCamera) pans with any tool armed.
  // The pan key as the latest press went down, which its tap reads (#589).
  let pressPanKey = false;
  app.engine.classifyDown = (button, touch, panKey) => {
    pressPanKey = panKey;
    return classifyGesture(catalogOf(app), app.tool, button, touch, panKey);
  };
  // Space pans only while the game follows it (inputKeys), read per press.
  app.engine.spacePanKey = (press) => app.spacePanKey(press);

  // A press-without-drag: select (inspect) or, on touch, run the tool. The
  // picked entity resolves transports by collider hit-test and units by the
  // tower's grid lookup (pickEntityAt).
  app.engine.onTap = (tile, floor, touch, picked, world) => {
    app.audio.start();
    if (app.tool.type === "inspect") {
      // A tap or click on a walking figure opens their card (#2092); the
      // figure wins over the room behind it.
      const person = pickPersonAt(app.engine, world);
      if (person !== null) {
        app.clearSelection();
        if (app.personCard.open(person)) return;
      }
      // Touch has no hover stream, so mobile shows ONE panel: the tap opens
      // the editor, which folds in the inspector card's diagnostics on mobile
      // (see refreshEditor / templates/editor). The floating card stays a
      // desktop-hover affordance and is never raised on touch.
      app.selectPicked(picked);
      return;
    }
    if (!touch) return; // mouse pan-taps with a build/bulldoze tool do nothing
    // A held pan key (Space or Shift on a touchscreen laptop) promises the
    // press only pans, so its tap builds and bulldozes nothing either (#589).
    if (pressPanKey) return;
    // A mode that refuses building while paused (Classic, #1936) places nothing.
    if (app.tool.type === "build" && refuseAppPlacementWhilePaused(app)) return;
    app.captureUndo(app.tool.type === "bulldoze" ? "Bulldoze" : `Build ${catalogFacility(catalogOf(app), app.tool.kind).name}`);
    if (app.tool.type === "bulldoze") app.build.bulldozePicked(picked);
    else if (app.tool.type === "build") {
      // Touch taps land here for every simple placement, including the
      // stairway/escalator flight (classifyDown routes them through the
      // pan/tap gesture so a finger-down can still pan). Drag-sized shafts
      // return null, they never place on a tap.
      placeSimpleBuild(app, app.tool.kind, tile, floor);
    }
    // The command is answered, so the step holds its effect.
    app.commitUndo();
  };

  app.engine.onActionDown = (tile, floor, touch, picked) => {
    app.audio.start();
    app.keyboard.pointerDrew();
    // A fresh gesture: drop any anchor or run an earlier press left behind, so
    // a new paint drag never extends from an abandoned anchor across the gap.
    // A release or a cancel (onActionCancel) clears them too.
    app.paintAnchor = null;
    app.buildAnchor = null;
    app.build.clearPaint();
    drag = null;
    // A mode that refuses building while paused (Classic, #1936) places
    // nothing and opens no step; with no drag, the moves and the release that
    // follow place nothing either.
    if (app.tool.type === "build" && refuseAppPlacementWhilePaused(app)) return;
    if (app.tool.type === "bulldoze" || app.tool.type === "build") {
      app.captureUndo(app.tool.type === "bulldoze" ? "Bulldoze" : `Build ${catalogFacility(catalogOf(app), app.tool.kind).name}`);
      drag = { gesture: app.undoGesture(), generation: app.enginePort.generation() };
    }
    if (app.tool.type === "bulldoze") {
      if (picked && drag) drag.bulldozes = picked.kind;
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
      } else {
        // A drag-sized shaft anchors here; anything else places on the press.
        // A fresh anchor drops the ghost an earlier press left (a release the
        // canvas never saw), so this press builds only what it sizes.
        const placing = placeSimpleBuild(app, app.tool.kind, tile, floor);
        if (!placing) {
          app.transportStart = { x: snapX(catalogOf(app), app.tool.kind, tile), floor };
          app.engine.transportPreview = null;
        }
      }
    }
  };

  app.engine.onActionMove = (tile, floor, picked) => {
    // A drag whose gesture closed under it (an undo, a redo, another gesture,
    // a tower swapped in) builds nothing more, so it drops the anchors and
    // the ghosts of what its release would have built.
    if (drag !== null && !dragActs()) {
      app.paintAnchor = null;
      app.buildAnchor = null;
      app.transportStart = null;
      app.engine.preview = null;
      app.engine.transportPreview = null;
      return;
    }
    if (app.tool.type === "bulldoze") {
      if (!dragActs() || !picked || !drag) return;
      // A drag removes only the kind it first touched (#644), unless the
      // player picked Everything on the Bulldoze card.
      drag.bulldozes ??= picked.kind;
      if (dragRemoves(app.bulldozeDrag.clears, drag.bulldozes, picked.kind)) app.build.bulldozePicked(picked, true); // drag: blocked tiles fail silently
      return;
    }
    if (app.tool.type !== "build") return;
    const kind = app.tool.kind;
    if (isTransportTool(app) && app.transportStart) {
      const bottom = Math.min(app.transportStart.floor, floor);
      const top = Math.max(app.transportStart.floor, floor);
      const x = app.transportStart.x;
      const valid = quoteShaft(app.enginePort, app.portCodes, kind, x, bottom, top).ok && isUnlocked(app, kind);
      app.engine.transportPreview = { kind, x, bottom, top, valid };
      app.engine.preview = null;
    } else if (isPaintKind(kind)) {
      if (!dragActs()) return;
      // A run begun while the clock ran stops laying once the game pauses
      // in a mode that refuses building while paused (#1936), and says why
      // once for the drag.
      if (drag && appPlacementPaused(app)) {
        if (!drag.pausedNoted) refuseAppPlacementWhilePaused(app);
        drag.pausedNoted = true;
        return;
      }
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
    // A drag begun while the clock ran and released after a pause commits
    // nothing in a mode that refuses building while paused (#1936); the
    // release says why once.
    const pending = app.tool.type === "build" && (app.paintAnchor !== null || app.buildAnchor !== null || app.transportStart !== null);
    // A drag whose moves already said why stays refused without a second note.
    const refused = pending && dragActs() && (drag?.pausedNoted ? appPlacementPaused(app) : refuseAppPlacementWhilePaused(app));
    const acts = dragActs() && !refused;
    // Another gesture opened over the drag is that gesture's to close.
    const closes = drag === null || app.undoGesture() === drag.gesture;
    drag = null;
    // A deferred touch paint that never moved is a TAP: lay the same brush
    // strip a desktop click lays (a drag already laid its run via
    // onActionMove and cleared the anchor).
    if (app.paintAnchor) {
      if (acts && app.tool.type === "build") app.build.seedPaint(app.tool.kind, app.paintAnchor.tile, app.paintAnchor.floor);
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
      if (acts && valid && app.tool.type === "build") placeSimpleBuild(app, app.tool.kind, a.tile, a.floor);
    }
    app.build.clearPaint();
    // Only drag-sized transports (elevators) commit on release. Stairs and
    // escalators already placed on the DOWN event, and their hover ghost
    // also lives in transportPreview, treating it as a drag commit here
    // would double-place on every desktop click.
    if (app.tool.type === "build" && isTransportTool(app) && !catalogFacility(catalogOf(app), app.tool.kind).fixedSpan) {
      const tp = app.engine.transportPreview;
      if (tp) {
        // The helper explains failures (invalid spot, not enough money)
        // instead of failing silently.
        if (acts) app.build.tryBuildTransport(tp.kind, tp.x, tp.bottom, tp.top);
        app.engine.transportPreview = null;
      } else if (app.transportStart && !refused) {
        // Pressed without dragging, teach the drag-to-size gesture.
        app.ui.toast(`Drag up or down to set the ${catalogFacility(catalogOf(app), app.tool.kind).name.toLowerCase()}'s height.`, "info");
      }
    }
    app.transportStart = null;
    // Every command this release issued is answered, so the step holds them.
    if (closes) app.commitUndo();
  };

  // The press was cut off without a release (a second finger turned it into
  // a pinch, or the browser canceled the pointer): close the step its drag
  // built so far, as a release would, and drop the anchors, the run and the
  // ghosts it left, so a later press that never moves builds no stale shaft.
  // Nothing is placed.
  app.engine.onActionCancel = () => {
    const closes = drag === null || app.undoGesture() === drag.gesture;
    drag = null;
    app.paintAnchor = null;
    app.buildAnchor = null;
    app.transportStart = null;
    app.engine.preview = null;
    app.engine.transportPreview = null;
    app.build.clearPaint();
    if (closes) app.commitUndo();
  };

  app.engine.onHover = (tile, floor, picked) => {
    app.keyboard.pointerDrew();
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
    // act on the tap, which the peek also swallows. So the discarded gesture
    // changed nothing and leaves no step (time passing during the hold is
    // never part of one).
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
    // A deliberate hold is fresh intent, same as a tap: spend the ✕-dismissal
    // latch through the seam selectPicked uses, so a hybrid device's dismissed
    // hover card cannot eat the peek (#696). Hover picks alone never spend it.
    app.inspector.resetLatch();
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
    // An undo, a redo or another gesture that ended the drag closed its step.
    if (!app.editor.endExtend()) return undefined;
    return commitAfter(app, null);
  };
  // Suppress the browser context menu so right-click is ours to use.
  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // A thrown frame must NEVER escape to Excalibur: its game loop calls
  // stop() on any uncaught exception, which freezes the whole game dead
  // (seen at high speed, where far more sim work runs per frame). Contain it
  // so a transient error skips one frame instead of halting play.
  const onFrameThrow = (err: unknown): void => {
    // A trap in the Rust engine stops the game, which logs it
    // (engineFault.ts), and the scene stops reading the engine: a trap in a
    // command or a save surfaces here as the next frame's first read. Any
    // other throw is logged at most once per two seconds per source, to the
    // console and the crash report's ring buffer, so a per-frame throw can't
    // spam either (game/frameErrors.ts has the window's rules).
    if (noteEngineThrow(err) || engineTrapped()) app.engine.halted = true;
    else noteFrameError(app, err);
  };
  // A renderer rebuilt after a trap never reads the engine either.
  app.engine.halted = engineTrapped();
  app.engine.onFrameError = onFrameThrow;
  // Per-frame: advance the sim and (throttled) refresh DOM/audio. Caught here
  // too, so a throw in the step still lets the scene sync run.
  app.engine.onUpdate = (ms) => {
    try {
      runFrame(app, ms);
    } catch (err) {
      onFrameThrow(err);
    }
  };

  // The GPU dropped the WebGL context (mobile browsers reset it under memory
  // pressure / after backgrounding). Recover for the player instead of
  // Excalibur's dead-end "please refresh the page" card.
  app.engine.onContextLost = () => app.saveLoad.recoverFromContextLoss();
}

/** Drop the app's half of a gesture its pointer can no longer finish: a lost
 *  canvas took the release with it, or the tower changed under the press (a
 *  swap, or an undo or redo step), which resets the engine's input, so the
 *  release never reaches `onActionUp`. A stale `transportStart` suppresses the
 *  update prompt session-long, and a stale paint or build anchor would place
 *  on a later tap or extend the next touch drag across the gap. The refusal
 *  card a refused drag raised goes too, latch first: hiding the shared card
 *  leaves `buildRefusalShowing` set, and a leaked latch offsets the next
 *  card's anchor a floor down (panelAnchoring reads it). */
export function dropSeveredGesture(app: GameApp): void {
  app.paintAnchor = null;
  app.buildAnchor = null;
  app.transportStart = null;
  app.build.clearPaint();
  clearBuildRefusal(app);
}

/**
 * Swap in a fresh renderer after a WebGL context loss, once the browser has
 * restored GPU access (see attemptContextRecovery). The simulation and the
 * whole DOM shell stay put; only the Excalibur engine and its canvas are
 * replaced. Resolves when the new engine is running with the player's
 * camera, selection, speed and motion prefs carried over.
 */
export function rebuildEngine(app: GameApp): Promise<void> {
  // Read the CPU-side view state before tearing the old engine down.
  // viewState always stamps zoom; the default only satisfies the save
  // schema's optional field (a TDT import carries no zoom).
  const { tile, floor, zoom = 0.9 } = app.engine.viewState();
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
  // died with it). This releases the refusal card's latch before the
  // blanket hide below.
  dropSeveredGesture(app);
  app.inspector.hide(); // drop a peek card the severed touch can no longer dismiss
  app.commitUndo(); // close the severed gesture's pending capture (no-op when clean)
  app.canvas = fresh;
  app.engine = new TowerEngine(fresh, app.renderSim, app.reader);
  if (!app.engine.rendersWithWebGL()) {
    // Excalibur silently fell back to Canvas2D: the GPU is still wedged.
    // That mode is degraded AND blind to further context losses, so treat
    // it as a failed recovery (the crash screen path takes over).
    app.engine.dispose();
    throw new Error("webgl unavailable after context restore");
  }
  wireEngine(app);
  // The fresh renderer starts with no ghost; one the keyboard drew comes back.
  app.keyboard.followTower("same tower");
  applyReducedMotion(app);
  app.engine.paused = SPEEDS[app.speed] === 0;
  app.engine.selectedId = app.selected?.id ?? null;
  return app.engine.start().then(() => {
    // start() adopted the sim's saved view (stamped by the pre-crash
    // flush); re-apply the live camera exactly so the player can't tell
    // the renderer changed.
    app.engine.setCamera(tile, floor, zoom);
  });
}
