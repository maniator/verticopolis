---
baseline_commit: f6149dacc7cf38f424543104201867873f9e2f7a
---

# Story: Save metadata stamps and bulletin-log persistence

Status: done (merged 2026-07-12 via PR #195, merge ae6617d; log-cap follow-up PR #196, merge aa63d7e)

Grounds: direct owner request (2026-07-12), follow-up to PR #194 (view-state
save parity): "any other things we should be adding to the vctower save?"
Owner approved the two recommended items, both, off origin/main. TDT is
fixed by the 1994 format and is untouched by this story.

## Story

As **a Verticopolis player who moves saves between devices and returns to
long-running towers**,
I want **my .vctower files to record when and by which build they were saved,
and my bulletin history to survive save/load**,
so that **a moved tower is identifiable and debuggable, and the game I load
reads like the game I left instead of opening with an empty message panel**.

## Context (read before coding)

- `SaveGame.saveTo`/`saveToAsync` (`src/storage/SaveGame.ts:211-246`) already
  stamp `savedAt` via an ad-hoc cast (`SerializedGame & { savedAt: number }`);
  `SaveGame.export` (`SaveGame.ts:249`) serializes WITHOUT any stamp, so a
  .vctower file carries no timestamp and no build provenance. `infoFrom`
  (`SaveGame.ts:96-114`) reads `savedAt` back through the same cast for the
  Saves manager.
- The app version is the Vite-injected `__APP_VERSION__` global; the standard
  guard is `typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"`
  (`src/main.ts:48`, `src/ui/Onboarding.ts:12`, `src/vite-env.d.ts:4`).
  `Date`/wall-clock stays out of the engine; stamping lives in the storage
  layer only (see `nowMs()` in SaveGame.ts).
- `Simulation.log: LogEntry[]` (`src/engine/Simulation.ts:290`) is explicitly
  transient (doc comment at 291-293, 406): the ring is capped at 300 by
  `emit` (`Simulation.ts:411`), and neither `log` nor the monotonic `logSeq`
  is serialized, so every load/import/undo wipes the bulletin panel.
- The UI needs NO changes: `UI.resetLog` (`src/ui/UI.ts:553-556`) already
  rebuilds the bulletin from `sim.log` on every adopt, and `renderLog`
  (`UI.ts:501`) diffs new-entry toasts on `logSeq`, not on `log.length`, so a
  restored log with `logSeq` back at 0 repopulates the panel without
  replaying a single toast.
- `LogEntry` is `{ minute: number; text: string; kind: "info" | "good" |
  "bad" | "money" }` (`Simulation.ts:141-145`). `emit` pushes and the UI
  renders via `textContent` (no HTML injection surface), but save text is
  UNTRUSTED on load and must be hardened at the deserialize trust boundary
  like every other field.
- Undo snapshots are `JSON.stringify(sim.serialize())` (`src/main.ts:389`)
  capped by `UNDO_CAP` (`src/engine/UndoHistory.ts:79`). Serializing the log
  means undo/redo also restores the bulletin (today an undo wipes it), at the
  cost of a few KB per snapshot on top of the ~0.7MB a big tower already is.
- PR #194's `view` field established the pattern for optional inert save
  cargo: spread into `serialize()` only when present, validated/dropped at
  `Simulation.deserialize`, absent field = today's behavior, no SAVE_VERSION
  bump. Tests live in `src/tests/viewStateParity.test.ts`; storage tests in
  `src/tests/storage.test.ts` (see `decodeVctower` helpers and the fixture
  `src/tests/fixtures/towerone_6.vctower`).

## Scope fence

Two items only: write-time metadata stamps (savedAt, appVersion) and the
bulletin-log tail. No TDT changes (the 1994 format has no room and the
importer/exporter already handle absence). No prefs, speed, tool, overlay,
selection, or undo-history persistence (ruled out in PR #194's party
session). No new UI surface (the Saves manager and import toasts stay as
they are; surfacing appVersion there is a possible later story).

