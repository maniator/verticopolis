import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { statsReport } from "../simport/statsSheet";
import { starUpScreen } from "../ui/templates/starUp";
import { showStarUp } from "../ui/uiStarUp";
import { dialogHoldsWork, hasBlockingModal } from "./interactionState";
import { catalogOf } from "./portAccess";

/** The highest rating the star-up box announces: the TOWER (6) has its own
 *  congratulations. */
const LAST_ANNOUNCED_STAR = 5;

/**
 * The star-up message box's latch. A climb is noted the frame it happens
 * (`noteStarUp`), and the box opens on the first calm frame after it
 * (`maybeShowStarUp`): not over the title screen, an emergency or the update
 * prompt, and not over a dialog that holds the player's work. Two climbs
 * before it opens make one box, from the lower rating to the higher.
 */
export function noteStarUp(app: GameApp, from: number, to: number): void {
  const top = Math.min(to, LAST_ANNOUNCED_STAR);
  if (top <= from) return;
  app.pendingStarUp = { from: app.pendingStarUp?.from ?? from, to: top };
}

/** Open the box when one is waiting and the way is clear. */
export function maybeShowStarUp(app: GameApp, splashUp: boolean): void {
  const climb = app.pendingStarUp;
  if (!climb || splashUp || hasBlockingModal(app) || dialogHoldsWork(app) || app.reader.header.pendingChoice) return;
  app.pendingStarUp = null;
  const catalog = catalogOf(app);
  const screen = starUpScreen(climb.from, climb.to, catalog, () => statsReport(app.enginePort.statsSheet(), app.portCodes));
  app.shownStar = true;
  // The mode and the rating, such as "modern-3": whether players see the box
  // for each climb `star_reached` counts.
  trackAppAction("star_notice", `${catalog.mode}-${climb.to}`);
  showStarUp(app.ui, screen, () => {
    app.shownStar = false;
  });
}
