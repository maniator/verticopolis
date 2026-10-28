# The engine port contract (facade slice 7, redesign of 2026-10-28)

Status: authoritative for slice 7 from 2026-10-28. It supersedes the
`RustSim` adapter design in `story-facade-7-rustsim.md` (ACs 1 to 12 as
written there) and the async `SimPort` shape in `src/simport/port.ts` for
the main-thread engines. The restore points, the fault fallback and every
test gate carry over; nothing here drops one (see "Migration").

Owner direction (Naftali on #1372, 2026-10-28): "I don't see why we need a
rust sim ts layer, ts should hit either the wasm engine or the ts engine with
the same abstract methods", and no JSON on the paths that run per frame or
per command. Settled the same day by a four-voice party (architect,
performance, renderer, test; no split) and the owner's "Perfect..let's do
it": a synchronous port, numeric records, one shared view reader.

## 1. The shape

- `EnginePort` (`src/simport/enginePort.ts`) is one TypeScript interface.
  Two classes implement it: the binding's `Engine` (Rust, through
  wasm-bindgen; the methods live in `engine-rs/src/wasm_port.rs`, the
  bindings in `engine-rs/src/wasm.rs`) and `TsEngine` (the TypeScript engine,
  `src/engine/tsEngine.ts`, over its own `Simulation`). The game holds one
  `EnginePort` and calls it directly. There is no adapter between the UI and
  either engine, and no wrapper that translates calls.
- **Compile-time proof.** A type test assigns the generated
  `src/dualrun/engine.d.ts` `Engine` and `TsEngine` to `EnginePort`; it fails
  when either drifts. The interface lists only members both have.
- **Synchronous.** Every member returns its answer in the same call. A
  command's effect is on the next view read.
- **Numeric.** Arguments are numbers, booleans, a `Float64Array`, or one of
  the few strings in section 4. Answers are a number, a boolean, a
  `Float64Array` record, or a string from a text getter. Facility kinds,
  film policies, unit and person states, weather, modes and calendars cross
  as codes: an index into the code tables of `viewLayout()`.
- **The shared view reader** (`src/simport/viewReader.ts`) is the one piece
  of TypeScript between the arrays and the renderer. It decodes, it never
  decides: no gameplay rule, no cache of anything but decoded rows. Both
  engines feed it the same arrays (section 5).

## 2. Members

Frequency tiers follow `docs/performance/hot-path-review.md`. "Record"
means a `Float64Array` whose slots `viewLayout().records.<name>` names.

### Time, lifecycle and saves

| Member | Answer | Tier | Notes |
| --- | --- | --- | --- |
| `tick(dtMinutes)` | void | frame | The frame loop's step; `dtMinutes` is a finite real, 0 or more. |
| `serialize()` | string | rare | The save; JSON is the save format. |
| `loadSave(text)` | record: status, generation | rare | The `stored` and `legacy` sources (below). |
| `restore(text)` | record: status, generation | per undo or redo | The `history` source: loads the snapshot but keeps the live camera and the auto-bridge preference. The auto-bridge preference is kept as `TowerSource` `history` does today. The camera is kept in the engine's own view (the one `setCamera` last stamped), the same camera the app's history adoption keeps with `keepCamera`, so a reader that rebuilds on the generation move reads the camera under the player. `TsEngine` does the same. |
| `foundTower(seed, modeCode, calendarCode, unbridged)` | record: status, generation | rare | The `found` source. Named apart from the static `newGame` constructor. The seed is a whole number that fits 32 bits unsigned. |
| `generation()` | number | frame | Moves on every successful `loadSave`, `restore` or `foundTower`; the reader resets on a move (section 5). |
| `undoSignature()` | string | per command | Slice 5a's F2 signature, kept as text. |
| `drainEvents()` | record: dropped, count | per step | Takes the gameplay events since the last drain as this batch. `dropped` counts the events a full ring pushed out since the engine was made; `count` is the batch's size, 0 on almost every step. |
| `eventText(i)` | string or undefined | per event | The `{ name, payload }` JSON of event `i` of the batch the last `drainEvents()` took (section 4). The engine keeps that batch's texts until the next `drainEvents()`, so a caller reads them after draining and before draining again. |
| `setBackdrop(on)` | nothing | once per boot | Marks the current tower as the title screen's scenery, so the next done swap discards its events (see "Events across a swap"). |

