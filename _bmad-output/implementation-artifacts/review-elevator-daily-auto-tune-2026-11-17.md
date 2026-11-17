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
