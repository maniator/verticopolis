# Edge function setup (dev guide)

Spec-authored companion to `SPEC.md` (CAP-2) and `reverse-proxy.md`. Hands-on setup for the same-origin `/api/ingest` relay on this project's Vercel hosting. This is the HOW; the contract and rationale live in `reverse-proxy.md`. Skeletons below are illustrative; the Vercel Functions API and the PostHog capture shape change, so confirm both against their current docs when the implementation PR lands (flagged inline).

## Prerequisites

- A PostHog project (US or EU cloud). Copy its **project API key** (write key, `phc_...`) and note the ingestion host (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
- The existing Vercel project for `verticopolis.com` (this repo; `framework: null`, `outputDirectory: dist`).
- Vercel picks up an `/api` directory as Functions for any project, so no framework change is needed.

## 1. Environment variables (key stays server-side)

Set in the Vercel project (Settings, Environment Variables), mirrored to Production and Preview. Never commit these; never expose them to the client build.

```
POSTHOG_KEY   = phc_...                       # project write key, server-side only
POSTHOG_HOST  = https://us.i.posthog.com      # or the EU host
```

CLI equivalent:

```
vercel env add POSTHOG_KEY production
vercel env add POSTHOG_KEY preview
vercel env add POSTHOG_HOST production
vercel env add POSTHOG_HOST preview
```

Do NOT prefix these with `VITE_`: `VITE_`-prefixed vars are inlined into the client bundle by Vite, which is exactly what this design forbids. These are read only by the edge function at runtime.

## 2. The edge function: `api/ingest.ts`

```ts
// Vercel Edge Function. Files under /api are served at /api/<name>, so this
// answers POST /api/ingest by default. Confirm the edge-runtime export and the
// Request/Response signature against Vercel's current Functions docs.
export const config = { runtime: "edge" };

const HOST = process.env.POSTHOG_HOST;
const KEY = process.env.POSTHOG_KEY;

export default async function handler(req: Request, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  // Best-effort: a missing secret must never break the site.
  if (!HOST || !KEY) return new Response(null, { status: 204 });

  let body: { event?: string; properties?: Record<string, unknown>; session?: string; ts?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!body?.event || typeof body.event !== "string") return new Response(null, { status: 400 });

  // TODO(rate-limit): drop over-limit requests with 429 before forwarding
  // (a fixed window keyed on the edge request IP; see reverse-proxy.md).

  // Confirm the capture path and payload (distinct_id inside properties) against
  // PostHog docs.
  const payload = {
    api_key: KEY,
    event: body.event,
    timestamp: body.ts,
    properties: {
      distinct_id: body.session ?? "anon",
      $process_person_profile: false,
      ...(body.properties ?? {}),
      // Server-authoritative: read from Vercel, placed AFTER the client spread so
      // the client cannot override it. Separates preview from production in PostHog.
      environment: process.env.VERCEL_ENV ?? "unknown",
    },
  };
  // Truly non-blocking: hand the forward to the runtime context's waitUntil so the
  // 204 returns without waiting on PostHog latency, while the request is kept alive
  // until the POST settles. Using ctx.waitUntil (the Edge Function context arg)
  // avoids any @vercel/functions dependency. Confirm how the chosen runtime exposes
  // waitUntil; if it is unavailable, `await` the fetch instead and accept the added
  // client latency.
  ctx.waitUntil(
    fetch(`${HOST}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* best-effort: swallow */
    }),
  );
  return new Response(null, { status: 204 });
}
```

No `posthog-js`, no `posthog-node`: a bare `fetch`. The key is read from the environment, never from the request or the bundle.

## 2a. Environment separation (preview vs production)

Vercel injects `VERCEL_ENV` (`production` / `preview` / `development`) into the function at runtime. The handler stamps it as the `environment` property (above), read server-side and placed after the client props so it cannot be overridden. In PostHog, filter or segment by `environment` and default every dashboard to `environment = production`, so preview traffic (and any `development` events sent to the function directly, for example by curl under `vercel dev`) is captured but never blended into the production numbers. Note the in-browser adapter is dark on localhost, because the host gate allows only `verticopolis.com` and `*.vercel.app`, so full in-browser validation runs on a Vercel preview deployment, not `vercel dev`.

This is more reliable than a client-derived flag: the client bundle is identical across environments (it just POSTs to same-origin `/api/ingest`), so the only trustworthy environment signal is the one Vercel gives the function. Previews still emit (the `telemetryHostAllowed` gate already allows `*.vercel.app`), which is wanted: it lets a preview validate the pipeline before production.

Optional hard isolation: set a different `POSTHOG_KEY` per Vercel environment scope (a production-project key on Production, a separate preview-project key on Preview). Then preview events land in a separate PostHog project entirely, and the `environment` tag is a within-project backstop. Choose one approach; the tag alone is enough for this project's scale.

### Changing the proxy itself: how previews behave

Because the relay is same-origin, each deployment is self-contained: a preview at `<branch>.vercel.app` serves both the client and the branch's `api/ingest.ts`, and the client POSTs to `<branch>.vercel.app/api/ingest`, so the client and the proxy are always the same version in a given deployment. There is no version skew and no cross-talk with production.

That makes a proxy change safe to validate before it ships:

- The branch's preview runs the new function with `VERCEL_ENV=preview` (Preview-scoped `POSTHOG_KEY`/`HOST`), so its events land tagged `environment=preview`, never in production numbers.
- Production keeps serving its last-deployed function until the change merges; a broken proxy on a preview only affects that preview's own best-effort telemetry (a 204 or a dropped event), never the page and never production.
- To confirm a proxy change: open the preview URL, do a few actions, and read PostHog filtered to `environment=preview` (add `deployment=<branch>` by stamping `process.env.VERCEL_GIT_COMMIT_REF` if several previews run at once). Merge only after it looks right.
- Requirement: the Preview env-var scope must carry `POSTHOG_KEY`/`POSTHOG_HOST`, or the preview function no-ops (best-effort), and the change looks dead on the preview for the wrong reason.

## 3. Routing

- Files under `/api` are served at `/api/<name>`, so `api/ingest.ts` answers `POST /api/ingest` by default, with no extra config. The client (section 4) posts to `/api/ingest` to match. Confirm this against Vercel's current routing for a `framework: null` + Vite project.
- Optional shorter path: if you prefer `POST /ingest`, add a `vercel.json` rewrite of `/ingest` to `/api/ingest` (a route rewrite, which does not expose the key, unlike the rejected direct-to-PostHog rewrite in `reverse-proxy.md`) and point the client at `/ingest`.
- Ensure the existing `vercel.json` rewrites (`/help`, `/gallery`) and the SPA fallback do not swallow the analytics route; `/api/*` is matched before the SPA fallback, but verify after wiring.

## 4. Client adapter (CAP-1 side, sketch)

```ts
// Inside the single analytics adapter (CAP-1). No PostHog import.
const SESSION = crypto.randomUUID(); // session-scoped; as built, cached in sessionStorage (see reverse-proxy.md), never persisted across sessions

export function sendEvent(event: string, properties: Record<string, unknown>): void {
  if (!telemetryHostAllowed()) return; // the one gate, unchanged
  const body = JSON.stringify({ event, properties, session: SESSION, ts: new Date().toISOString() });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon("/api/ingest", body);
    else void fetch("/api/ingest", { method: "POST", body, keepalive: true });
  } catch {
    /* best-effort */
  }
}
```

Note: `new Date().toISOString()` runs in the browser adapter (allowed); the engine's no-wall-clock rule is about `src/engine/`, not telemetry.

## 5. Local development

- `vite` alone does not run `/api` functions. Use `vercel dev` to run and smoke-test the edge **function** (it serves the Vite build and the function together), with a local `.env` holding `POSTHOG_KEY`/`POSTHOG_HOST` (git-ignored). This is function-only: the in-browser adapter is dark on localhost (the host gate allows only `verticopolis.com` and `*.vercel.app`), so validate the function by curl here and do full end-to-end (browser to `/api/ingest` to PostHog) validation on a Vercel preview deployment.
- Smoke test: `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/ingest -H 'content-type: application/json' -d '{"event":"boot","properties":{}}'` should return `204`, and the event should appear in PostHog's Activity view within a minute.

## 6. Deploy

- Merging to `main` deploys as usual; the function ships with the env vars already set. Preview deployments get the Preview-scoped vars.
- Confirm in a Preview deploy first: watch the Network tab (or the beacon) hit `/api/ingest` same-origin, and confirm no request goes to a `posthog.com` domain and no cookie is set.

## 7. Dual-write and cutover (CAP-4 tie-in)

- During validation the adapter calls both the existing Vercel `track` and `sendEvent` above. Compare PostHog headline counts against the Vercel report for the same window (`reverse-proxy.md`, Cost and dual-write).
- Retire the Vercel path and delete the `analytics-report.mjs` percentile machinery only after parity holds.

## Verify-at-build checklist

- Vercel edge-runtime export syntax and the `Request`/`Response` handler signature.
- Whether `/api/ingest.ts` auto-serves at `/ingest` for this `framework: null` + Vite project, or needs a `vercel.json` route.
- PostHog capture endpoint path and payload field placement (`distinct_id` inside `properties`).
- Current PostHog free-tier event limit and the project's Vercel plan (see `reverse-proxy.md`, Cost).
