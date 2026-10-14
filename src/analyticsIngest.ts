/**
 * The server-side core of the same-origin PostHog capture relay (spec CAP-2,
 * `reverse-proxy.md`). This module is pure and transport-agnostic: it takes a
 * web-standard `Request` plus injected dependencies (the environment secrets, a
 * `fetch`, a `waitUntil`, a clock, the resolved client IP, a rate limiter) and
 * returns a `Response`. All platform wiring lives in `api/_deps.ts` and the thin
 * route entries, so this logic stays fully unit-testable and carries no Vercel
 * or DOM dependency.
 *
 * What it does, per the spec:
 * - Accept only POST; other methods get 405.
 * - Reject a POST whose `Origin` the route does not accept with 403 (a filter
 *   with a narrower reach than it may read; see the note further down).
 * - No-op with 204 when the PostHog secrets are absent, so a missing env var can
 *   never break the site (telemetry is best-effort).
 * - Rate-limit per client IP with a fixed window; over-limit requests get 429
 *   and are never forwarded. The IP is resolved by the caller from Vercel's
 *   trusted source, so it is not client-spoofable.
 * - Reject an oversized or malformed body before forwarding (413 / 400).
 * - Forward the event to PostHog's capture API with the project key read
 *   server-side (never from the request, never echoed back), the anonymous
 *   posture pinned server-side (`$process_person_profile: false`), and the
 *   deployment `environment` stamped from `VERCEL_ENV` so preview and production
 *   never blend.
 * - Respond 204 immediately and let the forward settle in the background
 *   (`waitUntil`), so the client never waits on PostHog latency. Nothing on the
 *   forward path can throw past the 204.
 * - Never set a cookie. Never echo the key. The client IP is used only as the
 *   rate-limit key and is never logged or forwarded.
 *
 * The capture path and payload shape (`/capture/`, `distinct_id` inside
 * `properties`, `$process_person_profile`) were verified against PostHog's
 * current capture API docs at implementation time.
 *
 * THE ROUTE IS AN UNAUTHENTICATED PUBLIC ENDPOINT, and its origin filter is
 * functional rather than a security boundary. There is no token and no session,
 * and an absent `Origin` header passes, so the route is postable by anyone with
 * `curl`. A browser does attach its true `Origin` to a cross-origin POST, which
 * keeps an ordinary page on a named host out, and that is all the filter does.
 *
 * What bounds abuse is the per-IP rate limiter (best-effort and per instance;
 * see {@link RateLimiter}) and the 8 KiB body cap, which bounds the bytes
 * actually read rather than trusting a declared `content-length`. A forged
 * post's blast radius is anonymous noise in the dataset: no key, no cookie, no
 * response body. `platform` and `distribution_channel` pass only when they
 * carry a label from the client's closed set ({@link INGEST_PLATFORM_LABELS});
 * any other value is rewritten to `"unknown"`, so a forged body cannot add a
 * value to either dimension (GH #788). It can still pick one of the real labels.
 */

import { defaultRateLimiter, RateLimiter } from "./analyticsRateLimit.js";

// The limiter lives in its own module (see `analyticsRateLimit.ts`); it is
// re-exported here so importers and tests keep this file as the single entry
// point for the ingest core.
export { RateLimiter, RATE_LIMIT_MAX, RATE_LIMIT_MAX_KEYS, RATE_LIMIT_WINDOW_MS } from "./analyticsRateLimit.js";

/** The minimal request body the client relay posts (see the client transport in
 *  a later story). No API key, no cookie. All fields are untrusted. */
export interface IngestBody {
  event?: unknown;
  properties?: unknown;
  session?: unknown;
  ts?: unknown;
}

/** The PostHog capture body this relay builds, minus the server-side `api_key`
 *  (added only at the forward so the key never flows through the pure builder). */
export interface CaptureBody {
  event: string;
  timestamp?: string;
  properties: Record<string, unknown>;
}

/** Injected dependencies, so the core stays pure and testable. */
export interface IngestDeps {
  /** PostHog project write key, read server-side from the environment. */
  key: string | undefined;
  /** PostHog ingestion host, for example `https://us.i.posthog.com`. */
  host: string | undefined;
  /** Vercel's `VERCEL_ENV` (`production` / `preview` / `development`). */
  environment: string | undefined;
  /** The `fetch` used for the server-to-PostHog forward. */
  fetchImpl: typeof fetch;
  /** Keeps the function alive for the background forward without blocking the
   *  204 (Vercel's `waitUntil`; a no-op stand-in is fine in tests). */
  waitUntil: (promise: Promise<unknown>) => void;
  /** Current time in ms, for the rate-limit window (injected for determinism). */
  now: () => number;
  /** The client IP, resolved by the caller from Vercel's trusted source
   *  (`ipAddress`), used only as the rate-limit key. Never logged or forwarded. */
  clientIp: string;
  /** The rate limiter. Defaults to {@link defaultRateLimiter}; tests inject a
   *  fresh one to avoid shared state. */
  rateLimiter?: RateLimiter;
}

