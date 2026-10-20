---
status: in-progress
created: 2026-10-20
updated: 2026-10-20
baseline_commit: 8f3a14353487427760ae32a8247ce42632ddb8e0
issue: 1081
plan: _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md (section 4.1, step A1 of 9.1)
---

# Spec: the reliability instrument (A1)

<frozen-after-approval>
Record which engine every page life runs, whether it fell back and why, and
whether the engine save writer turned itself off, on the host status and in
analytics, as closed codes with no error text. Ship the analytics data map
entry and a governed, test-bound definition of the reliability rate with it,
so the Reliability row of #945 has something to count before S4 (#874) and a
cohort exist.
</frozen-after-approval>

## Why now

The Reliability row is the release date (plan 4.1): it needs engine sessions
counted over weeks, and today no field records the engine, a fallback, its
reason, or a latch-off. The instrument has to be in production before the
window can start, so it ships first and on its own. Boot reasons ship here;
runtime trap reasons ship with #874 (A3), which extends the same lists.

## Acceptance criteria

1. **Closed codes only.** Every value the event carries is from a list in our
   code: the engine kind, the engine requested, the build kind, the trigger,
   the fallback reason and its stage. No row ever carries an error message, a
   stack, a tower name or a path. A test sends rows for every boot failure path
   with an error message full of tower text and asserts none of it reaches the
   relay.
2. **Identity of the build.** Every row carries `version` and the commit
   (`__APP_SHA__`), so the tail can be read by commit when an internal-only
   merge keeps the version.
3. **Page-life id.** Every row carries an id minted in memory once per page
   life. It is never written to storage, so a reload mints a new one, while the
   relay's session id (`distinct_id`) carries over as it does for every event.
4. **When rows are sent.**
   - `settle`: exactly once per page life, after boot has picked its engine
     and the first tower is hosted or refused (or, for a wasm-only build that
     cannot start, just before boot stops).
   - `fallback`: on each later fallback in the same page life. In A1 that is
     a tower the host refused at a load, a new game or an undo restore, or
     (`other`) a boot step that failed after the worker host started.
   - `writer-latch`: when the engine save writer turns itself off.
   - `summary`: at a tab hide or page hide, only when a row was dropped by the
     cap since the last row went out (criterion 6).
5. **The host status agrees with the event.** `window.__vcEngineBoot`'s
   failure carries the same `reason` code and gains `writerLatched` once the
   writer turns itself off, and `WasmHostStatus` carries `fallbacks` and
   `lastFallback` (reason and stage), so a tester and the e2e suites read the
   code the event sends.
6. **The #841 check.** A fallback loop cannot hide under the cap. Rows past
   the per-page-life cap (10) that repeat a reason already sent are dropped,
   but every row carries the running `fallbacks` count, and the next hide
   sends one `summary` row with the true count. The first row of a new reason
   and the latch-off row always go out, so no reason is lost to the cap. A
   loop across reloads is a new page life each time and is never capped. A
   test drives 50 fallbacks in one page life and reads 50 from the summary.
7. **Data map first.** `docs/analytics-data-map.md` exists, lists every event
   in the vocabulary, and gives `engine_status` a full entry (each field, its
   values, purpose, retention, deletion path). A guard test fails when an event
   in `analyticsCore.ts` has no row, or when a field or code the event can send
   is missing from the map.
8. **Governed definition, bound by a test.** `scripts/engine-reliability.mjs`
   computes the rate from the rows and `src/engine-reliability.test.ts` pins
   every counting rule of plan 4.1 (listed under Design) and pins the session
   unit to the `session_lengths` view's (`distinct_id`, production only).
9. **No behavior change for players.** Nothing a player sees changes; the
   event is host-gated like every other (`telemetryHostAllowed`), so localhost
   and the e2e preview server send nothing. Vercel preview deployments do
   send, tagged `environment: preview`, which the definition leaves out.

