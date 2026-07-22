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
