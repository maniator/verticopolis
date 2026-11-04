---
story: dual-run-goldens
status: in-progress
depends_on: engine-dual-run
---

# Story: pinned Rust goldens for the dual run's coverage

## Why

The #945 Dual run row passes on "a day on every fixture at every speed with
no divergence, with the engine-owned step driver (#867)". Today the dual run
proves it by running the TypeScript engine and the Rust engine side by side
through the mirror (`src/dualrun/`, `src/tests/dualrun/`) and comparing them
every hour. The TypeScript engine is deleted before 3.0.0 (owner decision), and
#945's status note proposes that once it goes "the same coverage must come
from pinned Rust goldens". That proposal still needs the owner's sign-off on
#945 before #1421 deletes `dualRunDay`. The card-text sweep, #1561's canary, has the same
problem: it compares the Rust card with the TypeScript reference card, so it
would leave with the reference (#1806). This story pins both while the
referee still exists, so the coverage survives the deletion, and then
retires the mirror harness (#1421).

## Acceptance criteria

1. **AC1 Frame-day golden.** `src/tests/goldens/frame-days.json` pins every
   case of the dual run's day gate: each fixture at speeds 1, 2 and 3, a new
   Classic and a new Modern game, the canon calendar founded unbridged, one
   steady frame rate and the steady clock (29 cases). Each case loads its
   tower the way the game does (`loadVctower`, `foundTower`) and plays a day
   through the port's `advance`, the call the frame loop makes every frame,
   with the dual run's cycle of frame times, draining events every frame. A
   checkpoint at the start, after the first frame (a new game's founding
   pass), after every frame that crosses an hour and after the last frame
   holds the clock and the hashes of the state view, the crowd view and the
   events drained since the last one. The run stops on a dropped event, a
   choice the player would have to answer (at the start or during the day), a
   frame that crosses two hours, or a clock that stands still or goes back.
   Done in the first PR.
2. **AC2 Both engines equal the golden.** The Rust engine reproduces every
   checkpoint (`conformanceWasmFrameDays.integration.test.ts`, in
   `npm run test:wasm`), and the TypeScript engine reproduces the same file
   (`frameDaysReferee.integration.test.ts`, in the plain integration run), so
   the golden is what the dual run compared. The referee goes with
   `src/engine/`. A teeth test shows a tower changed after the start is caught
   at the next checkpoint, in the state hash. Done in the first PR.
3. **AC3 Card-text golden (#1806).** Each sweep case and mode has its tower
   (`.vctower`) and the reference card's lines for every room and shaft, in
   card order (`.json`), under `src/tests/goldens/card-text/`. The sweep
   (`cardTextParity.integration.test.ts`, in `npm run test:wasm`) loads each
   tower through the Rust engine's `.vctower` loader with the engine's own
   catalog, as the game does, and holds the shipped card to those lines, and
   also checks that the engine holds exactly the rooms (with their floors) and
   shafts (with their kinds) the golden names. It has no direct import from
   `src/engine/` or `src/game/facilityDiagnostics.ts` (the shipped card kit
   still reaches the reference through `facilityDiagnostics.ts`, the frontend
   ratchet's). The TypeScript referee
   (`cardTextReferee.integration.test.ts`) builds each case as the sweep did,
   loads the save into the TypeScript engine and holds the golden to it, the
   packed tower byte for byte and lines in order, until `src/engine/` goes. Both cards
   read a case after the same play (the every-transport case plays a morning,
   so a shaft card measures its load). Done in the first PR.
4. **AC4 Refresh is a reviewed change.** Each golden has its own switch
   (`src/tests/goldens/updateGate.ts`), separate from the conformance lock's,
   and is written only from a run in which every test in the writing file ran
   and passed (so a `-t` filter that leaves a test out writes nothing), never
   in CI, one checkpoint, room or shaft per line so a diff names what moved. `VC_FRAME_DAYS_UPDATE=1` has the Rust run write the frame-day
   golden. `VC_CARD_TEXT_UPDATE` names the one card-text writer in a run, and
   the other suite skips: `typescript` has the referee write the towers and
   their lines from the TypeScript card, and `rust` has the sweep rewrite the
   lines from the Rust card. While the referee exists both must pass, so the
   two write the same lines, and a line the Rust card prints differently on
   purpose is named in the referee with its reason. The card-text suites
   refuse a locale that prints numbers other than as US English. Done in the
   first PR.
5. **AC5 The mirror's own tests get replacements before they go (#1421).**
   `dualRunEdits` and `dualRunBrush` check host edits relayed through the
   mirror; the commands themselves move to a golden that drives the same edits
   through the port's commands on both engines, with each answer pinned (but
   not the generation an undo answers, which #1802 changes). Then
   `src/dualrun/mirror.ts`, `shadow.ts`, `src/tests/dualrun/`, the `dualRun*`
   suites and the `src/wasmhost/` mirror code go, after #878's evidence is
   recorded (the `unitWasm` and `integrationWasm` lanes stay until then).

## Coverage map

| Dual-run coverage today | Replacement |
| --- | --- |
| `dualRunDay`: 29 day cases, hourly state and crowd views and event batches | AC1 and AC2, the same 29 cases |
| `cardTextParity`: Rust card against the TypeScript card, 15 cases a mode | AC3 |
| `dualRunEdits`, `dualRunBrush`: mirrored edits, malformed relays | AC5 |
| `wasmHost*`, `capacityEventMatrix`, `conformanceWasmSaveHandoff`, the parity lanes | AC5, after #878 |

## Dev notes

- The golden is a test golden, not one of the five conformance lock files
  (`src/build/engineCompat.ts`), so a refresh alone does not move the crate
  version. `engine-rs/tests/data/fixed-step-cases.json` is the same kind of
  file.
- The checkpoint is taken after the frame that crosses the hour, where the
  dual run took it after the step. Both are fixed by the frame cadence, and the
  golden pins the clock at each one, so a change to the step driver shows.
- A moved hash tells you the hour; finding the field takes a dump.
  `VC_FRAME_DAYS_DUMP=<dir> VC_FRAME_DAYS_CASE=<case id>` writes a case's
  canonical views at every checkpoint, to diff against a run of the previous
  build.
- The card-text towers are frozen inputs: a change to the fixture builders
  does not move them until the referee rewrites them on purpose. Once the
  referee is gone, a new card-text case needs a builder on the Rust engine
  (the port's commands, as AC5's edit golden drives them).
- What still leads into code due for deletion from these goldens:
  - `src/tests/conformance/canonical.ts` re-exports the engine's
    `canonicalJson`;
  - `src/tests/conformance/wasmEngine.ts`, which the Rust suites load the
    engine package through, reads `engine/econConfig`, imports `REPO_ROOT`
    and the scenario types from `src/tests/conformance/scenario.ts`, which
    imports `Simulation` and is on the ratchet, and takes the
    `CheckpointDetail`, `FxSlot` and `ChargeOutcome` types from
    `checkpointDetail.ts` and `chargeOps.ts`, which import `Simulation` as a
    type (vitest still runs once they go, but `npm run typecheck` breaks);
  - the sweep sets the catalog through `src/catalog/towerCatalog.ts`
    (`useTowerCatalogSource`), which imports `engine/catalog` and is on the
    frontend ratchet;
  - `src/game/frameLoop.ts` (where the golden reads `SPEEDS`) re-exports
    `engine/sim/frameStep`;
  - the shipped card kit (`src/game/cardKit.ts`) still imports
    `facilityDiagnostics.ts`;
  - the Rust suites import from `src/dualrun/`: `binding.ts` (the binding's
    types and `checkBinding`, through `wasmEngine.ts`) and `catalog.ts`
    (`readCatalog`, which the sweep sets the catalog with), so #1421 keeps or
    moves those two when it deletes `mirror.ts` and `shadow.ts`.

  Each needs a home outside the deleted code before it goes; the retirement
  story's list names them. When the referee goes, `VC_CARD_TEXT_UPDATE`
  loses its `typescript` value and the sweep is the card-text golden's only
  writer.
- Review: `/gds-code-review` (engine data fidelity).
