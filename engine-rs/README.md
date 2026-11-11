# Verticopolis engine in Rust

`engine-rs/` is the game's simulation, written in Rust and compiled to
WebAssembly for the web game, where it is the only engine that runs. It began
as a port of the TypeScript simulation in `src/engine/`; that code is no longer
part of the game and is being deleted. Gameplay rules, caps and tuning live
here, and a change to how the game plays lands in this crate. The crate can also
run under hosts other than the browser (a native desktop client, a plain Rust
program) while staying one simulation.

Frontends may differ. Simulations may not. The referee for that rule is the
conformance suite in `../conformance/`: the port replays every scenario and
must reproduce every pinned checkpoint hash (`expected.json`) byte for byte.

## Layout

| Area | Files in `src/` |
| --- | --- |
| Core and determinism | `lib.rs`, `rng.rs` (seeded Mulberry32), `jsmath.rs` (JavaScript number semantics), `canonical.rs` (the conformance hash), `fixed_step.rs` (pacing a frame's minutes) |
| Rules and reference data | `rules.rs` (Classic vs Modern, `impl GameMode`), `facilities.rs` and `facilities/` (sizes, prices, build caps, transport pooling), `econ.rs`, `clock.rs`, `catalog.rs` and `catalog/` (everything a frontend shows) |
| The tower | `tower.rs` and `tower/` (placement, transports), `tower_index.rs`, `tower_query.rs`, `tower_query_state.rs`, `tower_removal.rs`, `build.rs`, `brush.rs` (floor and lobby painting), `schedule*.rs` (elevator schedules) |
| The simulation loop | `sim.rs` (`Simulation`), `sim_loop.rs` (`tick`), `presence.rs`, `demand.rs`, `churn.rs` and `churn/`, `star.rs`, `services.rs` (recycling, parking, extermination) |
| People and transport | `crowd/` (spawning, routing, walking, meals, staff), `dispatch.rs` (elevator cars), `housekeeping.rs` |
| Money, mood and events | `economy.rs` and `economy/`, `rent.rs`, `charges.rs`, `ledger.rs`, `satisfaction.rs` and `satisfaction/`, `noise.rs`, `events.rs`, `events_fire.rs`, `events_bomb.rs`, `gameplay.rs` (the gameplay events a host drains) |
| Undo | `undo.rs` (the steps and stacks), `undo_journal.rs` (recording a step), `sim_undo*.rs` (applying one) |
| Saves and files | `sim_save.rs`, `load.rs` and `load/` (the loader, coercion, migrations), `load_stream.rs`, `export_stream.rs`, `vctower_import.rs`, `save_delta.rs`, `fflate.rs` and `fflate/`, `tdt/` (the 1994 `.TDT` codec, see below) |
| What a host reads | `frame.rs` and `view/` (the frame layout and its reader), `render_reads.rs`, `snapshot.rs` (the hashed state view), `panels/`, `diagnostics/`, `telemetry.rs`, `identity.rs` |
| The WASM binding (feature `wasm`) | `wasm.rs`, `wasm/`, `wasm_port.rs` and `wasm_port_*.rs` (`EnginePort`), `wasm_relay.rs`, `wasm_sync.rs`, `wasm_facade_commands.rs` |
| Conformance and tools (feature `conformance`) | `scenario.rs` and `scenario/`, `suite.rs`, `bin/` (`conformance`, `dump`, `fuzz`, `tdt`, `tdt_fixtures`) |

Outside `src/`: `tests/` holds the integration tests (`independence.rs`,
`read_boundary.rs`, `api.rs` and the `.TDT` suites), `consumer/` is a small
frontend-free host, and [`API.md`](API.md) is the host API.

Unit tests sit beside their module as `<module>_tests.rs` (or `tests.rs` in a
module folder). Every file stays under the 500-line ceiling that
`src/tests/fileSize.guard.test.ts` enforces, so a growing module splits into a
folder.

Many functions keep the names and shape of their TypeScript originals. Where
JavaScript semantics matter for the hash (`Math.round`, `Number#toString`,
Mulberry32 on wrapping 32-bit integers, insertion-ordered maps and sets) the
Rust spells them out rather than reaching for the nearest standard-library
call.

## Contributing

Every rule in [CONTRIBUTING.md](../CONTRIBUTING.md) applies here, plus:

- **Gates:** `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test`, and
  the conformance referee (see Running). CI runs them in `engine-rs.yml`.
- **No host access.** The library reads no file, clock, console, network,
  thread or process, and pulls in no unreviewed crate (`tests/independence.rs`).
- **A change to how the game plays** regenerates `conformance/expected.json`
  in the same PR (see Keeping the lock honest), and a change to the save, frame
  layout, catalog or binding moves the crate version (see The crate version).
- **The web game builds the package** with `npm run wasm:build` from the
  repository root, or `bash scripts/build-engine-wasm.sh`, which also installs
  the pinned toolchain on x86_64 Linux. `npm run test:wasm` runs the web
  suites that drive the engine through its package.
- **The READMEs follow the engine.** A change to the library source or the
  binding updates `CRATE_README.md` and the WASM package's README where they
  went stale, or says `readmes: unchanged` in its change note
  (CONTRIBUTING.md, The engine READMEs).
- **Review:** gameplay and engine work gets `/gds-code-review`, and engine hot
  paths get the checklist in `docs/performance/hot-path-review.md`.

## Using it from another frontend

[`CRATE_README.md`](CRATE_README.md) is the crate's README for people who
build on it, the page a registry release will show (#893; that PR points
`readme` in `Cargo.toml` at it), and its quick start is
`consumer/examples/quick_start.rs`, which the `consumer` job compiles.
Both READMEs and `API.md` are also published at docs.verticopolis.com
(`docs/engine-site/`, built from each engine release).
[`API.md`](API.md) is the page for a host that is not the web game: how to
depend on the crate, the calls a frontend makes, and what is stable.
[`packages/verticopolis-engine/README.md`](../packages/verticopolis-engine/README.md)
is the README of the WASM package each crate
release publishes to GitHub Packages (`@maniator/verticopolis-engine`), for a
JavaScript host; `.github/workflows/release-tag.yml` packs it.
`consumer/` is a small crate that depends on the engine by path and makes
those calls; CI builds and runs a copy of it outside the checkout, in the
Rust container image with no Node.js and a checkout holding only
`engine-rs/` and `conformance/` (`engine-rs.yml`, job `consumer`), and
`tests/independence.rs` checks that the library source (the conformance
harness aside, which is behind the `conformance` feature) reaches for no
file, clock, console, network, thread or process access, compiles in
nothing from the web game's tree, and pulls in no unreviewed crate.
`tests/read_boundary.rs` keeps the tests and binaries reading only
`engine-rs/` and `conformance/`, and `tests/api.rs` names the host API.

## Running

```sh
cd engine-rs
cargo test                                  # unit tests (rng, number formatting, hash)
# The referee and the tools below are the `conformance` feature.
cargo run --release --features conformance --bin conformance       # replay every scenario against expected.json
cargo llvm-cov --no-report test --features conformance && cargo llvm-cov --no-report run --features conformance --bin conformance \
  && cargo llvm-cov report               # what the tests and the referee reach; CI floors lines at 87%
cargo run --release --features conformance --bin dump -- starter-classic t+60   # canonical JSON of one checkpoint
cargo run --release --features conformance --bin tdt                 # replay every .TDT case against conformance/tdt-cases.json
(cd consumer && cargo test --locked && cargo run --locked --release)   # the frontend-free host (API.md)
```

## The `.TDT` codec

`src/tdt/` reads and writes the 1994 SimTower save format the way
`src/storage/tdt*.ts` does: `import_tdt(bytes, filename)` gives the
serialized game as JSON (what `load::deserialize` takes) plus the binary
walk's warnings, and `export_tdt(save_json)` gives the file bytes for a
serialized game (what `Simulation::serialize` writes). Its referee is
`conformance/tdt-cases.json`, generated by
`src/tests/integration/tdtCases.integration.test.ts` (same
`VC_CONFORMANCE_UPDATE=1` switch as the scenario lock): every synthetic
`.TDT` case is pinned by the canonical-JSON hash of the save the TypeScript
importer produces and its warnings, every export case by the SHA-256 of the
bytes the TypeScript exporter writes. `cargo run --release --features conformance --bin tdt` prints
one line per case and exits non-zero on any mismatch; `cargo test` replays
the same table. The engine never depends on the module.

Beyond the pinned table, `npm run test:wasm` runs the differential test
`src/tests/integration/conformanceWasmTdt.integration.test.ts` (its side
runners and bookkeeping in `src/tests/conformance/tdtDifferential.ts`, its
input builders in `src/tests/fixtures/tdtDifferentialInputs.ts`): both codecs
import and export the same seeded inputs (round trips of fixtures, lock
saves, edge saves and played towers, NaN and forged values in numeric
fields, and mutated `.TDT` files) and must answer the same. `VC_TDT_DIFF_N`
scales it, `VC_TDT_DIFF_SEED` moves its seed, `VC_TDT_DIFF_OUT` dumps each
divergence's input, `VC_TDT_DIFF_REPORT=1` prints the tally and
`VC_TDT_DIFF_KNOWN=1` adds the inputs known to diverge today; the test's
header says what each one covers.

The import and export fidelity reports (what was mapped, dropped or
approximated) are not ported yet; the tallies they read from are.

## The `.vctower` container

`load::decode_vctower(text)` reads the web game's save file (the
`VCTOWER1` magic, then base64 of a raw-deflated JSON save) and
`load::encode_vctower(&save)` writes one, so a host that is not the web
game can write saves the web game opens. The encoder takes a serialized
game as a `serde_json::Value` (what `Simulation::serialize` returns), writes
it as given and returns the file bytes, or refuses a save too large to
read back (see the limits below). A save written as a player's tower
needs the stamp `SaveGame.export` adds: `load::stamp_save(&mut save,
app_version, saved_at_ms)` sets `appVersion` and `savedAt`, and
`load::encode_simulation_vctower(&sim, app_version, saved_at_ms)` serializes,
stamps and encodes a running game in one call. The engine does no file IO
and has no clock, so the host passes the build name and the time. The stamp
refuses a save the web import would refuse (no numeric `minutes` or no
`units` list), a time no JavaScript `Date` holds, and a build name the web
game reads as before 2.0, since a save stamped so, or not stamped at all,
loads as a founder's tower. A save still holding an older stamp that reads
as a founder's keeps that status as `founder: true`. A save with no stamp
looks like a fresh serialization, so load an unstamped file before writing
it again.

