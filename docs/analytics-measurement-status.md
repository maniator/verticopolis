# Analytics measurement status

What each reliability and usage measure can and cannot tell us, so a missing
measurement is read as "unknown" and never as "zero". This page is the status
inventory for the 3.0.0 release gate (#945, #1090). The events and fields
themselves are in [`analytics-data-map.md`](./analytics-data-map.md); the
counting rules for the engine fault rate are in
[`scripts/engine-reliability.mjs`](../scripts/engine-reliability.mjs).

> **Snapshot of the review on 2026-11-03.** The statuses below are definitions.
> A status changes when the instrumentation changes, and "Insufficient
> evidence" also moves with traffic and the window. The figures in the
> snapshot section at the end are dated, do not refresh, and are not release
> evidence. The live engine figure is
> `node scripts/engine-reliability.mjs --window <days>`, whose rules
> `src/engine-reliability.test.ts` pins. Sessions and engaged sessions are
> read from the `session_lengths` view and the `engaged` rows through the same
> script. The coverage cross-checks and the trap recovery counts are governed by
> `scripts/reliability-coverage.mjs` (see "Telemetry coverage" below).

## Privacy limits that cannot be worked around

The relay is cookieless and personless, and the session id lives in one tab's
`sessionStorage`. So three things stay **not measurable** until Naftali
separately approves an identity strategy:

- Unique human players, in any window.
- Returning-player retention, or any cohort over several visits.
- Any link between two tabs, devices or visits.

`returning`, `tenure` and `recency` are coarse on-device signals sent with each
event. They describe the tower on that device, not a person, so they are not a
retention measure and must not be reported as one.

## Status values

| Status | Meaning |
| --- | --- |
| **Accurate** | Counted exactly for what reaches the relay, with a stated denominator. |
| **Lower bound** | A count. Counted exactly for what reaches the relay, but sessions that never report (blockers, offline play, rate limits, tabs killed early) are missing, so the true count is at least this. |
| **Coverage-limited rate** | A rate computed over the sessions or attempts that reported. It is **not** a lower bound: missing sessions can sit in the numerator or the denominator, so the true rate can be higher or lower. Report it as observed, with unknown bias. Its exact 95% upper bound holds for the observed sample only, and assumes independent sessions, which these are not. |
| **Approximation** | A proxy for the thing named. Never quote it as the thing. |
| **Incomplete** | The event exists, but part of the outcome space has no event. |
| **Not measurable** | No event can answer it, by design or because none exists yet. Report "Not measurable", never 0. |
| **Not measured** | An event exists that could answer it, but no governed query computes it yet. Treat it as unknown until one does. |
| **Not collected** | The data map lists the event as planned, and the game does not send it. |
| **Not applicable** | The question no longer applies to this build. |
| **Insufficient evidence** | Measurable, but the window holds too few sessions or no occurrences, so a clean result proves little. Report the exact upper bound, not "no failures". |

"Release evidence" below means the figure may go in the #945 sign-off packet.
Only the candidate-build window counts (see #945). Everything else is early
telemetry and context.

## Inventory

| # | Measure | Source | Denominator | Window | Limits | Status | Release evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Engine fault rate (sessions) | `engine_status` page lives, `engine-reliability.mjs` | Sessions with a settled page life that ran the engine (N) | Any; the candidate-build tail is the evidence | Needs a `settle` row, so a tab that dies during load is not in N. Sessions that never report can sit in the numerator or the denominator, so the rate has unknown bias. The exact 95% upper bound holds for the observed sample only, and sessions are not independent, so it is optimistic | Fault count: lower bound. Fault rate: **coverage-limited rate** | **Yes**, as an observed rate with its bound, never as a lower bound or a proven rate |
| 2 | Engine faults by reason and by build | Same | Same | Same | A lone `boot-error` cannot be split between a real fault and files that did not arrive whole. By design (#1086, closed): a 404 or `TypeError` at the glue import, and a web page served where an engine file belongs, stay `boot-error`. Triage reads a `boot-error` spike right after a deploy as the deploy race, not an engine fault | Counts: lower bound; rates: coverage-limited; reason partly ambiguous | **Yes**, triaged one by one |
| 3 | Engine initialization failure | `engine_status` `fallback_reason` `boot-error`, `fallback_stage` | N | Same | A boot that throws before the game exists sends no row; `$exception` may report it. Browsers that block the relay send nothing | Count: lower bound. Rate: coverage-limited (inside row 1) | **Yes**, inside row 1 |
| 4 | Package mismatch and unverifiable engine files | `engine_status` `package-mismatch`, `unverifiable` | N | Same | Deploy race and browsers without `crypto.subtle`; deliberately outside the fault rate and printed on their own lines | Accurate for what reports | Reported, never counted as faults |
| 5 | WASM traps while running | `engine_status` `trap-command`, `trap-tick`, `trap-undo`, `crash-reload` | N | Same | Zero traps seen means zero reported, not zero happened: a tab killed by the trap before the row sends nothing. The reload path is exercised by the forced-trap E2E spec, not by production traffic so far | Count: lower bound; Insufficient evidence at current volume | **Yes**; any trap is a stop signal |
| 6 | Trap recovery: recovered versus stopped | `crash-reload` row, then the same `distinct_id`'s later page lives; a second trap on a build stops the game and sends a `fallback` row | Sessions with a trap row | Same | Counted by `scripts/reliability-coverage.mjs` (printed under the persistence failures) as sessions per outcome: recovered, stopped, reloaded without recovering (including a second trap and reload), unknown. A count of sessions, not a rate. Zero trapped sessions reads Insufficient evidence. A session that closed its tab after the trap is unknown, not failed | Count: lower bound | Yes, once traps occur |
| 7 | Writer latch-off | `engine_status` `writer_latched`, trigger `writer-latch` | N | Same | Reports only when the latch happens on a page that can still send | Count: lower bound. Rate: coverage-limited | **Yes**; any latch-off fails the row |
| 8 | Autosave, Quick Save and slot-save failures | `app_action` `autosave_failed` (#1533, approved 2026-11-03), once per page life, `detail` `timer` or `manual` | Sessions | Since the build that ships the code | Counts sessions with a failed save, not failures. `timer` covers every non-interactive save (the timer and tower-swap autosaves, the pre-update flush, the context-loss flush and the TDT adoption flush), so the swap autosave cannot be split from it without a new `detail` value, which is deferred to 3.x (#1631). The latch is per action and per page life, so `detail` is the first source that failed, and a reload can send a second event; the session count de-duplicates. A tab killed by the failure reports nothing. Builds before it report nothing, so earlier windows read Not measurable | Count: lower bound from that build. **Rate unavailable**: no autosave attempt or success is sent | Yes, as a count of sessions, for builds that carry it |
| 9 | Load failures | `boot` `reason=corrupt` (autosave at boot) and `app_action` `load_failed` (slot loads) | `boot` rows; sessions | Since the build that ships the code | `load_failed` cannot tell an empty slot from an unreadable one. Older builds have the boot reason only. Attempts are `load_slot` plus `load_failed`. Quick Load ("No saved tower found") is outside this measure | Count: lower bound from that build. Rate: coverage-limited, per attempt, printed with its bound | Yes, for builds that carry it |
| 10 | Import failures (`.vctower`, `.TDT`) | `app_action` `import_failed`, `detail` `save` or `tdt` | Import attempts (`import_save`, `import_tdt`) | Since the build that ships the code | A refusal is counted once per attempt; a file the picker never hands over is not seen. Attempts are the `import_save` and `import_tdt` rows, sent when the file is handed over | Count: lower bound from that build. Rate: coverage-limited, per attempt, printed with its bound | Yes, for builds that carry it |
| 11 | Save and load usage | `app_action` `save_slot`, `quick_save`, `load_slot`, `export_save` | Sessions | Any | Successes only, with no attempt count, so it is not a success rate | Approximation (usage), never an outcome rate | No |
| 12 | Crash screens (lost WebGL context) | `crash` | Crash rows | Any | Capped and deduplicated per page life, so the count of repeats is lost (#841). This is a renderer failure, not an engine fault | Incomplete (magnitude) | Reported separately from row 1 |
| 13 | `$exception` counts | `$exception` | Rows | Any | Raw counts, capped at 10 per page life, not classified by origin (#1090). Never present a raw count as engine failures | Approximation | Only once classified (#1090) |
| 14 | Engaged sessions | `engine_status` `engaged` rows, `engaged_by` | Sessions | Since 2026-10-29 | Lower bound on real play; a boot fault cannot engage, so engagement must never be the fault-rate denominator | Lower bound | Reported beside N, not as N |
| 15 | Sessions (per tab) | `session_lengths` view | Sessions that sent `session_end` | Any | `session_end` re-fires on every hide, so only the view is governed; a tab killed without a hide sends none | Lower bound | Context only |
| 16 | Sessions with incomplete terminal telemetry | `engine_status` sessions with no `session_end` | `engine_status` sessions | Any | See "Telemetry coverage". Counted by `scripts/reliability-coverage.mjs` as a cross-check, never a rate | Count: lower bound on tabs that never sent a hide | Caveat line only |
| 17 | Page lives that attempted and never settled | `engine_status` `attempt` without `settle` | `attempt` page lives | Any | Printed by the script on its own line today. Mixes tabs closed during load with boot throws | Accurate for what reports | Reported, outside the rate |
| 18 | Unique players, returning players, retention | None, by design | None | None | No person profile, cookie or stored id | **Not measurable** | Never, without an approved identity strategy |
| 19 | Sessions that never report | None | None | None | Blockers, offline play, rate limits and tabs killed before the first row are invisible to every event that uses the relay | **Not measurable** | Stated as a limit in every readout |
| 20 | Consent-off share | None | None | None | The consent flow was retired (#991); #945's "consenting sessions" wording is stale | Not applicable | No |
| 21 | Frame rate in the field | `session_fps` | Sessions | Any | Sampled at session end, so a killed tab sends none | Lower bound | No (the performance gate uses the pinned PC protocol) |
| 22 | Build identity (`version`, `sha`) | Every `engine_status` row | N | Any | Accurate; a forged row with valid codes cannot be told apart | Accurate | Yes, for by-build lines |
| 23 | Engine divergence reports (#954) | None | None | None | Planned in the data map, never collected; its premise (a TypeScript instance to disagree with) ended with the Rust-only build | Not collected | No; the data map's "Planned" entry should be retired |
| 24 | Export failures (`.vctower`, `.TDT`) | `app_action` `export_failed` (#1655), `detail` `save` or `tdt` | Export attempts (`export_save`, `export_tdt`), printed beside the failures and not divided into a rate | From 2.78.10, the first production version that ships the code (2.78.8 carried it for two minutes and is left out) | An export that wrote no file: the engine threw (a memory failure on a huge tower, or the `.TDT` codec failing to load) or refused (a Modern tower cannot become a `.TDT`). A download the browser blocks is not seen, and a failure that kills the tab reports nothing. The attempt rows are sent when the player clicks Export, so they also count a cancelled report and a click the export latch drops, which would make the ratio understate the failure rate | Count: lower bound from that build. No rate is printed | Yes, as two count rows in `scripts/persistence-failures.mjs` and the "Persistence failures" dashboard tile; the tile has no version filter, so read it from the 2.78.10 deploy on 2026-11-03 |

## Counts and rates for the persistence failures

`scripts/persistence-failures.mjs` (printed under the rate by
`scripts/engine-reliability.mjs`) keeps counts and rates apart. A count is what
the relay received. A rate is printed only where the game sends the attempts:
each import over its own `import_save` or `import_tdt` attempts, and slot loads
as `load_failed` over `load_slot` plus `load_failed`. The autosave rate is
**unavailable**: the game sends no autosave attempt or success, and the failure
is latched once per page life, so the report counts sessions with a failure, not failures. The two export rows (`.vctower`, `.TDT`) print their `export_failed` counts next to the `export_save` and `export_tdt` attempts with the rate marked unavailable, and read their own builds (from 2.78.10).
A
denominator is never inferred from another event. A window with no attempts
reads Insufficient evidence, and a window before the first build that sends the
codes reads Not measurable. The first build is `PERSISTENCE_FAILURE_SINCE` in
the script. Volume is expected to be low, so expect Insufficient evidence or
wide bounds for a while.

## Telemetry coverage: why 91 and 104 are not a gap of 13

The 91 sessions from `session_lengths` and the 104 engine sessions from the
governed script use different counting rules:

- `session_lengths` counts sessions that sent a `session_end`, grouped by each
  session's latest version. A tab that is killed, or whose hide event is
  rate-limited or lost, sends none.
- The script counts sessions with a settled page life that ran the engine,
  whatever ended the session.

So the difference is not "13 lost sessions". Comparing the two as sets of
sessions, a session with engine rows and no `session_end` is a tab that never
sent a hide. That is a measure of `session_end` coverage, and it says nothing
about engine rows.

The comparable check is two emitters that each fire once per page life:
`boot` and `engine_status` `settle`. Over the Rust-only window they agree to
within a few percent (figures below). Both travel through the same relay, so
loss that hits the relay itself (a blocker, an offline tab, a rate limit)
hides from both. Only an independent counter could bound that, for example
page-view counts from a different transport, and no such comparison has been
run yet.

The cross-checks are governed by `scripts/reliability-coverage.mjs`, which
`src/reliability-coverage.test.ts` pins and `scripts/engine-reliability.mjs`
prints under the persistence failures: boot rows, settle page lives, attempt
page lives that never settled, and sessions with engine rows and no
`session_end`. They are cross-checks, not rates, and loss on the relay itself
hides from all of them. The figures in the snapshot below were a one-off read
before that script existed; the script is the live definition.

## Snapshot, 2026-11-03 14:00 UTC (not refreshing)

Window: 2.66.0's first boot (2026-10-30 06:54 UTC) to 2026-11-03 14:00 UTC,
production only. Live figures: re-run the script above.

**Governed.** The script's own counting code, run on the rows of its own
page-life query (the query text came from `buildPageLivesQuery`; the rows came
through the PostHog connector because this review had no API key, so the
transport and its 500-row cap differ from the script's 50,000-row cap):
104 engine sessions, 166 page lives that ran the engine, 1 session with an
engine fault (0.96%, exact 95% upper bound 4.48%). The one fault is a
`boot-error` on 2.74.3 (2026-10-31 19:55 UTC); no `trap-*`, no
`attach-refused`, no package mismatch, no latch-off. 66 sessions engaged
(command or play) on the Rust engine. These figures match the SQL replication
posted the same day. Treat the connector run as a verification of the counting
code, not as a substitute for the script run with the API key.

**One-off, ungoverned (do not publish).**

| Signal (once per page life unless noted) | Count |
| --- | --- |
| `boot` events | 176 |
| `engine_status` `settle` page lives | 174 |
| `engine_status` `attempt` page lives | 172 |
| `engine_status` `engaged` page lives | 98 |
| Sessions with an engine row but no `session_end` | about 11 of about 110 |
| Sessions with `boot` but no engine row | 2 |
| `crash` events | 3 |
| `$exception` events | 17 |

## Where the gaps are tracked

- Save, load and import failure events: #1533 (the three `app_action` codes
  were approved 2026-11-03 and ship with this page's change).
- Trap during attach and older restore points: #1204.
- Crash loop magnitude: #841.
- `$exception` origin classification and the "no data" reading for builds
  with no eligible sessions: #1090.
- Derived coverage and recovery outcome: `scripts/reliability-coverage.mjs`
  (#1623). The dashboard status card is still open under #1623.
