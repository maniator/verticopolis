import type { GameApp } from "../main";
import { initPwaInstall, installAvailability, promptInstall, isStandalone, isIos, canPromptInstall } from "../pwaInstall";
import { trackAppAction, trackAppActionOnce } from "../analytics";
import { showInstallHelp } from "../ui/uiDialogs";
import { isWrappedMode } from "../platform";

/**
 * The install-affordance controller (SPEC-pwa-install). Ties the browser install
 * seam ({@link initPwaInstall}) to three surfaces:
 *
 *  - the Game-panel "Install app" entry (`#btn-install-menu`): the passive home,
 *    shown whenever the app is installable and not installed. The browser's own
 *    install offer is a one-shot, so on Chrome/Edge the entry hides after the
 *    player uses (or dismisses) the prompt and reappears if the browser offers
 *    again; on iOS (a how-to, no one-shot) it stays put;
 *  - the topbar "Install" chip (`#btn-install`): a ONE-TIME gentle surfacing,
 *    gated on real play, at most once ever (a persisted flag), after which the
 *    menu entry alone carries it. No re-nagging;
 *  - the splash install button (`#splash-install`, CAP-5): the persistent front
 *    door, shown for a not-standalone browser session (its visibility is NOT
 *    gated on a captured event, unlike the two in-game surfaces), owned by the
 *    splash template. It routes taps through {@link activateInstall} like the
 *    others.
 *
 * Activation ({@link activateInstall}) is shared by all three: a native prompt
 * where a `beforeinstallprompt` is captured, else an honest how-to (iOS Safari
 * steps, or Chrome/Edge browser-menu steps). Standalone / TWA sessions are
 * offered nothing on any surface, and neither are wrapped builds (Capacitor,
 * Electron): they are not installable web apps, and they are not standalone
 * either, so every surface gates on the build mode as well.
 */

/** Which affordance a player tapped to reach for the install, for the CAP-4
 *  engagement signal: the splash front door, the topbar chip, or the Game-panel
 *  entry. Flows to analytics as the `install_offer` action's `detail`. */
export type InstallSurface = "splash" | "chip" | "menu";

const CHIP_SHOWN_FLAG = "vc-install-chip-shown"; // once-ever: the chip surfaces at most one time

let chipResolved = false; // session guard so the play-gate poll self-terminates

function chipShownEver(): boolean {
  try {
    return localStorage.getItem(CHIP_SHOWN_FLAG) === "1";
  } catch {
    return false; // storage blocked: treat as not-yet-shown (worst case, one appearance)
  }
}

function markChipShownEver(): void {
  try {
    localStorage.setItem(CHIP_SHOWN_FLAG, "1");
  } catch {
    /* best effort: a blocked write just means the chip may appear again next session */
  }
}

/** Whether the splash shows its persistent install button (CAP-5): any session
 *  that is not already installed. Deliberately NOT gated on a captured event, so
 *  it never depends on Chrome's engagement heuristic or a reveal race; a tap with
 *  no event degrades to the browser-menu how-to inside {@link activateInstall}.
 *  Wrapped builds (Capacitor, Electron) are the exception: they are not
 *  installable web apps and are not standalone either, so without the mode gate
 *  this button was the one install surface that leaked into a wrapper window,
 *  where its tap led to browser install steps for a menu that does not exist
 *  there. */
export function splashInstallOffered(mode: string = import.meta.env.MODE): boolean {
  return !isWrappedMode(mode) && !isStandalone();
}

/** Real play, the chip's gate: past the splash and with at least one unit in the
 *  tower (a placed lobby / any build). A brand-new empty lot is not yet "playing". */
function hasReallyPlayed(app: GameApp): boolean {
  if (document.getElementById("splash")) return false;
  return (app.sim?.tower?.units?.length ?? 0) > 0;
}

/** Toggle the permanent passive menu entry to match live offerability. Cheap;
 *  called on init and on every install-seam change. */
function refreshMenu(): void {
  const menu = document.getElementById("btn-install-menu") as HTMLButtonElement | null;
  if (menu) menu.hidden = installAvailability() === "none";
}

function hideChip(): void {
  const chip = document.getElementById("btn-install") as HTMLButtonElement | null;
  if (chip) chip.hidden = true;
}

/** Hide the splash front-door button. Its visibility is otherwise decided once at
 *  mount (CAP-5: no live reveal race), but a definite install completing while the
 *  splash is still up must retire it: a `#splash-install` left visible to an
 *  already-installed session is a dead control (a re-tap reaches nothing). Only
 *  ever HIDES, never shows, so it introduces no reveal race. */
function hideSplashInstall(): void {
  const btn = document.querySelector('[data-splash="install"]') as HTMLButtonElement | null;
  if (btn) btn.hidden = true;
}

// Re-entrancy guard for activateInstall's native-prompt branch. `promptInstall`
// clears the one-shot BEFORE awaiting the sheet, so a second tap during that
// await sees canPromptInstall() === false and would otherwise fall through to the
// how-to, stacking a redundant modal behind the live native sheet. This latch
// makes a concurrent activation a no-op until the in-flight prompt resolves.
let promptInFlight = false;

