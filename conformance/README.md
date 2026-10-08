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
  `{ "scenarios": { "<id>": [ { "label", "state", "crowd" }, ... ] } }`.

The reference runner is `src/tests/conformance/scenario.ts`, and
`src/tests/integration/conformance.integration.test.ts` runs it in CI as part
of `npm test`. A mismatch fails the build and names the first checkpoint that
differs.

## When a hash moves

A moved hash means the simulation changed. If the change is intended, regenerate
the lock and commit it in the same pull request, saying why:

```sh
VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration conformance
```

An update writes the lock only when every test in the run passes and every
scenario finishes, and it refuses to run in CI.

A refactor that claims to change nothing must not touch `expected.json`.

## Fixtures the scenarios start from

The `fixture` starts use the saves under `src/tests/fixtures/`. Four of them
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

## The loader table

`loader-cases.json` is the referee for `deserialize` on saves no engine writes:
forged keys, mistyped numbers, overlapping units, inverted shafts, garbage
schedules. `src/tests/integration/loaderCases.integration.test.ts` builds the
cases from code, hashes the loaded state of each through the TypeScript
loader, and writes them with the same regeneration switch as the lock
(`VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration loaderCases`);
a Rust unit test replays every case. Add a case for any coercion rule you
touch.

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

- `{ "newGame": { "seed": n, "mode": "classic" | "modern" } }`: a new game with
  the default calendar and automatic bridging on (`newGame(seed, mode)`).
- `{ "fixture": "path/to/file.vctower", "mode"?: "classic" | "modern" }`: a save
  file, path relative to the repository root, loaded the way an import loads
  it: decode, migrate and load, then mark a save with no `appVersion` stamp
  (one from before 2.0) as a founder's tower. `mode`, when present, overwrites
  the save's mode before loading.

Commands run in order. Units and shafts are named by a tile they cover
(`floor`, `x`), never by id.

| op | fields | effect |
| -- | ------ | ------ |
| `setMoney` | `amount` | Set the treasury directly (a harness command). |
| `build` | `kind`, `floor`, `x`, `expectFail?` | Build through the normal money-aware path. |
| `buildRow` | `kind`, `floor`, `from`, `to` | `build` at every `x` from `from` to `to`, inclusive. |
| `buildTransport` | `kind`, `x`, `bottom`, `top`, `expectFail?` | Build a shaft. |
| `sell` | `floor`, `x`, `kind?` | Sell the unit at that tile; with `kind`, an error unless that is what the tile holds. |
| `adjustRent` | `floor`, `x`, `dir` (`1` or `-1`) | Step a unit's rent. |
| `setNoRate` | `floor`, `x` | Set a unit to no rate (the Classic price ladder only). |
| `setCars` | `floor`, `x`, `cars` | Set the car count of the shaft at that tile. |
| `setSchedule` | `floor`, `x`, `schedule` | Author the elevator schedule of the shaft at that tile (`Tower.setSchedule`), hardened the way a loaded one is; `{}` clears it. An error on a shaft that is not an elevator. |
| `startFire` | | Start a fire at once: `EventSystem.startFire`, with no hourly roll and no fire-rescue choice. |
| `bombThreat` | | Run a bomb threat at once: `EventSystem.bombThreat`, which charges the sweep when the tower has Security and detonates when it has none, with no ransom choice. |
| `evaluateStar` | | Run the star evaluation. |
| `resolveChoice` | `accept` | Answer the pending player choice (`resolveChoice`): `true` pays the fire rescue or the ransom, `false` declines (the fire burns on, Security searches for the bomb). An error when no choice is pending. |
| `callExterminator` | `expectFail?` | Book the Modern exterminator (`callExterminator`); a refusal (Classic, a booking pending, no infested room, short of funds) is an error unless `expectFail` is set. |
| `reload` | | Save the game and load the save (`serialize()`, a JSON round trip, `deserialize`), replacing the running engine. The hashed `state` view must come back unchanged; a difference is an error. Live state that saves do not carry (the crowd, elevator dispatch) restarts as a load restarts it (see Checkpoints). |
| `tick` | `dt`, `times?`, `checkpointEvery?` | Call `tick(dt)` `times` times (default 1). All three are whole positive numbers. After every `checkpointEvery`th call, take a checkpoint labeled `t+<minutes>`, where minutes counts every tick's `dt` since the start of the scenario. |
| `checkpoint` | `label` | Take a checkpoint. |

A command that fails is an error, and so is a build that succeeds when
`expectFail` is set, a rent step that leaves the rent where it was, a car
count the shaft clamps, and a `startFire` that sets nothing alight.

A scenario is refused before it runs if it is not an object, if `commands` is
not a list of objects, if it has an unknown op or an unknown field anywhere
(scenario, `start`, `start.newGame` or command), or if a field is missing or
ill-typed:

- `id` and `description`, `fixture`, and `label` are non-empty strings.
- `seed` is a whole number from 0 to 4294967295.
- `floor`, `x`, `from`, `to`, `bottom` and `top` are whole numbers, and a
  `buildRow`'s `from` is not past its `to`.
- `dt`, `times`, `checkpointEvery` and `cars` are whole numbers above zero.
- `dir` is 1 or -1, `amount` is a finite number, `expectFail` is a boolean.
- `kind` is a key of `FACILITIES` in `src/engine/facilitiesData.ts`: one
  without the `transport` flag for `build` and `buildRow`, one with it for
  `buildTransport`.
- `mode` is `classic` or `modern`.

Together these keep a scenario from quietly testing a different tower than the
one it describes.

Two `setCars` commands that shrink and then regrow a shaft with no `tick`
between them reach a known engine bug (#855), so no scenario does that until
it is fixed.

## Checkpoints

The runner takes a checkpoint labeled `start` before the first command and one
labeled `final` after the last, so nothing a scenario runs goes unchecked.
Labels are unique within a scenario. Each checkpoint records two hashes:

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