## Design

### The event: `engine_status`

| Field | Values | Notes |
| --- | --- | --- |
| `trigger` | `settle`, `fallback`, `writer-latch`, `summary` | Why this row was sent |
| `engine_requested` | `ts`, `wasm`, `wasm-frame`, `wasm-worker` | What `?engine=`, `vc.engine` or the build asked for; a wasm-only build always reads `wasm`, whatever the URL says |
| `engine` | `ts`, `wasm`, `wasm-frame`, `wasm-worker`, `ts-fallback`, `none` | What runs when the row is sent; `none` is a wasm-only build that stopped. Once a page life has fallen back it reads `ts-fallback` on every later row, even when a later tower is hosted again |
| `build` | `switchable`, `wasm-only` | The bundle kind |
| `fallback_reason` | `none`, `boot-timeout`, `boot-error`, `package-mismatch`, `attach-refused`, `trap-command`, `trap-tick`, `trap-undo`, `other` | The latest fallback in this page life. A1 sends the first five, plus `other` for a boot step outside the engine that failed after the worker host started; #874 sends the trap codes and its own `other` |
| `fallback_stage` | `none`, `load`, `start`, `adopt`, `undo` | Where it happened. #874 adds its runtime stages |
| `fallbacks` | integer, 0 or more | Fallbacks so far in this page life |
| `writer_latched` | boolean | The engine save writer turned itself off in this page life |
| `page_life` | random id | Minted in memory per page life |
| `version` | the app version | Also a common prop; sent explicitly like `boot` and `crash` do |
| `sha` | `__APP_SHA__` | The build's commit |

