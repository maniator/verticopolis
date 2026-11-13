# @maniator/verticopolis-engine

The [Verticopolis](https://verticopolis.com) simulation engine, compiled to
WebAssembly. It is the same engine the web game runs: every rule, price, cap,
command, save format and gameplay event of the tower simulation. Your code
owns everything a player sees and hears (rendering, audio, UI, input) and
drives the engine through the calls below.

The engine is written in Rust in
[`engine-rs/`](https://github.com/maniator/verticopolis/tree/main/engine-rs)
of the Verticopolis repository. This package is its JavaScript binding, built
by [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) once per engine
release.

- [What is in the package](#what-is-in-the-package)
- [Install](#install)
- [Quick start (Node)](#quick-start-node)
- [Quick start (browser)](#quick-start-browser)
- [How the engine talks](#how-the-engine-talks)
- [API reference](#api-reference)
- [Saves](#saves)
- [Versioning](#versioning)
- [Stability](#stability)
- [Using the Rust crate instead](#using-the-rust-crate-instead)
- [License](#license)

## What is in the package

| Path | What it is |
| --- | --- |
| `node/` | The Node build (CommonJS, also importable from ES modules). It loads the `.wasm` file next to it synchronously when you `require` it. This is the package's `main`. |
| `node/verticopolis_engine.d.ts` | The TypeScript declarations, with a doc comment on most calls. `web/verticopolis_engine.d.ts` declares the same calls plus the browser build's loader. |
| `web/` | The browser build (an ES module). Call its default export once to load the `.wasm` before you use anything else. |
| `web/BUILD.json` | The build record: the engine version, a hash of the Rust sources it was built from and a SHA-256 for each file. |
| `web/THIRD-PARTY.json` | The licenses of the Rust crates compiled into the `.wasm`. |
| `CHANGELOG.md` | The engine changelog, one section per version. |

Both builds come from the same Rust source at the same version and run the
same simulation.

For TypeScript, the declarations use `Symbol.dispose`, so include
`esnext.disposable` (or `esnext`) in your `lib` setting, or turn on
`skipLibCheck`.

## Install

The package is published to GitHub Packages, which needs a GitHub token to
install from even though the package is public. Create a token with the
`read:packages` scope (a classic personal access token works), then point the
`@maniator` scope at GitHub's registry in an `.npmrc` next to your
`package.json`:

```ini
@maniator:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Keep the token out of the file itself: npm reads `${GITHUB_TOKEN}` from the
environment. In GitHub Actions, the workflow's own `GITHUB_TOKEN` can read
public packages.

```sh
npm install @maniator/verticopolis-engine
```

Each engine release also attaches the same two builds as a zip, with a
SHA-256 checksum, to its GitHub release
([`engine-v<version>`](https://github.com/maniator/verticopolis/releases?q=engine-v)),
for anyone who would rather not use a registry.

## Quick start (Node)

```js
const { Engine, catalog } = require("@maniator/verticopolis-engine");
// or: import { Engine, catalog } from "@maniator/verticopolis-engine";

// A new Classic game from seed 42.
const engine = Engine.newGame(42, "classic");
console.log(engine.money()); // 2000000

// Look up the office in the catalog, then lay a lobby under it and build it.
const facilities = Object.values(JSON.parse(catalog("classic")).facilities);
const office = facilities.find((f) => f.key === "office");
for (let x = 10; x < 10 + office.width; x++) engine.build("lobby", 1, x);

console.log(engine.canBuild("office", 2, 10)); // {"ok":true,"cost":44500.0}
console.log(engine.build("office", 2, 10)); // {"ok":true}

// Run one game day, one minute at a time.
for (let minute = 0; minute < 24 * 60; minute++) engine.tick(1);

for (const event of JSON.parse(engine.drainGameplayEvents())) {
  console.log(event.name, event.payload);
}
console.log(JSON.parse(engine.towerStats()));

// Save it as a .vctower file the web game can open.
const file = engine.exportVctower("my-host 1.0.0", Date.now());

engine.free();
```

## Quick start (browser)

The browser build is an ES module that fetches its `.wasm` file next to it.
Bundlers that understand `new URL("...", import.meta.url)` (Vite, webpack 5,
Parcel, esbuild with a loader) copy the file for you.

```js
import init, { Engine } from "@maniator/verticopolis-engine/web/verticopolis_engine.js";

await init(); // once, before any other call

const engine = Engine.newGame(Date.now() >>> 0, "modern");
```

`init` also takes the `.wasm` location or its bytes,
`init({ module_or_path: url })`, when you serve the file yourself, and
`initSync({ module: bytes })` loads it synchronously from bytes you already
hold.

## How the engine talks

- **One `Engine` is one game.** Create one with `Engine.newGame`,
  `Engine.fromVctower` or `Engine.fromSave`. It lives in WebAssembly memory
  that JavaScript's garbage collector does not see, so call `free()` when you
  are done with it (or declare it with `using`, since it implements
  `Symbol.dispose`).
- **Structured answers are JSON text.** Calls that answer with a record return
  a string; `JSON.parse` it. Calls that take a structured argument take it as
  JSON text too.
- **Commands answer instead of throwing.** A command a player could make
  returns `{ "ok": true }` or `{ "ok": false, "reason": "..." }`, where
  `reason` is a sentence you can show a player. Money-moving commands add the
  amount moved. An argument of the wrong shape (a fractional id, an unknown
  end or method) is refused, never rounded into a different request. Loading
  and file calls (`fromVctower`, `importTdt`, an unknown mode) throw a
  JavaScript `Error` whose message is readable by a player.
- **The engine does no I/O.** It reads no file, clock, network or console. You
  pass in time (`tick`), files (as text or bytes) and timestamps, and you get
  bytes back to store wherever you like.
- **It is deterministic.** The same seed, the same commands and the same
  sequence of `tick` calls give the same game, on any machine and in either
  build.
- **Coordinates.** `floor` counts up from the ground floor, which is `1`.
  Floor `0` and below are basements, down to `-9`, and the top floor is
  `100`.
  Lobbies go on the ground floor and every 15th floor above it. `x` is a tile
  column, from `0` to the lot width less one (`375` tiles). The catalog's
  `world` record carries these numbers, so read them from there.
- **Modes.** `"classic"` follows the 1994 original; `"modern"` adds the
  facilities and rules the original did not have. The catalog marks each
  facility that is Modern-only.
- **Pause.** The engine has no paused state: pausing means your frontend
  stops calling `tick`, and a build still applies while it is stopped. The
  catalog's `rules.buildsWhilePaused` says whether the mode allows that.
  Classic does not, as in the original, so a Classic frontend refuses new
  placement while paused.

## API reference

The table lists the calls a frontend needs. The doc comments in
`node/verticopolis_engine.d.ts` give the exact argument rules and answer
shapes for each one.

### Starting and loading a game

| Call | What it does |
| --- | --- |
| `Engine.newGame(seed, mode, modernCalendar?, startUnbridged?)` | A new tower. `seed` is a 32-bit unsigned integer; `mode` is `"classic"` or `"modern"`; `modernCalendar` is `"realWorld"` (the default) or `"canon"`. |
| `Engine.fromVctower(text, mode?)` | Open a `.vctower` file the way the web game does: decode, migrate older saves and load. `mode` overrides the save's mode. |
| `Engine.fromSave(json)` | Load the save JSON that `serialize()` returns. |
| `importTdt(bytes, filename)` | Read a 1994 SimTower `.TDT` file. Answers `{ save, warnings }`; pass `JSON.stringify(save)` to `Engine.fromSave`. |

### Running time

| Call | What it does |
| --- | --- |
| `tick(dtMinutes)` | Advance the game by `dtMinutes` game minutes. Any size works: the engine cuts it into steps that never skip an hour boundary. How fast game time runs against real time is your choice. |

### Player commands

| Call | Answers |
| --- | --- |
| `canBuild(kind, floor, x)` | The dry run of `build`: `{ ok, reason?, cost }`, with the full price (floor tiles and bridging included). |
| `build(kind, floor, x)` | Place a facility with its left edge at `x`. `{ ok, reason? }`. `kind` is a catalog `key` such as `"office"`, `"condo"` or `"hotelSingle"`. |
| `paintBrush(kind, floor, tilesJson)` | Lay floor or lobby tiles along a stroke in one command. `{ placed, reason? }`. |
| `setLobbyHeight(height)`, `lobbyRise(floor, x)`, `lobbyHeights()` | How many stories (1 to 3) a new lobby rises from now on, where the mode lets that floor's lobby rise (the catalog's `rules.tallSkyLobbies`; the ground lobby always may), how many a lobby tile laid at `(floor, x)` would rise now, and every lobby hall taller than one story as flat `[floor, x0, x1, height, ...]` quads, `x1` being the hall's last column. In Classic a floor has one lobby height, set by its first lobby. In Modern each hall keeps its own: a tile laid against a hall takes that hall's height, a tile that closes a gap takes the left hall's, and a new hall takes the asked height, so halls of different heights can stand side by side. A first lobby asked taller where it cannot rise is refused, with a reason. A lobby's height never changes once built, and it costs the lobby price per story. |
| `walkwayTop(kind, x, bottom, top)` | The top a stairway or escalator at column `x` asked from `bottom` to `top` is built to: out of a tall lobby (in Modern, the hall under the flight) a one-story flight climbs the whole lobby, so a build preview can draw the flight a click lays. `top` for any other kind or span. |
| `buildTransport(kind, x, bottom, top)` | Place stairs, an escalator or an elevator shaft between two floors. `{ ok, reason? }`. |
| `validateTransport(kind, x, bottom, top)` | The same check without building. |
| `addCar(id)`, `removeCar(id)` | Add or remove an elevator car, charging or refunding it. `{ ok, reason?, delta }`. |
| `extendTransport(id, end, targetFloor)` | Stretch a shaft `"up"` or `"down"`, billing the new floors. |
| `removeFacility(id, method)` | Sell or bulldoze a unit or shaft by id (`"sell"` or `"bulldoze"`), paying the refund. `{ ok, reason?, delta }`. |
| `sellAt(floor, x)` | Remove whatever covers a tile. `true` when something went. |
| `adjustRent(id, dir)`, `priceUnit(id, target)`, `setNoRate(id)` | Change a room's rent: one step up (`1`) or down (`-1`), a chosen price, or off the market. |
| `pendingChoice()`, `resolveChoice(accept)` | A question the game is asking the player (a ransom, a VIP), as `{ kind, cost, message }`, and the answer to it. |
| `setTowerName(name)`, `towerName()` | The tower's name. |

### Reading the game

| Call | What it answers |
| --- | --- |
| `money()`, `mode()` | The balance and the mode. |
| `towerStats()` | The headline counters as JSON: population, money, star rating, offices, condos, hotel rooms, floors, elevators and so on. |
| `unitAt(floor, x)`, `unitDetail(id)` | The room covering a tile, and the inspector card for one room. |
| `drainGameplayEvents()` | The gameplay events since the last drain, oldest first, as `[{ name, payload }]` (`facility_placed`, `star_reached`, `fire_started`, `milestone_reached` and the rest). The names and payloads are listed in [`conformance/events/catalog.json`](https://github.com/maniator/verticopolis/blob/main/conformance/events/catalog.json). Drain after each frame; the buffer is bounded and `gameplayEventsDropped()` counts what it had to drop. |
| `logSince(seq)` | The tower's message log after entry `seq`, as `[{ seq, minute, text, kind }]`. |
| `viewLayout()`, `viewStructure()`, `viewFrame(full)` | The renderer's view, for a host that draws the tower every frame: the layout names every slot as JSON; the structure (floors, rooms, shafts) and the per-frame state (clock, people, changed rooms, cars) come as flat number arrays read through it. |
| `serialize()` | The whole game as save JSON. |
| `stateDigest()` | A short hash of the game state. Two engines that agree on it hold the same game. |

### Reference data and identity

| Call | What it answers |
| --- | --- |
| `catalog(mode)` | Every price, size, build cap and rule a frontend shows, for one mode, as JSON: `facilities` (one entry per kind, with its `key`, `name`, `width`, `cost`, `minStar` and so on), `world`, `economy`, `pools` (caps several kinds share; Classic adds one for party halls and theaters together) and `rules`. Read rules from here rather than copying them into your code. |
| `engineIdentity()` | Which engine this is and which contracts it speaks: the crate version, the save version it writes and the oldest it loads, the frame layout version, the catalog version with a digest per mode, and the conformance lock digest. |

The binding exports more than this table. The rest are the web game's own
plumbing and tooling: packed number-array answers its host decodes, test
hooks and raw edits that skip the game's charges (`setMoney`, `setCars`,
`startFire` and the like). They can change in any release, so build on the
calls above.

## Saves

- **`.vctower`** is the native save format, and what the web game imports and
  exports. Write one with `exportVctower(appVersion, savedAtMs)` and open one
  with `Engine.fromVctower(text)`. `appVersion` names your build; it is stored
  in the file. If you already hold save JSON, `encodeVctower(json, appVersion,
  savedAtMs)` writes the same file.
- **`.TDT`** is the 1994 SimTower format. `importTdt(bytes, filename)` reads
  one and `exportTdt(saveJson)` writes one, for towers the old format can
  hold. The catalog's `rules.exportsTo1994` says which mode's towers those
  are (Classic); a Modern tower is refused. Each elevator car's waiting floor
  travels both ways as the shaft's `schedule.homeFloors`.
- **A save holds the tower, not the moment.** The people walking around and
  the elevator cars' positions are not saved; a loaded game starts them
  fresh, so it does not carry on exactly where the saving game was. Two loads
  of the same save do stay identical to each other.
- **The loader repairs.** A damaged or hand-edited save is coerced the way the
  web game's loader does; only a file it cannot read at all is refused.
- **Newer saves are refused.** A save written by a newer engine than the one
  loading it is refused rather than half-read. `engineIdentity()` tells you
  which save version an engine writes. A save is version 7 unless it holds a
  lobby taller than one story, which makes it version 9 (one entry per hall).
  A version 8 save, which gave each floor one height, still loads.

## Versioning

The package version is the engine crate's version (`engine-rs/Cargo.toml`),
which is separate from the web game's version. Each engine release:

- publishes this package at that version;
- tags the repository `engine-v<version>` and publishes a GitHub release with
  that version's changelog section and the zipped builds;
- adds a section to [`CHANGELOG.md`](./CHANGELOG.md), written for people who
  build on the engine.

The version goes up when the engine's contract moves: the conformance lock
(simulation behavior), the save version, the frame or view layout, the
catalog, the identity record, or the binding's declarations. A change that
keeps all of these, such as a speed-up, does not raise the version on its
own; it ships with the next release.

To pin exactly, depend on an exact version (`"1.24.0"`, not `"^1.24.0"`): see
[Stability](#stability).

## Stability

- **No semver promise yet.** Until the engine's compatibility policy is
  written ([#893](https://github.com/maniator/verticopolis/issues/893)), a
  minor version can change a call's shape or the game's behavior. Pin an
  exact version and read the changelog before you move.
- **The conformance lock is the contract.** Every change to the simulation
  lands with an updated
  [`conformance/expected.json`](https://github.com/maniator/verticopolis/tree/main/conformance),
  the recorded state hashes of a suite of scripted games. An engine at a
  given version replays that suite exactly.
- **The calls in the API reference change only on purpose,** with a
  changelog line. Everything else the binding exports is internal.

## Using the Rust crate instead

A Rust host (a native client, a server, a tool) can depend on the crate
directly instead of on this package:

```toml
[dependencies]
verticopolis-engine = { git = "https://github.com/maniator/verticopolis", tag = "engine-v1.24.0" }
```

[`engine-rs/CRATE_README.md`](https://github.com/maniator/verticopolis/blob/main/engine-rs/CRATE_README.md)
is the crate's README, with a Rust quick start, and
[`engine-rs/API.md`](https://github.com/maniator/verticopolis/blob/main/engine-rs/API.md)
is the full guide: the Rust calls, the conformance harness a host uses to
prove it runs the real simulation, and the build metadata.

## License

MIT. See [`LICENSE`](./LICENSE). The licenses of the Rust crates compiled
into the WebAssembly are in `web/THIRD-PARTY.json`.
