---
story: engine-conformance-suite
status: review
baseline_commit: deba847
---

# Story: engine conformance suite

## Why

The engine is meant to run under more than one host, and later as a port to
another language. Each of those needs a referee: a fixed set of scripted games
with the exact state the reference engine reaches at known points, so a second
engine can prove it simulates the same game and find the first place it does
not. The existing golden masters pin one end state each and are tied to this
repository's test helpers, so they cannot serve a port and do not say where a
run went wrong. `engine-fixed-time-step` made step sequences deterministic,
which makes such a suite meaningful.

## Acceptance criteria

1. **AC1 Language-neutral scenarios.** Scenarios are JSON files under
   `conformance/scenarios/`: a start (a new game with seed and mode, or a
   `.vctower` fixture) and an ordered list of commands that name units and
   shafts by tile, never by id.
2. **AC2 Documented hash.** `conformance/README.md` defines the command set, the
   two checkpoint channels (saved state without prose, and the live crowd) and
   the canonical JSON and hash rules precisely enough for another language to
   reproduce them.
3. **AC3 Pinned and enforced.** `conformance/expected.json` pins every
   checkpoint. The integration test runs every scenario on the TypeScript
   engine in `npm test`, fails on any mismatch, names the first divergent
   checkpoint, and fails when a scenario and its lock entry do not pair up.
4. **AC4 Coverage that bites.** The scenarios cover Classic and Modern new
   games, all three save fixtures (v1, v4, v7, one forced to Modern) through
   migration, the 1, 2, 3, 5 and 20 minute quanta, a save round trip, builds,
   a sale, rent, no-rate and car edits, a fire and a bomb threat. A one-constant change
   to crowd movement fails every scenario.
5. **AC5 Explicit update.** Regenerating the lock takes an explicit
   `VC_CONFORMANCE_UPDATE=1`; a plain run never writes it, an update writes it
   only from a complete run, and an update refuses to run in CI.
6. **AC6 Stable.** A new-game scenario and a loaded-save scenario each run
   twice in one process give the same checkpoints, and a save round trip
   inside a scenario must return the saved state unchanged. The only engine
   change is the one that check turned up (see Dev notes).

## Out of scope

- Prose parity (log text and event messages).
- Hashing elevator dispatch internals directly.
- Event choices that only the hourly roll can open (fire rescue, ransom) and
  the exterminator: the debug triggers do not open them, so they need a
  scenario that reaches them through play.

## Dev notes

- Mutation check: changing the crowd movement chunk in `src/engine/sim/loop.ts`
  from 2.5 to 2.4 minutes fails all six scenarios. Before the fixtures gained a
  20-minute segment, they ran only at 1 and 2 minute quanta, where that chunk
  never applies, and passed; the coarse segment closes that gap.
- The suite runs in about 12 seconds.
- Review round 1 (`/gds-code-review`, Blind Hunter, Edge Case Hunter,
  Acceptance Auditor), all patched:
  - Fixture starts now finish the way an import does
    (`markFounderFromLoadedFile`). Only the two unstamped fixtures' state
    hashes moved; their crowd hashes and every `split-tower` hash held, which
    also shows the new canonical writer is byte-identical on real data.
  - The canonical writer builds the text itself, so integer-like keys sort by
    UTF-16 code units as documented, and it refuses maps, sets, class
    instances, functions, non-finite numbers and missing array elements.
  - Rent and no-rate edits fail loudly when refused, `tick` fields are
    validated, every scenario ends with a `final` checkpoint and labels are
    unique, and the unused `setFilmPolicy` command is gone.
  - The update switch writes from `afterAll` only after a complete run and is
    refused in CI; comparison is field by field and names a missing
    checkpoint.
  - The README documents the lock layout, the state and crowd shapes (the
    `SerializedGame` and `Person` types), what `startFire` and `bombThreat`
    do, and the refusals.
- Review round 2 (confirming pass), all patched:
  - Scenarios are validated against a per-op field schema before they run
    (unknown ops and fields, missing or ill-typed values), and a new game must
    found the requested mode.
  - A rent step that leaves the rent unchanged, a clamped car count and a
    `startFire` that lights nothing now fail, and labels are checked as they
    are taken.
  - `reload` asserts the saved state survives the round trip. That check
    found an engine bug: `setCars` grew `carPositions` and `carDir` but not
    `carLoad`, so the next dispatch pass zeroed every car's riders, while a
    save padded the array and kept them. A saved and reloaded tower played on
    differently from one left running. `setCars` now resizes `carLoad` with
    the rest (`src/engine/tower/transport.test.ts`). Only the two `edited`
    checkpoints moved. No player would notice, so no version bump.
  - An update refuses to write the lock if any test in the run failed.
  - The README spells out the string escapes and number format, how the crowd
    is seeded on a new game and on a load, and what `reload` does; the
    escapes are pinned by a unit test.
  - One build in each starter scenario uses `expectFail`.
- Review round 3 (confirming pass), all patched except one deferral:
  - The schema now covers the whole file: `id`, `description` and `start`
    (whole-number `seed`, `mode` of `classic` or `modern`, `fixture` path),
    facility `kind`s the engine defines, own-key lookups so inherited names
    such as `constructor` are refused, and a `buildRow` whose `from` is past
    its `to`.
  - `setCars` rebuilds `carLoad` to exactly one entry per car instead of
    pushing onto it, so the array is realigned whenever the fleet size
    changes.
  - The README states the whole validation list, how zero prints, how a seed
    maps to stream state, and that `reload` compares the hashed view. More
    escape cases are pinned.
  - Deferred to the backlog (`setcars-shrink-rider-reattach`, #855): a rider
    on a removed car can re-attach to a re-added one when the fleet shrinks
    and grows with no motion step between. This predates the `setCars` fix.
  - Version: the reviewers agreed no player would notice the `setCars` fix,
    so no bump.
- Review round 4 (confirming pass), all patched:
  - `seed` is limited to 0 through 4294967295, so no engine has to guess how
    to wrap a larger one; `kind` is split into room kinds for `build` and
    `buildRow` and transport kinds for `buildTransport`; a `null` command gets
    a located error.
  - `scenario.test.ts` now pins every refusal the README lists, including the
    top-level and `start.newGame` checks, and `transport.test.ts` covers a
    `carLoad` that starts out the wrong length.
  - README: the validation list renders as a list, names where facility
    kinds live, and notes that scenarios avoid the #855 path. The backlog row
    opens with **Ready.**
- Review round 5 (confirming pass): the Edge Case Hunter and Acceptance
  Auditor found nothing to patch. The Blind Hunter's two items were patched:
  `scenario.test.ts` now has a refusal case for every validated field, and
  the README states that a save's `seed` is always in the unsigned 32-bit
  range.
- Review round 6 (confirming pass): all three layers found nothing to patch,
  so the loop converged. One pre-existing engine edge case was deferred to
  the backlog (`rng-zero-state-reload`, #856): a save taken when the main
  stream sits at state 0 reloads at state 1.
