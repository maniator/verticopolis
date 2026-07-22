---
title: "Analytics migration: Vercel Web Analytics to cookieless PostHog (rule D-1)"
type: "epic"
created: "2026-07-22"
status: "in-progress"
spec: "../specs/spec-analytics-posthog-migration/SPEC.md"
adr: "../planning-artifacts/prds/prd-mobile-distribution-2026-07-08/decision-log.md (entry 14)"
rules: "D-1 (#542), specced in PR #571"
---

## What this tracks

The story sequence that carries the D-1 ruling (migrate off Vercel Web Analytics to
a cookieless PostHog relay) from the current single-vendor code to the shipped
migration. The SPEC and its companions (`reverse-proxy.md`, `edge-fn-setup.md`,
`transparency-note.md`) are the canonical contract; this file is only the running
order and status. If they disagree, the SPEC wins. Recreate this file from the
SPEC's "Process" constraint if it is ever lost.

## Hard invariants (every story obeys)

- Cookieless: no cookie, no localStorage identifier, no cross-session or
  cross-device identity, no consent banner. This is the load-bearing invariant.
- `posthog-js` is never shipped. The client sends typed events by
  `fetch`/`sendBeacon` to a same-origin `/api/ingest`; a Vercel edge function
  forwards to PostHog with the key server-side (`POSTHOG_KEY`/`POSTHOG_HOST`,
  never `VITE_`-prefixed, never in the bundle).
- One gate: `telemetryHostAllowed`, unchanged. Every telemetry call is
  best-effort and never throws past its caller.
- Environment split is server-side via `VERCEL_ENV` (production / preview /
  development), not client-derived.
- The measured mobile bundle delta stays at most 5 KB gzipped with no cold-start
  regression; the implementing PR records the measured number.
- Cross-session retention stays OUT of scope (parked): cookieless PostHog has no
  identity, so it needs a future funded identity decision (the E4 gate).

## Process (per story)

One story per PR. Each PR passes the four quality gates (typecheck, lint, test,
build) and runs `/gds-code-review` in-session (analytics correctness is
gameplay-progression semantics, per the TDT-is-storage-but-gds-reviewed
precedent). Fix every `patch` finding; record every `defer` finding in
`backlog.md` and keep the backlog-to-issue mirror true. Merge commits only, no
em-dashes in new prose. A version bump applies only where a player-facing surface
changes. Verify version-sensitive Vercel and PostHog API details against current
docs at build time (the `edge-fn-setup.md` verify-at-build checklist); do not
guess.

## Stories

