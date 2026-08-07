// Explicit .js extensions: Vercel compiles /api functions as ESM with nodenext
// resolution (package.json "type": "module"), which requires it. `api/tsconfig.json`
// uses nodenext too so `npm run typecheck` matches the Vercel build.
import { handleIngest } from "../src/analyticsIngest.js";
import { vercelIngestDeps } from "./_deps.js";

/**
 * Same-origin PostHog capture relay (spec CAP-2). Vercel serves this file at
 * `POST /api/ingest`. It is a thin binding: the environment wiring (the
 * server-side secrets, `VERCEL_ENV`, the clock, the trusted client IP) comes
 * from `api/_deps.ts`, shared with the desktop route, and the request goes to
 * the pure core in `src/analyticsIngest.ts`, which carries the whole contract
 * and its tests.
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

export default {
  fetch(request: Request): Promise<Response> {
    return handleIngest(request, vercelIngestDeps(request));
  },
};
