---
id: SPEC-analytics-posthog-migration
companions:
  - ../../project-context.md
  - reverse-proxy.md
  - edge-fn-setup.md
  - transparency-note.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Derived from `.memlog.md` (the decision of record); do not hand-edit, re-derive through bmad-spec.

# Analytics migration: Vercel Web Analytics to cookieless PostHog (rule D-1)

## Why

The full-repository-audit (2026-07-21) opened D-1 (issue #542): stay on Vercel Web Analytics, or migrate to cookieless PostHog for session-level analytics. Vercel Web Analytics is aggregate-only (no session id, no percentile function, a truncated top-100 group-by), so the shipped `analytics-report.mjs` reconstructs approximate percentiles from value histograms and cannot do per-session or per-tool correlation. A first analytics party ran on stale data (a ~1,100-commit-behind checkout) and argued against migrating; a reanalysis said "Vercel now, PostHog on a trigger." A fresh 2-day analytics-report run, validated live (production serves the insights and speed-insights scripts at HTTP 200, the event endpoint 400-validates a junk payload, and every custom event is wired to a real game action), returned 329 sessions, 197 boots, and roughly 113 unique visitors in two days, not the audit's dozen per thirty days. The trigger fired. The owner ruled D-1: migrate. Migrating does not unlock cross-session retention (cookieless PostHog has no identity either); it buys exact percentiles, per-session and per-tool correlation, a real funnel, and a platform dimension, at real current traffic.

## Capabilities

- **CAP-1: One-file analytics adapter seam**
  - **intent:** the vendor and transport live in exactly one adapter module; the typed event vocabulary (`game_started`, `first_build`, `tool_used`, `star_reached`, `boot`, `crash`, `update`, plus the session-depth events) and every call site are unchanged; a provider swap is a one-file diff.
  - **success:** grep finds no `@vercel/analytics` or PostHog import outside the single adapter; a stub adapter drives the whole vocabulary in tests; switching transports touches exactly one file.

- **CAP-2: Cookieless PostHog transport via a same-origin serverless relay (no posthog-js SDK)**
  - **intent:** the CAP-1 adapter POSTs typed events (event plus props, no key, no cookie) to a same-origin ingest path served by a Vercel edge function that forwards to PostHog's capture API with the project key read server-side from the environment; `posthog-js` is not shipped, so there is no SDK bundle weight and no key in the client. Within-session correlation comes from a per-session `distinct_id` created lazily and cached in `sessionStorage` (session-scoped: it survives a mid-play reload, so an "Update now" or WebGL-recovery reload keeps one play session as one analytics session, but it is cleared when the tab closes and is never persisted across sessions), so cross-session identity is deliberately absent. The mechanism is specified in `reverse-proxy.md`.
  - **success:** the shipped bundle contains no PostHog SDK and no project key; a network trace shows events posting to the same origin, never a PostHog domain; no cookie, no `localStorage` id, and no id persisted across sessions is set; events in one play session share a session-scoped id (kept in `sessionStorage` so a mid-play reload does not fragment the session) while a new tab starts fresh; disabling the transport degrades to best-effort no-throw.

- **CAP-3: Event enrichment that pays off with per-session correlation**
  - **intent:** add the platform dimension (`web` / `twa` / `ios`) as an event prop, resolving AUD-036; model the first-tower funnel (`game_started` then `first_build` then `star_reached(2)`) as a real funnel; keep the on-device `returning` signal derived off the onboarding-seen flag (cookieless has no cross-session id, so `returning` stays an anonymous on-device bucket); and unlock the per-tool and per-session splits the Vercel report could not compute.
  - **success:** PostHog shows a platform breakdown, the three-step funnel with real drop rates, returning-versus-new by depth, and per-tool per-session distributions.

- **CAP-4: Report re-target and tooling retirement**
  - **intent:** retarget the analytics report to PostHog queries and retire the percentile-reconstruction machinery in `analytics-report.mjs` once cutover is confirmed; `session_fps` (issue #538) emits raw values into the surviving stack; then stop the client dual-write so the relay is the only event transport.
  - **success:** exact percentiles and per-session correlation come from PostHog queries, not histogram reconstruction; the `analytics-report.mjs` percentile code is deleted (done, PR #692); the AUD-034 truncation caveat is gone; `track` (the custom-event side of `@vercel/analytics`) is called nowhere, while the seam keeps the page-level pair (`@vercel/speed-insights` plus the `@vercel/analytics` page-view inject); the transparency note copy is live in the shipped game.

## Constraints

- **Cookieless and consent-free by construction.** PostHog runs in memory-persistence mode: no cookie, no localStorage identifier, no cross-session or cross-device identity, and no consent banner as the price of pressing Play. The privacy posture is unchanged from the Vercel baseline. This is the load-bearing invariant.
- **No project key in the public bundle.** A same-origin serverless relay forwards events to PostHog server-side; the write key lives in the deployment environment (`POSTHOG_KEY`), never in the shipped bundle; the relay is rate-limited against abuse. See `reverse-proxy.md`.
- **Near-zero mobile bundle, verified.** Because `posthog-js` is not shipped (events flow through the thin same-origin relay), the client delta is a small `fetch` or `sendBeacon` adapter, not a ~50 KB SDK. The gzipped delta and any cold-start cost are still measured on a mid-tier phone against the render-perf error budget and must stay under a concrete ceiling: a net delta of at most 5 KB gzipped with no measurable cold-start regression, and the implementation PR records the actual measured number. Render performance is the audit's number-one risk, so this is a hard gate.
- **One gate for every surface.** `telemetryHostAllowed` stays the single predicate every telemetry call obeys; the native Capacitor shell, localhost, and the e2e `vite preview` server stay dark by it (Vercel preview deployments on `*.vercel.app` do emit, tagged `environment=preview`, so a preview can validate the pipeline); no second divergent gate. The typed vocabulary and the never-throw best-effort guarantee are preserved across the swap.
- **Dual-write validation window (closed 2026-07-29).** Both Vercel and PostHog received events in parallel from S3 (PR #582), with both reports rendered side by side from S5 (PR #604). The owner ruled the retirement on 2026-07-29 (report path in PR #692, client path in this story), superseding a formal headline-count write-up. The retirement boundary is events-versus-pages: PostHog owns every custom event, and Vercel keeps the page-level pair, both cookieless and same-origin. Speed Insights (Core Web Vitals) is KEPT (no replacement in the cookieless setup), and the `@vercel/analytics` page-view inject is KEPT inject-only (visits, paths, referrers; `track` is never called). Pre-agreed exit: if Vercel ever gates the page-view side, a `$pageview` through the relay replaces it, no re-litigation.
- **Preview and production are separated server-side.** The relay stamps an `environment` property from Vercel's `VERCEL_ENV` (`production` / `preview` / `development`), read server-side and not client-overridable; PostHog dashboards default to `environment = production` so preview and local traffic is captured for pipeline validation but never blended into production numbers. See `edge-fn-setup.md`.
- **Process.** Spec-first. The decision is ruled; the work sequences as seam, reverse proxy, cookieless transport swap, event enrichment, report re-target, dual-write, retire. Each PR passes four quality gates and `/gds-code-review` in-session (analytics correctness is gameplay-progression semantics, per the TDT-is-storage-but-gds-reviewed precedent); the player-facing transparency note is updated; a version bump applies only where a player-facing surface changes.

## Non-goals (parked and named)

- **The true cross-session cohort retention curve** (day-7 and day-30 unique-return rate), churn, and per-cohort funnels. Cookieless PostHog has no cross-session identity, so this migration does not unlock retention; it stays gated on a future funded identity decision (the E4 monetization gate).
- **Cookies, any cross-session or cross-device identifier, and a consent banner.**
- **Session replay, autocapture, DOM or pointer or keystroke capture, PII, and raw IP.**
- **Any PostHog project key in the shipped bundle.**
- **Native-shell telemetry.** The iOS Capacitor shell stays a separate decision; this SPEC does not turn it on.

## Success signal

After cutover, PostHog answers what Vercel only approximated: exact percentiles, per-tool and per-session splits, a real first-tower funnel, and a platform breakdown, at a measured mobile bundle cost under the stated budget, cookieless and banner-free. Cutover complete means: the `analytics-report.mjs` percentile machinery deleted (PR #692), `track` called nowhere (custom events relay-only), the page-level pair (Speed Insights and the page-view inject) retained by recorded decision with its exit clause, and the transparency note live in the shipped game.

## Assumptions

- Measured production traffic (validated 2026-07-21/22: 329 sessions and roughly 113 unique visitors in two days, pipeline confirmed live and correctly wired) sits well inside PostHog's free tier and justifies exact per-session analytics now.
- A same-origin reverse proxy to PostHog is deployable on the project hosting (a Vercel rewrite or an edge function) so the key stays server-side.
- Cookieless memory-persistence PostHog preserves the no-identity posture that keeps the game consent-banner-free, matching current Vercel behavior.
