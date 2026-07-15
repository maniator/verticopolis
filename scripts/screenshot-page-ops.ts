/**
 * ⚠ BROWSER-INJECTED CODE. Every function here is shipped into the page via
 * Playwright `page.evaluate(fn)`, which serializes the function with
 * `.toString()`. That means each one MUST be fully self-contained:
 *
 *   • NO imports, and NO references to module-scope values (constants, other
 *     helpers in this file, Node globals). Only its own arguments and browser
 *     globals (window, document, localStorage) survive serialization.
 *   • Do NOT "DRY up" two helpers by extracting a shared function and calling it
 *     from inside another injected function: the callee is not in the closure
 *     and the call throws (or silently no-ops) in the page. Inline instead.
 *
 * These are the in-page primitives: clock adoption, stepping, chrome sweeps,
 * palette/overlay/clock nudges, and camera framing. The runner (screenshots.ts)
 * and the manifest (screenshot-scenes.ts) pass them by identity to
 * `page.evaluate`. The self-contained scene builders live in
 * `screenshot-tower-builders.ts`; both sets are re-exported from
 * `screenshot-builders.ts` so importers keep their existing paths.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** Sweep transient chrome just before a capture: toasts always go; a stray
 *  event/emergency dialog (a random fire the running sim popped) goes unless the
 *  shot is deliberately showing a modal. Runs in the browser. */
export function pgClearTransients(keepDialogs: boolean): void {
  document.getElementById("toast-wrap")?.replaceChildren();
  if (!keepDialogs) {
    document.querySelectorAll<HTMLElement>("#modal [data-act='close'], #modal [data-act='decline']").forEach((b) => b.click());
    document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close?.());
    document.querySelector(".modal-backdrop")?.remove();
  }
}

// ---- In-page helpers (serialized into the browser by page.evaluate) ---------
// These run in the browser off window.game; they cannot reference Node scope.

/** Swap the page's live Excalibur clock for a manually stepped TestClock, so
 *  frames advance ONLY when pgStep drives them. Rendering, the decorative
 *  animation clock, and the per-frame sim feed all hang off that clock, so
 *  every capture becomes a pure function of the step count instead of wall
 *  time; that (plus seeded sims) is what makes CI regens byte-stable. Also
 *  zeroes the decorative animation clock, which accumulated a boot-dependent
 *  amount of time before adoption. Handles both page shapes: the game
 *  (window.game.engine is the TowerEngine) and the excalibur.html tooling page
 *  (window.engine is).
 *
 *  Returns a status the runner MUST check, because a silent fall-through here
 *  would quietly hand the page back to wall-clock timing and void the whole
 *  determinism guarantee: "adopted" (including already adopted), "none" (page
 *  has no engine: gallery/preview), or "failed" (an engine exists but the
 *  clock could not be swapped, e.g. an Excalibur API change). */
export function pgAdoptTestClock(): "adopted" | "none" | "failed" {
  const w = window as unknown as { game?: any; engine?: any };
  const te = w.game?.engine ?? w.engine;
  const eng = te?.engine;
  if (!eng) return "none";
  // Install the manually stepped clock if it isn't already the active one.
  // When it IS already installed (a re-entry on the same page), fall through
  // to the resets below rather than returning early: the resets are idempotent
  // and skipping them on re-entry would leave a boot-dependent decorative clock
  // or wall-time accumulator in place, reintroducing the very drift this guards.
  if (typeof eng.clock?.step !== "function") {
    // Prefer Excalibur's sanctioned frame-by-frame debug path; it stops the
    // running clock, converts it, and re-assigns it in one place.
    if (typeof eng.debug?.useTestClock === "function") eng.debug.useTestClock();
    if (typeof eng.clock?.step !== "function") return "failed";
  }
  // Zero the decorative animation clock via the engine's own reset (it
  // accumulated a boot-dependent amount before adoption). Fall back to the
  // field only if an older engine lacks the method, so a partial refactor
  // can't silently leave the clock un-reset.
  if (typeof te.resetDecorativeClock === "function") te.resetDecorativeClock();
  else if (typeof te.animClock === "number") te.animClock = 0;
  // Neither reset path exists (a TowerEngine refactor renamed both): refuse the
  // adoption rather than capture a boot-phased decorative clock. The runner
  // turns "failed" into a hard scene error, so this can't silently drift.
  else return "failed";
  // Collapse the last wall-clock input on the GAME page. main.ts drives the sim
  // from its per-frame update(), but two things there read REAL time via
  // performance.now(): the ~160ms DOM/audio/event-modal throttle, and (through
  // it) the auto-surfacing of an emergency choice modal, which sets shownChoice
  // and then FREEZES the sim (accMinutes=0, early return) until dismissed. Under
  // manual stepping those wall-time reads fire on wall-dependent frames, so a
  // live event could surface its modal (and freeze the sim) at a different step
  // each run: the tower would advance a different number of minutes and every
  // downstream shot would drift. Point performance.now() at the stepped clock
  // and clear the wall-time throttle + the sub-minute accumulator (which also
  // carried a boot-period value), so update() becomes a pure function of the
  // seeded sim and the step count. No-op for the excalibur.html tooling page
  // (no window.game), which has no such loop.
  const g = w.game;
  if (g) {
    try {
      Object.defineProperty(performance, "now", { configurable: true, value: () => eng.clock.now() });
    } catch {
      /* non-writable in a hardened Chromium: leave real time; the resets below still help */
    }
    // Pin Date.now() too. It never drives the sim clock, but the app stamps a
    // save's savedAt with it (SaveGame.saveTime) and the Saves dialog renders
    // that stamp (UI.showSaves), so a shot that quick-saves and opens the dialog
    // (first-run/02c-saves) would show a wall-clock time that differs every run.
    // A fixed epoch makes the rendered timestamp byte-stable. Constant (not the
    // stepped clock) is right here: nothing in a capture measures Date.now()
    // deltas, and a fixed absolute time is what the dialog should show.
    try {
      const FIXED_NOW = 1_704_067_200_000; // 2024-01-01T00:00:00Z, a stable stamp
      Object.defineProperty(Date, "now", { configurable: true, value: () => FIXED_NOW });
    } catch {
      /* non-writable: leave real time; only the Saves-dialog timestamp is affected */
    }
    try {
      g.lastUiUpdate = 0;
    } catch {
      /* ignore */
    }
    try {
      g.accMinutes = 0;
    } catch {
      /* ignore */
    }
  }
  return "adopted";
}

