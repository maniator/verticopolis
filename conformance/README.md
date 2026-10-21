# Engine conformance suite

This folder is the referee for every engine that runs Verticopolis. It holds
scripted scenarios and the hashes the TypeScript engine produces at fixed points
while it plays them. Another engine (for example a port to another language)
passes when it replays every scenario and produces the same list of checkpoints,
byte for byte.

Frontends may differ. Simulations may not.

- `scenarios/*.json`: one scenario per file. The file name is the scenario `id`.
- `expected.json`: the pinned checkpoints for every scenario, written by the
  TypeScript reference runner, as
  `{ "scenarios": { "<id>": [ { "label", "state", "crowd", "events" }, ... ] } }`.
- `events/catalog.json`: the gameplay event catalog, the contract for the
  events both engines emit (see Checkpoints).

The reference runner is `src/tests/conformance/scenario.ts`, and
`src/tests/integration/conformance.integration.test.ts` runs it in CI (its own
step of the `test` job, without coverage) and in `npm test`. A mismatch fails
the build and names the first checkpoint that differs.

The runner drives any engine behind its `ScenarioEngine` interface. The
TypeScript engine is the default; the Rust engine answers twice, natively
through `cargo run --release --features conformance --bin conformance` and through its WASM binding
from Node (`npm run wasm:build && npm run test:wasm`, see
`engine-rs/README.md`), where the same TypeScript runner replays every
scenario against this lock. Beyond the scripted scenarios, the dual run
(`src/dualrun/`, `npm run test:wasm`) compares the two engines every hour
under the web frame loop's own cadence, for a day on every fixture.

## When a hash moves

A moved hash means the simulation changed. If the change is intended, regenerate
the lock and commit it in the same pull request, saying why:

```sh
VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration conformance
```

An update writes the lock only when every test in the run passes and every
scenario finishes, and it refuses to run in CI.

A change to any of the five lock files (`catalog-digests.json`,
`events/catalog.json`, `expected.json`, `loader-cases.json`, `tdt-cases.json`)
also moves the engine crate version, and the steps do not stop at the lock:

1. Bump `version` in `engine-rs/Cargo.toml`, then `engine-rs/Cargo.lock` and
   `engine-rs/consumer/Cargo.lock` to match (a patch bump for a lock change on
   its own, while the crate is 0.x).
2. Run `npm run engine:compat` to rewrite `engine-rs/src/compat-record.json`.
3. Commit the lock, the version files and the record together.

Without them `engine-rs` and `test` fail on the record, and `consumer` fails on
its `--locked` build. The rule is in `CONTRIBUTING.md` under Versioning.

A refactor that claims to change nothing must not touch `expected.json`.

## Fixtures the scenarios start from

The `fixture` starts use the saves under `conformance/fixtures/`, named
`conformance/fixtures/<file>`, so the suite needs nothing from the web game's
tree. The TypeScript runner reads that name from the repository root; the
Rust runner reads the leading `conformance/` as the suite directory itself,
whatever it is called, and refuses a name outside it.
The web game's tests load the same files. Four of them
are derived from the others by editing a few fields of the serialized game
and nothing else, so a branch no real save reaches can be scripted:
`sixseven-december` (the sixseven clock moved to early December, for the
holiday window), `towerone-star4` (tower-one with `star` raised to four and
`money` filled, for the metro, a second express shaft, bomb threats and the
Modern amenities), `towerone-vip-pending` (tower-one with `vipFavorable`
cleared, `vipVisits` zeroed and `money` filled) and `towerone-star1`
(tower-one with `star` set to one, so a star evaluation has a rung to climb).
Derive a new one the same way, with `scripts/derive-fixture.ts <source>
<target> '<json patch>'`, which merges the patch over the top level of the
save and writes nothing else, and say what was edited in the scenario's
description.

`split-tower-4` is the owner's own Modern save of the split tower (four stars,
a founder's tower, 19,806 units, 194 KB): the largest fixture, kept unedited as
a real save the engines have to load and replay the same way. The owner agreed
to commit it on 2026-10-20.

## The loader table

