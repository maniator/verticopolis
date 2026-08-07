import { ipAddress, waitUntil } from "@vercel/functions";
// Explicit .js extension: Vercel compiles /api functions as ESM with nodenext
// resolution (package.json "type": "module"), which requires it. `api/tsconfig.json`
// uses nodenext too so `npm run typecheck` matches the Vercel build.
import type { IngestDeps } from "../src/analyticsIngest.js";

/**
 * One place for the platform reads both ingest routes bind: the same secrets,
 * the same environment, the same clock, and the same trusted client IP. Both
 * entries (`api/ingest.ts` and `api/ingest/desktop.ts`) import
 * {@link vercelIngestDeps} rather than copying it, so the two routes cannot end
 * up reading the environment differently.
 *
 * This is a shared module rather than a route. Vercel's builder skips any
 * function path containing `/_`, so the leading underscore is what keeps the
 * file from being served as `/api/_deps`. It sits here rather than inside
 * `api/ingest.ts` so that neither route imports the other: a route file doubling
 * as a library would pull the web route's module scope into the desktop
 * function's bundle, and Vercel reads static config from an entrypoint only, so
 * a future `export const config` on `api/ingest.ts` would apply to that route
 * and silently miss the desktop one.
 */

/**
 * Build the injected dependencies for one request.
 *
 * No rate limiter is passed, so each route falls through to the core's module
 * singleton. That singleton is per module instance, and Vercel builds each route
 * under `api/` as its own function, so in production the two routes hold
 * SEPARATE per-IP budgets and posting to both buys two windows. The limiter is
 * best-effort abuse damping rather than a quota; see `RateLimiter` in
 * `src/analyticsIngest.ts`.
 */
export function vercelIngestDeps(request: Request): IngestDeps {
  return {
    // Trim so stray whitespace from a copy/pasted env var does not disable the
    // relay (an empty string after trimming falls through to the 204 no-op).
    key: process.env.POSTHOG_KEY?.trim(),
    host: process.env.POSTHOG_HOST?.trim(),
    environment: process.env.VERCEL_ENV,
    fetchImpl: fetch,
    waitUntil,
    now: Date.now,
    // Vercel's trusted client IP. `ipAddress()` reads exactly one header,
    // `x-real-ip`, with no `x-forwarded-for` fallback; Vercel's edge sets that
    // header on every request, so the value is not client-spoofable. Used only
    // as the rate-limit key, never logged or forwarded. Where the header is
    // absent (`vercel dev`, or any non-Vercel host) every client collapses onto
    // the single "unknown" key, so one noisy client would 429 everyone. That is
    // theoretical on Vercel and real locally.
    clientIp: ipAddress(request) ?? "unknown",
  };
}
