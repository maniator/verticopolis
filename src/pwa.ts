/// <reference types="vite-plugin-pwa/client" />

/**
 * PWA service-worker registration and the "always run the latest" update flow.
 *
 * This is the ONLY place the service worker is registered (the Vite plugin's
 * auto-injection is turned off), and it's imported solely by the game entry
 * (`main.ts`) — never by the gallery/preview tooling pages, and never by the
 * test graph. Workbox does all the heavy lifting; we only decide *when* to
 * swap in a new version.
 *
 * The rule the user asked for: when a new build ships, force a quick save and
 * then release the new assets so the player is always on the latest code
 * without ever losing their tower. We run in `prompt` mode (the fresh worker
 * waits) so we control that instant: flush the save first, then activate.
 */
import { registerSW } from "virtual:pwa-register";

export interface PwaHandlers {
  /**
   * Fired the moment a new version is waiting. Flush any in-memory state to
   * disk here (a quick save) — a reload follows almost immediately. May be
   * async; the reload waits for it to settle.
   */
  onUpdateReady: () => void | Promise<void>;
  /** Fired once the app is fully cached and usable offline. */
  onOfflineReady?: () => void;
}

/**
 * How long to let the "updating…" toast breathe before the reload. Long enough
 * to be seen, short enough to still feel like "always latest".
 */
const UPDATE_GRACE_MS = 900;

/**
 * How often to poll the server for a newer service worker. The browser only
 * re-fetches `sw.js` on a navigation, which never happens during a long-lived
 * game session (the sim is designed to be left running — idle at high speed for
 * hours). Without an explicit poll, a player who keeps the tab or installed PWA
 * open right through a release never learns a new version shipped: `onNeedRefresh`
 * can't fire if nothing re-checks the worker. An hourly poll — plus a check the
 * moment the tab regains focus — is what actually makes "always latest" hold.
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
      // A new worker is waiting. Flush the tower to disk FIRST, then activate it
      // (`updateSW(true)` calls skipWaiting and reloads onto the new assets).
      // The async wrapper also catches a *synchronous* throw from the save.
      //
      // If the save throws or rejects (e.g. localStorage quota), we do NOT
      // reload — that would drop unsaved progress, the one thing this flow
      // exists to prevent. The new worker simply stays waiting and activates on
      // the next natural page load, so the player keeps their tower either way.
      void (async () => {
        try {
          await handlers.onUpdateReady();
        } catch {
          return;
        }
        window.setTimeout(() => void updateSW(true), UPDATE_GRACE_MS);
      })();
    },
    onOfflineReady() {
      handlers.onOfflineReady?.();
    },
  });
}
