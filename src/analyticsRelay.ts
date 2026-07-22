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
 * Within-session correlation comes from {@link SESSION}, a per-session id made
 * once in memory at module load and NEVER written to storage: every event from
 * one play session shares it, a new tab starts a fresh one, and nothing points
 * back to the visitor across sessions. This is the cookieless, memory-persistence
 * posture that keeps the game consent-banner-free.
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

/** Per-session id: in memory only, never persisted, so a new tab is a new session
 *  and there is no cross-session identity. Created lazily on first send (see
 *  {@link sessionId}), never at module load. */
let session: string | undefined;

/** A best-effort id for a context without a secure `crypto.randomUUID` (plain
 *  HTTP, an older WebView, the native shell). Correlation degrades to a
 *  lower-entropy in-memory id rather than the module throwing. */
function fallbackId(): string {
  return `s-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The per-session id, created on first use and memoized. It is generated INSIDE
 * the never-throw send path, not at module load: `crypto.randomUUID` exists only
 * in a secure context, so evaluating it eagerly at import could throw and crash
 * boot before any host gate runs. Here an absent or throwing `randomUUID` falls
 * back instead.
 */
function sessionId(): string {
  if (session === undefined) {
    try {
      session =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : fallbackId();
    } catch {
      session = fallbackId();
    }
  }
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