/** Step the adopted TestClock forward `frames` whole 60fps frames. Returns
 *  whether stepping happened, so the runner can fall back to a real wait on
 *  pages that have no engine clock (gallery/preview route pages, composite
 *  setContent shots). A non-finite or non-positive `frames` is treated as an
 *  invalid request: no stepping, returns false, so a bad caller can't mistake
 *  "did nothing" for "advanced time" and quietly void determinism. */
export function pgStep(frames: number): boolean {
  const w = window as unknown as { game?: any; engine?: any };
  const clock = (w.game?.engine ?? w.engine)?.engine?.clock;
  if (!clock || typeof clock.step !== "function") return false;
  const n = Math.floor(frames);
  if (!Number.isFinite(n) || n <= 0) return false;
  for (let i = 0; i < n; i++) clock.step(1000 / 60);
  return true;
}

/** Repaint the throttled DOM chrome (topbar, traffic chip, open editor) off the
 *  final sim state. The per-frame update() only refreshes that DOM every ~160ms
 *  of WALL time, so under stepped frames the last refresh lands on an arbitrary
 *  step; one explicit refresh right before capture pins it to the final state. */
export function pgRefreshUi(): void {
  const g = (window as unknown as { game?: any }).game;
  if (!g) return;
  g.ui?.update?.(g.sim);
  g.updateTraffic?.();
  if (g.selected != null && g.ui?.isEditorOpen?.() && !g.ui?.isEditorBusy?.()) g.refreshEditor?.();
}

/** Dismiss first-run splash/onboarding and resume the paused engine. */
export function pgDismissSplash(): void {
  try {
    localStorage.setItem("tt.onboarded", "1");
  } catch {
    /* ignore */
  }
  const w = window as unknown as { game?: any };
  document.querySelector("#splash [data-splash='continue'], #splash [data-splash='new']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // Remove only the first-run chrome. #scrim is a PERSISTENT app element (the
  // mobile drawer's dimming overlay, body.panels-open #scrim); deleting it would
  // break the mobile-drawer shots, so leave it (it's inert when no panel is open).
  for (const id of ["splash", "onboard"]) document.getElementById(id)?.remove();
  document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close?.());
  document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
  const g = w.game;
  if (g) {
    g.speed = 1;
    g.engine.paused = false;
  }
}

/** Fill a row of `kind` from x0 up to x1, reading each placed unit's CANON width
 *  to advance so rooms sit flush without overlap regardless of the width table. */
export function pgFillRow(kind: string, floor: number, x0: number, x1: number, state: string): void {
  const s = (window as unknown as { game: any }).game.sim;
  for (let x = x0; x + 1 <= x1; ) {
    const r = s.tower.place(kind, floor, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = state;
      u.everOccupied = true;
      x += u.width; // canon width of what actually got placed
    } else {
      x += 1; // obstacle (shaft) or edge, step over it
    }
  }
}

/** Set the in-game clock to a whole hour without advancing days. */
export function pgSetClock(hour: number): void {
  const c = (window as unknown as { game: any }).game.sim.clock;
  let delta = hour * 60 - c.minuteOfDay;
  if (delta < 0) delta += 1440;
  c.advance(delta);
}

/** Drive the real Map-overlay dropdown so the shot exercises the shipped path. */
export function pgSetOverlay(mode: string): void {
  const sel = document.getElementById("overlay-mode") as HTMLSelectElement | null;
  if (sel) {
    sel.value = mode;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/** Center the Excalibur camera on the lot. */
export function pgFrame(arg: { tile: number | null; floor: number; zoom: number }): void {
  const g = (window as unknown as { game: any }).game;
  const tile = arg.tile ?? Math.floor(g.grid.width / 2);
  g.engine.setCamera(tile, arg.floor, arg.zoom);
}
