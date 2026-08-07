// Explicit .js extensions: Vercel compiles /api functions as ESM with nodenext
// resolution (package.json "type": "module"), which requires it. `api/tsconfig.json`
// uses nodenext too so `npm run typecheck` matches the Vercel build.
import { handleDesktopIngest } from "../../src/analyticsIngest.js";
import { vercelIngestDeps } from "../ingest.js";

/**
 * PostHog capture relay for the packaged desktop build (issue #781). Vercel
 * serves this file at `POST /api/ingest/desktop`, a sibling route to the web
 * relay's `POST /api/ingest`; the two coexist because the file and the directory
 * resolve to different paths.
 *
 * As thin as the web entry, and deliberately so: it reads nothing of its own,
 * borrowing the environment wiring from `api/ingest.ts` so the two routes cannot
 * read the secrets differently, and hands the request to
 * `handleDesktopIngest` in `src/analyticsIngest.ts`, which carries the whole
 * contract and its tests. That core shares the rate limiter, the body cap, the
 * validation, and every response shape with the web route, and differs only in
 * which origins it accepts and in stamping `platform` and `distribution_channel`
 * server-side.
 *
 * This is an UNAUTHENTICATED PUBLIC ENDPOINT whose origin filter is functional
 * rather than a security boundary; the core's module comment says why and what
 * actually bounds abuse. The desktop client that posts here (an absolute URL, a
 * consent gate, the shell's network allowlist) lands in later stages of the
 * epic, so this route has no caller yet.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleDesktopIngest(request, vercelIngestDeps(request));
  },
};