## Acceptance Criteria

1. **Schema.** `SerializedGame` gains three optional fields: `savedAt?:
   number` (epoch ms, write-time stamp), `appVersion?: string` (build that
   wrote the file, write-time stamp), and `log?: LogEntry[]` (the bulletin
   tail). All documented: the two stamps are storage-layer provenance the
   engine never writes or reads; the log is engine state. The existing
   ad-hoc `savedAt` casts in SaveGame.ts go away.
2. **Stamps on every write.** `saveTo`, `saveToAsync`, and `export` all stamp
   `savedAt` (Date.now via the existing `nowMs()`) and `appVersion` (the
   `__APP_VERSION__` guard pattern). `sim.serialize()` itself emits neither
   key, and `Simulation.deserialize` does NOT carry them onto the sim (they
   are provenance of the FILE, not live state; the next write re-stamps).
   `listSlots` keeps returning `savedAt` without the cast.
3. **Log rides the save.** `serialize()` emits the last `LOG_SAVE_CAP = 100`
   entries of `sim.log` when the log is non-empty (spread pattern: an empty
   log contributes no key). The constant lives next to the LogEntry ring cap
   in Simulation.ts with the 300-entry ring documented as its ceiling.
   *(Superseded 2026-07-12, same day: an owner-delegated party ruling raised
   `LOG_SAVE_CAP` to equal the 300-entry ring cap so undo never trims
   scrollback; see the backlog's resolved row and the follow-up PR.)*
4. **Log restores through the trust boundary.** `deserialize` restores
   `sim.log` from `data.log`: a non-array or absent field restores an empty
   log; each entry must be an object with a string `text` (truncated to a
   hard cap, 400 chars) or it is dropped; `minute` coerces to a finite number
   (else 0); `kind` coerces to one of the four LogEntry kinds (else "info");
   at most 300 entries restore (the engine ring cap). `logSeq` stays
   transient at 0, which the UI's cursor logic already handles (no replayed
   toasts, panel repopulates via resetLog).
5. **Round trips.** A save/load and a .vctower export/import both bring the
   bulletin back (order preserved, newest last). Undo/redo now restores the
   bulletin too (snapshots carry the log). The pre-log fixture
   `towerone_6.vctower` still loads with an empty log and null-free schema.
6. **Hostile input.** Forged `log` values (scalar, array of scalars/nulls,
   entries with numeric text, NaN minutes, absurd kinds, 10k-char text,
   100k entries) load without throwing and produce only hardened entries.
   Forged `savedAt`/`appVersion` are inert (nothing reads them at load).
7. **Docs + version.** `package.json` bumps minor: 1.22.0 → 1.23.0 (bulletin
   continuity is a new player-facing capability; the stamps ride along).
8. **Gates + review.** All four gates green; `/gds-code-review` runs in this
   session (save round-trip work); every patch finding fixed, defers to
   backlog.

## Tasks / Subtasks

- [x] Schema fields + docs (AC1); SaveGame stamps and cast removal (AC2)
      with tests (export payload carries both; localStorage save carries
      both; serialize() emits neither; deserialize carries neither).
- [x] LOG_SAVE_CAP emit + serialize spread (AC3); deserialize hardening
      (AC4) with per-branch tests (AC6).
- [x] Round-trip tests incl. fixture regression and undo-snapshot log
      restore (AC5).
- [x] Version bump (AC7); gates + gds-code-review + backlog (AC8).

## Testing standards