/** Largest ingest body accepted, in bytes. Events are a handful of primitive
 *  props, so this is generous while rejecting an oversized POST before it is
 *  parsed. Vercel's platform body limit is the outer backstop. */
export const MAX_BODY_BYTES = 8_192;

/**
 * Read a request body as text, giving up as soon as it passes `max` bytes.
 *
 * The declared `content-length` is only a cheap early reject: a chunked POST
 * omits it, and nothing makes a client tell the truth in it (GH #789). This
 * counts the bytes as they stream in and cancels the read at the first chunk
 * that passes the cap, so at most the cap plus one platform chunk is held,
 * however long the body is. Returns `null` when
 * the cap was passed. A request with no body reads as empty text. Decoding
 * matches `Request.json()`: UTF-8, with a leading byte-order mark dropped.
 */
export async function readCappedText(request: Request, max: number): Promise<string | null> {
  const stream = request.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      // Not awaited: a source whose cancel never settles must not hold the 413.
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Normalize the configured host: strip surrounding whitespace (env vars often
 *  pick it up from a copy/paste) and every trailing slash, so `${host}/capture/`
 *  is a valid, non-doubled URL rather than a silently dropped forward. */
function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, "");
}

/** True for a plain JSON object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Same-origin guard for the public POST endpoint. A browser always sends an
 * `Origin` header on a cross-origin POST (even a "simple" `text/plain` one that
 * skips the CORS preflight), so a present-but-foreign origin means another site
 * is trying to use the relay as a spam target and is rejected. An absent `Origin`
 * (a non-browser client, the `curl` smoke test) cannot be checked, so it is
 * allowed.
 *
 * The check is environment-aware. Our own domain (the apex `verticopolis.com` and
 * any subdomain, for example a `*.preview.verticopolis.com` preview deployment) is
 * always trusted. The shared `*.vercel.app` suffix is trusted only on a KNOWN
 * non-production deployment (a truthy `VERCEL_ENV` that is not `production`, so an
 * absent env fails closed): it is common to every Vercel customer, so any site on
 * it could otherwise pass, but a preview's own origin is `<branch>.vercel.app` and preview
 * traffic is isolated from production (the `environment` tag, a preview-scoped key
 * when configured, and Vercel deployment protection). In production the only real
 * origin is our own domain, so the shared suffix is refused there. (One deliberate
 * asymmetry: the client `telemetryHostAllowed` cannot read `VERCEL_ENV`, so it
 * trusts `*.vercel.app` in every context; a production visit via the raw
 * `*.vercel.app` deploy URL therefore emits client-side but is refused here. That
 * is rare and accepted, since production traffic comes from the custom domain.)
 *
 * IMPORTANT: this host set mirrors `telemetryHostAllowed` in `telemetry.ts` (the
 * client-side gate that decides where the browser emits). Change the two together:
 * the client emits from there, the server accepts here, and a drift silently drops
 * events (client dark, or a 403 on a same-origin beacon).
 */
export function originAllowed(origin: string | null, environment: string | undefined): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  // Strip a trailing dot so the canonical absolute FQDN (`verticopolis.com.`) is
  // matched like the usual form. Mirror this in `telemetryHostAllowed`.
  host = host.replace(/\.$/, "");
  if (host === "verticopolis.com" || host.endsWith(".verticopolis.com")) return true;
  // Trust the shared *.vercel.app suffix only when we KNOW we are non-production
  // (a truthy VERCEL_ENV other than "production"). An absent or empty VERCEL_ENV
  // (a misconfiguration) falls through to the strict default below rather than
  // failing open into trusting a suffix common to every Vercel customer.
  if (environment && environment !== "production") return host.endsWith(".vercel.app");
  return false;
}

/**
 * The closed set of `platform` and `distribution_channel` labels the route
 * forwards. It restates `PLATFORM_LABELS` from `analyticsEnrichment.ts`
 * because this module stays free of the client tree; a test pins the two
 * together so they cannot drift.
 */
export const INGEST_PLATFORM_LABELS: readonly string[] = ["web", "twa"];

/** The value a label outside {@link INGEST_PLATFORM_LABELS} is rewritten to. */
export const INGEST_PLATFORM_FALLBACK = "unknown";

/** The client dimensions held to {@link INGEST_PLATFORM_LABELS}. */
const CLOSED_DIMENSIONS = ["platform", "distribution_channel"] as const;

/**
 * Hold each closed dimension the client sent to the known labels. An absent
 * dimension stays absent; a present one outside the set (any string or a
 * non-string) becomes {@link INGEST_PLATFORM_FALLBACK}.
 */
function closedDimensions(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CLOSED_DIMENSIONS) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
    const value = props[key];
    out[key] =
      typeof value === "string" && INGEST_PLATFORM_LABELS.includes(value) ? value : INGEST_PLATFORM_FALLBACK;
  }
  return out;
}

