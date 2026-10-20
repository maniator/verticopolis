---
title: Preserve pending exterminator bookings across engine attachment
type: bugfix
created: 2026-10-16
status: in-review
baseline_commit: 8f3a14353
context:
  - CONTRIBUTING.md
  - _bmad-output/project-context.md
---

<frozen-after-approval reason="Previously accepted cutover plan S5, executed under the owner's complete migration request">

## Intent

**Problem:** Saving or attaching the WASM host after an exterminator booking loses the billed room IDs. A later infestation then receives unpaid treatment because a missing list retains the legacy tower-wide fallback.

**Approach:** Persist the optional billed room list in both engines and carry it through host merges. Keep old saves readable, without a save-version bump, as the canonical cutover plan S5 requires.

## Boundaries & Constraints

**Always:** Preserve Classic behavior, preserve the absence of new fields in saves without bookings, use the same coercion in both engines, bound untrusted lists and keep treatment membership linear. Keep optional legacy semantics: absent list means tower-wide treatment, a present invalid list authorizes no rooms. IDs are positive integers below 2^31, deduplicated in input order and capped at the lot unit ceiling.

**Ask First:** Changes to the save version, paid treatment rules, or unrelated API contracts.

**Never:** Edit performance or rendering branches, flip the default engine, publish 3.0.0, or change TDT.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Pending booking | Room A billed, B becomes infested later | Save/load and attach preserve A only | No extra charge |
| Completion | Due date reached | A clears, B stays infested, pending state disappears | Missing or demolished A ignored |
| Legacy save | Due date present, list absent | Existing tower-wide treatment retained | No migration failure |
| Malformed list | Present non-array, invalid IDs, duplicates, oversized list | No coercion, unique valid bounded IDs retained | Present invalid list becomes empty |
| No booking | No valid due date or Classic | No list restored or written | Ignore orphan list |

</frozen-after-approval>

## Code Map

