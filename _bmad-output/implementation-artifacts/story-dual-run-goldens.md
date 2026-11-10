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
   `src/engine/` or the TypeScript reference card
   (`src/tests/diagnostics/facilityDiagnostics.ts`, which #1813 took off the
   shipped card kit). The TypeScript referee
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
   lines from the Rust card. `VC_PORT_EDITS_UPDATE=1` has the Rust run write
   the port-edit golden (AC5). While the referee exists both must pass, so the
   two write the same lines, and a line the Rust card prints differently on
   purpose is named in the referee with its reason. The card-text suites
   refuse a locale that prints numbers other than as US English. Done in the
   first PR, and the port-edit switch in the second.
5. **AC5 The mirror's own tests get replacements before they go (#1421).**
   `dualRunEdits` and `dualRunBrush` check host edits relayed through the
   mirror; the commands themselves move to a golden that drives the same edits
   through the port's commands on both engines, with each answer pinned (but
   not the generation an undo answers, which #1802 changes). Then
   `src/dualrun/mirror.ts`, `shadow.ts`, `src/tests/dualrun/`, the `dualRun*`
   suites and the `src/wasmhost/` mirror code go, after #878's evidence is
   recorded (the `unitWasm` and `integrationWasm` lanes stay until then).
   The edit golden is done in the second PR: `src/tests/goldens/port-edits.json`
   (built by `portEdits.ts`, its lines read, checked and compared in
   `portEditLines.ts`, cases in `portEditCases.ts`) holds seven cases
   for the two suites' nine tests (the coverage map names which). Each case
   starts its tower as the frame-day golden does, and its script says at
   every command whether the engine must do it or refuse it, so a script
   that stops doing what it says fails before anything is pinned. After
   every step a line pins the command's answer by the record's slot names
   (the generation left out) with any refusal text, the clock, and the
   hashes of the state view, the crowd view and the events since the last
   step, and each line names its kind (the start, a command, a swap, an
   undo or redo, an undo step opened or closed, a read, a tooling write, a
   tick or play). Play runs whole frames through `advance`, draining events
   every frame, with a line after the case's first frame, at every hour,
   and at the end of a play whose last frame wrote no line. After a swap it
   starts owing no minutes, as the game's `followSwap` drops them for
   another tower; after an undo or a redo it keeps them, as the game does
   for a step of the same tower. Each drag checks from its answer that it
   reached its floor and was billed or free. The four-star case also sells
   a room and bulldozes another outside any undo step and plays the hour
   after them, runs the game's undo trail (a sale and a bulldoze, each its
   own step, undone and redone with the notice the game shows) and restores
   an earlier save, which brings its clock back and keeps the live camera.
   The Rust engine
   is held to it in `conformanceWasmPortEdits.integration.test.ts` (in
   `npm run test:wasm`, written under `VC_PORT_EDITS_UPDATE=1`), the
   TypeScript engine in `portEditsReferee.integration.test.ts` (the plain
   integration run, with a ratchet line, gone with `src/engine/`). The
   referee names the one window where the two differ on purpose: the
   reference engine's undo swaps in a whole save, which holds no people, so
   from the first undo to the restore its crowd differs from the Rust
   engine's (whose undo puts back only what the edit changed), and so does
   its state after the hour played there. The answers, the clock and the
   events match on every line, and the referee checks that each allowance is
   still needed on every line it covers. The writer, both suites and the
   golden's own tests hold each line to its kind: only the first line is
   the start; every command, swap and undo or redo answers a status its
   kind can (only an undo or redo has nothing to step, and a swap lands),
   and a command's money is a number; a refused command (which also moves
   no money), a refused undo or one with nothing to step, a read and an
   undo step opened or closed move nothing and drain no event; a command
   that moved money, and an undo or redo taken, moved the state; each case
   plays an hour; and the fixture case's crowd moves during play.
   A teeth test shows a tower changed between steps is caught at the next
   line, in the state hash. A moved hash names the step; the field takes a
   dump: `VC_PORT_EDITS_DUMP=<dir> VC_PORT_EDITS_CASE=<case id>` writes each
   line's step, kind, answer and canonical views under `<dir>/<engine>/`,
   which has to be new or empty (a run that plays its case again in the same
   process empties its own). The mirror's deletion is the third PR.

## Coverage map