**The four sources.** `found`: `foundTower` (with `unbridged` for an unbridged
founding). `history`: `restore` with the undo or redo snapshot. `stored`:
the game code tries each stored save in order with `loadSave` until one is
done (founder detection stays in `src/storage/`, which reads the slot list,
not the engine). `legacy`: the existing `.TDT` import converts the file to
save text in `src/storage/tdt*`, then `loadSave`.

**Atomic.** A refused `loadSave`, `restore` or `foundTower` (text that does not
parse, a refused founding; like the TypeScript loader today, the engine
reads any other JSON best effort, a newer save version included) changes nothing: the tower, the
`generation`, the queued events, the undo history and the reader's base
stay as they were, and the refusal's text is `lastReason()`. A done one
replaces the tower in place, moves `generation`, and drops the drained
batch's texts, the restore-point sidecar and every engine cache; the reader
rebuilds before the next draw.

**Events across a swap.** The queued gameplay events are not dropped. A done
`loadSave`, `restore` or `foundTower` keeps what the replaced tower still owed
and its drop count, then appends the new tower's own events (a founding
event among them) after them, oldest first, as
`GameplayEventBuffer.inherit` does today for `GameApp.adoptSim`. A full ring
drops the oldest and counts them. The one exception is the title screen's
backdrop: `setBackdrop(true)` marks the current tower as scenery, and the
next done swap discards its events and drops (today's `discardOnHandOff`)
and clears the mark. A refused swap keeps the queue and the mark untouched.
A contract test on both engines covers events pending before a swap, undo
and redo, the backdrop exception and the overflow count. Changing this
behavior needs an owner decision and the analytics review.

### View and text

| Member | Answer | Tier | Notes |
| --- | --- | --- | --- |
| `viewLayout()` | string (JSON) | once per boot | Slots, widths, code tables and record slots; the reader refuses a `version` other than its own before any read. An instance member, so `Engine` satisfies the interface; the binding has no module-level `viewLayout` export. |
| `viewStructure()` | `Float64Array` | per tower revision | A fresh copy the caller owns. |
| `viewFrame(full)` | `Float64Array` | frame | A fresh copy the caller owns; `full` asks for every room row. |
| `unitMetaChanged(since)` | record: revision, full, then the ids | on a `metaRevision` move | The rooms whose label or subtype changed after revision `since`, or with `full` 1 (a `since` of 0, or one the log no longer reaches) every room that carries one; the caller reads each one's text with `unitLabel` and `unitSubtype`. It replaces the JSON `unitMetaSince` listing on the port. `unitMetaSince` stays as a legacy export for the conformance suites until PR 4 moves its last caller, the same way the other port names avoid the legacy JSON exports. |
| `unitLabel(id)` / `unitSubtype(id)` | string or undefined | per changed id | Undefined for an id that names no room. |
| `towerName()` | string or undefined | per tower | Undefined when unnamed. |
| `lastReason()` | string or undefined | after a refusal | See "The refusal text" below. |
| `logText(seq)` | string or undefined | per new log line | Kept while the line is in the engine's log window. |
| `view()` | string (JSON) or undefined | per tower | The saved camera; read once per tower, as today. |

Absent answers are `undefined`, never an empty string or a sentinel.

### Commands

Every command answers a **result record**, `Float64Array`, slots:

- `0` status: `1` done, `0` refused.
- `1` money delta, signed, measured by the engine around the command
  (the balance after minus before), so a refund and a charge never collide
  with the status.
- `2..` the op's own slots, named in `viewLayout().records.<op>`.

**The refusal text.** Only the members that answer a status (the
commands, `quoteBuild`, `quoteShaft`, `loadSave`, `restore`, `foundTower`)
clear `lastReason()` at their start and set it on a refusal. `lastReason()`
itself, the view and text getters, `generation()` and the other queries
never touch it, so the reader's reads between a refusal and its display
cannot lose it. A caller reads it after the refusal and before its next
status call. A contract test pins both halves: a refused command followed
by view reads still gives that refusal, and a later done command gives
undefined. Partial success (a brush that lays some tiles) is status `1`
with the count in its slot.

| Command | Args | Own slots | Tier |
| --- | --- | --- | --- |
| `buildAt` | kind, floor, x | none | per command |
| `paintTiles` | kind, floor, tiles `Float64Array` (at most 32) | placed | per drag step |
| `buildShaft` | kind, x, bottom, top | none | per command |
| `demolish` | id, bulldoze | none | per command |
| `changeCars` | id, add | cars | per command |
| `startExtend` / `stopExtend` | id / none | none | per drag |
| `extendShaft` | id, up, targetFloor | bottom, top, added | per drag step |
| `markStop` | id, floor, stop | none | per command |
| `expressStops` / `dropStops` | id | none | per command |
| `scheduleShaft` | id, slots `Float64Array` of layout `scheduleSlots` length: a weekday flag and its 24 hours, the same for the weekend, the two timings (NaN unset), then the home-floor count and up to 8 floors | none | per command |
| `labelUnit` | id, text | none | per command (string, section 4) |
| `stepRent` | id, dir | rent | per command |
| `noRate` | id | none | per command |
| `setRent` | id, target (0 or more) | rent | per command |
| `rentBatch` | kind, target (NaN = default, -1 = No Rate), onlyDefault | the batch counters | per command |
| `setFilm` | id, policyCode | policyCode | per command |
| `rerollUnit` | id | subtypeCode | per command |
| `bookExterminator` | none | cost, rooms | per command |
| `answerChoice` | accept | none | per command |
| `chooseAutoBridge` / `flipAutoBridge` | value / none | value | per command |
| `nameTower` | text (undefined clears) | none | per command (string, section 4) |
| `setCamera` | tile, floor, zoom (NaN = none) | none | per camera save |
| `logLine` | text, kindCode (layout `logKinds`) | none | rare (string, section 4) |

**Port names.** A command whose natural name is already a legacy binding
export (`setStop`, `adjustRent`, `priceUnit`, `applyRentBatch`,
`rerollSubtype`, `setLabel`, `setTowerName`, `toggleAutoBridge`, `setSchedule`,
`beginExtend`, `endExtend`, `setExpressStops`, `clearStops`, `emit`, `logSince`) takes the port
name above instead, because the conformance suites still call the legacy
export with its old answer. The legacy exports go when PR 4 moves their last
callers. `chooseAutoBridge` and `answerChoice` had no caller, so they answer
records under their own names.

### Queries

| Query | Args | Answer | Tier |
| --- | --- | --- | --- |
| `quoteBuild` | kind, floor, x | record: ok, cost; text by `lastReason()` | pointer move |
| `quoteShaft` | kind, x, bottom, top | record: ok; text by `lastReason()` | pointer move |
| `unlockedMask` | none | in the frame header (`unlocked`) | frame |
| `statsStrip` | none | record, `TOWER_STATS` order | UI tick |
| `hotspot` | none | record: ratio, floor (NaN = none) | UI tick |
| `onboarding` | none | number, bits in `ONBOARDING` order | UI tick |
| `floorHeatmap` | modeCode | record: cells of floor, minX, maxX, severity, tint code | overlay refresh |
| `unitDetail` | id | record (NaN for absent fields); `unitLabel(id)`, `unitSubtype(id)` text | selection, revision or hour change |
| `transportDetail` | id | record with the stop rows and hourly slots; origins as counted pairs | selection, revision or hour change |
| `statsReport` | none | record with counted sections | stats screen open |
| `housekeepingCoverage` | none | record | exterminator gate |
| `diagnosticFacts` | id | record | diagnostics readout |
| `logAfter` | seq | record of (seq, kindCode, minute) triples; `logText(seq)` | per new log line |

`towerName()`, `unitLabel(id)`, `logText(seq)` and the other text getters
return a plain string, never JSON.

## 3. Input rules (both engines, one contract)

The same rules on `Engine` and `TsEngine`, pinned by one contract fixture
that runs on both (`src/simport/enginePortContract.fixture.ts`, the `unit`
project for `TsEngine`, `unitWasm` for `Engine`):

- Every numeric argument has one of three classes, and anything outside
  its class is refused with `INVALID_REQUEST`, never coerced:
  - **safe integer**: a whole JS number within `Number.isSafeInteger`
    (`crate::charges::whole` and its TypeScript twin). Ids, floors,
    columns, tiles, counts, seeds, codes, revisions and sequence numbers.
  - **finite real**: any finite number, with the range its member states.
    `tick`'s `dtMinutes` (0 or more), `setCamera`'s `tile` and `floor`
    (any finite value: the renderer's camera center is fractional, and the
    save loader clamps it on read) and `zoom` (above 0), `setRent`'s and
    `rentBatch`'s `target` (0 or more), and `stepRent`'s `dir` (exactly 1
    or -1).
  - **sentinel**: a value with a stated meaning in one slot only. NaN for
    "none" in `setCamera`'s `zoom` and `rentBatch`'s target ("default"), and
    -1 for `rentBatch`'s No Rate target.
- `scheduleShaft`'s slots follow the same classes, slot by slot: the
  slot count must be the layout's `scheduleSlots`; each row flag is 0 or
  1; a set row's 24 car counts are safe integers (an unset row's hours are
  not read); each timing is a finite real, or NaN for unset; the home-floor
  count is a safe integer from 0 to 8, and each home floor it counts is a
  safe integer. Anything else is refused and the shaft's schedule stays.
  The ranges (car counts up to the shaft's cars, the timing limits, home
  floors up to the car count) then follow `Schedule::coerce`, which clamps
  them as it does for the legacy JSON setter and a save, so the two setters
  cannot drift (section 4 lists why the engine builds that input).
