import type { GameApp } from "../main";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";

/**
 * The single owner of "can the player interact right now" (issue #716).
 *
 * Five sources answer that question, and before this module nothing required
 * them to agree:
 *
 *  1. `app.shownChoice` — an emergency-choice modal is up (freezes the sim).
 *  2. `app.shownUpdate` — the update modal is up (freezes the sim).
 *  3. `#modal.open` — any modal dialog is open (a save picker or New Tower
 *     picker sets this with NEITHER flag above).
 *  4. the title screen is up (`#splash`).
 *  5. `#crash-screen` exists — the renderer died.
 *
 * The class of bug this prevents is two of those sources disagreeing in one
 * state: one consumer reading the flags while another reads the element (the
 * #715 defect). This module governs the class: every reader of "can the player
 * interact" asks here, and nothing else reads a raw source. A source-text guard
 * (`src/tests/interactionStateSingleSource.guard.test.ts`) pins that.
 *
 * This is a facade, not a store (party ruling 2026-07-30): plain synchronous
 * reads of the DOM and `GameApp` chrome fields, no reactive graph, no
 * subscription to `sim`. It reads `src/engine` never (AD-4/AD-5): the five
 * sources are all UI chrome. The five WRITERS stay where they are (AD-8):
 * `shownChoice` in `frameLoop`, `shownUpdate` in `updateFlow`, the `#modal`
 * element in `UI`, `#splash` in `Onboarding`, `#crash-screen` in `crashScreen`.
 * This module owns the READS.
 */

/** The renderer died and the crash card is up. On its own, and first, because
 *  once it is true everything else is moot AND it must not touch `app.ui`: a
 *  UI-layer fault is the most likely reason the crash handler is running, so a
 *  read of `app.ui` here could throw before the crash is even reported. */
export function isCrashed(): boolean {
  return !!document.getElementById(CRASH_SCREEN_ID);
}

/** The engine-failure message's element id (bootstrap.ts renders it). */
export const ENGINE_FAILURE_ID = "engine-failure";

/** The game stopped on its engine (the engine-failure message from
 *  bootstrap.ts is up: a wasm-only build's engine that did not start, or a
 *  Rust engine that trapped): no engine holds the tower, so nothing may
 *  advance, change or save it. Read like the crash card, from its element. */
export function isEngineStopped(): boolean {
  return !!document.getElementById(ENGINE_FAILURE_ID);
}

/**
 * The title screen is up. This is the single answer to that question for the
 * whole app. `Onboarding` mounts and tears down `#splash` as one operation, so
 * this element read is the authoritative presence of the screen.
 */
export function isSplashUp(): boolean {
  return !!document.getElementById("splash");
}

/** Any modal dialog is open. Reads `#modal.open` directly rather than through
 *  `UI.isModalOpen()` so the crash and pump paths never depend on `app.ui`
 *  being constructed. */
export function isDialogOpen(): boolean {
  return !!(document.getElementById("modal") as HTMLDialogElement | null)?.open;
}

/** A sim-freezing modal is up (AD-2's flagged predicate). The pair implies
 *  `#modal.open`; the reverse does not, which is why this is a separate
 *  question from {@link isDialogOpen}. */
export function hasBlockingModal(app: GameApp): boolean {
  return app.shownChoice || app.shownUpdate;
}

/**
 * A live press is held inside the editor card (AD-7): a sub-second local grip
 * rather than a global screen, so it is a predicate. Consumers read it
 * synchronously at the moment of action.
 *
 * Guarded, because this is the one source that runs GAME code rather than
 * reading a flag or an element, and `app.ui` may be unset (a fault during
 * construction) or may itself be the thing that just threw.
 */
export function isEditorBusy(app: GameApp): boolean {
  try {
    return app.ui?.isEditorBusy() ?? false;
  } catch (err) {
    console.warn("[interaction] isEditorBusy threw; treating the editor as idle:", err);
    return false;
  }
}
