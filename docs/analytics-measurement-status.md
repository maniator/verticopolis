# Analytics measurement status

What each reliability and usage measure can and cannot tell us, so a missing
measurement is read as "unknown" and never as "zero". This page is the status
inventory for the 3.0.0 release gate (#945, #1090). The events and fields
themselves are in [`analytics-data-map.md`](./analytics-data-map.md); the
counting rules for the engine fault rate are in
[`scripts/engine-reliability.mjs`](../scripts/engine-reliability.mjs).

> **Snapshot of the review on 2026-11-03.** The statuses below are definitions
> and change only when the instrumentation changes. The figures in the
> snapshot section at the end are dated, do not refresh, and are not release
> evidence. The live engine figure is
> `node scripts/engine-reliability.mjs --window <days>`, whose rules
> `src/engine-reliability.test.ts` pins. Sessions and engaged sessions are
> read from the `session_lengths` view and the `engaged` rows through the same
> script. The coverage numbers have no governed definition yet (see
> "Telemetry coverage" below).

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
| **Lower bound** | Counted exactly, but sessions that never report (blockers, offline play, rate limits, tabs killed early) are missing, so the true value is at least this. |
| **Approximation** | A proxy for the thing named. Never quote it as the thing. |
| **Incomplete** | The event exists, but part of the outcome space has no event. |
| **Not measurable** | No event can answer it, by design or because none exists yet. Report "Not measurable", never 0. |
| **Insufficient evidence** | Measurable, but the window holds too few sessions or no occurrences, so a clean result proves little. Report the exact upper bound, not "no failures". |

"Release evidence" below means the figure may go in the #945 sign-off packet.
Only the candidate-build window counts (see #945). Everything else is early
telemetry and context.

## Inventory

| # | Measure | Source | Denominator | Window | Limits | Status | Release evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Engine fault rate (sessions) | `engine_status` page lives, `engine-reliability.mjs` | Sessions with a settled page life that ran the engine (N) | Any; the candidate-build tail is the evidence | Needs a `settle` row, so a tab that dies during load is not in N. Sessions are not independent, so the exact 95% upper bound is optimistic | Lower bound | **Yes**, with the bound reported as achieved |
| 2 | Engine faults by reason and by build | Same | Same | Same | A lone `boot-error` cannot be split between a real fault and files that did not arrive whole (#1086 shapes 1 and 2) | Lower bound, reason partly ambiguous | **Yes**, triaged one by one |
| 3 | Engine initialization failure | `engine_status` `fallback_reason` `boot-error`, `fallback_stage` | N | Same | A boot that throws before the game exists sends no row; `$exception` may report it. Browsers that block the relay send nothing | Lower bound | **Yes**, inside row 1 |
| 4 | Package mismatch and unverifiable engine files | `engine_status` `package-mismatch`, `unverifiable` | N | Same | Deploy race and browsers without `crypto.subtle`; deliberately outside the fault rate and printed on their own lines | Accurate for what reports | Reported, never counted as faults |
| 5 | WASM traps while running | `engine_status` `trap-command`, `trap-tick`, `trap-undo`, `crash-reload` | N | Same | Zero traps seen means zero reported, not zero happened: a tab killed by the trap before the row sends nothing. The reload path is exercised by the forced-trap E2E spec, not by production traffic so far | Lower bound; Insufficient evidence at current volume | **Yes**; any trap is a stop signal |
| 6 | Trap recovery: recovered versus stopped | `crash-reload` row, then the same `distinct_id`'s later page lives; a second trap on a build stops the game and sends a `fallback` row | Sessions with a trap row | Same | Derivable from existing rows, but no governed query computes it today. The reloaded page life boots as `continue`, so only the session sequence tells recovery apart | **Not measured** (derivable) | Needed; see #1623 |
| 7 | Writer latch-off | `engine_status` `writer_latched`, trigger `writer-latch` | N | Same | Reports only when the latch happens on a page that can still send | Lower bound | **Yes**; any latch-off fails the row |
| 8 | Autosave and quick-save failures | None. A quick-save failure toasts the player; an autosave failure is silent (#1533) | None | None | No event, so a quota or storage failure is invisible. Indirect hints only: `writer_latched`, `crash.saveFlushed` | **Not measurable** today | Needed (new field, needs approval) |
| 9 | Load failures | `boot` `reason=corrupt` only | `boot` rows | Any | Covers a corrupt autosave at boot. A failed manual load is invisible (#1533) | **Incomplete** | Needed for the manual-load half |
| 10 | Import failures (`.vctower`, `.TDT`) | None | None | None | Successes are counted as `app_action` `import_save` and `import_tdt`; failures are not (#1533) | **Not measurable** today | Needed (new field, needs approval) |
| 11 | Save and load usage | `app_action` `save_slot`, `quick_save`, `load_slot`, `export_save` | Sessions | Any | Successes only, with no attempt count, so it is not a success rate | Approximation (usage), never an outcome rate | No |
| 12 | Crash screens (lost WebGL context) | `crash` | Crash rows | Any | Capped and deduplicated per page life, so the count of repeats is lost (#841). This is a renderer failure, not an engine fault | Incomplete (magnitude) | Reported separately from row 1 |
| 13 | `$exception` counts | `$exception` | Rows | Any | Raw counts, capped at 10 per page life, not classified by origin (#1090). Never present a raw count as engine failures | Approximation | Only once classified (#1090) |
| 14 | Engaged sessions | `engine_status` `engaged` rows, `engaged_by` | Sessions | Since 2026-10-29 | Lower bound on real play; a boot fault cannot engage, so engagement must never be the fault-rate denominator | Lower bound | Reported beside N, not as N |
| 15 | Sessions (per tab) | `session_lengths` view | Sessions that sent `session_end` | Any | `session_end` re-fires on every hide, so only the view is governed; a tab killed without a hide sends none | Lower bound | Context only |
| 16 | Sessions with incomplete terminal telemetry | `engine_status` sessions with no `session_end` | `engine_status` sessions | Any | See "Telemetry coverage". No governed query yet | **Not measured** (derivable) | Needed as a caveat line |
| 17 | Page lives that attempted and never settled | `engine_status` `attempt` without `settle` | `attempt` page lives | Any | Printed by the script on its own line today. Mixes tabs closed during load with boot throws | Accurate for what reports | Reported, outside the rate |
| 18 | Unique players, returning players, retention | None, by design | None | None | No person profile, cookie or stored id | **Not measurable** | Never, without an approved identity strategy |
| 19 | Sessions that never report | None | None | None | Blockers, offline play, rate limits and tabs killed before the first row are invisible to every event that uses the relay | **Not measurable** | Stated as a limit in every readout |
| 20 | Consent-off share | None | None | None | The consent flow was retired (#991); #945's "consenting sessions" wording is stale | Not applicable | No |
| 21 | Frame rate in the field | `session_fps` | Sessions | Any | Sampled at session end, so a killed tab sends none | Lower bound | No (the performance gate uses the pinned PC protocol) |
| 22 | Build identity (`version`, `sha`) | Every `engine_status` row | N | Any | Accurate; a forged row with valid codes cannot be told apart | Accurate | Yes, for by-build lines |
| 23 | Engine divergence reports (#954) | None | None | None | Planned in the data map, never collected; its premise (a TypeScript instance to disagree with) ended with the Rust-only build | Not collected | No; the data map's "Planned" entry should be retired |

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

None of these coverage figures is governed. Do not publish them as a rate;
#1623 proposes a tested definition.

## Snapshot, 2026-11-03 14:00 UTC (not refreshing)

Window: 2.66.0's first boot (2026-10-30 06:54 UTC) to 2026-11-03 14:00 UTC,
production only. Live figures: re-run the script above.

**Governed.** The script's own counting code, run on the rows of its own
page-life query (the query text came from `buildPageLivesQuery`; the rows came
through the PostHog connector because this review had no API key, so the
transport and the 500-row cap of the connector differ from the script's):
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

- Save, load and import failure events: #1533 (new `app_action` codes need
  the owner's approval before they ship).
- Trap during attach and older restore points: #1204.
- Deploy-race shapes still coded as `boot-error`: #1086.
- Crash loop magnitude: #841.
- `$exception` origin classification and the "no data" reading for builds
  with no eligible sessions: #1090.
- Derived coverage, recovery outcome and the dashboard status card: #1623.
