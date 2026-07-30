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
 *  4. the title screen is up (`#splash`, tracked through `splashActions`).
 *  5. `#crash-screen` exists — the renderer died.
 *
 * The class of bug this prevents is two of those sources disagreeing in one
 * state. PR #715's review found the host-command availability push telling the
 * desktop menu every command was available in exactly the state where
 * `#modal.open` refused all of them, because one consumer read the flags and
 * another read the element. #715 fixed that instance; this module governs the
 * class: every reader of "can the player interact" asks here, and nothing else
 * reads a raw source. A source-text guard
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

/** The persistent global chrome screen, in precedence order. Screens only
 *  (AD-2): a transient sub-second grip like an editor drag is a predicate
 *  ({@link isEditorBusy}), never a mode, so `mode()` cannot flicker every drag
 *  frame. */
export type InteractionMode = "crash" | "splash" | "dialog" | "live";

/**
 * The five sources plus the editor-busy predicate, read once. Kept as a flat
 * bag because the host-command guard (`refusalForState`) asks about all eight
 * commands against one snapshot, and reading each source per command meant the
 * DOM was hit eight times a tick. Hoisting the reads also makes that guard a
 * pure function of a plain object, testable without a DOM.
 */
export interface InteractionState {
  crashed: boolean;
  splashUp: boolean;
  /** A choice-bearing modal (`shownChoice`/`shownUpdate`), the sim-freezing kind.
   *  Read from the flags rather than inferred from `#modal.open`, because the
   *  implication (flag ⟹ element open) is held by convention in two other
   *  modules and the reverse does not hold. This is AD-2's flagged-vs-flagless
   *  distinction, the exact thing the #715 defect turned on. */
  blockingChoice: boolean;
  dialogOpen: boolean;
  editorBusy: boolean;
}

/** The renderer died and the crash card is up. On its own, and first, because
 *  once it is true everything else is moot AND it must not touch `app.ui`: a
 *  UI-layer fault is the most likely reason the crash handler is running, so a
 *  read of `app.ui` here could throw before the crash is even reported. */
export function isCrashed(): boolean {
  return !!document.getElementById(CRASH_SCREEN_ID);
}

/**
 * The title screen is up. This is the single answer to that question for the
 * whole app: both the host-command availability guard and its dispatch read it,
 * so they cannot give two answers the way #715's round-3 review found (the guard
 * asked the DOM while the dispatch asked the `splashActions` registry). The
 * registry now holds only the splash's bound handlers for `runSplashAction` to
 * call; it no longer answers a state question of its own. `Onboarding` mounts
 * and tears down `#splash` as one operation, so this element read is the
 * authoritative presence of the screen.
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
 * A live press is held inside the editor card (AD-7). A real availability input
 * (the host menu refuses dialog-opening commands while a drag is held, so a
 * dialog cannot open under an active press), but a sub-second local grip rather
 * than a global screen, so it is a predicate surfaced alongside {@link mode},
 * never a mode value: folding it into `mode()` would flicker the mode every
 * drag frame. Consumers read it synchronously at the moment of action.
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

/** Read all five sources plus the editor predicate once. */
export function readInteractionState(app: GameApp): InteractionState {
  return {
    crashed: isCrashed(),
    splashUp: isSplashUp(),
    blockingChoice: hasBlockingModal(app),
    dialogOpen: isDialogOpen(),
    editorBusy: isEditorBusy(app),
  };
}

/**
 * The persistent chrome screen, precedence-ordered (AD-2). `dialog` covers both
 * a flagged sim-freezing modal and a flagless `#modal.open`; a consumer that
 * must tell those apart uses {@link hasBlockingModal}. The editor grip is never
 * a mode (AD-7); read {@link isEditorBusy} for it.
 */
export function mode(app: GameApp): InteractionMode {
  if (isCrashed()) return "crash";
  if (isSplashUp()) return "splash";
  // A flagged modal implies `#modal.open`, but read both so a flag set a beat
  // before the element opens still reads as `dialog` and never as `live`.
  if (isDialogOpen() || hasBlockingModal(app)) return "dialog";
  return "live";
}

/**
 * A comparable change key over an ordered list of parts (AD-3). Pure, so a
 * caller compares this frame's key against the one it holds and acts only on a
 * change. `uiStatus.paletteScanKey` still builds its own key today; this helper
 * is here for it to adopt if that reuse is ever wanted (AD-3 leaves it optional).
 * The data each caller keys over stays its own.
 */
export function changeKey(parts: ReadonlyArray<string | number | boolean>): string {
  return parts.join("␟");
}

/**
 * The dirty-gate state for the host-command availability push (AD-3). Only this
 * key moves here: `paletteScanKey` answers "what can the player afford" (sim
 * content, stays in `uiStatus`) and `lastUiUpdate` is a wall-clock throttle.
 * The key is compared and committed in two steps on purpose, so the caller
 * commits only after the cross-process push actually lands: recording it as
 * delivered first would let one transient throw leave the shell showing a stale
 * set forever, because steady play never changes the set again to re-fire.
 */
let lastAvailabilityKey: string | null = null;

/** True when `key` differs from the last committed availability key. Does not
 *  mutate: the caller commits only after a successful push. */
export function availabilityKeyChanged(key: string): boolean {
  return key !== lastAvailabilityKey;
}

/** Record `key` as the delivered availability key, after a successful push. */
export function commitAvailabilityKey(key: string): void {
  lastAvailabilityKey = key;
}

/** Clear the dirty-gate so the next push always fires (bind time, and tests). */
export function resetAvailabilityKey(): void {
  lastAvailabilityKey = null;
}
