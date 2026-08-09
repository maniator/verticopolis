import type { EventProps } from "./analyticsAdapter";

/**
 * Cookieless client transport for the same-origin PostHog relay (spec CAP-2, S3).
 * It posts typed events to our own `/api/ingest` (the S2 function forwards them
 * to PostHog with the project key server-side), so neither `posthog-js` nor the
 * project key ships in the client. Sending prefers `navigator.sendBeacon` (it
 * survives page-hide, which matters for `session_end`) and falls back to `fetch`
 * with `keepalive`. Best-effort and never-throw; since the D-1 cutover this is
 * the only custom-event transport (the dual-write window is closed).
 *
 * The desktop build is the one exception to "same-origin", and only to that: it
 * posts the same bodies to {@link DESKTOP_INGEST_URL} instead, because a
 * packaged shell has no server behind its own origin. Everything else about the
 * transport (the payload, the per-session id, the never-throw posture) is shared,
 * so there is one relay rather than two.
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

/**
 * The desktop build's ingest URL, absolute because it has to be: a packaged
 * shell loads from its own app protocol, so `/api/ingest` would resolve through
 * the protocol handler and 404. It names the production domain outright, which
 * is also what the shell's network allowlist and its `connect-src` are pinned to
 * (one URL, by full prefix, in the distribution repo).
 *
 * Its server half is `POST /api/ingest/desktop` (`api/ingest/desktop.ts`, guarded
 * by `desktopOriginAllowed`), a route that refuses every web host just as
 * `originAllowed` refuses the shell's origin. The two ingest paths are separate
 * end to end and must stay that way.
 */
export const DESKTOP_INGEST_URL = "https://verticopolis.com/api/ingest/desktop";

/**
 * Where one build posts. Desktop gets the absolute URL above; every other mode
 * keeps the unchanged relative path, so the web, TWA, and iOS builds send
 * exactly what they sent before.
 *
 * Pure and mode-taking so both directions are assertable: under vitest
 * `import.meta.env.MODE` is always `"test"`, so a live-read-only version could
 * never be shown to pick the desktop URL for anything.
 */
export function ingestEndpoint(mode: string): string {
  return mode === "desktop" ? DESKTOP_INGEST_URL : INGEST_PATH;
}

/**
 * The `fetch` fallback's init for one build.
 *
 * Desktop adds `mode: "no-cors"` and nothing else. The desktop route sends no
 * CORS response headers and answers `OPTIONS` with 405 (issue #791), so the
 * request has to stay a SIMPLE request: a JSON `content-type`, or any custom
 * header, would trigger a preflight that the route refuses, and the event would
 * never arrive. No header is set here for exactly that reason, and the relay
 * parses the body text without consulting `content-type`, so nothing is lost.
 *
 * The consequence is worth stating plainly, because it shapes everything
 * downstream: under `no-cors` the response is OPAQUE. The client cannot read the
 * status, so it cannot see a 429 rate limit or a 400 rejection, and there is
 * nothing to react to even in principle. Every desktop send is fire-and-forget:
 * no retry, no backoff, no error surface. That is also why an offline send is
 * simply dropped rather than queued (see `desktopConsent.ts`).
 *
 * `sendBeacon` is untouched by any of this. It has always been a simple,
 * no-cors-by-definition POST, so the preferred path needed no change at all.
 */
export function relayFetchInit(mode: string, body: string): RequestInit {
  // `keepalive` lets the request outlive a page-hide, matching sendBeacon.
  const init: RequestInit = { method: "POST", body, keepalive: true };
  if (mode === "desktop") init.mode = "no-cors";
  return init;
}

/** The body shape the relay expects (matches `IngestBody` on the server side).
 *  `properties` is widened to arbitrary JSON here (not just the primitive
 *  `EventProps` the gameplay vocabulary uses) so the error path can carry the
 *  nested `$exception_list` PostHog Error Tracking expects; the server accepts
 *  any plain-object `properties` and spreads it through untouched. */
interface RelayBody {
  event: string;
  properties: Record<string, unknown>;
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
 * Post one event to the relay. Best-effort and never-throw: a serialization
 * failure or a transport hiccup drops the event silently rather than surfacing to
 * the caller (the host gate and the game loop live upstream in `analytics.ts` and
 * `analyticsErrors.ts`). Shared by the typed gameplay path ({@link sendToRelay})
 * and the error path ({@link sendException}).
 */
function postToRelay(event: string, properties: Record<string, unknown>): void {
  let body: string;
  try {
    const payload: RelayBody = {
      event,
      properties,
      session: sessionId(),
      ts: new Date().toISOString(),
    };
    body = JSON.stringify(payload);
  } catch {
    return; // an unserializable payload is dropped, never thrown
  }
  // One mode read feeds both transports, so the beacon and the fallback can
  // never post to different places.
  const mode = import.meta.env.MODE;
  const endpoint = ingestEndpoint(mode);
  try {
    // Prefer sendBeacon (survives page-hide). It returns false when the user
    // agent cannot queue the payload (buffer full); fall through to fetch then.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(endpoint, body)) return;
    }
    // The returned promise is caught so a rejected fetch (offline, DNS) cannot
    // become an unhandled rejection: the whole path stays best-effort. A desktop
    // send is opaque as well as best-effort, so there is nothing here to inspect
    // and nothing to retry; the event is simply gone.
    void fetch(endpoint, relayFetchInit(mode, body)).catch(() => {});
  } catch {
    /* best-effort telemetry; never block the caller */
  }
}

/**
 * Post one typed gameplay event to the relay. The primitive-only `EventProps`
 * keeps the typed vocabulary honest at the call site; the transport itself does
 * not care about the shape.
 */
export function sendToRelay(event: string, props: EventProps): void {
  postToRelay(event, props);
}

/**
 * Post a `$exception` event for cookieless error tracking (see
 * `analyticsErrors.ts`). Kept off the adapter seam by design: `$exception` is a
 * PostHog Error Tracking event with a nested `$exception_list` that only the
 * relay understands, so it goes straight through here.
 * Same never-throw transport, same per-tab session id as every other event, so an
 * error report correlates with the play session it came from.
 */
export function sendException(properties: Record<string, unknown>): void {
  postToRelay("$exception", properties);
}