For the same serialized save, stamp and time, the file is the one the web
game writes, byte for byte: the magic, a newline, one line of padded
standard base64, a newline, around raw DEFLATE of the save's JSON. The JSON
is `JSON.stringify`'s text (`canonical::js_json`: keys in insertion order,
which serde_json's `preserve_order` keeps, with array-index keys first, as
in any JavaScript object), so a save parsed from the web game's JSON keeps
its key order. The compressor is `src/fflate.rs`, a line-for-line port of
fflate 0.8.3 `deflateSync` at level 1, the compressor every web writer uses
(`SaveGame.export`, `packSync`, `toTowerFile`). It is pinned by reference
vectors fflate wrote; change it only together with the fflate version in
`package-lock.json`. A save built by the engine's own `serialize` has the
engine's key order, which every reader takes, and a string holding half a
surrogate pair is written as U+FFFD where `JSON.stringify` writes the escape
(the web game repairs such strings on load and on input, so its saves hold
none). The Rust tests in `load.rs`
round-trip every web-written fixture in `conformance/fixtures/`, and
`src/tests/integration/conformanceWasmVctower.integration.test.ts` (part of
`npm run test:wasm`) loads each fixture in the web game, writes it with the
engine, checks the file against `SaveGame.export`'s and `toTowerFile`'s
byte for byte, reads it back through `decodeVctower`, `fromTowerFile` and
`SaveGame.import`, and checks the Founder status and the loaded state's
hash. The same file runs a randomized differential of the compressor
against fflate.

