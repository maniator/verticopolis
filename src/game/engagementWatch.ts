import { createEngagementDetector, watchGameplayCommands } from "../analyticsEngagement";
import { cohortRows, noteEngineEngaged } from "../analyticsEngineStatus";
import type { EnginePortCommands } from "../simport/enginePort";
import { isDialogOpen, isSplashUp } from "./interactionState";

/** How often the `play` branch judges a second of play. */
const SAMPLE_MS = 1000;

/**
 * Start the page life's engagement detector (#1090) once the game exists:
 * the port's gameplay commands report their answers, and a once-a-second
 * sample reads the tab, the splash and dialogs, and the game clock. It stops
 * at the first engagement. Without the cohort's rows nothing is wrapped and no
 * timer runs.
 */
export function startEngagementWatch(port: EnginePortCommands, clock: () => number): void {
  if (!cohortRows.on) return;
  const detector = createEngagementDetector((by) => {
    clearInterval(timer);
    noteEngineEngaged(by);
  });
  watchGameplayCommands(port, detector);
  // The callback above reads `timer` only once a command or a sample runs,
  // both after this line.
  const timer = setInterval(() => {
    try {
      detector.sample({ visible: document.visibilityState === "visible", blocked: isSplashUp() || isDialogOpen(), clock: clock() });
    } catch (e) {
      console.error("[engagement] could not sample play:", e);
      clearInterval(timer);
    }
  }, SAMPLE_MS);
}
