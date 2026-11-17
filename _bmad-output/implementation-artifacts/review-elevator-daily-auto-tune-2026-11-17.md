# Review: daily Auto-tune for elevator schedules (round 1)

- Skill: `/gds-code-review` (engine, save and port fidelity), run as one lean
  pass without a subagent per layer (CLAUDE.md, owner 2026-11-10), with the
  `/bmad-code-review` UI-plumbing layer folded in for the dialog and analytics.
- Diff: `claude/project-thread-acxtb3` against #2415's head `d7337fc`, commit
  `33f1196`, all files.
- Spec: `story-elevator-daily-auto-tune.md`, party findings items 1 to 14.

## Findings

| Id | Layer | Class | Finding | Resolution |
| --- | --- | --- | --- | --- |
| P1 | Edge Case | patch | Run every morning, #2415's first saturated-hour reading and the plain proposal took turns, so an hour swung by one car every day or two for most loads (probe of the 0.3 blend). The pre-registered settle test missed it because its tower never ran a car full. | #2415 round 2 replaced the reading with `cars_for` (rows with room by construction). Regression `a_cut_hour_never_swings_back_and_forth` drives 30 mornings for every load in tenths. Party findings item 14. |
| P2 | Blind Hunter | patch | `seed_telemetry`'s doc said the save never carries the rings; it does now with a shaft on Auto. | Doc fixed in `telemetry.rs`. |
| P3 | Acceptance | patch | `load_stream_tests.rs` (514) and `dispatch_tests.rs` (501) crossed the 500-line ceiling. | Hint test moved to `load_stream_hint_tests.rs`; `Schedule` derives `Default`, the dispatch literal uses it. |
| P4 | Acceptance | patch | TS expectations still named layout 31, a 61-slot schedule, save version 11 as newest, and the old mode-summary phrase; fuzz golden for the Modern smoke run stale. | Port fixture regenerated, tests updated, fuzz goldens re-pinned with the native fuzzer. |
| D1 | Edge Case | dismiss | The 05:00 pass can rewrite rows during a bomb search, when the player cannot. | Every car is stopped during a search, so the rows act only after it ends, and the next morning re-tunes anyway. The lock is on player commands, not engine state. |
| D2 | Acceptance | dismiss | `version-check` fails this branch on #2415's change note (`readmes: unchanged`) because this PR edits the guides. | Stack artifact: it clears when #2415 merges and this branch is restacked on main. |

No `defer` findings, so no backlog rows.

## Hot-path record (section 6), commit `33f1196`, whole diff

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | clear | `retune_auto_schedules` <- `on_hour` <- `tick`: returns on the hour check except 05:00, once per game day. `runs_an_auto_schedule`, `elevator_load_json` <- `save_fields` / `written_save_version` (save only). `same_but_auto_rows` <- `Transport::config_eq` (undo checks per command). `place_transport` per build. `restore_elevator_load` per load. Signature fingerprint hashes one bool per transport per structure change. TS: `tuneHint`, `countsLocked`, `onAutoToggle` per dialog event; `editorActions.apply` per OK. | none |
| HP-2 | clear | At 05:00, per Auto shaft, `auto_tune_proposal` -> `twin_load` scans the transports and each one's stops: O(T x S log S) per shaft, at most 48 x 48 shafts once per game day. Nothing per tick or per frame. | none |
| HP-3 | clear | The daily pass allocates the proposal's two 24-row vectors per Auto shaft and a `Retune` list; the save writes 48 floats and two hour lists per measured elevator. | none |
| HP-4 | clear | No sort added; `hours_of` is an ascending filter over 24 flags. | none |
| HP-5 | clear | `telemetry.hourly` inserts on load only; no new map or set. | none |
| HP-6 | clear | `restore_elevator_load` looks shafts up with `get_transport(id)`; the pass indexes `transports[i]` from its own enumeration. No removal. | none |
| HP-7 | n/a | No ported or moved hot code; the moved hint test is a test. | none |
| HP-8 | n/a | No cache added, dropped or bypassed. | none |
| HP-9 | n/a | No finding under HP-2 to HP-6. | none |
| HP-10 | n/a | No optimization; rows are recomputed from the rings every morning. | none |
| HP-11 | clear | The schedule record crosses as 62 slots (one Auto flag), only on schedule reads and writes; view layout 32 carries no per-frame slot change. Package rebuilt, `packageHash`, `engineIdentity` and the port fixtures pass. | none |
| HP-12 | clear | Rendering untouched; the dialog re-renders on its own events only. | none |

