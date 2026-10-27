import type { ShadowCommand } from "../dualrun/commands";

/**
 * When a command ahead of an hour pass still lets the engine send a delta
 * (#1045). Any other command makes the next hour pass a full save: the
 * engine may have answered it differently from the read model (a refusal
 * shows only in its result), and a unit the engine never changes would
 * stay wrong, which no delta corrects.
 *
 * A command is exempt only when it cannot change a unit record and the
 * engine cannot refuse it. Every op added here needs a test proving both
 * (`wasmWorkerDelta.integration.test.ts`). The worker host reads the list
 * today; a main-thread host that takes the same delta (#868) is to use it
 * unchanged.
 *
 * - `setView` and `emit`: the camera stamp and a log line (the frame loop's
 *   meal-rush bulletins send one three times a day, with no player in it).
 * - `setTowerName`: the save's remainder carries `towerName` whole, and the
 *   engine's setter has no failure path.
 */
export const KEYFRAME_EXEMPT_OPS: ReadonlySet<ShadowCommand["op"]> = new Set<ShadowCommand["op"]>(["setView", "emit", "setTowerName"]);

/** What a host needs to patch its read model with one delta: the engine's
 *  `saveDelta()` text and the telemetry and housekeeping texts that ride
 *  with it. The worker host's payload extends this with its sequence
 *  numbers; the main-thread host can pass the three texts as they are. */
export interface DeltaText {
  delta: string;
  telemetry: string;
  housekeeping: string | null;
}
