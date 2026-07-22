import type { EventProps } from "./analyticsAdapter";

/**
 * Cookieless client transport for the same-origin PostHog relay (spec CAP-2, S3).
 * It posts typed events to our own `/api/ingest` (the S2 function forwards them
 * to PostHog with the project key server-side), so neither `posthog-js` nor the
 * project key ships in the client. Sending prefers `navigator.sendBeacon` (it
 * survives page-hide, which matters for `session_end`) and falls back to `fetch`
 * with `keepalive`. Best-effort and never-throw, exactly like the Vercel `track`
 * path it runs alongside during the dual-write window.
 *
 * Within-session correlation comes from the per-session id (see {@link
 * sessionId}), created lazily on the first send and cached in `sessionStorage` so
 * it survives a reload within the tab (an "Update now" or WebGL-recovery resume
 * reload, or a manual refresh): every event from one continuous play session
 * shares it, instead of a new id per reload fragmenting the session. The id is
 * cleared when the tab closes, so a genuinely new tab starts a fresh session and
 * nothing points back to the visitor across sessions or devices (the lone edge is
 * browser tab-duplication / session-restore, which copies `sessionStorage` within
 * the same device and browsing lineage, briefly continuing the id: rare and
 * privacy-benign). It is minted on first send rather than at module load because
 * `crypto.randomUUID` is secure-context-only and evaluating it eagerly could
 * throw at import. `sessionStorage` is not a cookie or a `localStorage`
 * identifier, so this stays the cookieless posture that keeps the game
 * consent-banner-free.
 */

/** The same-origin relay path. No key, no cookie, no third-party domain. */
const INGEST_PATH = "/api/ingest";

/** The body shape the relay expects (matches `IngestBody` on the server side). */
interface RelayBody {
  event: string;
  properties: EventProps;
  session: string;
  ts: string;
}

/** The `sessionStorage` key the per-session id rides. `sessionStorage` (NOT
 *  `localStorage`) is deliberate: it survives a reload WITHIN a tab, so an
 *  app-initiated resume reload (an "Update now" reload, a WebGL-context-recovery
 *  reload) or a manual refresh keeps one continuous play session as ONE analytics
 *  session, instead of minting a new id each reload and fragmenting it. It is
 *  cleared when the tab closes, so a genuinely new tab starts a fresh session and
 *  nothing links a visitor across sessions or devices. The one edge: browser
 *  "Duplicate Tab" (and same-tab session-restore) copies `sessionStorage`, so a
 *  duplicated tab briefly continues the same id, on the same device and browsing
 *  lineage. That is rare and privacy-benign: still no cookie, no `localStorage`
 *  id, and no cross-device or persisted-across-sessions identity, so the
 *  cookieless, consent-banner-free posture holds. */
const SESSION_KEY = "vc-analytics-session";

/** In-memory memo of the per-session id for this page's life; seeded from
 *  `sessionStorage` on first use so a reload continues the same session. */
let session: string | undefined;

/** A best-effort id for a context without a secure `crypto.randomUUID` (plain
 *  HTTP, an older WebView, the native shell). Correlation degrades to a
 *  lower-entropy id rather than the module throwing. */
function fallbackId(): string {
  return `s-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** The session id persisted for this tab, or undefined when absent or storage is
 *  unavailable. Wrapped: `sessionStorage.getItem` throws in some privacy modes,
 *  and a throw must degrade to a fresh in-memory id, never break the send path. */
function readStoredSession(): string | undefined {
  try {
    const stored = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
    return typeof stored === "string" && stored.length > 0 ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort persist of the session id. A throw (private mode, disabled
 *  storage) is swallowed: the id still works in memory for this page, it just
 *  won't survive a reload (today's pre-fix behavior). */
function storeSession(id: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* private mode / disabled storage: degrade to in-memory only */
  }
}

/**
 * The per-session id, created on first use and memoized. Resolution order:
 * in-memory memo, then the value persisted for this tab (so a reload continues
 * the same session), then a freshly minted id that is persisted for the tab.
 * Everything runs INSIDE the never-throw send path, not at module load:
 * `crypto.randomUUID` is secure-context-only, so evaluating it eagerly at import
 * could throw and crash boot before any host gate runs. An absent or throwing
 * `randomUUID`, or unavailable storage, falls back instead.
 */
function sessionId(): string {
  if (session !== undefined) return session;
  const stored = readStoredSession();
  if (stored !== undefined) {
    session = stored;
    return session;
  }
  let minted: string;
  try {
    minted =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : fallbackId();
  } catch {
    minted = fallbackId();
  }
  session = minted;
  storeSession(minted);
  return session;
}

/**
 * Post one typed event to the relay. Best-effort and never-throw: a serialization
 * failure or a transport hiccup drops the event silently rather than surfacing to
 * the caller (the host gate and the game loop live upstream in `analytics.ts`).
 */
export function sendToRelay(event: string, props: EventProps): void {
  let body: string;
  try {
    const payload: RelayBody = {
      event,
      properties: props,
      session: sessionId(),
      ts: new Date().toISOString(),
    };
    body = JSON.stringify(payload);
  } catch {
    return; // an unserializable payload is dropped, never thrown
  }
  try {
    // Prefer sendBeacon (survives page-hide). It returns false when the user
    // agent cannot queue the payload (buffer full); fall through to fetch then.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(INGEST_PATH, body)) return;
    }
    // `keepalive` lets the request outlive a page-hide, matching sendBeacon. The
    // returned promise is caught so a rejected fetch (offline, DNS) cannot become
    // an unhandled rejection: the whole path stays best-effort.
    void fetch(INGEST_PATH, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    /* best-effort telemetry; never block the caller */
  }
}