`arm` and `size_gated` (A4, after the owner's OD-1) and `divergence_reports`
(#874 onward) are not sent by A1. The data map lists them as planned, not
collected.

### Reason classification at boot

- The load passed its time limit: `boot-timeout` (a typed error from the
  timer, never a message match). The worker's ready timeout is the same code.
- The package loaded but is not the one this shell expects: `package-mismatch`.
  That is a binding that lacks an export (`checkBinding`), a glue and binary
  that do not link (`WebAssembly.LinkError`), or a wasm-only build whose
  package has no save writer.
- Anything else on the way to a running engine (a 404, an init throw, a host
  that throws while starting): `boot-error`.
- The host would not take the first tower, or a later one: `attach-refused`,
  unless the package's facility or room catalogs are foreign to this build
  (`refuseForeignCatalog`) or of another catalog version, which is a shell
  and an engine from different deploys and so `package-mismatch`. Only a
  catalog the engine handed over and this build rejects counts: a catalog call
  that throws or returns no JSON is the engine failing, stays
  `attach-refused`, and is asked again at the next refusal. A verdict is kept
  for the page life.
- A boot step outside the engine (the service worker, tooling) that throws
  after the worker host started: the host is let go and the row says `other`
  at `start`. On the main-thread host the same throw leaves the engine
  running, so only the settle row goes out. The settle row is sent before
  those later steps, so it is never lost to them; when the game itself was
  never created, no row is sent.

### Engine kind

From the boot state and the request: a wasm-only build that stopped is
`none`; any recorded failure in a switchable build is `ts-fallback`; otherwise
`ts` when TypeScript was requested, or the requested host. The kind never goes
back to a WASM host within a page life: the row answers "did this page life
fall back", and the running count says how often.

### The governed definition (plan 4.1)

The unit is the governed view's session, `distinct_id`, production only;
`session_end` is never read. The query returns one row per page life
(`distinct_id`, `page_life`) with its build, request, arm (when present), size
gate (when present), the highest `fallbacks`, its reasons and the latch. The
counting is plain JavaScript over those rows, which is what the test pins:

- The window holds the page lives whose `settle` row falls in it (the query's
  `HAVING`), so a fault from before the window is never charged to it. Rows
  come newest first, so a truncated result keeps the latest builds.
- A page life carrying a value the game never sends (a request, bundle kind
  or reason outside the closed lists, a version or commit of the wrong shape)
  is left out and counted on its own line; the closed lists are bound to their
  sources by the test.
- A page life is **counted** when it asked for a counted host (`wasm` by
  default), ran a counted version, commit and bundle kind (all by default; a
  commit matches when one is a prefix of the other), sits in a counted arm,
  and was not size-gated. A row with no `arm` reads `none`; `override` and
  `unassigned` are left out by default, as plan 4.1 leaves them out of both
  arms.
- A page life whose settle row already fell back on `package-mismatch`, and
  that sent no other reason, never ran the engine: it is neither a pass nor a
  fault. One whose first tower ran and that met the mismatch later ran the
  engine without a fault. Both are on the mismatch line, never in the
  by-reason table.
- *N* is the number of sessions with at least one counted page life that ran
  the engine.
- A session **falls back** when any of those page lives had an engine fault
  (every code but `package-mismatch`, `attach-refused` included); it counts
  once however many did, and stays counted if a later page life ran clean.
- Page lives are counted exactly, by `page_life`, and the by-reason table
  lists the engine-fault reasons of the counted page lives that ran the
  engine. The report also gives the fallbacks those page lives sent in all
  and the most in one page life, so a loop keeps its size.
- By build and by arm, a fault is charged to the build or arm of the page
  life it happened in, and a session that ran several counts once under each.
- Size-gated page lives are outside the rate; their count obeys every other
  filter.
- Every value read from a row is checked against a safe pattern before it
  reaches the report; anything else prints as `unrecognized`.
- The report flags a truncated result (the row limit, or the API's
  `hasMore`) and prints every value in a code span. The CLI refuses an
  unknown or repeated flag, a missing value, and a value its flag cannot hold
  (a host that is not a WASM host, a bundle kind, a commit under 7 hex digits,
  a version of another shape); a commit matches by prefix only between two
  real commits.
- Latch-offs are counted by session and page life.
- The 95% upper bound is the exact one-sided binomial (Clopper-Pearson) bound
  on the engine-fault rate: about 3/*n* with no fallback, about 4.74/*n* with
  one.
- The report says at the top that it is a snapshot with its window, and that
  the rate is a lower bound: the relay has no offline queue and a per-IP
  limit, so a fallback in an offline session, a tab closed while the engine
  loads, a tab killed before its first row (or after a capped drop with no
  later hide) and a boot whose game never started after its engine failed
  never report; runtime traps are not reported before #874; outcomes are as of
  the run; background tabs never seen still count. When the worker host is
  counted, it adds that the host reports only its first tower and that its
  `other` is a boot step outside the engine. Sessions are not independent, so
  the bound is optimistic.

## Files

| File | Change |
| --- | --- |
| `src/wasmhost/engineBoot.ts` | Reason and stage lists, `EngineBootError`, reason on `EngineBootFailure`, classification |
| `src/wasmhost/startWasmHost.ts` | `package-mismatch` from the binding check; `fallbacks` and `lastFallback` on `WasmHostStatus`; `onFallback` option |
| `src/wasmhost/workerController.ts` | The ready timeout rejects with the timeout code |
| `src/storage/vctowerWriter.ts` | A latch-off callback |
| `src/analyticsEngineStatus.ts` (new) | The emitter: page-life id, rows, cap, summary |
| `src/analyticsCore.ts`, `src/analytics.ts`, `src/analyticsSession.ts` | The vocabulary entry, the hide hook, the test reset |
| `src/bootstrap.ts` | Wiring: settle, fallback, latch |
| `docs/analytics-data-map.md` (new) | The data map |
| `scripts/engine-reliability.mjs` (new) | The governed definition and its report |
| `scripts/posthog-report.mjs`, `scripts/posthog-report.d.mts` | Exports `runQuery` for reuse |
| `scripts/engine-reliability.d.mts` (new) | The type surface the test imports |
| `_bmad-output/implementation-artifacts/backlog.md` | The #1081 row |
| Tests | New `analyticsEngineStatus.test.ts`, `analyticsDataMap.test.ts`, `engine-reliability.test.ts`, `startWasmHostFallback.test.ts`; additions to `engineBoot.test.ts`, `bootstrapEngine.test.ts`, `bootstrap.test.ts`, `analytics.test.ts`, `workerController.test.ts`, `vctowerWriter.test.ts` |

Not touched, because WS-B's #1062 holds them: `wasmHost.ts`,
`startWasmHost.test.ts`, `fakeEngine.fixture.ts`, `src/dualrun/binding.ts`,
`vite.config.ts`, `telemetry.ts` and the worker host files (`workerHost.ts`,
`workerCore.ts`, `workerApply.ts`, `workerProtocol.ts`). The new host tests sit
in their own file for that reason. `workerController.ts` is not in #1062.

## Risks and how the tests cover them

| Risk | Cover |
| --- | --- |
| Error text leaks into analytics (R16) | Rows are built only from closed codes; a test puts a tower name in every failure message and checks every relay call |
| Double counting the first tower's refusal (the host's callback and the boot state both see it) | Fallbacks before `settle` are not emitted; the settle row reads the boot state alone. Test: a refused first tower yields one row with `fallbacks: 1` |
| A loop floods the per-IP ingest budget | Cap of 10 rows per page life; one `summary` per hide only when something was dropped |
| A loop hides under the cap (#841) | Running count plus the hide summary; test with 50 fallbacks |
| The definition drifts from the view's session unit | Test reads `scripts/posthog-dashboard.mjs` and checks the unit and filter |
| The data map falls behind the vocabulary | Guard test over `analyticsCore.ts` and the event's code lists |
| A new boot failure path is added without a reason | `EngineBootFailure.reason` is required, so the compiler asks for one |

## Out of scope
- The amended plan's (39680f0, OD-2) split of early telemetry from eligible
  sessions, the per-arm crash rates, the tail's bound and the stop signals:
  definition logic with no new client field, in #1090 (backlog row
  `engine-reliability-eligibility-split`). Until then the report says at the
  top that every session is early telemetry.
- The cohort, `arm`, the size gate and `size_gated` (A4, owner-gated).
- Runtime traps and their reasons, divergence counts, re-adoption (#874).
- Later fallbacks of the experimental worker host (measurement only, never a
  release host); its boot failures are covered.
- #841 itself (the `crash` event's lost magnitude) stays open: A1 only makes
  sure the new counts do not repeat it.

## Review

`/gds-code-review` (host and engine boot behavior) and `/bmad-code-review`
(analytics plumbing, the definition, the data map). Copilot if available.

### `/gds-code-review`, 2026-10-20 (on 645d36a)

Blind Hunter, Edge Case Hunter and Acceptance Auditor over `8f3a143..645d36a`
with this spec and plan 4.1. Triage: 0 decision-needed, 16 patch (all
applied), 1 defer, 5 dismissed.

Patches applied:

1. A boot step after the engine settled could throw and lose the settle row:
   settle now goes out right after the engine block, and the catch path sends
   it when the game was created.
2. A package with foreign catalogs was coded `attach-refused`: now
   `package-mismatch`, also passed to `onFatal`.
3. The writer latch was not on the host status: `writerLatched` on
   `__vcEngineBoot`.
4. Leak and coverage tests for every boot failure path, the wasm-only paths,
   and the later-boot-step throw.
5. The data map guard missed fields and per-field codes: it now checks every
   field and every code list, typed against the source unions.
6. The CLI accepted unknown flags and missing values.
7. A malformed API response read as zero rows.
8. Row values reached the report unescaped.
9. The by-reason table read page lives outside N.
10. A page life that settled before the window could be charged to it.
11. Bundle kind, size-gated filters, default arms and the by-arm table.
12. A truncated result was not flagged (`hasMore`).
13. Spec and data map wording that no longer matched the code, and the plan
    reference.
14. A comment that said the settle row carried a message.
15. Lower-bound caveats missing from the report.
16. `posthog-report.mjs` line growth.

Deferred: #1086 (a deploy-race 404 and a worker link error read as
`boot-error` where `package-mismatch` belongs; backlog row
`engine-status-mismatch-coverage`).

Dismissed: `engine_requested` reading `wasm` in a wasm-only build (intended);
`attach-refused` counting as a fault (plan 4.1 rules it does); `reset()` being
test-only; the undo stage coming only from an undo (correct); a flush after
the page ended (harmless).

### `/bmad-code-review`, 2026-10-20 (on f06e7ed)

Blind Hunter, Edge Case Hunter and Acceptance Auditor over `8f3a143..f06e7ed`,
focused on the analytics side. The auditor found every criterion met. Triage:
0 decision-needed, 18 patch (all applied), 1 defer, 6 dismissed.

Patches applied:

1. Any throw from the foreign-catalog probe read as `package-mismatch`, for
   the whole page life, so an engine that could not answer left the rate. Now
   only a catalog this build rejects counts, and a failed call is asked again.
2. A page life whose first tower ran and that met a mismatch later was taken
   out of N. Now only a mismatch at settle sets a page life aside.
3. The mismatch line mixed populations, and the by-reason table could list
   `package-mismatch`.
4. Rows outside the closed lists (forged on the public route) counted under
   the default filters, and a one-letter commit matched by prefix.
5. CLI values were never checked against their lists (`--hosts wsam` counted
   nothing; `--hosts ts` diluted the rate), and a repeated flag kept the last
   value; the key check hid a bad flag.
6. The cap could drop a reason for good. It now drops repeats only.
7. The governed report dropped the loop size the summary row keeps.
8. Missing lower-bound caveats: runtime traps before #874, the relay's per-IP
   limit, a boot whose game never started, a drop with no later hide,
   outcomes as of the run, background tabs, and the worker host's gaps.
9. A truncated result kept the oldest page lives; its row-limit branch had no
   test.
10. The query's `session` alias could meet the events table's own `session`;
    it is `session_id`, as in the view.
11. Values printed raw into the Markdown (a version like `__x__` became
    emphasis); argv values reached the step summary.
12. The data map guard matched event names anywhere, checked one way only,
    and did not tie the limits to the code.
13. Data map drift: `engine_requested` (the default and the wasm-only rule),
    `package-mismatch` (catalog version, no save writer), `fallback_stage`
    `start`, `environment` (`development`), divergence reports (#874, not
    A6), the Bounded bullet.
14. Spec drift: the `other` row in criterion 4, criterion 9 and Vercel
    previews.
15. The session-unit pin could read past the view's SQL.
16. The hide test left listeners and a `visibilityState` override behind.
17. A throw in the session's end could cost the summary row (it now goes
    first).
18. Two counting rules were not pinned directly (N across builds, and a
    session with a faulted page life outside the counted set).

Deferred: #1086 gains the worker host's refused first tower, which skips the
catalog check (the worker files are not this change's), and a deploy race
that serves a page or a cut file where the binary belongs
(`WebAssembly.CompileError`).

Dismissed: the boot error's message reaching `$exception` (as before this
change, documented in the map and the Help copy, with redaction already a
backlog follow-up); the `engine` field read from the request (every path that
does not start the engine records a failure); `__vcEngineBoot` not following a
later fallback (criterion 5 is met through `__vcEngine`'s status); the owner
gate being a process step (merging is shipping, by design); the Help privacy
copy (checked: an in-memory page-life id does not point back across visits);
`setEngineWriter`'s optional latch callback (its one production caller passes
it, and a test pins the report).
