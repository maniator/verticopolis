/**
 * The Player's Manual offline, on both sides (owner, 2026-11-20).
 *
 * The manual's pages register its worker (src/manual/manualWorker.ts), and
 * once that worker has saved the manual, they set the `vc_manual` cookie to
 * the manual's host. The game reads that cookie before it opens Help offline:
 * with the manual saved it opens the tab as usual, and the worker answers it;
 * without, it says the manual needs the internet, as before.
 *
 * A cookie, because the manual on its own host (help.verticopolis.com) cannot
 * reach the game's storage; on that host it is shared with every
 * verticopolis.com host, as the `vc_scheme` cookie is. It holds the manual's
 * host and nothing else. A build that keeps the manual under /help on the
 * game's host writes it for that host only. The value names the host so the
 * production manual's cookie, which staging can see, never tells a staging
 * game that its own /help copy is saved.
 */

import { HELP_ADDRESS } from "../helpAddress";

/** The cookie that says the manual is saved on this device. */
export const MANUAL_COOKIE = "vc_manual";

/** Browsers cap a cookie's life at 400 days. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * The cookie line that marks the manual saved for `host`. On the manual's own
 * host it is shared with every verticopolis.com host, so the game sees it;
 * anywhere else it stays on `host`.
 */
export function manualCookie(host: string): string {
  const shared = host === HELP_ADDRESS ? "; Domain=verticopolis.com" : "";
  return `${MANUAL_COOKIE}=${host}${shared}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}

/** Whether `cookies` (a `document.cookie` line) says the manual at `host` is
 *  saved. Two cookies of that name can show (the shared one and a host's own),
 *  so any of them counts. */
export function manualSavedFor(cookies: string, host: string): boolean {
  return cookies.split(";").some((part) => part.trim() === `${MANUAL_COOKIE}=${host}`);
}

/** The service worker calls the manual's pages make, so a test can stand in. */
export interface ManualWorkerHost {
  register(url: string, options: { scope: string }): Promise<unknown>;
  readonly ready: Promise<unknown>;
}

/** What {@link saveManualOffline} needs from the page. */
export interface SaveManualDeps {
  /** `navigator.serviceWorker`, or null where there is none (an insecure
   *  page, a browser without workers, some private windows). */
  readonly workers: ManualWorkerHost | null;
  readonly doc: Pick<Document, "cookie">;
  /** The page's host. */
  readonly host: string;
  /** Counts the first save on this device (`help_offline_saved`). */
  readonly track: () => void;
}

/**
 * Register the manual's worker at `base` (the site's base, "" or "/help"),
 * and once a worker is active (its install saved every page), mark the
 * manual saved, counting it the first time. Refreshes the cookie's life on
 * every page. Never throws: a refused worker or blocked cookies leave the
 * manual online only, as before.
 */
export async function saveManualOffline(base: string, deps: SaveManualDeps): Promise<void> {
  if (!deps.workers) return;
  try {
    await deps.workers.register(`${base}/sw.js`, { scope: `${base}/` });
    await deps.workers.ready;
    const first = !manualSavedFor(deps.doc.cookie, deps.host);
    deps.doc.cookie = manualCookie(deps.host);
    if (first && manualSavedFor(deps.doc.cookie, deps.host)) deps.track();
  } catch {
    // No worker, or no cookie: the manual stays online only.
  }
}

/** The host the game's manual lives on: its own in a production build
 *  (`helpOrigin`), else the game's. */
export function manualHost(helpOrigin: string, gameHost: string): string {
  if (!helpOrigin) return gameHost;
  try {
    return new URL(helpOrigin).host;
  } catch {
    return gameHost;
  }
}
