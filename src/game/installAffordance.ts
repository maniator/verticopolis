import type { GameApp } from "../main";
import { initPwaInstall, installAvailability, promptInstall, isStandalone } from "../pwaInstall";
import { trackAppActionOnce } from "../analytics";
import { showInstallHelp } from "../ui/uiDialogs";

/**
 * The install-affordance controller (SPEC-pwa-install). Ties the browser install
 * seam ({@link initPwaInstall}) to two surfaces:
 *
 *  - the Game-panel "Install app" entry (`#btn-install-menu`): the passive home,
 *    shown whenever the app is installable and not installed. The browser's own
 *    install offer is a one-shot, so on Chrome/Edge the entry hides after the
 *    player uses (or dismisses) the prompt and reappears if the browser offers
 *    again; on iOS (a how-to, no one-shot) it stays put;
 *  - the topbar "Install" chip (`#btn-install`): a ONE-TIME gentle surfacing,
 *    gated on real play, at most once ever (a persisted flag), after which the
 *    menu entry alone carries it. No re-nagging.
 *
 * On iOS the same surfaces are present but activation opens an Add-to-Home-Screen
 * how-to instead of a native prompt. Standalone / TWA sessions are offered
 * nothing (installAvailability() returns "none").
 */

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

/** Activate the offer from either surface: native prompt where available, the
 *  iOS how-to otherwise. Never throws or rejects past the click handler: a
 *  native prompt() that rejects (called outside a trusted gesture, sheet
 *  failure) must not become an unhandled rejection, and the post-prompt refresh
 *  must still run. */
async function activate(app: GameApp): Promise<void> {
  const avail = installAvailability();
  if (avail === "ios-howto") {
    showInstallHelp(app.ui);
    return;
  }
  if (avail === "prompt") {
    try {
      await promptInstall(); // one-shot; appinstalled (on accept) hides both surfaces
    } catch {
      /* the browser rejected the prompt; the one-shot is spent either way */
    }
    refreshMenu();
    hideChip(); // the offer was taken up (or declined); don't keep the chip lingering
  }
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
      chipResolved = true;
    },
  });
  // Catch on the click, not just inside activate: activate is async, so ANY
  // synchronous throw in its body (a modal-open hiccup, say) would otherwise
  // surface as an unhandledrejection and the installed error tracking would
  // promote it to crash telemetry. The offer is best-effort chrome.
  const onClick = () => void activate(app).catch(() => {});
  const chip = document.getElementById("btn-install");
  const menu = document.getElementById("btn-install-menu");
  if (chip) chip.addEventListener("click", onClick);
  if (menu) menu.addEventListener("click", onClick);
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

/** Test-only reset of the session guard. */
export function __resetInstallAffordanceForTest(): void {
  chipResolved = false;
}