`loader-cases.json` is the referee for `deserialize` on saves no engine writes:
forged keys, mistyped numbers, overlapping units, inverted shafts, garbage
schedules. `src/tests/integration/loaderCases.integration.test.ts` builds the
cases from code, hashes the loaded state of each through the TypeScript
loader, and writes them with the same regeneration switch as the lock
(`VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration loaderCases`);
a Rust unit test replays every case. Add a case for any coercion rule you
touch.

## The catalog lock

`catalog-digests.json` pins the canonical hash of each mode's catalog: the
prices, sizes and build rules a frontend reads from the engine
(`src/engine/catalog.ts`, `engine-rs/src/catalog.rs`). The TypeScript run
writes it (`src/tests/integration/catalog.integration.test.ts`, regenerated
with `VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration catalog`);
a Rust crate test, `cargo run --release --features conformance --bin conformance` and the WASM suite
check against it. A moved digest means a price, a size or a build rule some
frontend shows has changed: regenerate it on purpose only, in the same pull
request, saying why.

## The `.TDT` table

`tdt-cases.json` is the referee for the 1994 `.TDT` codec in `engine-rs/src/tdt/`.
`src/tests/integration/tdtCases.integration.test.ts` builds the cases from
code: synthetic `.TDT` files from the test builder (never bytes from a real
save), each pinned by the canonical-JSON hash of the save `parseTDT` produces
and the sorted warnings of the binary walk, or by the message of the
refusal; and serialized towers (hand-built saves embedded in the lock, the
sample variants as a base plus a top-level patch, and every `.vctower`
fixture loaded and re-serialized), each pinned by the SHA-256 of the bytes
`buildTDT` writes, or by the message of the refusal. It regenerates with the
same switch as the lock (`VC_CONFORMANCE_UPDATE=1 npx vitest run --project
integration tdtCases`); `cargo run --release --features conformance --bin tdt` and a Rust unit test
replay every case.

The table pins chosen inputs only. `conformanceWasmTdt.integration.test.ts`,
part of `npm run test:wasm` (side runners in
`src/tests/conformance/tdtDifferential.ts`, input builders in
`src/tests/fixtures/tdtDifferentialInputs.ts`), runs both codecs through the
WASM binding on
seeded inputs with no lock (round trips, NaN and forged fields, mutated
files) and fails on any difference. Its switches (`VC_TDT_DIFF_N`,
`VC_TDT_DIFF_SEED`, `VC_TDT_DIFF_OUT`, `VC_TDT_DIFF_REPORT`,
`VC_TDT_DIFF_KNOWN`) are described in the test's header.

## The `.vctower` container

There is no lock table for the `.vctower` container. The engine's writer
(`encode_vctower` in `engine-rs/src/load.rs`) matches the TypeScript writers'
framing byte for byte, but its JSON keys are sorted and its deflate bits come
from a different compressor, so a hash of the file would change with the
compressor even when the save is the same. Instead, `cargo test`
round-trips every `.vctower` fixture through the Rust decoder and encoder,
and
`conformanceWasmVctower.integration.test.ts`, part of `npm run test:wasm`,
writes each loaded fixture with the engine and reads it back through the web
game's readers: the same save, the TypeScript writer's framing, its
canonical JSON as the payload, the same Founder status and the same loaded
state hash.

## Scenario format

```json
{
  "id": "starter-classic",
  "description": "What the scenario exercises.",
  "start": { "newGame": { "seed": 20260713, "mode": "classic" } },
  "commands": [ { "op": "setMoney", "amount": 500000000 } ]
}
```

`start` is one of:

- `{ "newGame": { "seed": n, "mode": "classic" | "modern", "star": 1 to 5 } }`: a
  new game with the default calendar and automatic bridging on
  (`newGame(seed, mode)`). The optional `star` sets the game's star before the
  first command, so what unlocks above one star is in reach (the fuzzer uses
  it); a game with no `star` opens at one.
- `{ "fixture": "conformance/fixtures/file.vctower", "mode"?: "classic" | "modern" }`:
  a save file inside the suite (the name starts with `conformance/` and has no
  empty, `.` or `..` step), loaded the way an import loads
  it: decode, migrate and load, then mark a save with no `appVersion` stamp
  (one from before 2.0) as a founder's tower. `mode`, when present, overwrites
  the save's mode before loading.

