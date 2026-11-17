import type { GameApp } from "../main";
import { outcome } from "../simport/portCodes";

/** What the player is told when the call is refused, by the engine's reason. */
export const FIRE_RESCUE_REFUSED = {
  none: "No fire is burning, so there is nothing for the rescue crews to put out.",
  pending: "Answer the emergency that is already waiting first.",
  coming: "The Fire Rescue helicopter is already on its way.",
} as const;

/**
 * Tower > Call Fire Rescue… (#1889). In the 1994 game a player who declines
 * the fire rescue offer can still call it later from the menu, for as long as
 * a fire burns (manual p.62). The engine puts the same offer up again, and
 * the frame loop shows it the way it shows the first one, so the player pays
 * or declines there. A refusal says why in a toast.
 */
export function callFireRescue(app: GameApp): void {
  const res = outcome(app.enginePort, app.enginePort.callFireRescue());
  if (res.ok) {
    // The reader learns of a choice when the frame's flag rises; read it now
    // so the offer opens on the next frame even while the game is paused.
    app.reader.update();
    return;
  }
  const why = res.reason === "pending" || res.reason === "coming" ? res.reason : "none";
  app.ui.toast(FIRE_RESCUE_REFUSED[why], "info");
}
