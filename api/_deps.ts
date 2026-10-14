import { ipAddress, waitUntil } from "@vercel/functions";
// Explicit .js extension: Vercel compiles /api functions as ESM with nodenext
// resolution (package.json "type": "module"), which requires it. `api/tsconfig.json`
// uses nodenext too so `npm run typecheck` matches the Vercel build.
import type { IngestDeps } from "../src/analyticsIngest.js";

/**
 * The platform reads the ingest route binds: the secrets, the environment, the
 * clock, and the trusted client IP. A shared module rather than a route:
 * Vercel's builder skips any function path containing `/_`, so the leading
 * underscore keeps the file from being served as `/api/_deps`.
 */

/**
 * Build the injected dependencies for one request.
 *
 * No rate limiter is passed, so the route falls through to the core's module
 * singleton, which is per function instance. The limiter is
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
