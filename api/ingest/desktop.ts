// Explicit .js extensions: Vercel compiles /api functions as ESM with nodenext
// resolution (package.json "type": "module"), which requires it. `api/tsconfig.json`
// uses nodenext too so `npm run typecheck` matches the Vercel build.
import { handleDesktopIngest } from "../../src/analyticsIngest.js";
import { vercelIngestDeps } from "../_deps.js";

/**
 * PostHog capture relay for the packaged desktop build (issue #781). Vercel
 * serves this file at `POST /api/ingest/desktop`, a sibling route to the web
 * relay's `POST /api/ingest`; the two coexist because the file and the directory
 * resolve to different paths.
 *
 * As thin as the web entry, and deliberately so: it reads nothing of its own,
 * taking the environment wiring from the shared `api/_deps.ts` so the two routes
 * cannot read the secrets differently, and hands the request to
 * `handleDesktopIngest` in `src/analyticsIngest.ts`, which carries the whole
 * contract and its tests. That core shares the rate-limiting, body-cap,
 * validation, and response-shape code with the web route, and differs only in
 * which origins it accepts and in stamping `platform` and `distribution_channel`
 * server-side. The rate-limit STATE is not shared once deployed: each route is
 * built as its own function with its own module instance, so each holds its own
 * per-IP budget.
 *
 * This is an UNAUTHENTICATED PUBLIC ENDPOINT whose origin filter is functional
 * rather than a security boundary; the core's module comment says why and what
 * actually bounds abuse. The desktop client that posts here (an absolute URL, a
 * consent gate, the shell's network allowlist) lands in later stages of the
 * epic, so this route has no caller yet.
 *
 * NOTE FOR THE CLIENT STAGE: this route sends no CORS response headers and
 * answers a preflight `OPTIONS` with 405. A cross-origin request that would need
 * a preflight therefore fails before it reaches the handler, so the client has
 * to post in a form that stays a simple request: `navigator.sendBeacon`, or a
 * `no-cors` `fetch` with a simple content type. The core parses the body text
 * and ignores `content-type`, which is what makes both of those work. Nothing
 * can read the response either way, and the relay's answers carry no body.
 */
export default {
  fetch(request: Request): Promise<Response> {
    return handleDesktopIngest(request, vercelIngestDeps(request));
  },
};