- The classes apply to JS numbers. A non-number (a string, a boolean,
  `null`) is a type error: `EnginePort` types every numeric argument as
  `number`, so the typecheck refuses it before it runs. The binding takes
  plain `f64` parameters, which the WebAssembly boundary converts with
  `ToNumber`, so an untyped caller that passed `"1"` would reach the engine
  as `1`. That is deliberate: a `JsValue` per argument costs a heap slot and
  a call back into JS on every command and pointer-move quote. Untyped
  callers (the dual-run relay, tooling) keep the legacy checked exports,
  which take `JsValue` and refuse a non-number.
- Boundary tests on both engines cover NaN, both infinities, a fraction,
  `2^53` and a negative value for each class, and the camera and clock
  calls the game makes today stay accepted.
- A code outside its table is refused (`UNKNOWN_FACILITY` for a kind,
  `INVALID_REQUEST` otherwise).
- A refusal changes nothing and its delta is `0`.
- The contract is versioned with the layout (`VIEW_LAYOUT_VERSION`, 2 from PR 1a; a native test pins the whole exported layout, records included): a
  record's slots and the code tables are part of it, and a reader built
  against another version refuses to start.

The rules each engine applies are its own existing code: the Rust engine's
gameplay modules and the TypeScript `Simulation`. `TsEngine` adds no rule;
it maps arguments and encodes answers. The conformance lock keeps the two
engines' gameplay equal while the TypeScript engine lives; the Rust engine
stays the one that survives (3.x).