/**
 * Build the PostHog capture body from the client payload. Every server-authored
 * field (`distinct_id`, `$process_person_profile`, `$geoip_disable`,
 * `environment`) is written AFTER the client property spread, so a crafted client
 * body can never override them: it cannot spoof the session id, flip the
 * no-person-profile posture, re-enable GeoIP, or mislabel its environment. Junk
 * shapes are neutralized here too (a non-object `properties` is dropped, an empty
 * or non-string `session` falls back to the anonymous bucket, a non-ISO `ts` is
 * omitted so PostHog defaults the time, and a `platform` or
 * `distribution_channel` outside the closed set becomes `"unknown"`). The
 * `api_key` is deliberately not added here; the handler adds it only at the
 * forward so the key never passes through this pure builder.
 *
 * `$geoip_disable: true` is deliberate. We never forward the player's IP (raw IP
 * is a spec non-goal), so the only IP PostHog would see is the relay's own egress
 * (the Vercel function's region), which made every event geo-locate to one
 * datacenter. Disabling GeoIP drops that misleading, uniform location data and
 * keeps us IP-free, rather than forwarding the client IP to get real geography.
 */
export function buildCaptureBody(
  body: IngestBody & { event: string },
  environment: string | undefined,
): CaptureBody {
  const session =
    typeof body.session === "string" && body.session.length > 0 ? body.session : "anon";
  const hasValidTs = typeof body.ts === "string" && Number.isFinite(Date.parse(body.ts));
  const props = isPlainObject(body.properties) ? body.properties : {};
  return {
    event: body.event,
    ...(hasValidTs ? { timestamp: body.ts as string } : {}),
    properties: {
      ...props,
      ...closedDimensions(props),
      distinct_id: session,
      $process_person_profile: false,
      $geoip_disable: true,
      environment: environment ?? "unknown",
    },
  };
}

/**
 * Handle one request to the relay (`POST /api/ingest`), the browser's
 * same-origin path, bound by `api/ingest.ts`. See the module comment for the
 * full contract. Pure apart from the injected `deps`, so every branch (405 /
 * 403 / 204 no-op / 429 / 413 / 400 / forward) is unit-testable.
 */
export async function handleIngest(request: Request, deps: IngestDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  // Reject a foreign Origin before doing any work.
  if (!originAllowed(request.headers.get("origin"), deps.environment)) {
    return new Response(null, { status: 403 });
  }

  // Best-effort: a missing secret must never break the site, so no-op with 204
  // (the same success shape a forwarded request returns) instead of erroring.
  const { key, host } = deps;
  if (!key || !host) return new Response(null, { status: 204 });

  // Rate-limit before any parsing or forwarding, so a flood is cheap to reject.
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  if (!limiter.allow(deps.clientIp, deps.now())) return new Response(null, { status: 429 });

  // Reject a declared-oversized body before reading anything. This is only the
  // cheap path: the read below enforces the cap on the bytes themselves.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let text: string | null;
  try {
    text = await readCappedText(request, MAX_BODY_BYTES);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (text === null) return new Response(null, { status: 413 });

  let body: IngestBody;
  try {
    // The body TEXT is parsed whatever the `content-type` header says, which is
    // what makes `navigator.sendBeacon` work: with a string it sends
    // `text/plain`.
    body = JSON.parse(text) as IngestBody;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!isPlainObject(body)) return new Response(null, { status: 400 });
  const event = typeof body.event === "string" ? body.event.trim() : "";
  if (event.length === 0) return new Response(null, { status: 400 });
  if (body.properties !== undefined && !isPlainObject(body.properties)) {
    return new Response(null, { status: 400 });
  }

  const captureBody = buildCaptureBody({ ...body, event }, deps.environment);
  // Non-blocking: return 204 now, let the forward settle in the background. The
  // key is added only here, server-side. The whole forward is wrapped so nothing
  // on it (a synchronous `fetch` throw on a malformed host, a `waitUntil` hiccup)
  // can escape past the 204; a rejected forward is swallowed too. The relay is
  // best-effort, so a PostHog outage never surfaces to the client.
  try {
    deps.waitUntil(
      deps
        .fetchImpl(`${normalizeHost(host)}/capture/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ api_key: key, ...captureBody }),
        })
        .then((res) => {
          // Surface a failed forward in the server runtime logs. `fetch` resolves
          // (does not reject) on an HTTP error, so a wrong `POSTHOG_KEY` returns a
          // 401 that would otherwise fail completely silently. Log the status only,
          // never the key or the payload. Still best-effort: the client already got
          // its 204.
          if (!res.ok) console.warn(`analytics relay: PostHog capture returned ${res.status}`);
        })
        .catch(() => {
          /* network failure (offline, DNS): best-effort, stays silent */
        }),
    );
  } catch {
    /* best-effort: a forward that cannot even be dispatched is dropped silently */
  }
  return new Response(null, { status: 204 });
}
