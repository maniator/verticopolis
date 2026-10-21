---
title: 'Staged WASM cohort with sticky engine selection and a Settings engine choice'
type: feature
created: '2026-10-20'
status: approved for implementation (activation not approved)
issue: '#1197'
baseline_commit: c3aa94f (main, after #1177)
context:
  - CONTRIBUTING.md
  - _bmad-output/project-context.md
  - _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md (4.1 "The population (OD-1)", A4)
  - _bmad-output/implementation-artifacts/spec-reliability-instrument.md (A1, `engine_status`)
  - _bmad-output/implementation-artifacts/spec-874-runtime-fallback.md (A3, runtime fallback)
  - docs/analytics-data-map.md
---

# Intent

**Problem.** A player reaches the Rust/WASM engine today only by adding
`?engine=wasm` to the URL (one visit) or by setting `vc.engine` in
`localStorage` by hand (`src/wasmhost/engineChoice.ts`). There is no cohort,
no Settings control, no size gate and no remote flag (analytics is a
write-only relay, so there are no PostHog feature flags). Without a cohort
there are no engine sessions for #945's Reliability row (plan R3).

**Approach.** Plan 4.1's staged cohort (OD-1), with the owner's 2026-10-20
direction on top of it:

1. A persistent rollout bucket and enrollment, drawn once per browser.
2. An explicit player preference in Settings that survives reloads, deploys,
   PWA updates, stage changes and the 3.0.0 flip.
3. A sticky safety suppression: when Rust actually fails on this device, the
   device stays on TypeScript until the player asks to retry. A player never
   bounces WASM, then TypeScript after a fault, then WASM again on reload.
4. No engine change in the middle of an action; the size gate acts only at a
   tower load, with a truthful notice.
5. Everything above is local, so it holds offline and across delayed service
   worker updates.

**Release identity.** Stages 1 to 3 run on 2.x releases as a 3.0 pre-release
test. 3.0.0 is the default flip, after every #945 gate and the owner's final
approval. Nothing in this story is a 3.1 item, and stage 3 is not a "3.0
launch".

## Boundaries

- **Approved:** this spec and the implementation in small reviewed PRs
  (owner, 2026-10-20).
- **Not approved, each needs the owner's explicit OK:** any stage promotion
  (1, 2, 3), any production deploy that turns the cohort on, a deliberate
  drop-back, every new production analytics field or value (listed exactly
  under Telemetry), the size gate's threshold, the default flip, 3.0.0.
- The cohort decides only "Rust/WASM or TypeScript". Which WASM host runs
  (today's main-thread host, later the Rust-backed facade from #1184 slice
  10) is the facade lane's decision, so slice 10 needs no cohort change.
  Moving a live cohort to the facade host is itself an owner approval.
- Stage configuration ships with each versioned deploy; there is no remote
  flag. An installed PWA that is offline may not receive a drop-back right away, so
  recovery and safety suppression work locally and never depend on a deploy.
- Tooling and CI builds (`VC_TOOLING=1`, e2e, screenshots, `npm run perf`)
  and the wasm-only build turn the draw off, so they keep a known engine. A
  tooling-only seam (compiled out of production builds) lets tests set the
  stage and the bucket.
- Saves are engine-neutral (both engines read and write the same format), so
  an engine change between page lives never changes a save. A test pins it.

## Ownership and order

- The Runtime fallback lane owns `src/bootstrap.ts`,
  `src/wasmhost/startWasmHost.ts`, `hostFault.ts`, `wasmHost.ts` and
  `merge.ts`; its PR for #1113, #1126 and #1149 is open on them. This spec
  is written in the triage lane; the Runtime lane implements it in those
  files after that PR merges and after this spec's review.
- That PR adds the hooks this spec uses: `WasmHostStatus.latched` (hosting
  is off for the page life after a runtime fault or a trap while a tower
  attaches) and `onFallback(fallback, latched)`. A clean attach refusal (a
  save the engine refused) is not latched: it means "this tower was not
  hosted", while a latched fallback means "Rust failed".
- The facade (#1184) recovers only the page life where a fault happens; what
  the next boot runs is this spec's suppression. Its host keeps the same
  `onFallback(fallback, latched)` contract and reason codes (a contract test
  in the facade's slice 8 or 10 story), so the suppression needs no change
  when slice 10 lands. Recovery may lose up to 30 seconds of real play (R6),
  and the recovery notice says how much was rewound; this spec adds no copy
  about loss. `?engine=wasm-mirror` sessions report `selected_by: url`.
- New code outside those files: a cohort module (the policy, the storage
  records, the stage config) outside `src/wasmhost` (plan 4.1), the
  Settings section (`src/ui/templates/settings.ts`, `src/ui/uiSettings.ts`),
  the help sentence (`src/ui/templates/helpContent.ts`),
  `src/analyticsEngineStatus.ts` and `docs/analytics-data-map.md`.

## The selection policy

Evaluated once at boot, before the engine package loads, by one pure
function from (stored records, URL, build config) to (engine to request,
the reasons). In order, the first rule that applies decides:

| # | Input | Result | `selected_by` |
| --- | --- | --- | --- |
| 1 | Draw off (tooling, wasm-only build) | today's behavior | `default` |
| 2 | `?engine=` in the URL | that engine, this visit only; nothing stored changes | `url` |
| 3 | Safety suppression latched, and rule 4 or 5 would request Rust | TypeScript | `safety` |
| 4 | Settings preference `rust` or `ts` | that engine | `setting` |
| 5 | Automatic, bucket assigned | WASM when `bucket < share(stage)`, else TypeScript | `cohort` |
| 6 | Automatic, storage unusable | TypeScript | `default` |

The size gate is not in this table: it acts at a tower load (below).

### 1. Bucket and enrollment

- Drawn once, on the first boot of a build that carries this code, at every
  stage including 0: an integer 0 to 99 from `crypto.getRandomValues`,
  written to the cohort record and read back. A browser whose storage
  cannot be read, or does not keep the write, is `unassigned`: TypeScript,
  and nothing else in this spec persists for it.
- The record (`vc.engineCohort`, versioned JSON) holds the bucket and the
  last applied enrollment: `{ stage, arm, sha }` of the build that last
  booted under it. The bucket is never redrawn while the record is
  readable. A record that fails to parse is redrawn once and the event is
  kept locally (it is as random as the first draw).
- The assigned arm is `bucket < share(stage)` for this build's stage. It is
  computed the same way whatever the preference, the URL, a suppression or
  the size gate says, so the randomized assignment survives every override.
- A stage promotion moves a TypeScript-arm browser into the WASM arm once;
  an approved drop-back moves it back once. Both show up as a change
  between the stored enrollment and this build's, which boot records. The
  notice ("This game now runs on the new Rust engine as part of a test. You
  can change this in Settings." and the reverse) shows once, and only when
  the preference is Automatic, no suppression is active and the engine this
  boot runs differs from the one the stored enrollment ran. A player with
  an explicit choice or a suppression sees no notice, since their engine
  did not change. Ordinary reloads and deploys at the same stage change
  nothing.

### 2. Player preference

- The Settings choice stores `vc.engine` (`wasm` or `ts`; Automatic removes
  the key). Existing values keep working: a tester's `wasm-frame` or
  `wasm-worker` is shown as "Rust engine (experimental)" with a note that a
  test host is selected, and picking any option replaces it.
- The preference is never written by the cohort, a deploy, a PWA update, a
  stage change, a drop-back or the 3.0.0 flip. It changes only when the
  player picks another option. A player's TypeScript choice survives 3.0.0.
- `?engine=` never writes it.

### 3. Sticky safety suppression

- **What latches.** A latched runtime fallback (`onFallback(_, true)`: a
  trap in a command, tick, frame sync, drain, undo, or while a tower
  attaches), any failure while the engine package loads, any failure while
  the host starts on the first tower except a clean refusal, and a crash
  loop (below). Each writes the safety record (`vc.engineSafety`, versioned
  JSON): the reason code, the boot stage, the app commit (`__APP_SHA__`),
  the engine source hash (#963) when known, and the time.
- **Two scopes, keyed on the stage where it failed** (`FALLBACK_STAGES` in
  `src/wasmhost/engineBoot.ts`), since one reason code can come from either
  kind of cause. `boot-error` from the load covers a package fetch that
  failed (`load-failed`) or could not be checked (`unverifiable`), which is
  a network or deploy problem; `boot-error` from the host's start is the
  engine itself.
  - *Build* (stage `load`, whatever the reason: `boot-timeout`,
    `package-mismatch`, `boot-error`): a slow network, an offline fetch or
    the deploy race #1046, which say nothing about the engine. TypeScript
    for the rest of this build (same `__APP_SHA__`); a new build tries Rust
    once, and a build-scoped failure on that build latches again.
  - *Fault* (stages `start`, `adopt`, `undo` and `host`: the trap codes,
    a `boot-error` or `other` from the host, and the crash loop's
    `unclean-exit`): TypeScript on every later boot, across deploys, until
    the player retries. No automatic re-enable in this story; any later
    automatic re-enable on a new validated engine is a separate spec and an
    owner decision, and must be visible and loop-proof.
- **Not latched:** a clean attach refusal. Under the cohort the page life
  still stays on TypeScript after it (rule 4 below), but the next page life
  follows the policy.
- **Within a page life:** after any fallback the page life stays on
  TypeScript; no later tower in it goes back to Rust.
- **Crash-loop protection.** The marker (`vc.engineBoot`) is per page
  life, so two windows or tabs never clear or count each other's. A page
  life that requests Rust adds its own entry (a random page-life key, the
  build's `__APP_SHA__`, and a heartbeat time) before it loads the engine.
  While the page is visible it refreshes its heartbeat every 10 seconds.
  It removes its entry when the page is hidden (`visibilitychange` to
  hidden, or `pagehide`), which is a clean exit as far as this check goes,
  and adds it back when the page becomes visible again. Removing it on hide
  keeps a phone that discards a backgrounded tab from counting as a crash.
  - At boot, an entry for the same build whose heartbeat is older than 30
    seconds belongs to a page life that died while visible (out of memory,
    a hang the browser killed) without reaching the fallback path. An entry
    with a fresh heartbeat belongs to another open window and is left alone.
  - Two or more stale entries for the same build latch a fault with the
    reason `unclean-exit`, and the boot runs TypeScript. One stale entry is
    kept and counted again next time.
  - A page life that exits cleanly removes its own entry and the stale ones
    for its build. Entries for another build are dropped at boot, since a
    crash on an older build says nothing about this one.
- **Retry.** Settings shows the suppression and a "Try the Rust engine
  again" button, which clears the safety record and the marker. It takes
  effect at the next start; the game never reloads itself.
- **Analysis.** The suppression never changes the bucket or the assigned
  arm. A suppressed page life reports `safety_suppressed: true` and stays in
  the WASM arm's all-attempts safety analysis.
- A safety record that fails to parse counts as a fault suppression (fail
  safe), shown in Settings with the retry button.

### 4. Tower loads and the size gate

- Boot picks the page life's engine. A load, a new tower or an undo never
  picks a new engine on its own. There is one exception, and it moves only
  toward TypeScript: a load (Load or an import) that the size gate declines
  switches the page life to TypeScript at that load. This is
  the owner's "controlled safe transition". It happens between two towers,
  never during an action. The incoming tower starts on TypeScript from its
  own save, so nothing has to be recovered, and the notice below tells the
  player. The page life never moves back to Rust.
- **The gate (stages 1 and 2 only).** When a WASM page life adopts a tower
  through the first tower, Load or an import, and its size is above the
  threshold, the host declines it and the tower runs on TypeScript with
  `size_gated: true`, never coded as a fallback. The page life then stays
  on TypeScript (no return to Rust for a smaller tower in the same page
  life). The player sees once per page life: "This tower is larger than the
  Rust engine test covers yet, so it runs on the TypeScript engine."
- **An undo restore is never gated.** It returns the tower the page life
  is already running to an earlier state, so it stays on the engine that
  is running it, even when the restored state is above the threshold.
- A tower that grows past the threshold while it runs keeps its engine for
  that page life. The gate applies at its next Load or import, between two
  towers, never in the middle of an action. Nothing about the tower is
  stored: a tower that later shrinks below the threshold may run on Rust
  again, but only from a later page life's first tower or load, so the
  engine still changes only at a load and never back and forth inside one
  page life. Stage 3 removes the gate.
- The gate's size is computed in both arms, so the arms stay comparable
  (plan 4.1). The unit and the threshold come from the owner (RUN-0b or the
  2026-10-15 desktop runs) and live in the stage config module.
- New towers start small and are never gated.

### 5. Offline and updates

- The bucket, enrollment, preference, safety record and crash marker are
  all in `localStorage`, read with every access in `try`/`catch`.
  An offline reload, a delayed service-worker update and a precached older
  build all read the same records and reach the same engine.
- The stage share and threshold come with the build. An installed PWA moves
  to a new stage (or back) only after it takes the update.
- A new build never resets the preference or a fault suppression.

## Settings

A new "Game engine" section, during the 2.x test:

- **Automatic (recommended)**: follows the test you were placed in.
- **Rust engine (experimental)**
- **TypeScript engine (stable)**

Never "Classic": Classic is a gameplay mode. Under the choices, a status
line shows the engine actually running this page life, read from the boot
state and the host status rather than the stored choice, any fallback or suppression reason
in plain words, and "Restart the game to switch engines" when the choice
differs from what is running. Changing the choice never reloads the page. The
descriptions are rewritten for 3.0.0, when Rust becomes the default. 3.0.0
ships the switchable build (OD-5), so a stored TypeScript choice still
selects TypeScript after the flip.
Storage that cannot be written disables the control with a note.

**One player-facing name.** The game says "WASM engine" today (the version
suffix in `src/wasmhost/engineLabel.ts`, About and Copy Diagnostics, the
stop screen in `engineFailureCopy`, Help). This story renames every
player-facing mention to "Rust engine", and "TypeScript engine" for the
other, so a tester told to look for "Rust engine" finds that word wherever
the UI names the engine. Code identifiers, analytics values (`wasm`) and
console logs keep their names. The screenshot gallery and any e2e text
match update in the same PR.

## Telemetry (proposals: needs the owner's approval of the exact additions)

Every field and value below is a proposal until Naftali answers the open
telemetry question. A roundtable's recommendations are with him: what
`assigned_arm` means, whether safety folds into `selected_by` (which would
drop the separate `safety_suppressed` flag, since it then equals
`selected_by: safety`), when `unclean-exit` fires, where `engaged` is
detected, and no `enrolled_stage`. This section changes to match his answer
before any code sends a field.

**How nothing ships early.** The implementation keeps the new fields out of
the `engine_status` event type and the data map until the owner approves
them, and `COHORT_TELEMETRY` in the config module stays false. Until then a
suppressed page life reports as a plain TypeScript page life, and a crash
loop is not visible in analytics; that gap closes when the fields ship.

The data map and its tests change first, in the PR that sends the fields;
nothing ships to production before the owner approves this list.

**The fields ship with their binding to the governed definition, in one approval and one PR.**
`scripts/engine-reliability.mjs` reads `arm` today and excludes `override`
and `unassigned`; a row without that field reads as `none` and is counted. A
row that started carrying `selected_by: setting` or `url` without that
script learning it would count Settings and URL opt-ins as cohort sessions.
The work splits in two:

- **The base definition lands first** (#1232, the #1090 projection lane):
  `scripts/engine-reliability.mjs`, its test and the data map's "How it is
  counted" paragraph learn `assigned_arm`, `selected_by` and the other
  cohort fields, with their value lists pinned to this spec's literals and
  marked as temporary by a test.
- **This story's fields PR does the binding.** In the same PR that adds the
  fields and turns `COHORT_TELEMETRY` on, the script imports `STAGES`,
  `ASSIGNED_ARMS` and `SELECTIONS` from the cohort module in place of the
  pinned literals, `unclean-exit` is bound as a fallback reason, and the
  data map's field table gains the new rows. The owner approves those
  fields and that binding as one packet.

New `engine_status` fields, on every row:

| Field | Values | Meaning |
| --- | --- | --- |
| `stage` | `0`, `1`, `2`, `3` | The cohort stage the build carries |
| `assigned_arm` | `wasm`, `ts`, `unassigned`, `none` | The randomized arm at this build's stage, unchanged by any setting, URL, suppression or the gate. `none`: the draw is off (tooling, wasm-only). |
| `selected_by` | `default`, `cohort`, `setting`, `url`, `safety` | Which policy rule chose `engine_requested` |
| `safety_suppressed` | boolean | A latched suppression put this page life on TypeScript |
| `size_gated` | boolean | The gate moved a tower to TypeScript this page life |

New values on existing fields:

- `fallback_reason`: `unclean-exit` (the crash-loop latch, sent on the
  settle row of the boot that detects it, so a crash before engagement still
  counts).
- `trigger`: `size-gate`, a row when the gate moves a later tower in a page
  life.
- `engine_requested` keeps its meaning (what the policy asked for). With a
  suppression, `engine_requested` is the selection before safety and
  `engine` is `ts`.

Proposed in the same packet by the #1090 lane, so the owner approves one
list. The reasoning for these two belongs to their definition:

- `trigger`: `attempt`, one row per page life once boot has picked the
  engine and before the package loads, so a tab that closes or crashes
  during the load is still visible.
- `trigger`: `engaged`, with a field `engaged_by` (`command` or `play`):
  the first accepted player command, or 30 seconds of foreground play with
  the game clock advancing (the owner's engagement rule for #1090).

Not sent: the bucket, any id beyond the existing page-life id, tower names,
save contents, the enrollment history. With `stage`, `assigned_arm` reveals
at most whether the bucket is below the share.

**Original arm and enrollment.** `assigned_arm` is the arm at the current
build's stage, so a stage promotion changes it for the browsers it moves.
The governed definition takes each session's original arm as the
`assigned_arm` of its first page life, and enrollment (whether the cohort
chose the engine) follows from `assigned_arm` and `selected_by`, so neither
needs a field of its own.

How the governed definition (#1090) reads them: the all-attempts safety
denominator is every page life with `assigned_arm: wasm`, whatever
`selected_by` and `safety_suppressed` say, so opt-outs and suppressions stay
visible in the WASM arm. An eligible session additionally has `selected_by:
cohort`, no suppression, no size gate, stage 3 and the build conditions of
plan 4.1 and the owner's R3 note (the facade live as the normal WASM host).
Overrides (`setting`, `url`) are early telemetry, never counted toward the
1,000. Suppressed page lives are also never eligible, so the #1090
projection and its blind spots should count suppression attrition: every
WASM-arm browser that latches leaves the eligible pool for good.

## Before asking the owner for stage 1

**Stage 1 waits on Naftali's telemetry approval.** The cohort's fields, with
the governed-definition change above, must be approved and live before any
build carries a share above 0. A unit test over the config module pins it:
a stage whose share is above 0 with `COHORT_TELEMETRY` false fails, so a
stage cannot ship blind to which sessions the cohort chose.

Plan 4.1's entry conditions, rechecked against live GitHub and deployed
behavior, plus the owner's 2026-10-20 list: tested fallback evidence
(including the forced-trap spec and the suppression e2e below), PC
performance and UX evidence for the host the cohort would actually get, the
size threshold, the known risks, crash-loop protection working, and a
working manual opt-out. Players are not recruited into a known severely
degraded experience to meet a session floor.

Stage 3's entry conditions, including what "the facade is the WASM host"
means (slice 10 deployed, with its tests), are the ones the facade plan's
section 1.2 (#1184) and plan 4.1 state; this spec cites them and does not
restate them.

Settings and URL opt-ins never count toward the 1,000, so the #1090 traffic
projection should assume a share of WASM-arm players moving to an override,
using the opt-out count this story makes visible.

## Acceptance

1. With the draw on and no URL or preference, a browser's engine follows
   `bucket < share(stage)`, the same on every reload of the same build.
2. Raising the stage moves only TypeScript-arm browsers to WASM, once, with
   the notice; lowering it moves them back once.
3. A Settings preference survives reloads, a new build, a stage change and
   an offline reload, and the cohort never overwrites it.
4. After a latched fallback, every later boot of the same browser runs
   TypeScript (fault scope across builds; build scope until a new build),
   until "Try the Rust engine again"; no WASM, TypeScript, WASM cycle
   happens on reloads.
5. Two stale crash-marker entries on one build latch `unclean-exit`; a
   second open window never counts as a crash.
6. A page life never returns to Rust after a fallback or a size-gated
   tower.
7. A tower above the threshold, at the first tower, a Load or an import,
   runs on TypeScript with the notice and `size_gated`; one that grew past
   it switches at its next Load or import; an undo restore is never gated.
8. Settings shows the running engine, the reason and restart-needed, and
   never reloads the page.
9. Every `engine_status` row carries the fields above with the right values
   in each case, the data map lists them, and nothing else is sent.
10. Every player-facing mention of the engine says "Rust engine" or
    "TypeScript engine"; no player-facing "WASM engine" remains (a guard test
    over the UI templates and copy modules pins it).

## Tests

- **Unit (policy):** each table rule and their order; bucket boundaries
  (9 and 10 at 10%, 24 and 25, 49 and 50); unreadable, unwritable and
  corrupt records; tooling and wasm-only builds; stage promotion and
  drop-back transitions; preference precedence over the cohort and
  suppression precedence over the preference; URL never writes; fault and
  build scopes by stage; the crash marker's stale count, heartbeat, clear
  paths and two open windows; a share above 0 requires `COHORT_TELEMETRY`.
- **Unit (telemetry):** every new field and value on each trigger, the
  engine kind under suppression, the data map guard.
- **Integration (boot with the fake engine):** a latched fallback writes
  the record and the next boot requests TypeScript; a clean refusal does
  not latch; the size gate declines over-threshold towers in a WASM page
  life and the page life stays on TypeScript.
- **E2E on `chromium-wasm`** (stage and bucket set through the tooling
  seam): cohort WASM with no URL; the forced trap from #874, then a reload
  stays on TypeScript and Settings shows the suppression, then retry and a
  reload runs WASM; a TypeScript preference through a reload, a new build
  and a stage change; the same two stickiness cases with the network
  offline in the production-build PWA suite; a crash marker left twice.
- `/bmad-code-review` for the policy, storage and UI, `/gds-code-review`
  for the size gate and the host behavior, a hot-path record for the boot
  path, and the independent review before merge. Player-facing, so a minor
  version bump.

## Owner decisions this spec needs

- The exact telemetry additions above.
- The size gate's unit and threshold.
- Whether build-scoped suppression (any failure while the package loads)
  may retry once on a new build, as specified, or should latch like a fault.