## Round 2: Codex P1 and the independent review (2026-11-17)

| Id | Source | Class | Finding | Resolution |
| --- | --- | --- | --- | --- |
| P5 | Codex P1, independent review R2 | patch | The 05:00 pass ran the whole proposal per Auto shaft, and `twin_load` cloned every same-kind shaft's stop list each time: O(E² x S) copies, over the hourly budget at 48 shafts. | `tuned_rows` is the rows-only helper both the proposal and the pass share. The pass reads each elevator's stops once as a floor set (`elevator_stop_sets`, `floor_bits.rs`), and a twin is one set comparison per elevator (`twins_of`), stairs and escalators left out. Regressions: `the_pass_writes_each_shafts_proposal_with_its_twins`, `twins_are_the_same_kind_stopping_at_every_floor`, `a_set_covers_its_subsets_only`. |
| P6 | Measurement (this round) | patch | The pass moved the tower revision every morning a row changed, which rebuilt the routing graph, the stop lists and every per-revision cache: 4 to 8 ms more on the 05:00 tick of the large towers. | The pass moves no revision: the rows only pick the cars in service, which every step reads live, and nothing cached by revision reads them. |
| P7 | Independent review R1 | patch | Three wasm-feature lib tests were red: the exported layout pin, and two port tests that expected a new Modern elevator to have no schedule. | Pin set to layout 32's hash; the tests assert the schedule it was built with (Auto alone). |
| P8 | Independent review | patch | `telemetry.rs` module doc said the rings are never saved or read back; the change note said layout 31; the data map said "after 4.10". | Fixed. |

### Measurements (release build, maxed towers loaded as Modern, every elevator on Auto with warm rings)

The pass alone (`retune_auto_schedules`, mean of 200 runs):

| Tower | Auto elevators | Before | After |
| --- | --- | --- | --- |
| large | 5 | 3.9 us | 3.3 us |
| many-unit | 24 | 61.7 us | 34.2 us |
| large + 43 added shafts | 48 | 728.1 us | 163.1 us |

The 05:00 tick against the other hour ticks, median of five game days:

| Tower | main (no pass) | Before | After |
| --- | --- | --- | --- |
| large | 1.28 ms (others 1.50) | 6.63 ms (others 1.58) | 1.42 ms (others 1.49) |
| many-unit | 0.87 ms (others 0.97) | 4.44 ms (others 0.91) | 1.00 ms (others 1.06) |
| large + 48 shafts | 3.91 ms (others 4.92) | 13.20 ms (others 5.25) | 5.15 ms (others 5.33) |

After the fix the 05:00 tick sits with the other hour ticks on every tower. The rest of the gap to main is the different traffic Auto's rows make, which every hour tick shares. HP-2 for the pass is now E x E set comparisons (2,304 at the 48-shaft cap) plus one stop read per elevator, inside the hourly budget.

## Round 3: Codex P2 and the independent review round 2 (2026-11-17)

| ID | Source | Class | Finding | Resolution |
| --- | --- | --- | --- | --- |
| P9 | Codex P2, independent review R7 | patch | Ticking Auto never seeded the staging floors, against story AC 5 ("homes seeded only when the player has none, as the button does"). | The toggle passes `!homesDirty`, as the Auto-tune button's proposal does; the morning pass still leaves staging alone. Regression: "ticking it seeds the staging floors when the player has set none". |
| P10 | Independent review R6 | patch | `shortFleets` listed Auto shafts as idle cars, so a flat tuned row got the recovery toast and a "Use all installed cars" button the next 05:00 pass would undo. | `shortFleets` skips a schedule on Auto. Regression: "leaves a shaft on Auto alone, since the morning re-tune owns its counts". |

Neither touches a hot path: P9 runs on a click, P10 only when Tower Statistics or the review opens, and both add one flag read.