When the WASM engine runs (always, in a deployed build), the web game writes its own
saves through this writer: `SaveGame.export` and `SaveGame.packSync` hand
the stamped save JSON to `encodeVctower` (`src/storage/vctowerWriter.ts`),
and fall back to the TypeScript writer if the engine throws or writes no
`.vctower` file. A save past 8 MiB skips the engine, which would parse and
re-print it on the main thread. The timer autosave (`saveToAsync`, which compresses off
the main thread) and the desktop store's `toTowerFile` re-header keep their
own writers. The same test file checks that a file written that way is the
one the web game writes on its own.

Two limits apply to every save the engine reads or writes as JSON text.
A JavaScript string can hold half of a surrogate pair (a tower name cut
through an emoji, since the rename box counts UTF-16 units), which
`JSON.stringify` writes as a `\udxxx` escape that a Rust string cannot
hold. `load::parse_save_json` reads each such escape as U+FFFD, the
character `TextEncoder` substitutes for an unpaired surrogate, and every
engine entry point that takes save JSON goes through it: `decode_vctower`,
`fromSave`, `encodeVctower` and `exportTdt`. Such a save loads in the
engine with U+FFFD where the half character was, and the web
game repairs the same way: `parseSaveJson` (`src/storage/saveCompression.ts`)
on every save text it reads, and `wellFormed` where a name is set (the
tower-name callback and `Tower.setLabel`), so both engines hold one tower. And the
encoder refuses a save whose JSON is longer than 32 MiB, the cap every
reader holds to (`decode_vctower`, and on the web `inflateCapped` and
`SaveGame.import`; the web writers check it too, through `encodeSaveJson`),
since that file would only fail to load.