Vitest, headless, deterministic; unit tests at the cheapest tier; fixtures
assert every construction step. No tick-path work is added (log restore is
load-time only; emit's hot path gains nothing).

## Project Context Rules (extract)

- American English; no em-dashes in new prose. Engine stays DOM-free and
  wall-clock-free (stamps live in storage). Version bump minor. Branch:
  `claude/vctower-save-parity-coi39u` restarted from origin/main f6149dac
  (PR #194 merged; this is a NEW PR).

## References

- [Source: src/storage/SaveGame.ts:211-257] write paths + savedAt cast.
- [Source: src/engine/Simulation.ts:141-145, 290-293, 400-411] LogEntry,
  transient log/logSeq, ring cap.
- [Source: src/ui/UI.ts:501-556] renderLog cursor + resetLog rebuild.
- [Source: src/main.ts:48, 389] APP_VERSION guard; undo snapshot source.
- Prior art: PR #194 view field (story-view-state-save-parity.md).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (session 2026-07-12)

## Deep review (gds-code-review, same session)

Three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor);
thirteen raw findings deduped to ten: seven patched, one deferred, two
dismissed.

Patched:

1. **Boot path never rendered the restored bulletin** (edge, High): the boot
   sim is assigned directly, bypassing `adoptSim` and its `resetLog`, so a
   plain page reload (the most common load) opened with an empty panel.
   `GameApp`'s constructor now calls `ui.resetLog(this.sim)` after the UI
   prime.
2. **`savedAt` crossed the trust boundary uncoerced** (blind + edge): a
   forged slot could render "Invalid Date" in the Saves dialog. `infoFrom`
   now reads it as absent unless it is a finite number; pinned by test.
3. **`coerceLog` capped before filtering** (blind): junk padding could evict
   valid history. It now walks from the newest end keeping the newest 300
   VALID entries; pinned by test.
4. **Truncation could tear a surrogate pair** (blind + edge): a trailing lone
   high surrogate is dropped after the 400-char cut; pinned by test.
5. **Restored `minute` floors at 0** (blind): nothing consumes it today, but
   the coercion now matches the neighboring fields' posture.
6. **Missing storage-layer round-trip pins** (auditor): added slot
   save/load and .vctower export/import bulletin tests, plus the forged
   savedAt and junk-padding cases. Fake timers in the export byte-identity
   test now fake Date explicitly.
7. **Bookkeeping + relocated em-dash comment** (auditor): this record, task
   checkboxes, and the moved comment reworded.

Deferred (backlog): undo/redo trims bulletin scrollback to the 100-entry
save cap when the live ring holds more; deliberate size tradeoff, revisit if
noticed. *(Resolved same day: the owner delegated the call, the party ruled
the caps equal, and the follow-up PR raised `LOG_SAVE_CAP` to 300.)*

Dismissed: the appVersion "dev" fallback being untested under Vite-injected
test config (the guard exists for non-Vite contexts; the injected path is
the shipped one); test literals pinning constants (intentional pins).

### Debug Log References

- Gates green at completion: typecheck, lint, full suite, build.
- The exportGame byte-identity test needed a frozen Date: exports now stamp
  savedAt, so two exports are byte-identical only at the same instant.

### Completion Notes List

- `savedAt` + `appVersion` stamp every write path through one `stamp()` in
  SaveGame.ts (localStorage sync + async, .vctower export). `serialize()` is
  stamp-free, deserialize carries neither, listSlots reads savedAt hardened.
- The bulletin tail (newest 100, later raised to the full 300 ring by the
  same-day cap-unification ruling) rides every save; restore is hardened at
  `coerceLog` (drop, truncate surrogate-safely, coerce kind/minute, cap 300
  newest-valid). `logSeq` stays transient; the UI cursor rebases on adopt
  AND now on boot, so history renders everywhere without toast replay.
- LogEntry moved to engine/types.ts (schema needs it); Simulation re-exports
  for the UI import path.

### File List

- src/engine/types.ts
- src/engine/Simulation.ts
- src/storage/SaveGame.ts
- src/main.ts
- src/tests/saveMetadataLog.test.ts (new)
- src/tests/gameControllersCoverage.test.ts
- _bmad-output/implementation-artifacts/backlog.md
- package.json
