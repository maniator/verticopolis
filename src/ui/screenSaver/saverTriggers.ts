import type { SaverPrefs } from "./saverPrefs";
import { NO_SAVER } from "./saverPrefs";

/**
 * When the screen saver comes up on its own (party 2026-11-15):
 *
 * - **Idle:** the tower has been paused and untouched for the wait. A running
 *   tower never starts it, so a player watching their tower is never
 *   interrupted.
 * - **Return:** the player comes back to this tab after being away at least
 *   the wait, when they asked for that. A hidden tab draws nothing, so the
 *   saver waits for them on the way back instead.
 *
 * Cost: one passive listener per input type that only stores a time, one
 * timer every {@link IDLE_POLL_MS}, and one visibility listener. Nothing
 * runs per frame, and with the saver set to none the timer never runs.
 */

/** How often the idle check looks, in milliseconds. */
export const IDLE_POLL_MS = 15_000;

/** What started a saver: the idle wait, the way back to the tab, or the
 *  dialog's Preview. */
export type SaverTrigger = "idle" | "return" | "preview";

export interface SaverTriggerPorts {
  /** The choices as they stand now (the dialog can change them). */
  prefs(): SaverPrefs;
  /** Nothing is in the way: no dialog, title screen, stopped engine,
   *  emergency or test browser, and no saver already up. */
  canShow(): boolean;
  /** The tower is paused. */
  paused(): boolean;
  /** Put the saver up. */
  start(trigger: Exclude<SaverTrigger, "preview">): void;
}

/** Input that counts as the player being there. */
const PRESENCE = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** Watch for the idle wait and the way back to the tab. Returns a function
 *  that stops watching, and one that marks the player as just here (call it
 *  when the saver ends or the choices change). */
export function watchForSaver(ports: SaverTriggerPorts, win: Window = window): { stop: () => void; touched: () => void } {
  const doc = win.document;
  const now = () => win.performance.now();
  let lastInput = now();
  let hiddenAt: number | null = doc.visibilityState === "hidden" ? now() : null;
  let timer = 0;
  const waitMs = () => ports.prefs().waitMinutes * 60_000;
  const on = () => ports.prefs().saver !== NO_SAVER;

  const touched = () => {
    lastInput = now();
    arm();
  };
  const onInput = () => {
    lastInput = now();
  };
  const check = () => {
    timer = 0;
    if (!on()) return;
    if (doc.visibilityState !== "hidden" && now() - lastInput >= waitMs() && ports.paused() && ports.canShow()) ports.start("idle");
    arm();
  };
  function arm(): void {
    if (timer) win.clearTimeout(timer);
    timer = on() ? win.setTimeout(check, IDLE_POLL_MS) : 0;
  }
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") {
      hiddenAt = now();
      return;
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    lastInput = now();
    const p = ports.prefs();
    if (p.saver !== NO_SAVER && p.onReturn && away >= waitMs() && ports.canShow()) ports.start("return");
  };

  const passive = { capture: true, passive: true } as const;
  for (const type of PRESENCE) win.addEventListener(type, onInput, passive);
  doc.addEventListener("visibilitychange", onVisibility);
  arm();
  return {
    stop: () => {
      if (timer) win.clearTimeout(timer);
      timer = 0;
      for (const type of PRESENCE) win.removeEventListener(type, onInput, passive);
      doc.removeEventListener("visibilitychange", onVisibility);
    },
    touched,
  };
}