## 4. Where JSON or a string remains

| Path | Form | Why | Frequency |
| --- | --- | --- | --- |
| `viewLayout()` | JSON | static tables, read once | once per boot |
| `serialize()` / `loadSave()` / `restore()` | JSON | the save format | rare |
| `labelUnit`, `nameTower`, `logLine` | string argument | free text | per command, short |
| `eventText(i)` | JSON string | an analytics event's `{ name, payload }` | per gameplay event, rare (a drain's `count` is 0 on almost every step) |
| `scheduleShaft` (inside the engine) | a small JSON value built from the slots | the slots cross as numbers; the engine builds the input `Schedule::coerce` reads, so the schedule's coercion rules stay in one place for this setter and the legacy one | per schedule edit (one value of two 24-hour rows and a few fields, under 1 KB) |
| text getters (`lastReason`, `unitLabel`, `logText`, `towerName`) | string | free text | on demand |
| digests, telemetry, dual-run views | JSON | tooling only, never in a player build's loop | tooling |

Nothing else crosses as JSON. A new exception needs a row here and a
reviewer's OK.

## 5. The view and the shared reader

- `viewStructure()` per tower revision and `viewFrame(full)` per frame are
  copies (`Vec<f64>` to a fresh `Float64Array`), so WASM memory growth never
  invalidates an array the reader holds.
- The reader rebuilds `rooms`, `structure`, `transports` and its cell maps
  only when `towerRevision` moves or `generation()` moves; it patches only
  the dirty rows a frame lists. A `frameSeq` skip, a new engine object, a
  `generation` move (load, new game, undo, redo) or a layout mismatch makes
  it read a full frame and rebuild before the next draw; it never keeps rows
  from an older base. A metadata-only change (`metaRevision`) re-reads the
  labels and subtypes of the ids `unitMetaChanged` lists, nothing else.