| Dual-run coverage today | Replacement |
| --- | --- |
| `dualRunDay`: 29 day cases, hourly state and crowd views and event batches | AC1 and AC2, the same 29 cases |
| `cardTextParity`: Rust card against the TypeScript card, 19 cases a mode (#1780 added four to the 15 this golden first pinned) | AC3 |
| `dualRunEdits`' four-star test, its founded-game test, its Modern bridging test, its malformed charge test (#923) and its malformed edit test (#996) | AC5, `port-edits.json`: one case each |
| `dualRunEdits`: the drag mark taken over mid-drag (#990) | the malformed charge case drags inside the engine-held mark (a regrow inside it is free, and once the drag closes, or a refused start drops it, a shrink and regrow is billed), and the four-star case's drag is free inside the mark; each drag's answer is checked for the floor it reached and the money it moved; a shadow attached mid-drag is mirror-only |
| `dualRunBrush`: the relayed brush, its lobby upgrades and refusals | AC5: the floor and lobby brush case (each floor run checked to lay all its tiles), and the brush on a loaded tower (the raw test's tower, saved, stamped as the game stores it and loaded, then brushed) |
| `dualRunBrush`: the brush called raw through the relay binding | mirror-only: the port's `paintTiles` takes a typed kind code, floor and tile array, so the golden pins the numeric refusals, the raw test's floor of -0.5 (which an engine that truncated it, as an integer cast does, would land on floor 0) included; the binding's text checks stay in the Rust tests `wasm_facade_commands.rs` (`a_malformed_brush_is_refused_and_lays_nothing`) and `tower_removal_tests.rs` (`a_malformed_brush_lays_nothing`) |
| `dualRunBrush`: a partial brush answers a reason | the port clears `lastReason()` on a done command, so the golden pins the tiles laid (`placed`) and the money moved; a refused brush pins its reason |
| `dualRunBrush`: each brush relays as one command | mirror-only: a port brush is one call |
| `dualRunEdits`: the edits the host wrote to the tower directly (a raw car count or span, a car count set in one call), which the game no longer sends and the port has no command for | the port's commands for the same edits (`changeCars`, `extendShaft`), in the same cases |
| `dualRunEdits`: a caller's inflated drag mark buys nothing | the port's `extendShaft` takes no mark, so a caller has none to pass; the golden's drags pin the engine-held one |
| `dualRunEdits`: a bad direction or removal word (`"sideways"`, `"burn"`) and other non-number arguments through the mirror's relay | the port takes booleans and typed numbers, so the golden pins the numeric refusals (fractional, NaN, 2^53); the raw binding's type checks stay in `chargeBindingRaw` and `relayedCommandRaw`, which import `Simulation` and are on the TypeScript-engine ratchet, so they move to the Rust engine alone before `src/engine/` goes (the retirement story lists them) |
| `dualRunEdits`: the shadow attached after the edits or in the middle of a drag, and a drifting shadow caught at the next hour with the path | mirror-only, so they go with it; the teeth test shows the golden catches a change between steps at the next line, and `VC_PORT_EDITS_DUMP` finds the field |
| The game's undo and redo, which no dual-run test steps | new: the four-star case's sale and bulldoze steps, undone and redone, and a restore of an earlier save |
| `dualRunEdits`: the hour played after the four-star tower's removals, compared | the four-star case's sale and bulldoze outside any undo step and the hour after them, which the referee compares in full (the undo trail's hours sit in its named window) |
| `wasmHost*`, `capacityEventMatrix`, `conformanceWasmSaveHandoff`, the parity lanes | AC5, after #878 |

## Dev notes

- The golden is a test golden, not one of the five conformance lock files
  (`src/build/engineCompat.ts`), so a refresh alone does not move the crate
  version. `engine-rs/tests/data/fixed-step-cases.json` is the same kind of
  file.
- The checkpoint is taken after the frame that crosses the hour, where the
  dual run took it after the step. Both are fixed by the frame cadence, and the
  golden pins the clock at each one, so a change to the step driver shows.
- The port-edit cases fund their towers with a tooling write, as the dual
  run did: `setMoney` on the Rust binding (tier 3, which #1057 retires or
  moves behind a feature) and a write to `sim.money` on the referee. The
  write is a step of its own, outside any command's answer.
- A moved hash tells you the hour; finding the field takes a dump.
  `VC_FRAME_DAYS_DUMP=<dir> VC_FRAME_DAYS_CASE=<case id>` writes a case's
  canonical views at every checkpoint under `<dir>/<engine>/`, which has to
  be new or empty, to diff against a run of the previous build.
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
  - `src/game/frameLoop.ts`, where the golden reads `SPEEDS`, reaches the
    TypeScript `Simulation` through `src/game/engineFault.ts`, then
    `src/wasmhost/hostFault.ts`, and through `src/game/installAffordance.ts`,
    then `src/ui/uiDialogs.ts`, `src/ui/templates/reports.ts` and
    `src/storage/SaveGame.ts`, and reaches `engine/catalog` through
    `src/game/panelAnchoring.ts`, then `src/game/portAccess.ts` and
    `towerCatalog` (the entry above);
    `hostFault.ts` and `SaveGame.ts` are on `simulationReach.ratchet.txt` and
    leave with #921;
  - the Rust suites import from `src/dualrun/`: `binding.ts` (the binding's
    types and `checkBinding`, through `wasmEngine.ts`) and `catalog.ts`
    (`readCatalog`, which the sweep sets the catalog with), so #1421 keeps or
    moves those two when it deletes `mirror.ts` and `shadow.ts`.

  Each needs a home outside the deleted code before it goes; the retirement
  story's list names them. #1813 removed two direct paths: the frame loop no
  longer re-exports `engine/sim/frameStep`, and the shipped card kit no
  longer imports the TypeScript reference card, which only tests read now
  (the card kit still reaches `engine/catalog` through `towerCatalog`, the
  entry above). When the
  referee goes, `VC_CARD_TEXT_UPDATE` loses its `typescript` value and the
  sweep is the card-text golden's only writer.
- Review: `/gds-code-review` (engine data fidelity).