/** Activate the offer from any surface: native prompt where a `beforeinstallprompt`
 *  is captured, the iOS Safari how-to on iOS, and the Chrome/Edge browser-menu
 *  how-to for a not-standalone session that reaches the splash button before the
 *  browser has fired its install event. Never throws or rejects past the click
 *  handler: a native prompt() that rejects (called outside a trusted gesture,
 *  sheet failure) must not become an unhandled rejection, and the post-prompt
 *  refresh must still run.
 *
 *  Exported for the splash button (CAP-5): the in-game chip/menu only ever call
 *  it when availability is "prompt" or "ios-howto", but the splash button is a
 *  persistent front door (shown for a not-standalone browser session), so it
 *  can reach the browser-menu how-to fallback the in-game surfaces never do.
 *
 *  `surface` names which affordance was tapped, for the CAP-4 engagement signal. */
export async function activateInstall(app: GameApp, surface: InstallSurface): Promise<void> {
  // Record the tap per surface BEFORE the offer resolves (a re-entrancy bail or a
  // rejected prompt must not swallow it): a deliberate, low-volume, cookieless
  // count of which affordance players reach for. The `install_app` completion
  // cannot attribute this (the OS `appinstalled` event names no surface).
  trackAppAction("install_offer", surface);
  if (canPromptInstall()) {
    if (promptInFlight) return; // a prompt is already showing; don't stack a how-to behind it
    promptInFlight = true;
    try {
      await promptInstall(); // one-shot; appinstalled (on accept) hides the surfaces
    } catch {
      /* the browser rejected the prompt; the one-shot is spent either way */
    } finally {
      promptInFlight = false;
    }
    refreshMenu();
    hideChip(); // the offer was taken up (or declined); don't keep the chip lingering
    return;
  }
  // A prompt is mid-flight but its one-shot is already cleared: a concurrent tap
  // must not open the how-to behind the live native sheet. Bail until it resolves.
  if (promptInFlight) return;
  // No captured event: fall back to an honest, deliberate-tap-only how-to. iOS
  // gets the Share-sheet steps; a not-standalone desktop/Android session (no
  // event yet) gets the browser-menu steps. A standalone/TWA session never gets
  // here: no surface offers activation to it.
  if (isStandalone()) return;
  showInstallHelp(app.ui, isIos() ? "ios" : "browser");
}

/** Wire the affordance: capture the browser event as early as this runs, bind
 *  both surfaces, and do the initial menu refresh. */
export function initInstallAffordance(app: GameApp): void {
  initPwaInstall({
    onChange: refreshMenu,
    onInstalled: () => {
      // The app is installed, however it was triggered (our offer or the
      // browser menu): a coarse once-per-session fact, no id (CAP-4). The
      // `display` common prop separately carries standalone reach at boot.
      trackAppActionOnce("install_app");
      refreshMenu();
      hideChip();
      hideSplashInstall(); // a completed install retires the splash front door too
      chipResolved = true;
    },
  });
  // Catch on the click, not just inside activateInstall: it is async, so ANY
  // synchronous throw in its body (a modal-open hiccup, say) would otherwise
  // surface as an unhandledrejection and the installed error tracking would
  // promote it to crash telemetry. The offer is best-effort chrome. Each surface
  // passes its own name so the CAP-4 tap signal is attributed.
  const chip = document.getElementById("btn-install");
  const menu = document.getElementById("btn-install-menu");
  if (chip) chip.addEventListener("click", () => void activateInstall(app, "chip").catch(() => {}));
  if (menu) menu.addEventListener("click", () => void activateInstall(app, "menu").catch(() => {}));
  refreshMenu();
}

/**
 * The play-gated chip surfacing, called from the ~6Hz UI tick. Genuinely
 * self-terminating: it resolves (and stops all further work) the moment the
 * session is standalone, or the player has really started playing. A browser
 * fires `beforeinstallprompt` near load, well before a first placement, so if
 * the player is in-game and it still has not fired, it never will (Firefox
 * desktop, etc.): the chip is decided ONCE at that point rather than polling
 * the availability probe forever. A late-arriving install offer is still caught
 * by the always-live menu entry (event-driven), so nothing is lost. Until the
 * player is in-game the per-tick work is only the standalone check plus a DOM
 * read, and it ends as soon as they build.
 */
export function tickInstallAffordance(app: GameApp): void {
  if (chipResolved) return;
  if (isStandalone()) {
    chipResolved = true; // installed / TWA: never offer; stop polling
    return;
  }
  if (!hasReallyPlayed(app)) return; // not yet playing; keep the cheap wait
  // In-game now: decide the chip once, whatever the availability, then stop.
  if (installAvailability() === "prompt" && !chipShownEver()) {
    const chip = document.getElementById("btn-install") as HTMLButtonElement | null;
    if (chip) {
      chip.hidden = false;
      markChipShownEver(); // set the flag ONLY once the chip actually surfaced
    }
  }
  chipResolved = true;
}

/** Test-only reset of the session guards. */
export function __resetInstallAffordanceForTest(): void {
  chipResolved = false;
  promptInFlight = false;
}
