/**
 * The server-side core of the same-origin PostHog capture relay (spec CAP-2,
 * `reverse-proxy.md`). This module is pure and transport-agnostic: it takes a
 * web-standard `Request` plus injected dependencies (the environment secrets, a
 * `fetch`, a `waitUntil`, a clock, the resolved client IP, a rate limiter) and
 * returns a `Response`. All platform wiring lives in the thin `api/ingest.ts`
 * entry, so this logic stays fully unit-testable and carries no Vercel or DOM
 * dependency.
 *
 * What it does, per the spec:
 * - Accept only POST; other methods get 405.
 * - Reject a cross-site browser POST (a present, foreign `Origin`) with 403, so
 *   the public endpoint cannot be used as a cross-site spam target.
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
 */

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
  /** The rate limiter. Defaults to the module singleton; tests inject a fresh
   *  one to avoid shared state. */
  rateLimiter?: RateLimiter;
}

/** Requests allowed per IP per fixed window before a 429. A play session emits
 *  on the order of a few dozen events over minutes, so this is generous for
 *  legitimate use while capping a hostile burst. */
export const RATE_LIMIT_MAX = 100;
/** The fixed rate-limit window, in ms. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Hard ceiling on tracked IPs. The map never exceeds this: once full, the
 *  oldest entry is evicted on each new key, so a stream of unique IPs cannot grow
 *  memory without bound and each request stays O(1). */
export const RATE_LIMIT_MAX_KEYS = 10_000;
/** Largest ingest body accepted, in bytes. Events are a handful of primitive
 *  props, so this is generous while rejecting an oversized POST before it is
 *  parsed. Vercel's platform body limit is the outer backstop. */
export const MAX_BODY_BYTES = 8_192;

/**
 * A per-instance fixed-window rate limiter with a hard key ceiling. Best-effort
 * by design: serverless instances are ephemeral and requests spread across
 * several, so this caps abuse per instance rather than enforcing a global quota.
 * It holds only a count and a window start per IP, never the request content.
 * Memory is bounded: at the ceiling, inserting a new key evicts the oldest, so a
 * flood of unique keys cannot grow the map, and every operation is O(1).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly max: number = RATE_LIMIT_MAX,
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    private readonly maxKeys: number = RATE_LIMIT_MAX_KEYS,
  ) {}

  /** Record a hit for `key` at `now`; return false once the window is full. */
  allow(key: string, now: number): boolean {
    const rec = this.hits.get(key);
    if (rec && now - rec.windowStart < this.windowMs) {
      // Touch the key so any active key (hot or currently blocked) moves to the
      // newest position: `Map` insertion order does not update on `get`, so
      // without this a frequently-hit key could be the oldest and get evicted
      // below, resetting its window. Eviction then only ever removes idle keys.
      this.hits.delete(key);
      this.hits.set(key, rec);
      if (rec.count >= this.max) return false;
      rec.count += 1;
      return true;
    }
    // Start a fresh window for this key. At the ceiling, evict the oldest (least
    // recently touched) entry first, so a flood of unique keys cannot grow the
    // map and an active key is never the one dropped.
    this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, { count: 1, windowStart: now });
    return true;
  }
}

/** The process-wide limiter used by the real handler. */
const defaultLimiter = new RateLimiter();

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
 * Build the PostHog capture body from the client payload. Every server-authored
 * field (`distinct_id`, `$process_person_profile`, `environment`) is written
 * AFTER the client property spread, so a crafted client body can never override
 * them: it cannot spoof the session id, flip the no-person-profile posture, or
 * mislabel its environment. Junk shapes are neutralized here too (a non-object
 * `properties` is dropped, an empty or non-string `session` falls back to the
 * anonymous bucket, a non-ISO `ts` is omitted so PostHog defaults the time). The
 * `api_key` is deliberately not added here; the handler adds it only at the
 * forward so the key never passes through this pure builder.
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
      distinct_id: session,
      $process_person_profile: false,
      environment: environment ?? "unknown",
    },
  };
}

/**
 * Handle one ingest request. See the module comment for the full contract. Pure
 * apart from the injected `deps`, so every branch (405 / 204 no-op / 429 / 413 /
 * 400 / forward) is unit-testable.
 */
export async function handleIngest(request: Request, deps: IngestDeps): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  // Reject a cross-site browser POST before doing any work: a foreign Origin has
  // no business posting to our same-origin relay. Production trusts only the
  // custom domain, not the shared `*.vercel.app` suffix (see `originAllowed`).
  if (!originAllowed(request.headers.get("origin"), deps.environment)) {
    return new Response(null, { status: 403 });
  }

  // Best-effort: a missing secret must never break the site, so no-op with 204
  // (the same success shape a forwarded request returns) instead of erroring.
  const { key, host } = deps;
  if (!key || !host) return new Response(null, { status: 204 });

  // Rate-limit before any parsing or forwarding, so a flood is cheap to reject.
  const limiter = deps.rateLimiter ?? defaultLimiter;
  if (!limiter.allow(deps.clientIp, deps.now())) return new Response(null, { status: 429 });

  // Reject an oversized body before buffering it into memory.
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
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
