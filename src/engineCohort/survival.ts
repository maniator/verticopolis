import { HEARTBEAT_MS, STALE_MS, exitCleanly, heartbeat, stepAside, type PageLife } from "./crashMarker";
import type { KeyValueStore } from "./records";

/**
 * Keeps this page life's crash-marker entry honest (#1197, spec section 3):
 * a heartbeat every `HEARTBEAT_MS` while the page is visible, the entry
 * removed when the page is hidden (a crashed tab never reports a hide), and
 * added back when the page is visible again. Removing it on hide also keeps a
 * phone that discards a backgrounded tab from counting as a crash.
 *
 * A hide removes only this page's own entry: a page that hid and then
 * crashed has not shown that the build runs, so earlier stale entries stay
 * and still count. Only a `pagehide` from a page that ran visibly on Rust for
 * at least `STALE_MS` also clears this build's stale entries.
 */

interface SurvivalHost {
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  every: (fn: () => void, ms: number) => unknown;
  cancel: (t: unknown) => void;
  now: () => number;
}

const browserHost = (): SurvivalHost => ({
  doc: document,
  win: window,
  every: (fn, ms) => setInterval(fn, ms),
  cancel: (t) => clearInterval(t as ReturnType<typeof setInterval>),
  now: () => Date.now(),
});

/** Start watching; returns a function that stops and leaves the entry as it is. */
export function watchSurvival(store: KeyValueStore | null, page: PageLife, host: SurvivalHost = browserHost()): () => void {
  // Visible time on Rust so far, and when the current visible spell began.
  let visibleMs = 0;
  let visibleSince: number | null = null;
  const settle = (now: number) => {
    if (visibleSince !== null) visibleMs += Math.max(0, now - visibleSince);
    visibleSince = null;
  };
  const beat = () => {
    if (host.doc.visibilityState !== "visible") return;
    const now = host.now();
    if (visibleSince === null) visibleSince = now;
    heartbeat(store, page, now);
  };
  const onVisibility = () => {
    if (host.doc.visibilityState === "hidden") {
      settle(host.now());
      stepAside(store, page);
    } else beat();
  };
  const onPageHide = () => {
    const now = host.now();
    settle(now);
    if (visibleMs >= STALE_MS) exitCleanly(store, page, now);
    else stepAside(store, page);
  };
  // A page restored from the back-forward cache may report no visibility change.
  const onPageShow = () => beat();
  host.doc.addEventListener("visibilitychange", onVisibility);
  host.win.addEventListener("pagehide", onPageHide);
  host.win.addEventListener("pageshow", onPageShow);
  const timer = host.every(beat, HEARTBEAT_MS);
  // A page that started in the background (a background tab, a restored
  // session) has no heartbeat yet, so its boot entry would go stale while it
  // is alive. It drops its own entry and adds it back when first shown.
  onVisibility();
  return () => {
    host.doc.removeEventListener("visibilitychange", onVisibility);
    host.win.removeEventListener("pagehide", onPageHide);
    host.win.removeEventListener("pageshow", onPageShow);
    host.cancel(timer);
  };
}
