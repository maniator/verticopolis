import type { GameApp } from "../main";
import { arrivalLine } from "./arrivalLine";
import { dropSeveredGesture } from "./engineWiring";
import { noteTowerSwap } from "./engineFault";
import { hudSource } from "./hudSource";
import { showTower } from "../ui/uiStatus";
import { touchOverviewMap } from "./overviewMapWiring";
import { newRenderSim } from "./portAccess";
import { forgetCurrentFile } from "./currentFile";
import { nextAnalyticsTower } from "../analyticsTower";

/** How the app follows the tower the engine holds now. A `"swap"` (a load, a new tower, an
 *  import, a tooling swap) is another tower. A `"restore"` (a tooling harness's tower) is too,
 *  but keeps the view. A `"step"` (an undo or redo step) changed the tower the renderer
 *  already draws, as an edit does. */
export type TowerFollow = "swap" | "restore" | "step";

/** `GameApp.followSwap`. Another tower drops what belonged to the old one, points the view
 *  and the renderer at the new one and starts the view over (the camera, the title screen,
 *  the traffic chip); a restore keeps the view. A step keeps the view, the scene and that
 *  tower's latches. */
export function followEngineTower(app: GameApp, follow: TowerFollow): void {
  if (follow === "step") {
    followStep(app);
    return;
  }
  const startsOver = follow !== "restore";
  app.clearSelection();
  dropSeveredGesture(app);
  // Facility ids restart in a fresh tower, so a stale ✕-latch (or anchor) would mute the
  // inspector on a facility that reuses the id.
  app.inspector.clear();
  // Getting Started and the engine's trap report follow the swap too.
  app.onboarding.adoptSim(app.enginePort, !startsOver);
  noteTowerSwap(!startsOver);
  // Another tower starts its win and owed-minute latches over, and drops the crash
  // report's entries (a report pairs them with the current tower's save).
  // Later first-tower funnel events belong to this tower (#2392).
  nextAnalyticsTower();
  // The elevator schedule review mentions this tower once, as it did the last (#1556).
  app.scheduleReview.towerArrived();
  // It is not the My Towers file the last tower was: File > Save writes
  // only the Auto-save until it is opened from or saved to one.
  forgetCurrentFile();
  // A tower that arrives already rated TOWER was congratulated where it was
  // won, so a load does not open the congratulations again (#1134). Only a
  // win the player sees happen here opens them.
  app.shownWin = app.enginePort.evaluatedTower();
  app.winHeldUntil = -Infinity;
  app.accMinutes = 0;
  app.frameErrors.length = 0;
  // Read the swapped-in tower now, before the renderer takes it.
  app.reader.update();
  app.lastStar = app.reader.header.star;
  // A box not yet shown belongs to the tower it was earned in.
  app.pendingStarUp = null;
  // Another tower gets a new render view, since the renderer's caches (the scenery seed,
  // walker reach) key on the sim it draws; a restore keeps the camera.
  app.renderSim = newRenderSim(app.enginePort, app.reader);
  app.engine.setSim(app.renderSim, { keepCamera: !startsOver });
  // Let the keyboard cursor follow (its ghost, an anchor from another tower), rebase the UI
  // log cursor so old entries don't replay as toasts, and refresh the palette's star level.
  app.keyboard.followTower("another tower");
  // A load, an import or a new tower opens its Bulletin with the game's own
  // first line; a tooling restore keeps the log as it is.
  showTower(app.ui, hudSource(app), follow === "swap" ? arrivalLine(app.reader, "entered") : undefined);
  if (startsOver) app.lastTrafficTier = 0; // the chip's hysteresis starts over on another tower
  // The Map's Eval and Pricing views read the new tower's tiers on their next open frame.
  touchOverviewMap(app);
}

/** An undo or redo step: the same tower, changed as an edit changes it (#1802). The engine
 *  keeps its generation, so the reader follows the step from the next frame and keeps every
 *  room and person object it still holds. The selection, the inspector card and its ✕-latch
 *  stay unless the step took their facility away, and the scene, the latches, the log and the
 *  camera stay too. */
function followStep(app: GameApp): void {
  dropSeveredGesture(app);
  // Getting Started and the engine's trap report read the stepped tower.
  app.onboarding.adoptSim(app.enginePort, true);
  noteTowerSwap(true);
  const drawn = app.reader.tower.revision;
  app.reader.update();
  app.lastStar = app.reader.header.star;
  // A box not yet shown belongs to the step it was earned in.
  app.pendingStarUp = null;
  const stands = (picked: { type: "unit" | "transport"; id: number }): boolean =>
    picked.type === "unit"
      ? app.reader.tower.getUnit(picked.id) !== undefined
      : app.reader.tower.getTransport(picked.id) !== undefined;
  // A person's card can name a room the step took away, so it closes either way.
  app.personCard?.close();
  if (app.selected && !stands(app.selected)) app.clearSelection();
  else if (app.selected) app.refreshEditor();
  app.inspector.followStep(stands);
  // The scene's syncs follow the revision a step that moved rooms or shafts raised, as after a
  // build. A step that put back only settings (a name, a rent) raised none and needs no sync:
  // names reach the rooms through the reader's meta read.
  if (app.reader.tower.revision > drawn) app.engine.followStep();
  app.keyboard.followTower("same tower");
  // The step keeps the log as it is.
  showTower(app.ui, hudSource(app), undefined);
  touchOverviewMap(app);
}