Commands run in order. Units and shafts are named by a tile they cover
(`floor`, `x`), never by id.

| op | fields | effect |
| -- | ------ | ------ |
| `setMoney` | `amount` | Set the treasury directly (a harness command). |
| `build` | `kind`, `floor`, `x`, `expectFail?`, `reason?` | Build through the normal money-aware path. |
| `buildRow` | `kind`, `floor`, `from`, `to` | `build` at every `x` from `from` to `to`, inclusive. |
| `buildTransport` | `kind`, `x`, `bottom`, `top`, `expectFail?`, `reason?` | Build a shaft. |
| `sell` | `floor`, `x`, `kind?` | Sell the unit at that tile; with `kind`, an error unless that is what the tile holds. |
| `adjustRent` | `floor`, `x`, `dir` (`1` or `-1`) | Step a unit's rent. |
| `setNoRate` | `floor`, `x` | Set a unit to no rate (the Classic price ladder only). |
| `setCars` | `floor`, `x`, `cars` | Set the car count of the shaft at that tile. |
| `addCar` | `floor`, `x`, `reason?` | Buy a car for the elevator at that tile through the engine's charge (`addCar`). |
| `removeCar` | `floor`, `x`, `reason?` | Sell a car back for half the add-car cost (`removeCar`). |
| `beginExtend` | `floor`, `x` | Open an extend gesture on the elevator at that tile (`beginExtend`, #990): the engine holds its high-water mark, starting at the shaft's current span. It must open. |
| `extendTransport` | `floor`, `x`, `end`, `targetFloor`, `reason?` | Move the `up` or `down` end of the elevator at that tile to `targetFloor`, billed per floor past the high-water mark and clamped to the budget (`extendTransport`). The mark is the open gesture's on that shaft, or the shaft's current span when none is open. |
| `endExtend` | (none) | Close the open extend gesture (`endExtend`). |
| `removeFacility` | `floor`, `x`, `method`, `shaft?`, `reason?` | `sell` or `bulldoze` the unit at that tile (the shaft with `shaft: true`) through the engine's removal command, which pays the refund (`removeFacility`). |
| `setSchedule` | `floor`, `x`, `schedule` | Author the elevator schedule of the shaft at that tile (`Tower.setSchedule`), hardened the way a loaded one is; `{}` clears it. An error on a shaft that is not an elevator. |
| `startFire` | | Start a fire at once: `EventSystem.startFire`, with no hourly roll and no fire-rescue choice. |
| `bombThreat` | | Run a bomb threat at once: `EventSystem.bombThreat`, which charges the sweep when the tower has Security and detonates when it has none, with no ransom choice. |
| `evaluateStar` | | Run the star evaluation. |
| `resolveChoice` | `accept`, `kind?` | Answer the pending player choice (`resolveChoice`): `true` pays the fire rescue or the ransom, `false` declines (the fire burns on; Security searches for the bomb, and with no Security it detonates). An error when no choice is pending, when `kind` (`fireRescue` or `bombThreat`) is not the pending kind, or when `accept` is set and the treasury cannot pay (the engine would treat that as a decline). |
| `callExterminator` | `expectFail?`, `reason?` | Book the Modern exterminator (`callExterminator`); a refusal (Classic, a booking pending, no infested room, short of funds) is an error unless `expectFail` is set. |
| `toggleAutoBridge` | | Flip the Modern bridging preference (`toggleAutoBridge`); an error in Classic, where it never flips. |
| `setFilmPolicy` | `floor`, `x`, `policy` | Set the cinema at that tile to `auto`, `feature` or `blockbuster`; an error on anything but a cinema. |
| `rerollSubtype` | `floor`, `x` | Draw a fresh retail variety for the unit at that tile off the main rng; an error on a kind with no varieties. |
| `applyRentBatch` | `kind`, `target`, `onlyDefaultPriced?` | Batch reprice every unit of `kind` to `target` (a number, `default` or `noRate`); an error on an unpriced kind, a `noRate` target off the Classic ladder, or when no unit of that kind exists. |
| `resizeTransport` | `floor`, `x`, `bottom`, `top`, `expectFail?`, `reason?` | Grow or shrink the shaft at that tile to the span (`Tower.resizeTransport`), laying floor behind newly served floors. |
| `clearStops` | `floor`, `x` | Every floor stops again on the shaft at that tile (an express keeps its lobby-only rule). |
| `setStop` | `floor`, `x`, `stopFloor`, `stop` | Serve or skip `stopFloor` on the shaft at that tile; an error outside the span or for an express stop off a lobby. |
| `priceUnit` | `floor`, `x`, `target` | Set the unit's price to `target` through the one choke point every price write takes; an error when the unit is not repriceable. |
| `reload` | | Save the game and load the save (`serialize()`, a JSON round trip, `deserialize`), replacing the running engine. The hashed `state` view must come back unchanged; a difference is an error. Live state that saves do not carry (the crowd, elevator dispatch) restarts as a load restarts it (see Checkpoints). |
| `tick` | `dt`, `times?`, `checkpointEvery?` | Call `tick(dt)` `times` times (default 1). All three are whole positive numbers. After every `checkpointEvery`th call, take a checkpoint labeled `t+<minutes>`, where minutes counts every tick's `dt` since the start of the scenario. |
| `checkpoint` | `label` | Take a checkpoint. |

A command that fails is an error, and so is a build that succeeds when
`expectFail` is set, a rent step that leaves the rent where it was, a car
count the shaft clamps, and a `startFire` that sets nothing alight. The four
charge ops (`addCar`, `removeCar`, `extendTransport`, `removeFacility`) must
land, or, when `reason` is given, be refused with exactly that copy; either
way the balance must move by exactly the `delta` the command reports, and a
refusal must report a delta of 0.

The four ops that take `expectFail` (`build`, `buildTransport`, `resizeTransport`,
`callExterminator`) also take an optional `reason`. With `expectFail`, a
`reason` pins the refusal: both runners error when the engine refuses for any
other copy, so a port that checks its gates in another order fails even when
it refuses the same commands. A `reason` without `expectFail` is an error. The
reason is not part of any checkpoint hash. Every refusal in the committed
scenarios carries one.

A scenario is refused before it runs if it is not an object, if `commands` is
not a list of objects, if it has an unknown op or an unknown field anywhere
(scenario, `start`, `start.newGame` or command), or if a field is missing or
ill-typed:

- `id` and `description`, `fixture`, and `label` are non-empty strings.
- `seed` is a whole number from 0 to 4294967295.
- `floor`, `x`, `from`, `to`, `bottom` and `top` are whole numbers, and a
  `buildRow`'s `from` is not past its `to`.
- `dt`, `times`, `checkpointEvery` and `cars` are whole numbers above zero.
- `dir` is 1 or -1, `amount` is a finite number, `expectFail` is a boolean, `reason` a non-empty string.
- a `resolveChoice` `kind` is `fireRescue` or `bombThreat`.
- a `policy` is `auto`, `feature` or `blockbuster`; a batch `target` is a
  finite number, `default` or `noRate`; `stopFloor` is a whole number,
  `stop` a boolean, a `priceUnit` `target` a finite number.
- `kind` is a key of `FACILITIES` in `src/engine/facilitiesData.ts`: one
  without the `transport` flag for `build` and `buildRow`, one with it for
  `buildTransport`.
- `mode` is `classic` or `modern`.

Together these keep a scenario from quietly testing a different tower than the
one it describes.

Two `setCars` commands that shrink and then regrow a shaft with no `tick`
between them reach a known engine bug (#855), so no scenario does that until
it is fixed.

## The fuzz corpus

`fuzz-corpus/*.json` holds scenarios the seeded differential found trouble
with, plus smoke entries that keep the job from running on nothing. They use
the scenario format above, but they are not part of the lock: there are no
pinned hashes, only the two engines' agreement. The file name is the scenario
`id`.

A pull request that touches either engine replays every entry on both and
fails if they differ at any checkpoint (`scripts/fuzz-corpus.ts`, the
`fuzz-corpus` job of `engine-rs.yml`, held to ten minutes):

```sh
(cd engine-rs && cargo build --release --features conformance --bin fuzz)
npx tsx scripts/fuzz-corpus.ts
```

When a night diverges, shrink its scenario and add the result in the fix pull
request:

```sh
npx tsx scripts/fuzz-shrink.ts fuzz-out/fuzz-<seed>.json <entry-name>
```

The shrinker drops commands until none can go, keeping a candidate only when
the Rust engine runs it cleanly and the TypeScript replay shows the same kind
of divergence, then writes `fuzz-corpus/<entry-name>.json`. Before the fix the
entry fails the corpus job; after it, the entry passes and stays as a
regression. `fuzz --replay <scenario.json> <out-dir>` is the Rust half: it
runs any scenario and writes the records `scripts/fuzz-compare.ts` reads.

## Checkpoints

The runner takes a checkpoint labeled `start` before the first command and one
labeled `final` after the last, so nothing a scenario runs goes unchecked.
Labels are unique within a scenario. Each checkpoint records three hashes:

- `state`: the saved game (what `serialize()` returns) with prose removed: each
  log entry drops `text` and a pending event choice drops `message`, and every
  other field of both stays. Prose is player copy with locale-formatted money,
  so it is not part of the contract.
- `crowd`: `{ "nextId": n, "rng": s, "people": [...] }`, the crowd's person id
  source, its random stream's current state as an unsigned 32-bit integer, and
  every live person in order. Saves never carry the crowd, so it gets its own
  channel. A new game starts the crowd empty with `nextId` 1 and its stream
  seeded with the game seed. Seeding a Mulberry32 stream sets its state to the
  seed, or to 1 when the seed is 0. A load (a fixture start or `reload`) does
  the same with the save's `seed` field, the main stream's state when it was
  saved, which the engine always writes as a whole number from 0 to
  4294967295.
- `events`: the gameplay events the engine emitted since the previous
  checkpoint (since the start for `start`), drained at the checkpoint, as the
  array `[{ "name", "payload" }, ...]` in emission order. A new game's `start`
  carries its `tower_founded`; a load emits nothing. A `reload` drains the
  engine it replaces first, so the next checkpoint still counts those events.
  `events/catalog.json` defines every event, its payload (closed enums and
  small integers only, no free text or money) and when it fires;
  `engine-rs/src/gameplay.rs` holds the Rust type to it and
  `src/engine/gameplayEvents.d.ts` is generated from it (`npm run
  gen:events`). The events never enter the save or the other two views, and
  emitting them draws no randomness, so adding an event moves only this hash.

The shapes are the TypeScript types: `SerializedGame` in
`src/engine/serializedGame.ts` for the state and `Person` in
`src/engine/crowd/person.ts` for each person, with the fields each one
actually carries (an optional field that is not set is absent). Changing
either shape moves the hashes and is a contract change.

Elevator dispatch internals are not hashed directly. They show up in both
channels within a few steps of any divergence.

## Hash definition

A hash is the first 16 lowercase hex digits of the SHA-256 of the UTF-8 bytes
of the value's canonical JSON:

- Object keys sorted by UTF-16 code unit order at every depth. Arrays keep
  their order.
- Values are objects, arrays, strings, finite numbers, booleans and null.
  The reference runner refuses anything else (a map, a set, a non-finite
  number, a missing array element) rather than hash it.
- Keys whose value is undefined are dropped.
- Numbers print as ECMAScript `Number.prototype.toString` prints them: the
  shortest digits that round-trip, a whole number with no fraction or `.0`
  (`5`), zero (`-0` included) as `0`, any other number in plain decimal while
  its magnitude is at least `1e-6` and below `1e21`, and otherwise in exponent
  form with a lowercase `e`, an explicit sign and no leading zeros (`1e+21`,
  `1.5e-7`).
- Strings are wrapped in double quotes with `"` and `\` escaped as `\"` and
  `\\`, the controls U+0008, U+0009, U+000A, U+000C and U+000D as `\b`, `\t`,
  `\n`, `\f` and `\r`, every other character below U+0020 and every unpaired
  surrogate as `\u` plus four lowercase hex digits, and everything else
  (including `/` and all non-ASCII text) written as is, UTF-8 encoded.
- No whitespace.

Matching these hashes requires the same float arithmetic in the same order, the
same Mulberry32 random streams drawn in the same order, and the same iteration
order for every collection (insertion order, as JavaScript `Map` and `Set`
iterate).