- Array identity: `rooms` keeps its identity until a rebuild, as
  `SimView.rooms` promises today.
- No per-frame decoder object or `Set` allocation in steady state: the
  person pool is reused by id with a generation stamp, and car arrays are
  reused. The frame itself is a fresh `Float64Array` each frame (about 8
  doubles a person plus the dirty rooms and cars); its allocation, the copy
  and the GC pressure are counted in each PR's hot-path record and in the
  owner's PC check. If they show up there, the frame moves to a reused
  buffer the engine writes into, with the reader re-taking its view after
  any memory growth.
- Tests: a golden-array test per engine (the same tower encoded by `Engine`
  and by `TsEngine` decodes to the same records), the frame-skip, swap and
  metadata cases above, and the HP record lists the rebuild and patch costs.

## 6. Workers (slice 12)

A worker cannot satisfy a synchronous interface across `postMessage`. If
slice 12 ships, the worker runs an `EnginePort` inside the worker, and the
page talks to it through a separately named async gateway
(`EngineGateway`) with ordered requests and async save, undo and fault
semantics. The gateway is not an `EnginePort` and never blocks the UI.
Slice 12 (#1224) is postponed until that gateway is designed. The guard
that fails on an `await` of a port call covers the direct main-thread
`EnginePort` only.

## 7. Callers

The `SimPort` consumers (slices 2, 3, 4a, 4e-1: about 33 call sites in
seven `src/game/` files, the renderer through `SimView`) move to
`EnginePort` plus the reader in PR 4. `SimPort`, `TsSim` and the command
and query unions are deleted in the same PR, so no second wrapper stays.
Copilot issues #1373 and #1374 are rewritten against this contract before
they resume.

## 8. PRs

1. Rust port members on `Engine`, result records and `lastReason`, with
   native tests; crate minor. It lands in three parts: 1a the commands, the
   quotes and the HUD queries (`wasm_port.rs`, `wasm_port_edit.rs`); 1b the
   lifecycle members, `drainEvents` and `eventText`, `setBackdrop`, the log,
   `unitMetaChanged` and the text getters, and `scheduleShaft`
   (`wasm_port_life.rs`); 1c the panel queries.
2. `EnginePort`, the shared reader, the contract fixture on `Engine`, the
   compile-time check; R2's notes from `3a8e4008` (room-count guard rows,
   the import-walk guard over the port's modules, no per-frame `Set`).
3. `TsEngine` and the contract fixture and golden arrays on it.
4. Callers onto the port; `SimPort` and `TsSim` deleted.
5. Boot behind `?engine=wasm-facade` (tooling builds), the e2e run, then the
   one-tower PC check through the coordinator.
6. Restore points and the sidecar, the cadence exclusions, the fault
   fallback (story ACs 16 to 21 and slice 8), unchanged in substance.

## Migration (story ACs to this contract)

| Story AC | Now |
| --- | --- |
| 1 one adapter, every contract | The contract fixture runs on `Engine` and `TsEngine` (section 3); the old suites' cases move into it, none dropped. |
| 2 no TypeScript `Simulation` | Kept: the import-walk guard covers `enginePort.ts`, `viewReader.ts` and the boot path. |
| 3 commands at issue, one queue | Kept and simpler: synchronous calls run in issue order by construction. |
| 4 the shape check first | Moves into each engine (section 3). |
| 5 the brush as one call | `paintTiles`. |
| 6 `TsSim`'s answers exactly | The result records; delta measured by the engine. |
| 7, 8 the view, rooms and structure | Section 5. |
| 9 the camera | `view` getter plus `setCamera`. |
| 10 panels from the engine | The query records (section 2). |
| 11, 12 lifecycle, EX-2 | `loadSave`, `restore`, `foundTower`, `generation`, `serialize`; EX-2 unchanged. |
| 13 to 15 boot, trap freeze, e2e | PR 5, unchanged in substance. |
| 16 to 20 restore points, sidecar, R5 | PR 6, unchanged; owner: this lane. |
| 21 cadence exclusions | PR 6, unchanged. |
| Slice 8 fault fallback | Unchanged; adopts the TypeScript engine from a restore point. Owner: this lane after PR 6. |
