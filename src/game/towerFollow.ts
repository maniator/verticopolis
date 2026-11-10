import type { GameApp } from "../main";
import { dropSeveredGesture } from "./engineWiring";
import { noteTowerSwap } from "./engineFault";
import { hudSource } from "./hudSource";
import { touchOverviewMap } from "./overviewMapWiring";
import { newRenderSim } from "./portAccess";

/** How the app follows the tower the engine holds now. A `"swap"` (a load, a new tower, an
 *  import, a tooling swap) is another tower. A `"restore"` (a tooling harness's tower) is too,
 *  but keeps the view. A `"step"` (an undo or redo step) changed the tower the renderer
 *  already draws. */
export type TowerFollow = "swap" | "restore" | "step";

/** `GameApp.followSwap`. Another tower drops what belonged to the old one, points the view
 *  and the renderer at the new one and starts the view over (the camera, the title screen,
 *  the traffic chip); a restore keeps the view. A step keeps the view, the scene and that
 *  tower's latches. */
export function followEngineTower(app: GameApp, follow: TowerFollow): void {
  const startsOver = follow !== "restore" && follow !== "step";
  app.clearSelection();
  dropSeveredGesture(app);
  // Facility ids restart in a fresh tower, so a stale ✕-latch (or anchor) would mute the
  // inspector on a facility that reuses the id. A step clears it too, for now: #1802 keeps a
  // selection the step leaves.
  app.inspector.clear();
  // Getting Started and the engine's trap report follow the swap too.
  app.onboarding.adoptSim(app.enginePort, !startsOver);
  noteTowerSwap(!startsOver);
  // Another tower starts its win, meal-rush and owed-minute latches over, and drops the crash
  // report's entries (a report pairs them with the current tower's save). A step keeps them:
  // it is the same tower, and time does not go back.
  if (follow !== "step") {
    app.shownWin = false;
    app.accMinutes = 0;
    app.lastMealRushDay = { breakfast: -1, lunch: -1, dinner: -1 };
    app.frameErrors.length = 0;
  }
  // Read the swapped-in tower now, before the renderer takes it.
  const drawn = app.reader.tower.revision;
  app.reader.update();
  app.lastStar = app.reader.header.star;
  // A step keeps the scene, whose syncs follow the revision the step raised, as after an
  // edit. One that did not raise it (the TypeScript reference engine's) rebuilds it instead,
  // under the same camera. Any other tower gets a new render view, since the renderer's
  // caches (the scenery seed, walker reach) key on the sim it draws.
  if (follow === "step" && app.reader.tower.revision > drawn) app.engine.followStep();
  else {
    app.renderSim = newRenderSim(app.enginePort, app.reader);
    app.engine.setSim(app.renderSim, { keepCamera: !startsOver });
  }
  // Let the keyboard cursor follow (its ghost, an anchor from another tower), rebase the UI
  // log cursor so old entries don't replay as toasts, and refresh the palette's star level.
  app.keyboard.followTower(follow === "step" ? "same tower" : "another tower");
  app.ui.resetLog(hudSource(app));
  app.ui.update(hudSource(app));
  if (startsOver) app.lastTrafficTier = 0; // the chip's hysteresis starts over on another tower
  // The Map's Eval and Pricing views read the new tower's tiers on their next open frame.
  touchOverviewMap(app);
}