- `src/engine/serializedGame.ts`, `src/engine/sim/serialization.ts`, `src/engine/sim/coerce.ts`, `src/engine/Simulation.ts`: optional saved field and loader trust boundary.
- `engine-rs/src/sim.rs`, `engine-rs/src/load.rs`, `engine-rs/src/services.rs`: matching persistence, loader coercion (the patch, then the review's cap and dedupe fixes) and treatment membership.
- `src/wasmhost/merge.ts`: preserve pending IDs and clear completed bookings.
- `src/tests/parity/wasmHostSetup.ts` and `src/tests/parity/wasmHostSetup.integration.test.ts`: the parity setup no longer refuses a re-host while a booking is pending, and its test re-hosts mid-booking and ticks through the treatment.
- `vite.config.ts` (`typescriptSide`) and `.github/workflows/engine-rs.yml` (paths and the named case list): the new host test runs on the TypeScript side and in the engine workflow.
- `src/engine/sim/exterminationPersistence.test.ts` and `engine-rs/src/extermination_tests.rs`: the same cases in both engines (reload, legacy, non-array list, orphan and Classic lists, the cap and its boundaries, a demolished billed room).
- `src/tests/integration/wasmHostExtermination.integration.test.ts`: actual WASM attach and mid-booking detach regressions; S4's booking case, an engine trap in a tick or a command mid-booking that falls back through `startWasmHost` and keeps the treatment; and the worker host mid-booking: its attach through the treatment, the hour pass's reply putting a cleared list back, and a detach (kept out of the parity projects, since it starts its own hosts).
- `src/tests/integration/loaderCases.integration.test.ts`, `conformance/scenarios/hotel-exterminator-reload-modern.json`, `conformance/`: cross-engine lock evidence.
- `_bmad-output/planning-artifacts/release-3.0-exception-register.md`: EX-1, the rollback loss.

## Tasks & Acceptance

**Execution:**
- [x] Add optional field, conditional writer and matching loader coercion in both engines.
- [x] Adopt the saved pending list through host merge and clear absent values.
- [x] Add unit regressions for booking, clearing, relapsing and malformed/legacy loads.
- [x] Add Rust and actual WASM attach regressions and conformance input cases.
- [x] Run applicable gates and mandatory `gds-code-review`, recording triage.
- [x] After #874 (A3) merged: merge it in (a merge commit) and add S4's booking case (an engine trap mid-booking falls back and keeps the treatment) and a worker-host attach mid-booking.

**Acceptance Criteria:**
- Given A was billed and B was not, when saved, reloaded or attached mid-booking, then the treatment clears only A.
- Given a completed treatment, when a later room relapses, then a new paid booking can be made without stale IDs.
- Given legacy saves without IDs, when loaded, then their current tower-wide treatment is preserved.
- Given corrupt input, when loaded by either engine, then both retain the same bounded valid list and do not grant extra treatment from malformed lists.

## Spec Change Log

- 2026-10-20, recovered and reviewed (WS-A, A2): the patch was recovered from
  a Codex worktree and applied unchanged, then main (with #1062) was merged
  in. Its WASM integration test had never run (the engine package was not
  built where it was written): it ticked one hour short of the treatment and
  ran in the WASM parity project, which hosts the tower itself. The
  conformance reload now has its own scenario, `hotel-exterminator-reload-modern`,
  so `hotel-exterminator-modern` keeps the path with no reload. The
  original's lock moves only where a booking is pending, since the state now
  carries the billed ids. The rollback loss is EX-1 in the release exception
  register.
- 2026-10-20, after #874 (A3, PR #1101) merged: `main` merged in (a merge
  commit, 2.41.0 kept above #1101's 2.40.0). `wasmHostExtermination` adds
  S4's booking case through the real fallback (`startWasmHost` with the app's
  undo history): an engine trap in a tick, whose newest restore point is the
  last merge's save, and in a command, whose point is the undo capture's
  save. Both restore from an engine-written save taken after the attach,
  keep the booked list, and the TypeScript loop then treats only the billed
  room. The worker host's cases attach mid-booking and run through the
  treatment on the engine, and let go mid-booking after an hourly pass, with
  the TypeScript loop treating only the billed room. All six cases in the
  file fail with the TypeScript loader dropping the list, with the merge
  deleting it, and with the Rust writer leaving it out (each checked by
  hand). Gates rerun on `cc69346`: typecheck, lint, `npm test`, `test:wasm`,
  `test:wasm:parity`, `cargo fmt`, `clippy` and `cargo test` (the
  conformance referee included), the production and wasm-only builds, and
  the `chromium-wasm` and wasm-only e2e specs; CI green on the same head.
- 2026-10-20, `/gds-code-review` of the post-#874 head (`cc69346`), below:
  the worker host's tests now show the hosting and the merges they rely on,
  one of them clears the read model's list and needs the 08:00 hour pass's
  own reply (no settle) to put it back, which is the path #1068's hourly
  delta takes; the trap cases pin which restore point came back (the merge's
  at three hours for a tick, the capture's a minute later for a command).
  The merge-deleting mutation fails all six cases again. The hot-path
  record found nothing new; its pre-existing items are #1173 and #1158's
  A23.
- 2026-10-20, after #1157 merged first (`a146861`, crate 0.2.0): `main`
  merged in (a merge commit, no conflicts) and the crate goes to 0.3.0 with
  `compat-record.json` re-recorded by `npm run engine:compat`. The lock
  moves (`expected.json`, `loader-cases.json`), and the save gains a field
  an older engine drops (EX-1), so this takes the minor bump CONTRIBUTING
  gives a save change rather than the patch for a lock change alone.
  `SAVE_VERSION`, the frame layout, the catalogs and `engine.d.ts` are
  unchanged.

## Design Notes

S5 explicitly permits the optional field and resulting conformance hash change. Rollback to a pre-S5 engine discards the field and can clear later infestations too; that compatibility exception is EX-1 in `_bmad-output/planning-artifacts/release-3.0-exception-register.md`, for the owner's decision at the #945 sign-off. The issue's original suggestion that treatment never lands is stale: current resolution with absent IDs clears every infested hotel. Tests pin the observed failure.

## Verification

- Focused TypeScript unit and WASM integration tests.
- Loader conformance regeneration followed by Rust loader replay and full referee.
- Typecheck, lint, ordinary tests, production build, Rust format/clippy/tests and WASM build as available.
- Mandatory three-layer `gds-code-review`, including save-input hardening and engine architecture concerns.

## Review

### `/gds-code-review`, 2026-10-20 (on the recovered patch with its regenerated locks, before 6861477)

Blind Hunter, Edge Case Hunter and Acceptance Auditor. Fixed:

1. `serialization.ts` went over the 500-line ceiling (the file-size guard
   failed).
2. The WASM attach test had never passed: it ticked to 07:00 on the due day,
   an hour before the Modern shift lands the treatment, and it ran in the
   `integrationWasm` project, whose setup already hosts the tower. It now
   ticks to 08:00 and sits with the other self-hosting tests in
   `typescriptSide` and the `engine-rs.yml` path lists.
3. Nothing covered a fallback mid-booking: a new test detaches the host
   before the treatment and checks the TypeScript loop treats only the
   billed room.
4. The cap and the treatment outcomes were pinned in TypeScript only. Both
   engines now run the same cases: the cap with a repeat just short of it
   and invalid entries ahead of it, the `2^31 - 1` and `2^31` boundaries, a
   legacy save, a list that is not an array, orphan and Classic lists, and a
   billed room demolished and rebuilt before the treatment.
5. Inserting the reload into `hotel-exterminator-modern` replaced its
   no-reload path; the reload is now its own scenario, whose state at
   `reloaded-booking` equals its state at `booked`.
6. Comments still called the ids transient (`Simulation.ts`, `sim.rs`), and
   the `coerce.ts`, `merge.ts` and both `services` comments said more or
   less than the code does (`merge.ts` also had a British spelling).
7. The backlog row, the test-parity story and this spec described the old
   behavior; the rollback loss had no register entry (now EX-1).
8. A player who reloads mid-booking sees a different treatment, so the
   version moves with a changelog line (2.36.0 after the bmad pass below).
9. The Rust test grew `services.rs`, already over the ceiling; the booking
   tests now live in `engine-rs/src/extermination_tests.rs`.

With A3 merged in (the last task above): S4's trap-mid-booking case and a
worker-host attach mid-booking, now in `wasmHostExtermination` (see the
change log).

Dismissed: the TypeScript treatment lookup being linear (it already uses a
`Set`); a save stripped of the list getting the legacy treatment (a
hand-edited save can grant itself anything, and old saves must stay
readable); id reuse after a demolition (ids are monotonic and `nextId` is
saved); the loader cases not reaching the list (the booked, empty and legacy
cases hash apart, and the orphan and Classic cases equal their round trips);
serde parsing decimals differently (`float_roundtrip` is on); the merge
dropping a list the instance booked (commands relay to the engine as they
happen); a corrupt list using up a paid booking (by design, AC4); the
cutover plan's gap table (a dated snapshot).

### `/bmad-code-review`, 2026-10-20 (on 6861477 plus the CI fixes)

Blind Hunter, Edge Case Hunter and Acceptance Auditor, on the non-gameplay
surface. Fixed:

1. CI: `exterminationPersistence.test.ts` failed on `unitWasm`. Its
   `booked()` wrote the later infestation onto the hosted instance after
   the booking, and a hosted instance's `serialize()` returns the engine's
   save, so the write never reached the save. The tests now write it into
   the raw save. The parity re-host test ticked 24 hours, an hour short of
   the treatment; it ticks 30.
2. Removing the booking guard from `compareOrRehost` also let the compare
   right after a relayed `callExterminator` re-host on a difference while
   the crowd is empty, so a booking the two engines answered differently
   would be re-hosted away. That compare now throws on any difference
   (`rehost: false`), pinned by a parity setup test that fails without it.
3. EX-1's check cited a section 6 rehearsal that only flips the default on
   the same build, which keeps the field. It now points at the deploy
   rollback the 3.0 web release plan proposes (#1080, section 10) and stays
   proposed.
4. The `merge.ts` comment gave the wrong reason for the explicit copy (the
   loop already copies the key; the line is a safeguard).
5. The host detach test now detaches in `finally`.
6. The Rust loader's cap had no literal pin; its test pins 82,500, the
   value `storage.integration.test.ts` pins for TypeScript.
7. CONTRIBUTING files a visible fix under minor and gives a patch no
   changelog line, so the version is 2.36.0.
8. The Code Map, the backlog row's pinned-by list (the host tests, and the
   two tests owed with the A3 rebase) and the changelog line (now about
   saves made from this version on) were incomplete.

Dismissed: the reload scenario not reaching the billed-only branch (a
probe on the TypeScript engine shows six rooms turning infested in the
treatment's own tick before it lands; a tower-wide treatment leaves none,
the billed one leaves those six, so `cleared` pins the branch); the
`t+10800` lock move (the second booking is pending there); `load.rs` and
`services.rs` growing (both on the ratchet; the test module follows the
`*_tests.rs` include convention, and the coercion sits with the other save
fields); the row reading done before the merge (it says the issue closes
on merge and lists the tests still owed); `serialization.ts` at exactly 500
lines; `BUILD.json` not committed (generated); the second scenario
duplicating the first (kept on purpose, gds item 5).

Noted for the merge (PR "Before merge"): PR #1068 rewrites `merge.ts` and
still deletes `exterminationRoomIds`, so whichever lands second keeps the
adoption, and the worker-host tests pin it; #1080 edits this backlog row
(P1 and an S4 note); a re-bump if A3 bumps first. Since settled: the
worker-host tests landed with the post-#874 merge, the version is 2.41.0
above #1101's 2.40.0 (the 2.36.0 above was this branch's bump before
then), and a trial merge of #1068 keeps the assignment inside its
`adoptSimulationFields`.

### `/gds-code-review`, 2026-10-20 (the post-#874 head, `cc69346`)

Blind Hunter, Edge Case Hunter, Acceptance Auditor and the Hot-Path
Auditor, on the whole PR with the focus on the merge of main, the new tests
and the docs. Patch findings, all fixed:

1. The worker host's tests never showed the worker was hosting or that a
   merge ran, and their read-model checks held with no merge at all (the
   list was on the instance before the attach). The attach case asserts
   `loaded()`, a merge and an exact engine save (no approximate save
   taken); the let-go case clears the read model's list and needs the
   08:00 hour pass's own reply to put it back, with no settle, then
   detaches without one.
2. The let-go case ran a fixed 15 frames and read the hour as a stand-in
   for the hourly pass; it now runs to the hour.
3. The trap cases did not pin the restore point: a tick restores the last
   merge's save (three hours in), a command the capture's save, a minute
   later.
4. Smaller test fixes: `MAX_STEPS_PER_FRAME` for the literal four, one
   tower object per case, the log checked non-empty before its last line,
   the older cases' `host` locals renamed (they shadowed the driver) and
   reusing the shared helpers.
5. Docs: the #902 backlog row's grammar and test list; #874's close
   condition aligned across spec-874's bullet, its Merge section and the
   backlog row (after #1092 and the owner's PC restore-point run); the
   retirement story's test names and the read-model assertions that go;
   this spec's stale merge note; a parity setup comment.

Deferred: the Hot-Path Auditor's pre-existing items (the treatment and the
booking walking every unit, and the Rust `excavated` list's linear dedupe,
which the TypeScript keeps in a `Set`) are #1173 with a backlog row; the
hourly full-save merge is #1158's A23. None is in code this PR adds or
rewrites, and each fits its tier's budget today.

Dismissed: `detach()` not awaited (it returns nothing); a timeout per
worker case (the integration projects allow 120 s and the file runs in
under a second); the unasserted log mocks (the fallback's reporting is
#1101's tests'); the engine workflow's path list missing the shared test
helpers (the other self-hosting tests do not list them either, and
`test:wasm` runs the file on every PR); "Temporary, with the fallback."
(the marker the fallback's code uses throughout); undo, redo and booking
traps mid-booking (the general command-trap path is #1101's; S4 and S5 ask
for a fallback mid-booking).