## The WASM binding

The crate also builds as a WebAssembly module for JavaScript hosts. The
binding (`src/wasm.rs`, behind the `wasm` cargo feature) exports one class,
`Engine`, with constructors for a new game, a serialized save and a
`.vctower` text, and methods for ticking, the build and edit commands, the
events, the tile queries, the readouts a runner checks (`mode`, `money`,
`setMoney`, `fires`), `serialize` and the two hashed views with their
digests, plus three free functions: two for the 1994 save format,
`importTdt(bytes, filename)` (JSON text `{ save, warnings }`) and
`exportTdt(saveJson)` (the file bytes), and `encodeVctower(saveJson,
appVersion, savedAtMs)`, the stamped `.vctower` text for a serialized game.
Structured values cross as JSON text; integers cross as 32-bit
values (`i32`, and `u32` for the seed and the fire count), which the
generated TypeScript sees as `number`. Beside the class, the free function
`catalog(mode)` returns the catalog (below) as canonical JSON.
Nothing in the binding simulates anything.

`wasm:build` runs only on the release `rust-version` names, at `.0`
(1.97.0 today), because the package's `THIRD-PARTY.json` attributes the
standard library that release links (#955). On another toolchain, install
that release and build with `RUSTUP_TOOLCHAIN=1.97.0 npm run wasm:build`.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --locked --version 0.2.129   # the version Cargo.toml pins
npm run wasm:build          # cargo rustc (cdylib) for wasm32 + wasm-bindgen into engine-rs/pkg/
npm run test:wasm           # every scenario through the binding, the frame-day and port-edit goldens, the .TDT differential test and the .vctower writer test (fails without the package)
```

`engine-rs/pkg/` is build output and is not checked in, except for the
declaration wasm-bindgen writes, copied to `src/dualrun/engine.d.ts`:
`src/dualrun/binding.ts` types the adapters against it, so a method added
or renamed in `wasm.rs` reaches TypeScript as a type change, and the
`engine-rs.yml` job fails when the checked-in copy is stale (rebuild and
commit it with the Rust change). The WASM suite
(`src/tests/integration/conformanceWasm.integration.test.ts`) skips itself
when the package is missing, so `npm test` stays green without a Rust
toolchain; CI builds the package first (the engine-wasm action fails when a
package file is missing) and then runs the suite. Rebuild
the package after any change to the Rust source; the suite replays whatever
was built last.

## The catalog

`catalog::catalog(mode)` is the reference data every frontend draws a build
menu, a price label or a placement ghost from, read out of the engine's own
tables and resolved for one mode so a frontend never applies a rule itself:
the world geometry (lot width, floor range, ground floor, lobby interval),
the economy constants a UI shows (starting money, the add-car cost and its
refund, the per-floor transport cost, upkeep and bookings, the exterminator
fees where the mode has them, whether bridging can be switched off, and the
calendars the mode runs with the factor each applies to the monthly and
quarterly figures, since a canon calendar charges a tenth of a monthly
figure every three days), the
pooled caps, and per facility kind its key, name, category, size, cost, star
gate, population, attendance, flags, whether the mode can build it, build
minutes, resale refund, build cap and pool, transport span, cars and car
capacity, subtypes, rent configuration (the Classic ladder with No Rate or
the Modern band, and when it is collected), daily income, spend per customer
and service upkeep.
A value a kind does not have is present as `null`, and the shape carries
a `version` that moves when a field is added, renamed or removed.

The WASM binding returns the same JSON from `catalog(mode)`, typed by
`Catalog` in `src/catalog/catalogTypes.ts` and read through `readCatalog` in
`src/dualrun/catalog.ts`, which refuses a reply whose shape is not `Catalog`
(a missing or mistyped field, a negative price, a pool or ground floor
structure naming no listed kind). `conformance/catalog-digests.json` pins
each mode's canonical hash: the WASM suite writes it from this catalog
(`conformanceWasm.integration.test.ts`, regenerated with the conformance
switch), and a crate test, the referee binary and the WASM suite check
against it, so a changed price or size moves the digest in the PR that
changes it. A crate test also checks that the prices the catalog quotes are
the ones the build and sell paths charge.
Presentation (display copy beyond the name, icons, pixel sizes, colors)
stays with the frontend.

The catalog gives a kind's base price. The price of one placement also
depends on the tower: the floor tiles laid under a room and, with bridging
on, the gap tiles bridged to the tower. The binding answers it with
`canBuild(kind, floor, x)`, the same dry run `build` makes first, as JSON
`{ ok, reason?, cost }`. When the placement fits, `cost` is its full price,
and a "Not enough money." refusal carries that same price. Any other refusal
carries the reason `build` would give and the facility's base price, so
placement rules the catalog does not list (the Wedding Hall on the top floor,
the ground-floor concourse, a claimed sky-lobby story, lobby floors) reach a
frontend through the engine that enforces them. The binding has no
quote for a shaft yet (backlog row `engine-independence`, #980); a native host
asks the crate's `Simulation::can_build_transport(kind, x, bottom, top)`, the
dry run `build_transport` makes first.
`conformanceWasmCanBuild.integration.test.ts` sweeps every kind over a grid
of floors and positions on new games and saved towers in both modes (two
raised to the TOWER rating, so the star-gated rules answer), with bridging on
and off where the mode allows it and money flush, short and exactly at a
price, and requires the Rust answer to equal the TypeScript one. The build
paths in both engines charge the same constants the catalog quotes: the
transport per-floor cost, and the lobby and floor tile prices from the
facility table.

## The web host

Every build of the web game runs this engine, and only this engine. The game
holds the WASM `Engine` as its `EnginePort` and calls it directly; there is no
TypeScript read model or fallback. The browser package is served from
`src/public/engine/` with a `BUILD.json` naming the Rust sources' hash. It is
build output and is not checked in: the Vercel build
(`scripts/vercel-build.sh`) builds it on every deploy, and CI restores it from
the Actions cache keyed on that hash, building it only when the engine changed
(`.github/actions/engine-wasm`; jobs in the Playwright container download it as
a run artifact). Every build, on Vercel or on a CI cache miss, installs the
pinned toolchain through `scripts/build-engine-wasm.sh`. A unit test fails when
a local package is stale.

Gameplay events (`conformance/events/catalog.json`, `src/gameplay.rs`) come
from the engine: `Engine.drainGameplayEvents()` returns and clears the batch as
JSON, and `Engine.gameplayEventsPending()` says how many it holds. The
host's typed drain is `src/simport/portEvents.ts`.

## The goldens

Two goldens pin what the engine does when the web game drives it, and
`npm run test:wasm` checks both:

- **The frame-day golden** (`src/tests/goldens/frame-days.json`): the engine
  plays each case through its own `advance`, as the game's frame loop calls it,
  and must reproduce every checkpoint (the start, the first frame, each hour
  and the end of the day). `VC_FRAME_DAYS_UPDATE=1` rewrites it from this
  engine. To find the field behind a moved hash,
  `VC_FRAME_DAYS_DUMP=<dir> VC_FRAME_DAYS_CASE=<case id>` writes the case's
  canonical views at each checkpoint under `<dir>/rust/`, to diff against a run
  of the build before the change.
- **The port-edit golden** (`src/tests/goldens/port-edits.json`): each case
  sends the player's edits as the game's port commands and pins every answer,
  with the view hashes and events after each step and at every hour of play
  between them (`conformanceWasmPortEdits`). It also steps the undo trail and
  restores an earlier save. `VC_PORT_EDITS_UPDATE=1` rewrites it, and
  `VC_PORT_EDITS_DUMP=<dir> VC_PORT_EDITS_CASE=<case id>` dumps a case's views
  at each line the same way.

The referee prints one line per scenario: `ok`, the first divergent
checkpoint with both hashes, or the first command the port cannot run. It
exits non-zero unless every scenario matches. When a checkpoint diverges, the
`dump` binary prints the canonical JSON for that label, to compare with a run
of the build before the change.

## Keeping the lock honest

A simulation change lands in this crate, with the regenerated
`conformance/expected.json` (see `conformance/README.md`). CI runs
the referee on every change to `engine-rs/` or `conformance/`, the save
fixtures in `conformance/fixtures/` included (`.github/workflows/engine-rs.yml`).

## The crate version

`version` in `Cargo.toml` moves with the engine's compatibility contract:
the conformance lock, the save version, the frame layout, catalog and identity
record versions, and the checked-in binding declaration `src/dualrun/engine.d.ts`.
Change any of them and the version goes up in the same pull request, in
`Cargo.toml`, `Cargo.lock` and `consumer/Cargo.lock` (CI builds the consumer
with `--locked`), followed by `npm run engine:compat`, which rewrites
`src/compat-record.json`. `src/tests/engineCompat.guard.test.ts` fails when a
pin moved and the record did not. An internal change that keeps all of them is
told apart by the build hash in `BUILD.json` and needs no bump. The full rule,
including what the guard does not see, is in `CONTRIBUTING.md` under
Versioning.

