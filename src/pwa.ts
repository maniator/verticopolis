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
import { parseUpdateInfo, isDifferentBuild, type UpdateInfo } from "./pwaUpdateInfo";

/**
 * High-level facts about the INCOMING build, read at prompt time from the
 * deployed `version.json` (see `emit-version-json` in vite.config.ts). The old
 * client can't introspect the waiting worker, so this is how it learns what it's
 * updating to. The interface + its pure sanitizer live in `./pwaUpdateInfo` (so
 * the bounds are unit-tested); re-exported here for the existing import site.
 */
export type { UpdateInfo };

export interface PwaHandlers {
  /**
   * Fired the moment a new version is waiting. `activate` skips the waiting
   * worker and reloads onto the new assets; the app calls it only when the
   * player chooses to update now. If it is never called, the new worker simply
   * activates on the next cold reopen — nothing is forced. `info` carries the
   * incoming build's identity/notes (or undefined if it couldn't be fetched).
   */
  onUpdateAvailable: (activate: () => Promise<void>, info?: UpdateInfo) => void;
  /** Fired once the app is fully cached and usable offline. */
  onOfflineReady?: () => void;
}

/**
 * Fetch the incoming build's `version.json`, network-fresh. It's deliberately
 * NOT precached (Workbox `globPatterns` covers no `.json`, and there's no
 * runtime cache route), so this always hits the freshly deployed file. `onNeedRefresh`
 * only fires after `registration.update()` already found the new `sw.js`, so the
 * server's `version.json` reflects the incoming build by the time we ask. Any
 * failure (offline, 404, malformed) resolves to `null` — the prompt degrades to
 * its generic copy and never blocks on this. */
async function fetchUpdateInfo(): Promise<UpdateInfo | null> {
  // Bound the fetch with an AbortController + setTimeout rather than
  // AbortSignal.timeout — the latter is missing on older Safari/iOS, where it
  // would throw synchronously and drop build info even on a healthy network.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    // Resolve against the page (Vite base is "./", so URLs stay relative to
    // wherever the site is served from) and cache-bust so a CDN edge can't hand
    // back a stale copy.
    const url = new URL("version.json", document.baseURI);
    url.searchParams.set("t", String(Date.now()));
    const res = await fetch(url.href, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    // Sanitize (bounds the notes, type-guards version/sha) in a pure, unit-tested
    // helper — see src/pwaUpdateInfo.ts.
    return parseUpdateInfo(j);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  // Native-wrapper builds (`--mode native`, for the iOS Capacitor shell) get
  // their updates from the App Store. Skip registration and the hourly
  // `version.json` poll entirely; the poll would only ever see the bundled
  // snapshot the wrapper shipped anyway. The Android TWA renders the live
  // site with the plain build, so it deliberately keeps this flow; the gate
  // is on the build's Vite mode (inlined in production builds), not on any
  // runtime wrapper flag.
  if (import.meta.env.MODE === "native") {
    return;
  }
  // Service workers only work in a secure context with SW support. Bail cleanly
  // otherwise — a non-browser environment, insecure `http://`, or a page opened
  // straight from `file://` — rather than let registration throw a
  // SecurityError. (localhost counts as secure, so dev/preview still register.)
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  // Surface an incoming build to the app at most once, keyed by its identity, so
  // the two detectors below (the service worker's onNeedRefresh and the
  // version.json poll) never double-prompt for the same build, while a genuinely
  // newer deploy still re-arms the prompt.
  let lastSurfacedKey: string | undefined;
  let hasSurfaced = false;
  const surface = (info: UpdateInfo | undefined, activate: () => Promise<void>) => {
    const key = info?.sha ?? info?.version;
    // Dedup so the two detectors (onNeedRefresh and the version.json backstop)
    // never double-prompt for one build. Once something has surfaced, skip a
    // repeat of the same key AND a keyless surface (a failed fetch carries no
    // identity to tell builds apart, so treat it as "already shown"); a genuinely
    // different key still re-arms the prompt.
    if (hasSurfaced && (key === undefined || key === lastSurfacedKey)) return;
    hasSurfaced = true;
    lastSurfacedKey = key;
    handlers.onUpdateAvailable(activate, info);
  };

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // The browser's built-in update check only runs on navigation, so for an
      // installed PWA left open across a release it effectively never fires. On
      // an hourly poll AND whenever the tab returns to the foreground:
      //   1. registration.update() re-fetches sw.js; a found update installs a
      //      waiting worker, which surfaces through onNeedRefresh (the normal
      //      path). This is what the stale-served sw.js used to block, and what
      //      the deploy's no-cache header on sw.js now restores.
      //   2. Backstop: a worker can reach "waiting" before the app attached its
      //      onNeedRefresh handler, so that event is occasionally missed. If one
      //      is waiting, confirm against the network-fresh version.json (never
      //      precached) and surface the prompt. Gating on an actual waiting
      //      worker keeps the activate honest: updateSW(true) always has a real
      //      worker to skip, so the prompt can never reload into the same build.
      // Both network calls are best-effort (offline / transient failure), and a
      // simple in-flight guard stops the interval and a visibilitychange that
      // land together from running two overlapping checks.
      if (!registration) return;
      let checking = false;
      const check = async () => {
        if (checking) return;
        checking = true;
        try {
          await registration.update().catch(() => {});
          if (!registration.waiting) return;
          const info = await fetchUpdateInfo();
          if (isDifferentBuild(info, __APP_VERSION__, __APP_SHA__)) {
            surface(info ?? undefined, () => updateSW(true));
          }
        } finally {
          checking = false;
        }
      };
      window.setInterval(() => void check(), UPDATE_POLL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void check();
      });
    },
    onNeedRefresh() {
      // A new worker is waiting. Don't touch it — fetch the incoming build's
      // notes/identity (best-effort), then hand the app an `activate` callback
      // (skipWaiting + reload onto the new assets) and let it decide when to
      // prompt the player. Until the player picks "update now", the new worker
      // keeps waiting and activates on the next cold reopen, so nothing is ever
      // force-reloaded out from under a live game.
      void (async () => {
        const info = await fetchUpdateInfo();
        surface(info ?? undefined, () => updateSW(true));
      })().catch(() => {
        // onUpdateAvailable only stores state + shows the chip, but guard anyway
        // so a throw here can't surface as an unhandled rejection.
      });
    },
    onOfflineReady() {
      handlers.onOfflineReady?.();
    },
  });
}
