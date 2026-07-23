/**
 * The PWA install seam: captures the browser's install offer and reports what
 * install path (if any) a plain-web session can take. Sibling of `pwa.ts` (the
 * update flow). Pure of any UI: the affordance controller (`game/installAffordance`)
 * reads this and drives the chip / menu / iOS how-to. SPEC-pwa-install.
 *
 * `beforeinstallprompt` can fire during initial load, so {@link initPwaInstall}
 * must run as early as the boot flow allows (before the game constructs).
 */

/** The `beforeinstallprompt` event, not in every TS lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
let notifyChange: (() => void) | null = null;
let onInstalledCb: (() => void) | null = null;
let listenersInstalled = false;
let bipHandler: ((e: Event) => void) | null = null;
let installedHandler: (() => void) | null = null;

/**
 * Install the capture listeners and/or update the callbacks. `onChange` fires
 * when installability appears (a captured `beforeinstallprompt`) or the app is
 * installed; `onInstalled` fires on a successful install (for analytics).
 *
 * Split from the affordance controller ON PURPOSE: `beforeinstallprompt` can
 * fire during the initial page load, before the game constructs, so the boot
 * flow calls this ONCE with no callbacks as early as it runs (to catch an early
 * event into `deferred`), and the controller calls it again with its callbacks.
 * The listeners bind exactly once; every call refreshes the callbacks (a later
 * call never clobbers a set callback to null, and never double-binds). Inert
 * without a `window`.
 */
export function initPwaInstall(opts: { onChange?: () => void; onInstalled?: () => void } = {}): void {
  if (typeof window === "undefined") return;
  if (opts.onChange) notifyChange = opts.onChange;
  if (opts.onInstalled) onInstalledCb = opts.onInstalled;
  if (listenersInstalled) return; // idempotent: never double-bind
  listenersInstalled = true;
  bipHandler = (e: Event) => {
    // Keep the browser's own mini-infobar from auto-surfacing; the offer is
    // ours to place (in-game, play-gated), never an unsolicited pop.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notifyChange?.();
  };
  installedHandler = () => {
    installedThisSession = true;
    deferred = null; // no longer promptable
    onInstalledCb?.();
    notifyChange?.();
  };
  window.addEventListener("beforeinstallprompt", bipHandler);
  window.addEventListener("appinstalled", installedHandler);
}

/** True when this session is already running as an installed app: the
 *  standalone display mode, the iOS `navigator.standalone` flag, or an install
 *  that completed this session. Such a session is offered nothing. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return displayStandalone || iosStandalone || installedThisSession;
}

/** True on iOS, where no browser fires `beforeinstallprompt` and there is no
 *  programmatic install: the honest path is Add-to-Home-Screen instructions.
 *  Covers iPadOS masquerading as desktop Safari (MacIntel + touch points). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

/** True when a native install sheet is ready to prompt (a captured event). */
export function canPromptInstall(): boolean {
  return deferred !== null;
}

export type InstallAvailability = "prompt" | "ios-howto" | "none";

/**
 * What install path a not-standalone session can offer: `prompt` when a native
 * install sheet is captured (one tap), `ios-howto` on iOS (Add-to-Home-Screen
 * steps), `none` when there is nothing to offer (already installed, or a
 * browser that has not made the app installable). A standalone/TWA session is
 * always `none`.
 */
export function installAvailability(): InstallAvailability {
  if (isStandalone()) return "none";
  if (canPromptInstall()) return "prompt";
  if (isIos()) return "ios-howto";
  return "none";
}

/**
 * Trigger the native install sheet. The deferred event is a ONE-SHOT: it is
 * cleared before the await so a rapid second activation can't double-prompt or
 * reuse a spent event, and a stray dismissal elsewhere never burns it (only
 * this deliberate call consumes it). Returns the outcome, or `unavailable`
 * when no event was captured.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  deferred = null; // consume the one-shot up front
  notifyChange?.();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome;
}

/** Test-only reset: clears singletons AND removes the window listeners so a
 *  suite's re-inits do not accumulate handlers. */
export function __resetPwaInstallForTest(): void {
  if (typeof window !== "undefined") {
    if (bipHandler) window.removeEventListener("beforeinstallprompt", bipHandler);
    if (installedHandler) window.removeEventListener("appinstalled", installedHandler);
  }
  deferred = null;
  installedThisSession = false;
  notifyChange = null;
  onInstalledCb = null;
  listenersInstalled = false;
  bipHandler = null;
  installedHandler = null;
}