| ID | Story | CAP | Review | Version bump | Status |
|----|-------|-----|--------|--------------|--------|
| S1 | Extract the vendor and transport into one adapter behind the typed `note*` vocabulary. Vercel stays byte-identical; stub adapter for tests; no `@vercel/analytics` import outside the adapter. | CAP-1 | `/gds-code-review` | none (internal) | done (PR #577) |
| S2 | `api/ingest.ts` relay: forward to PostHog capture, key server-side, `VERCEL_ENV` tag, rate-limit, non-blocking forward, plus the Vercel env vars. | CAP-2 | `/gds-code-review` | none (server-only) | done (PR #580) |
| S3 | Cookieless client transport: `sendBeacon` to `/api/ingest`, in-memory session id, dual-write to both Vercel and PostHog. Measure the mobile bundle delta and record it. | CAP-2 | `/gds-code-review` | none (no player-facing surface) | in-progress |
| S4 | Event enrichment: `platform` prop (resolves AUD-036), on-device returning and tenure buckets, the first-tower funnel. | CAP-3 | `/gds-code-review` | as measured | todo |
| S5 | Re-target the report to PostHog queries; `session_fps` (#538) emits raw values into the surviving stack. | CAP-4 | `/gds-code-review` | none (tooling) | todo |
| S6 | Confirm dual-write parity, then retire Vercel: delete the `analytics-report.mjs` percentile machinery, ship the transparency note. Speed Insights keep-or-drop recorded here. | CAP-4 | `/gds-code-review` | patch | todo |

## S1 seam (as built)

- `src/analyticsAdapter.ts` is the single vendor seam: it owns the only
  `@vercel/analytics` and `@vercel/speed-insights` imports and exposes the
  vendor-neutral `AnalyticsAdapter` (`send`, `injectPageTelemetry`).
  `vercelAdapter` is the production binding; `setAnalyticsAdapter` swaps it (the
  S2/S3 provider swap is a new adapter plus that one binding).
- `src/analytics.ts` (`trackEvent`) and `src/telemetry.ts`
  (`injectVercelTelemetry`) reach the vendor only through `analyticsAdapter()`.
  The host gate and the never-throw try/catch stay with those callers, unchanged.
- `src/analyticsAdapter.test.ts` drives the whole typed vocabulary through a stub
  adapter and asserts the vendor is untouched while the stub is active, proving a
  transport swap is a one-file change.

## S2 relay (as built)

- `src/analyticsIngest.ts` is the pure, fully tested server core: method gate
  (405), best-effort 204 no-op when the secrets are absent, per-IP fixed-window
  rate limit (429), body validation (400), and the PostHog capture forward with
  the key added server-side only at the forward. `buildCaptureBody` writes the
  server-authoritative fields (`distinct_id`, `$process_person_profile: false`,
  `environment` from `VERCEL_ENV`) AFTER the client property spread, so a crafted
  client body cannot spoof the session, flip the no-person-profile posture, or
  mislabel its environment.
- `api/ingest.ts` is the thin Vercel entry (served at `POST /api/ingest`). It
  reads `POSTHOG_KEY` / `POSTHOG_HOST` / `VERCEL_ENV` from the environment and
  delegates to the core. The four gates cover `api/` too: `api/tsconfig.json`
  plus a chained `tsc` in the `typecheck` script, and `eslint src api` with an
  `api/**` rule block.
- **Runtime deviation from the spec, verified against current docs.** The spec
  sketched a Vercel Edge Function (`export const config = { runtime: "edge" }`
  with the context `waitUntil`). Vercel deprecated the Edge runtime in mid-2026
  and now recommends Node.js-runtime Functions with the web-standard `fetch`
  handler, so S2 ships that instead, with `waitUntil` from the `@vercel/functions`
  package (server-only, never in the client bundle). This is exactly the
  verify-at-build substitution the spec's `edge-fn-setup.md` anticipated. The
  cookieless and non-blocking properties are unchanged.
- **Env vars are set at deploy time in the Vercel project.** `POSTHOG_KEY` and
  `POSTHOG_HOST` live in the Vercel project (Production and Preview scopes), never committed.
  Until they are set the relay no-ops with 204, so merging this is safe before the
  secrets exist.
- PostHog capture contract (`POST {host}/capture/`, `api_key` at the top level,
  `distinct_id` inside `properties`, `$process_person_profile: false`, ISO
  `timestamp`) confirmed against PostHog's current capture API docs.
- **Same-origin guard decision (from #580 review).** `originAllowed` rejects a
  cross-site browser POST with 403. It is environment-aware: production trusts
  only `verticopolis.com`, never the shared `*.vercel.app` suffix (common to every
  Vercel customer). `*.vercel.app` is accepted only on preview and development,
  whose own origin is `<branch>.vercel.app` and whose traffic is auth-gated (Vercel
  deployment protection) and isolated by the `environment` tag. Vercel's paid
  preview-suffix (a `verticopolis.com` preview subdomain) would let the
  `.vercel.app` branch be dropped everywhere, but it was judged not worth the cost:
  production, the only public endpoint, is already locked to the custom domain.

## S3 client transport (as built)

- `src/analyticsRelay.ts` is the cookieless client transport: `sendToRelay` posts
  `{ event, properties, session, ts }` to same-origin `/api/ingest` via
  `navigator.sendBeacon` (fetch `keepalive` fallback). No `posthog-js`, no key.
  The per-session id is a `crypto.randomUUID()` created lazily on the first send
  (with a `Math.random` fallback for a non-secure context) and never persisted, so
  a new tab is a new session and there is no cross-session identity. It is made on
  first send rather than at module load so an absent or throwing `randomUUID`
  cannot crash boot. Best-effort and never-throw.
- `dualWriteAdapter` in `analyticsAdapter.ts` is the new default active adapter:
  every event goes to BOTH Vercel `track` and `sendToRelay`, independently (a
  Vercel throw cannot suppress the relay write), so the two feeds can be compared
  before Vercel is retired at S6. Page-view and Core Web Vitals inject stays
  Vercel-only. The host gate and never-throw guarantee are unchanged (upstream in
  `analytics.ts`).
- **Measured mobile bundle delta: +0.23 KB gzipped** (the `telemetry` chunk went
  from 4.72 to 4.95 KB gzipped; all other chunks flat). Far under the 5 KB ceiling,
  as expected: the client gains a small `sendBeacon` function; a full SDK would
  have added roughly 50 KB.
  No cold-start regression by construction: the transport runs only on an event
  (nothing runs at module load; the session id is minted lazily on the first
  send). The on-device frame-health number rides the perf harness when a device
  run is taken.
