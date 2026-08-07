import { ipAddress, waitUntil } from "@vercel/functions";
// Explicit .js extension: Vercel compiles /api functions as ESM with nodenext
// resolution (package.json "type": "module"), which requires it. `api/tsconfig.json`
// uses nodenext too so `npm run typecheck` matches the Vercel build.
import { handleIngest, type IngestDeps } from "../src/analyticsIngest.js";

/**
 * Same-origin PostHog capture relay (spec CAP-2). Vercel serves this file at
 * `POST /api/ingest`. It is a thin binding: it reads the server-side secrets and
 * `VERCEL_ENV` from the environment and hands the request to the pure core in
 * `src/analyticsIngest.ts`, which carries the whole contract and its tests.
 *
 * Runtime note: this is a Node.js-runtime Vercel Function using the web-standard
 * `fetch` handler. The spec sketched a Vercel Edge Function, but Vercel
 * deprecated the Edge runtime (mid-2026) in favor of Node.js functions, so the
 * `runtime = "edge"` export and the context `waitUntil` arg are gone; `waitUntil`
 * now comes from `@vercel/functions`. This was confirmed against Vercel's current
 * Functions docs, per the spec's verify-at-build checklist. The client bundle is
 * unaffected: `@vercel/functions` is server-only and never imported by the game.
 *
 * The secrets (`POSTHOG_KEY`, `POSTHOG_HOST`) live only in the Vercel project
 * environment (Production and Preview scopes), never in the repo or the bundle.
 * With them unset the relay no-ops with 204, so a missing secret cannot break the
 * site.
 */

/**
 * The platform reads both ingest routes bind: the same secrets, the same
 * environment, the same clock, and the same trusted client IP. Exported and
 * imported by the desktop entry (`api/ingest/desktop.ts`) rather than copied, so
 * the two routes cannot end up reading the environment differently. Kept here
 * rather than in a shared `api/` module because every file under `api/` is a
 * route, and this file is the one that already owns the wiring.
 *
 * No rate limiter is passed, so both routes fall through to the core's module
 * singleton and share one per-IP budget.
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
    // Vercel's trusted client IP (it overwrites `x-forwarded-for` at the edge,
    // so this is not client-spoofable). Used only as the rate-limit key.
    clientIp: ipAddress(request) ?? "unknown",
  };
}

export default {
  fetch(request: Request): Promise<Response> {
    return handleIngest(request, vercelIngestDeps(request));
  },
};
