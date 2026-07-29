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
- One gate: `telemetryHostAllowed` stays the single client-side predicate every
  telemetry call obeys (its host set is mirrored server-side by `originAllowed` on
  the relay; change the two together). Every telemetry call is best-effort and
  never throws past its caller.
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
| S3 | Cookieless client transport: `sendBeacon` to `/api/ingest`, in-memory session id, dual-write to both Vercel and PostHog. Measure the mobile bundle delta and record it. | CAP-2 | `/gds-code-review` | none (no player-facing surface) | done (PR #582) |
| S4 | Event enrichment: `platform` prop (resolves AUD-036), on-device returning and tenure buckets, the first-tower funnel. | CAP-3 | `/gds-code-review` | none (analytics-only, no player-facing surface) | done (PR #597) |
| S5 | Re-target the report to PostHog queries; `session_fps` (#538) emits raw values into the surviving stack. | CAP-4 | `/gds-code-review` | minor (`session_fps` emission) | done (PR #604) |
| S5b | Cookieless JS error tracking: `$exception` through the relay (follow-up feature, not a CAP story). | CAP-2 posture | `/bmad-code-review` | minor (new emission) | done (PR #608) |
| S5c | Error-tracking enhancements + app-chrome telemetry: WebGL crashes to Error Tracking (synthetic `$exception`), top-level `$exception_type`, and one `app_action` event for the save/export/import/TDT/dialog/toggle/page surface (design-partied). Spec: `spec-posthog-error-tracking`. | see spec CAP-1..4 | `/bmad-code-review` | minor (new emissions) | in review |
| S6 | Retire Vercel custom events after the owner closed the dual-write window (2026-07-29): the whole typed vocabulary goes relay-only and `track` is called nowhere; the transparency note ships player-facing. Recorded keeps: Speed Insights AND the `@vercel/analytics` page-view inject (inject-only; visits, paths, referrers), the events-versus-pages boundary with a relay `$pageview` as the pre-agreed exit if Vercel gates it. The report half (delete `scripts/analytics-report.mjs`, its tests, docs, and workflow step) landed early in PR #692; the client half is PR #693. | CAP-4 | `/gds-code-review` | patch | done (PR #692 + PR #693) |

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

## Gate alignment + forward logging (follow-up to S3)

- **Both host gates now recognize our own domain.** `telemetryHostAllowed`
  (client, `telemetry.ts`) and `originAllowed` (server, `analyticsIngest.ts`) both
  allow `verticopolis.com` and any `.verticopolis.com` subdomain, so a custom
  preview-suffix deployment (`*.preview.verticopolis.com`) emits from the client
  and is accepted by the relay. Without this the client was dark on the custom
  preview domain (the beacon never fired), which would have made the S6 dual-write
  parity check impossible to validate on preview. The two host sets carry
  reciprocal cross-reference comments (change one, change the other), and a
  prefix-glued look-alike test on both gates locks the `.verticopolis.com` dot
  boundary so a future edit cannot silently regress it. They are not identical
  predicates: the client cannot read `VERCEL_ENV`, so it trusts `*.vercel.app`
  everywhere while the server refuses that shared suffix in production.
- **`*.vercel.app` is kept, and stays production-strict on the server.** The raw
  Vercel deploy URL (`verticopolis-<hash>.vercel.app`) still exists alongside the
  custom preview alias, so dropping it would 403 a preview opened via that URL.
  `originAllowed` trusts `*.vercel.app` only outside production; production trusts
  only our own domain. (Decision reached in a party-mode review: the shared suffix
  is a preview-only, auth-gated, rate-limited exposure, and the paid Vercel
  preview-suffix was judged not worth it since production is already apex-locked.)
- **Server-side forward logging.** The relay's PostHog forward now logs a non-2xx
  response (for example a wrong-key 401) to the server console, which lands in
  Vercel's runtime logs. `fetch` resolves rather than rejects on an HTTP error, so
  this is the only place a bad key would otherwise fail silently. Status only,
  never the key or the payload. The client stays silent by design (best-effort
  misses are expected and logging them would just be player-console noise).

## Relay correctness follow-ups (geoIP + session continuity)

Two small fixes found while validating the live pipeline in PostHog, shipped
together ahead of S5 so the data goes clean immediately (decided in party-mode).

- **GeoIP disabled at the relay.** `buildCaptureBody` now writes
  `$geoip_disable: true` as a server-authoritative prop (after the client
  spread, un-overridable). We never forward the player's IP (raw IP is a spec
  non-goal), so PostHog was GeoIP-ing the only IP it saw: the relay's own Vercel
  egress, making every event geo-locate to one datacenter (Ashburn VA / `iad1`).
  Disabling the enrichment drops that misleading uniform location and keeps us
  IP-free, rather than forwarding the client IP to get real geography.
- **Session id survives a reload within the tab.** The client session id
  (`analyticsRelay.ts`) now rides `sessionStorage` instead of a bare in-memory
  variable, so an app-initiated resume reload (an "Update now" reload, a
  WebGL-context-recovery reload) or a manual refresh keeps one continuous play
  session as ONE analytics session, instead of minting a new id per reload and
  fragmenting it. Still cookieless: `sessionStorage` is cleared on tab close, so a
  genuinely new tab is a fresh session and nothing links a visitor across sessions
  or devices (no cookie, no `localStorage` id, no consent banner). The one edge is
  browser "Duplicate Tab" / session-restore, which copies `sessionStorage` on the
  same device and browsing lineage, so a duplicated tab briefly continues the id;
  rare and privacy-benign (no cross-device or persisted-across-sessions identity).
  Wrapped never-throw: a private-mode storage throw degrades to the old in-memory
  behavior.
- **SPEC CAP-2 amended to match.** CAP-2 originally specified an "in-memory,
  never persisted" `distinct_id`; this change moves it to `sessionStorage`
  (session-scoped, never persisted across sessions), so CAP-2's intent and
  success wording were updated to bless the session-scoped stored id and keep the
  canonical contract accurate. The privacy goal CAP-2 protected (no cross-session
  or cross-device identity) is unchanged; only the fragment-on-reload behavior is
  fixed. This mirrors how S2 recorded its Node-runtime deviation from the sketched
  Edge Function.
- **Single PostHog project, environment-tagged (matches the SPEC).** Production
  and preview both route to the `verticopolis` project (id 524085, US Cloud),
  separated by the server-stamped `environment` prop; dashboards default to
  `environment = production`. The earlier `verticopolis-preview` project is left
  dormant. This is the SPEC's one-project design, recorded here since the setup
  briefly diverged.

## S4 event enrichment (as built)

- **One merge point, above the seam.** `analytics.ts` holds a module-level
  `commonProps` and a `setCommonProps` setter; `trackEvent` spreads the common
  props into EVERY event FIRST, then the per-event props, so a per-event field
  always wins on a key collision (the typed vocabulary is never shadowed). The
  merge sits above the adapter, so it is provider-neutral and the S6 relay-only
  swap is unaffected. `commonProps` starts empty (a no-op merge before boot) and
  is cleared by `reset()` for test isolation.
- **`src/analyticsEnrichment.ts` is the pure, fully tested enrichment core.**
  `resolvePlatformLabel(isNativeWrapper, search)` resolves the platform dimension
  (AUD-036) in priority order: the native wrapper port (`ios`) outranks the TWA
  start-URL marker (`?src=twa` -> `twa`), else `web`; `platformLabel()` is the
  thin wrapper reading the live `getPlatform()` flag and `location.search`.
  `tenureBucket(day)` and `recencyBucket(msSinceSave)` are coarse anonymous
  buckets (tenure `d0`/`d1-6`/`d7-29`/`d30+`; recency `1d`/`7d`/`30d`/`30d+`),
  each reading a missing/non-finite/negative input as `unknown`. `bootCommonProps`
  assembles the four props from live signals passed in, so the field mapping and
  the recency delta are unit-testable without the boot harness.
- **Computed once at boot, banner-free, no new storage.** `runBootFlow` calls
  `setCommonProps(bootCommonProps(...))` just BEFORE the `boot` event, so every
  event (boot included) carries the enrichment. `returning` is `isOnboarded()`
  (the onboarding-seen flag, the SPEC's cookieless on-device returning signal),
  `tenure` is the loaded tower's in-game age (`sim.clock.day`), `recency` comes
  from the loaded tower's write time. `SaveGame.loadResult()` now surfaces
  `savedAt` from the SAME decode it already runs (and the SAME key that actually
  loaded, legacy fallback included), so the recency read costs no second decode
  and reflects the tower that really opened; a forged/out-of-range stamp reads as
  absent (`parseSavedAt`, shared with the Saves dialog). The ctor passes that
  `savedAt` straight into `runBootFlow(app, savedAt)`, so no new field lands on
  the app. The whole compute is wrapped best-effort so an enrichment read can
  never throw past boot, matching the boot snapshot's never-block posture.
- **The first-tower funnel** (`game_started` -> `first_build` -> `star_reached(2)`)
  is composed of events that already fire; S4 makes each one carry `platform` /
  `returning` / `tenure` / `recency`, so the funnel is segmentable. Modeling it
  as a real PostHog funnel insight (with drop rates) is report-side and lands at
  S5 with the report re-target.
- **No id, nothing persisted, nothing crosses a session or device**, so this
  stays inside the cookieless / banner-free invariant. The persistent
  save-derived `distinct_id` (Tier 3) is deliberately NOT here (parked at E4).
- **Bundle delta: the `telemetry` chunk is 4.97 KB gzipped (from 4.95 at S3,
  +~0.02 KB)**, the enrichment being a handful of pure functions; the boot-wiring
  bytes land in the main chunk and are negligible. Far under the 5 KB ceiling. No
  cold-start regression: the enrichment is one synchronous compute at boot from
  state already in hand (no network, no new persistent storage, and no new
  decode: the recency stamp rides the autosave decode `loadResult` already runs,
  and `returning` is a `getItem` on the onboarding flag the boot flow already
  consults).
- **No version bump:** analytics-only, invisible to players (no UI or gameplay
  change).

## S4 plan: on-device returning/tenure identity (decided in party-mode)

The retention/identity question ("identify by save file") resolves into three
tiers. The save file is a fine SOURCE for an anonymous bucket, but a stable id
derived from it that LEAVES the device is a persistent identifier and re-triggers
consent. Decision:

- **Tier 1 (S4, now):** `returning` and `tenure` buckets derived on-device from
  EXISTING save state (has-a-save, star level, in-game age). The splash "Continue"
  button already makes the returning bit visible to the player, so this is the
  most transparent possible source: no id, no new storage, banner-free.
- **Tier 2 (S4, deliberate):** an on-device return-recency bucket (came back
  within 1d / 7d / 30d), computed locally and emitted only as a coarse bucket; the
  id never leaves the device. A retention-shaped signal that stays cookieless.
- **Tier 3 (parked at E4, needs consent):** a save-derived persistent
  `distinct_id` that leaves the device, enabling true per-cohort unique-return
  curves. This is a persistent online identifier: GDPR/ePrivacy consent plus Apple
  ATT. "The player sees Continue" does NOT authorize it (a new purpose, a
  different actor, sent to a server), but because Continue already establishes
  "there is local state," the honest consent can be a gentle settings opt-in
  rather than a blocking cookie banner. It rides the E4 monetization gate, where
  the funded identity decision travels with a privacy review. No id that leaves
  the device ships before that ruling.
- **Bonus (player feature, no consent):** if Continue means "welcome back," a
  local "your tower has been quiet N days" touch on the Continue card is the same
  save data spent on delight, computed and shown on-device, never transmitted.

## S5 frame-rate signal + report re-target (as built)

CAP-3's raw frame-rate signal and CAP-4's report re-target, plus the live
dashboard as code. All three landed together (design settled in party-mode; the
two relay-correctness fixes shipped ahead in the follow-up section above, so S5
is signal + report + dashboard, not the relay).

- **`session_fps` reports per-session frame-rate percentiles, not Vercel's
  buckets.** `GameplaySession.noteFrame()` reservoir-samples per-frame fps with
  Algorithm R capped at 256 samples, and `end()` emits
  `session_fps { p50, low, samples }` once per session alongside `session_end` /
  `session_builds`, where `low` is the 5th-percentile (worst-frame) fps. The two
  fps numbers are session estimates over the bounded reservoir; PostHog computes
  the exact CROSS-session quantiles from them, so we are no longer forced into the
  fixed histogram buckets Vercel required. `p50` is typical smoothness; `low` is
  the hitch a player actually feels. The gate `FPS_MIN_SAMPLES = 120` drops
  sessions too short to characterize (no misleading fps from a five-frame visit).
- **The sampler measures real wall-clock frame time, not the engine's delta.**
  The gds-code-review caught that Excalibur's clock clamps any frame longer than
  200ms down to 1ms as a sim spike-guard, so feeding `noteFrame` the engine's
  frame delta would have recorded a genuine hitch (the whole point of #538) as
  ~1000fps at the GOOD end of the distribution and inverted the worst-frame `low`
  signal. `noteFrame` now reads its own `performance.now()` gap between frames,
  which keeps the hitch; a regression test drives real 500ms freezes and asserts
  they land in the low tail as ~2fps. The frame anchor is reset on each resume
  (`begin`) so a backgrounded tab's gap is never sampled as one giant slow frame,
  and the fast end is capped so a sub-millisecond delta cannot inject a spike.
- **Sampling cost was the #1 audit risk, kept near zero.** `noteFrame` is the
  first line of `runFrame` (before the modal-freeze early return, so it captures
  every RENDERED frame, fps being a render metric not a sim-tick one). It is one
  `performance.now` read, a subtract, a divide, and either a push or a single
  random-index write into a fixed 256-slot array: O(1), no allocation on the hot
  path. Foreground-gated (`resumedAt !== null`) so a backgrounded tab's frames
  never pollute the sample. The reservoir is emitted once (`fpsReported` latch)
  and cleared in `reset()`. A known minor limitation (idle/paused frames still
  sampled, diluting the signal on big towers) is tracked as a deferral (#603).
- **Report re-targeted to PostHog (HogQL), Vercel kept until S6.**
  `scripts/posthog-report.mjs` is a new dependency-free Node script that queries
  PostHog with HogQL and renders the same three outputs the Vercel report did
  (styled HTML artifact, markdown job summary, raw JSON to the log). It is a
  SECOND script, not an edit of `analytics-report.mjs`: the Vercel path stays
  live so the two run side by side through the cutover, and S6 removes the Vercel
  one. The re-target buys precision: HogQL `quantile(0.5)(...)` computes EXACT
  percentiles instead of reconstructing them from a capped value histogram, and
  because every event now carries a per-tab session id (`distinct_id`), the
  report does the per-session and per-tool splits the Vercel path could not
  (Vercel Web Analytics has no session correlation). All queries filter
  `properties.environment = 'production'`; the look-back is a clamped integer and
  the one string interpolated into HogQL (event/property names) is hardcoded and
  escaped (`lit`), so there is no injection surface. Never-throw, same as the
  Vercel report: a failed query renders a skipped section, not a crash. Pure
  helpers (query builders + response normalizers) are unit-tested in
  `src/posthog-report.test.ts` without a live key.
- **Dashboard as code.** `scripts/posthog-dashboard.mjs` provisions the live
  "Verticopolis: Gameplay Analytics" dashboard idempotently (find-or-create the
  dashboard and each insight by name, then create-or-PATCH), so the dashboard the
  game reports into is reproducible and reviewable rather than a pile of
  hand-clicked tiles. It carries the core trends and the first-tower funnel, the
  S4 enrichment breakdowns (platform / reason / returning / tenure / recency),
  exact session-length and depth percentiles, the new `session_fps` frame-health
  tile, and a set of KPI BoldNumbers and at-a-glance tables. Every tile filters
  to `environment = production`; GeoIP is disabled at the relay so there are no
  geo tiles. Run with a `phx_...` personal API key: it needs `insight:*` and
  `dashboard:*`, distinct from the `phc_...` ingest key.
- **CI wiring.** `.github/workflows/analytics-report.yml` now runs the PostHog
  report first, then the Vercel report (labeled "retires at S6"). New secret
  `POSTHOG_PERSONAL_API_KEY` (a `phx_...` key with `query:read`); optional repo
  vars `POSTHOG_PROJECT_ID` (default 524085) and `POSTHOG_HOST` (default
  `https://us.posthog.com`). The dispatch `days` input still passes through env,
  never interpolated into the shell.
- **Bundle delta (hard gate, measured): the telemetry chunk is 4.95 KB gzipped
  (5072 bytes), flat against S4's 4.97 KB.** `session_fps` adds a handful of pure
  lines to the sampler; the one `noteFrame` call in the frame loop lands in the
  main chunk and is negligible. No measurable net weight and no cold-start cost:
  the sampler is one `performance.now` read and O(1) arithmetic per frame, no
  network and no allocation on the hot path. Well under the 5 KB ceiling.
- **Version bump: minor (`session_fps` is a new player-observable emission).**
  The frame-rate signal fires from the running game, so the build changes what
  the client does even though nothing on screen moves; the report and dashboard
  are tooling and would not bump on their own.

## Cookieless error tracking (S5 follow-up feature, as built)

A new capability beyond CAP-1..CAP-4: report GENUINELY uncaught JavaScript
exceptions (a throw during boot, in an event handler, or in an async callback)
and unhandled promise rejections to PostHog Error Tracking through the same
cookieless relay, without shipping `posthog-js`, without a cookie or persistent
id, and without a consent banner. Ruled in during the S5 party-mode session and
built on its own branch/PR per the one-story-one-PR convention.

Scope, stated precisely (the review corrected an earlier overclaim): this does
NOT capture the two crash classes that never surface as uncaught window errors,
and that is deliberate. A throw inside the render frame loop is swallowed by the
frame-error guard (`engineWiring.ts`) and never escapes to `window`; and the
Pixel 8a / #538 failure is a WebGL context loss, not a throw, already handled and
reported by the typed `crash` gameplay event. So `$exception` complements `crash`
(the two paths are disjoint), giving visibility into the uncaught-error class the
game has none of today, rather than duplicating the WebGL-crash reporting.

- **Two global listeners, relay-only.** `installErrorTracking` (`analyticsErrors
  .ts`) attaches `window` `error` (uncaught throws) and `unhandledrejection`
  handlers, installed first thing in `bootGame`'s `boot()` so an exception during
  the rest of boot is still caught. Each report goes straight through the new
  `sendException` (`analyticsRelay.ts`), never the dual-write adapter: `$exception`
  is a PostHog Error Tracking event with a nested `$exception_list` that has no
  Vercel Web Analytics equivalent, so it must not be sent to Vercel. The report
  rides the SAME per-tab session id every event carries, so a crash correlates
  with the play session it came from, plus the boot common props (platform /
  build version) for context.
- **Canonical `$exception_list`, raw stack, no frame parsing yet.** The payload is
  the canonical PostHog shape: `$exception_list: [{ type, value, mechanism:
  { handled:false, synthetic:false }, stacktrace: { type:"raw", frames: [] } }]`
  plus a `$exception_fingerprint` and a bounded `$exception_stack_trace_raw`.
  Structured stack FRAMES are deliberately left empty in this first version: with
  no source maps uploaded they would point at minified positions, so the bounded
  raw stack string carries the same debugging value at far less code. Frame
  parsing plus a source-map upload is the natural follow-up.
- **Guardrails, because it runs on the error path.** Host-gated by
  `telemetryHostAllowed` (nothing fires on localhost, the e2e preview server, or
  the native shell), never-throw (every handler wrapped, plus a re-entrancy latch
  so a report cannot trigger a report and spiral), deduplicated by fingerprint
  (type + message + first stack frame) so a crash thrown every frame reports once,
  and hard-capped at 10 `$exception` events per session (the relay's per-IP rate
  limit is the outer backstop). Message and raw stack are length-bounded (500 /
  2000 chars) before they leave the page, comfortably inside the relay's 8 KB
  body cap.
- **Cookieless invariant preserved.** No cookie, no `localStorage` id, no
  cross-session or cross-device identity, no consent banner; the report carries
  only the session-scoped id and the coarse common-prop buckets, never an
  identifier. The relay forwards no IP and disables GeoIP, so an exception is not
  a de-anonymizing signal. Privacy note recorded in the module: an exception
  `value` is the thrown message, which the game builds from its own strings and
  could occasionally interpolate a player-authored tower name. The 500/2000-char
  bounds cap payload SIZE, not sensitivity (a tower name within the bound is
  forwarded verbatim); it stays acceptable because with no IP, no persistent id,
  and no cross-session linkage a leaked free-text string is bound to no stable
  identity and does not de-anonymize. Redacting known player-authored fields from
  the outgoing message is tracked as a follow-up (#607).
- **Relay widened for nested props.** `sendToRelay` kept its primitive-only
  `EventProps` signature (the typed gameplay vocabulary stays honest at the call
  site); the transport core was extracted so the new `sendException` path can
  carry the nested `$exception_list`. The server already accepts any plain-object
  `properties` and spreads it through, so no server change was needed.
- **Bundle delta (measured): +550 bytes gzipped in the main chunk**, measured by
  building with and without the feature (tree-shaken out when unimported). Well
  under the 5 KB ceiling. No cold-start cost: installation is two passive
  listeners; work happens only when an error actually fires.
- **Version bump: minor (a new emission from the running game).** The review
  flagged that the first draft cited the wrong precedent: S4 took no bump because
  it added PROPERTIES to already-emitted events (enrichment), whereas this, like
  S5's `session_fps`, installs handlers that emit a BRAND-NEW event type from the
  running client. Under the epic's own codified rule ("a new emission from the
  running game" bumps minor, even when nothing on screen changes), this matches
  S5, not S4, so it takes a minor bump (1.86.0 to 1.87.0), lockfile in lockstep.

## S5c error-tracking enhancements + app-chrome telemetry (as built)

Specced in `_bmad-output/specs/spec-posthog-error-tracking` (CAP-1..4) and design-partied before implementation. One combined PR at the user's request.

- **WebGL crashes reach Error Tracking (CAP-1).** `analyticsErrors.reportCrashException` emits a synthetic `$exception` (type `WebGLContextLost`, mechanism handled+synthetic, stable fingerprint so all WebGL losses group into one issue, crash flags as context) through the same `report()` machinery, wired at the crash site after `noteCrash`. The typed `crash` event still fires: two lenses on one incident, documented so they are not summed as a double-count. Fixes the earlier gap where the #538 crash was invisible in the Error Tracking product.
- **Exceptions are breakdownable by type (CAP-2).** Every `$exception` now carries a top-level `$exception_type`, so a dashboard trend splits errors by kind without reaching into the nested `$exception_list`.
- **One `app_action` event for the whole app chrome (CAP-4).** A single parametrized `app_action { action: AppActionName; detail? }` keyed by a closed union covers save/quick-save, slot save/load/delete, export/import, TDT export/import, the settings/help/compare/saves/stats/replay-onboarding opens, the mute/reduced-motion/steady-clock toggles (detail on/off), and the standalone help/gallery landings. `speed` and `volume` are coarse, session-latched (`trackAppActionOnce`) so the pointer-move slider and repeated speed taps cannot flood; `speed` is wired at the user controls, not the `setSpeed` choke, because the game auto-runs at Slow after the splash. Wired at clean choke points (`uiCallbacks`, `audioPrefs`, `appModals`, `uiDialogs`); the persistence + replay calls live in `uiCallbacks` so `saveLoad.ts` and `main.ts` (both at the 500-line ceiling) stay untouched.
- **Design-party rulings (recorded in the spec memlog).** CUT the low-signal micro-actions (undo/redo/overlay, and a rename VALUE, the tower name is player-authored and never sent). The deep editor economy actions (rent/cars/schedule) are a separate gameplay-analytics story with its own `/gds-code-review` (#611). The cookieless "who" caveat is stated in words on the dashboard: answers are per-session and cohort, never per-person; the vocabulary does not answer "who are my power users."
- **Dashboard as code.** The provisioning script gains an error-tracking section (errors over time, by type, top issues by fingerprint, by platform/version, WebGL crashes by recovery outcome) and an app-chrome section (actions by type, over time, persistence by action and by platform cohort, help/gallery landings, mute by state), each carrying the cookieless caveat.
- **Bundle delta: negligible (main chunk flat within build noise vs origin/main).** The wiring is a few dozen one-line, host-gated, off-render-path calls. Well under the 5 KB ceiling.
- **Version bump: minor.** New client-emitted event categories (`app_action`, the synthetic crash `$exception`), the same rule that bumped `session_fps` and the base error tracking.
