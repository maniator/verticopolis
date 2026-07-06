/// <reference types="vite-plugin-pwa/client" />

/**
 * PWA service-worker registration and the player-prompted update flow.
 *
 * This is the ONLY place the service worker is registered (the Vite plugin's
 * auto-injection is turned off), and it's imported solely by the game entry
 * (`main.ts`) — never by the gallery/preview tooling pages, and never by the
 * test graph. Workbox does all the heavy lifting; we only decide *when* to
 * swap in a new version.
 *
 * We run in `prompt` mode (the fresh worker waits instead of hijacking the
 * tab) and never activate it on our own: a new build is surfaced to the app,
 * which asks the player whether to update now or keep playing. This shim stays
 * deliberately dumb — it owns registration and the update poll and hands the
 * app an `activate` callback; every "when/how to prompt" decision lives
 * app-side (GameApp), where it is testable. Nothing here touches the save, the
 * UI, or reloads on a timer.
 */
import { registerSW } from "virtual:pwa-register";

export interface PwaHandlers {
  /**
   * Fired the moment a new version is waiting. `activate` skips the waiting
   * worker and reloads onto the new assets; the app calls it only when the
   * player chooses to update now. If it is never called, the new worker simply
   * activates on the next cold reopen — nothing is forced.
   */
  onUpdateAvailable: (activate: () => Promise<void>) => void;
  /** Fired once the app is fully cached and usable offline. */
  onOfflineReady?: () => void;
}

/**
 * How often to poll the server for a newer service worker. The browser only
 * re-fetches `sw.js` on a navigation, which never happens during a long-lived
 * game session (the sim is designed to be left running — idle at high speed for
 * hours). Without an explicit poll, a player who keeps the tab or installed PWA
 * open right through a release never learns a new version shipped: `onNeedRefresh`
 * can't fire if nothing re-checks the worker. An hourly poll — plus a check the
 * moment the tab regains focus — is what lets a long-lived session ever learn a
 * new build shipped (so it can offer the update prompt).
 */
const UPDATE_POLL_MS = 60 * 60 * 1000;

export function registerPWA(handlers: PwaHandlers): void {
  // Service workers only work in a secure context with SW support. Bail cleanly
  // otherwise — a non-browser environment, insecure `http://`, or a page opened
  // straight from `file://` — rather than let registration throw a
  // SecurityError. (localhost counts as secure, so dev/preview still register.)
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // The browser's built-in update check only runs on navigation, so for an
      // installed PWA left open across a release it effectively never fires.
      // Drive `registration.update()` ourselves on two triggers the navigation
      // check misses (mirrors maniator/blipit-legends' service-worker hook):
      //   • an hourly poll, so a session left running still picks up a release;
      //   • a re-check whenever the tab returns to the foreground, so reopening
      //     a backgrounded PWA notices a new version right away.
      // A found update surfaces as a waiting worker → onNeedRefresh below. The
      // update() call is best-effort (offline / transient network) — swallow it.
      if (!registration) return;
      const check = () => void registration.update().catch(() => {});
      window.setInterval(check, UPDATE_POLL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
    onNeedRefresh() {
      // A new worker is waiting. Don't touch it — hand the app an `activate`
      // callback (skipWaiting + reload onto the new assets) and let it decide
      // when to prompt the player. Until the player picks "update now", the new
      // worker keeps waiting and activates on the next cold reopen, so nothing
      // is ever force-reloaded out from under a live game.
      handlers.onUpdateAvailable(() => updateSW(true));
    },
    onOfflineReady() {
      handlers.onOfflineReady?.();
    },
  });
}
