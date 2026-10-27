# Story 1301: the save codec boundary (Rust authority, TypeScript fallback)

Status: in-progress (slice A, this planning PR: the audit, the boundary
contract, the fallback policy and the PR plan; it changes no code)

Issue #1301 (the owner, 2026-10-22), with the owner's six-slice direction in
its comment of 16:00 UTC that day ("(A) audit ... and define the boundary
contract; (B) introduce the common persistence/codec interface without
changing behavior; (C) complete #1066-aligned Rust boot/import wiring; (D)
integrate remaining .vctower/.TDT save/export/load codec paths; (E) test
WASM-unavailable, trap-after-state-change, offline/PWA and rollback recovery;
(F) update #945 release evidence"). Copilot's PR #1302 for it closed
unmerged; the engine-writer hook it proposed is already on `main` as
`setEngineWriter` and `packVctower` (#935).

Owner: the Runtime thread ("Runtime fallback and engine authority"), which
also owns #1066 and facade slice 5 (#1212, whose first PR is #1294; its
later PRs 5b and 5c sit under the same issue). Relates by reference only,
with no closing keyword: #1066, #945, #1104, the facade tracker #1207 and
its slices 5 (#1212), 7 (#1217), 8 (#1218), 10 (#1222) and 13 (#1225), A7
(#885, #886, #887, #920) under OD-8, B6 (#856, #858), #932, X2's rollback
rehearsal (OD-5) and EX-2. #1301 closes only when its four acceptance items
hold.

## Story

As the developer moving the web game onto Rust authority,
I want every save, load, import and export to reach its codec through one
boundary that uses the Rust codec whenever the WASM engine is healthy and
the TypeScript codec otherwise,
so that 3.0 reads and writes saves by the engine's own rules, no player
loses a save or gets a changed file when the engine fails, and retiring the
TypeScript codec later is a deletion behind one interface.

## The requirements, restated

From the issue and the owner's comment. Nothing in either reads as cut off;
the open points are under "Owner decisions" below.

1. **Authority.** Rust is the long-term authority for simulation and codec
   semantics. The TypeScript codec is maintenance-only during the staged
   rollout: correctness, security, crash and hang, real-save compatibility
   and fallback fixes. No new features, and no unlimited parity work on
   forged-only cases.
2. **A Rust path before 3.0.0.** Save, load, import and export (native
   `.vctower` and the 1994 `.TDT`) have a tested integration path to Rust,
   with representative real and legacy saves, byte and round-trip checks,
   failure and rollback paths and offline behavior. Audit first, and do not
   assume every operation needs new code.
3. **One boundary.** A coherent frontend codec boundary instead of WASM calls
   scattered through the UI. Browser storage may stay TypeScript;
   serialization, validation, conversion and codec semantics move to Rust.
4. **Nothing gets worse.** The approved stage-0 default, the TypeScript
   fallback, trap and crash recovery, offline and PWA use and rollback all
   keep working. A Rust codec failure never strands a player from their
   saves or blocks a safe export or recovery. The story says which
   operations fall back to TypeScript, and when.
5. **Recovery after a trap that follows a change** (the owner's "IMPORTANT").
   The tower has changed, then the engine traps: no save is lost or
   corrupted, and no format drifts without notice.
6. **Scope.** #1292 stays scoped to #887's approved fixes: this story adds no
   forged-only work to it, does not revert its safety guardrails, and is no
   reason to merge it. #1271 and the owner's gates (OD-8 among them) stand.
   No duplication of #1066, #945, #885, #886, #920 or the facade issues:
   link and amend them, sequence small PRs, and track the TypeScript codec's
   retirement as its own post-cutover item.
7. **How the work runs.** Small, meaningful commits; the relevant tests, CI
   and coverage floors run and reported on each PR. Not an instruction to
   merge PRs, change cohorts, turn on telemetry, change timing or change
   release policy. Branch overlap is coordinated with #1292 (the TypeScript
   `.TDT` exporter), #1298 (Rust step work; a crate version only) and #1327
   (B6, `load.rs`); #1266 merged on 2026-10-23.

Two changes to the six-slice outline the owner endorsed, both explained
below: `.TDT` import moves from C to D2, because OD-8 makes A7 its
prerequisite while the founder mark and the read bindings are not gated;
and E splits in two, so the trap-after-change test runs on today's write
paths without waiting for the new reads.

## Audit (acceptance 1)

Read on `main` at `8594e3b1` (2026-10-27) and rechecked at `b7ebe830`; the
cited files did not change between the two.

### Modes

| Mode | How it is chosen | What the codec does today |
| --- | --- | --- |
| TypeScript default | a switchable build with no WASM asked for (stage 0's default); `typescriptBoot()` returns `module: null` (`src/wasmhost/engineBoot.ts:224`) | TypeScript throughout; no package on the page |
| WASM, main thread | `?engine=wasm` or `wasm-frame`, the Settings choice "Rust engine (experimental)", a cohort arm that resolves to WASM (`selectBootEngine`, `src/bootstrap.ts:239`), or the wasm-only build. The package loads before `create()` (`:239-243`, `:297`); `startWasmHost` (`:348`) wraps `adoptSim` (`src/wasmhost/startWasmHost.ts:445-462`); the host replaces `sim.serialize` with the engine's save (`src/wasmhost/wasmHost.ts:185-191`, `:445-449`), and every such save is also a restore point | reads on TypeScript; the engine writer (`encodeVctower`) is set once the host has started without latching (`bootstrap.ts:374-394`), even when the first tower stayed on TypeScript, because the host follows every later adopt |
| Tower not hosted | the host started but refused a tower cleanly (`attach-refused`, not latched; `startWasmHost.ts:400-412`) | that tower's content is TypeScript's; the engine writer stays set and writes its container (the same bytes, #939) |
| Worker | `?engine=wasm-worker`, switchable builds only, measurement only; the module loads inside the worker (`src/wasmhost/engineWorker.ts:30`) | TypeScript containers; the engine writer is never set. The autosave and the export settle first and take the engine's exact save; a synchronous save takes the exact save when the last reply carried one, and otherwise the read model's own save with the engine's minute (`workerHost.ts:453-477`, #1018) |
| Engine fault | a hosted call throws and `FaultLatch` freezes the host. A save answers with the newest restore point (`wasmHost.ts:446-447`, `hostFault.ts:265`); one always loads, since the attach save is kept (`hostFault.ts:260-264`) | `onFallback` turns the writer off (`bootstrap.ts:355-361`, "a trapped module may be corrupt"). Switchable builds recover onto a TypeScript `Simulation` from the newest loadable restore point (`hostFault.ts:244-258`) and never host again (`startWasmHost.ts:386`) |
| Engine fault, wasm-only | the same fault in the wasm-only build | `onFatal` stops the game: `isEngineStopped()` blocks the autosave (`src/game/appBoot.ts:405-409`), the context-loss flush (`saveLoad.ts:224`) and every modal (`uiModal.ts:64`), so the play since the last write is lost and nothing exports |
| Package unavailable | refused, missing, offline without its cache, or timed out (`engineBoot.ts:194`, `:230`, `:240-243`) | a switchable build runs on TypeScript; the wasm-only build throws before `create()` (`bootstrap.ts:280-291`), so storage is never touched |

The wasm-only build is a CI variant today (`.github/workflows/test.yml`,
`e2e-wasm-only`); no deploy ships it. It keeps the TypeScript
`Simulation`, `serialization` and the migrations in its bundle
(`scripts/engine-bundle.allow.txt`).

### The shared pipelines

- **Synchronous write.** `SaveGame.saveTo` (`src/storage/SaveGame.ts:302`)
  clears the asynchronous token for the autosave key, then calls `packSync`
  (`:295`): stamp `savedAt` and `appVersion` (`:488-492`),
  `JSON.stringify`, the 32 MiB check (`encodeSaveJson`,
  `saveCompression.ts:151`), then `packVctower`
  (`src/storage/vctowerWriter.ts:42`), which uses the engine writer when one
  is set and the save is at most 8 MiB, and fflate's level-1 raw deflate
  otherwise. The `.vctower` base64 line becomes the `VCZ1:` store value
  (`payloadLine`), written by `writeSlot` (`SaveGame.ts:426`).
- **Asynchronous write.** `saveToAsync` (`:316`) stamps and encodes the
  same way, then deflates with the browser's `CompressionStream` in
  `deflate-raw` form (`saveCompression.ts:224-228`) under a latest-write
  token (`SaveGame.ts:62`, `:325-329`). It never uses the engine writer
  (`vctowerWriter.ts:15-16`). Without `CompressionStream` it falls back to
  the synchronous write. Both writers store raw deflate under `VCZ1:`.
- **Stored read.** `readSlot` (`SaveGame.ts:76`) inflates a `VCZ1:` value
  with fflate under the cap (`inflateCapped`, `saveCompression.ts:168`),
  decodes UTF-8 with a fatal decoder, or takes a legacy raw-JSON value as is,
  then `parseSaveJson`. Callers then run `Simulation.deserialize`
  (`src/engine/sim/serialization.ts:75`, which migrates at `:77`) and
  `markFounderFromLoadedFile` (`src/engine/sim/founderStatus.ts:32`, the
  rule that a save with no `appVersion` predates 2.0, applied only to file
  and slot loads so an undo snapshot never earns it).
- **Host attach after a load.** `adoptSim` reaches `attachWasmHost`
  (`wasmHost.ts:112`), whose load command re-serializes the TypeScript
  tower (`src/dualrun/mirror.ts:34-39`; the founder flag is in the save,
  `serialization.ts:46`) for `Engine.fromSave` (`src/dualrun/shadow.ts:53`).
  The worker host does the same through `workerCore.ts:74-82`.

### Every operation

| Operation | Entry | Codec work | Rust today (main-thread host) |
| --- | --- | --- | --- |
| Autosave (30 s) | `appBoot.ts:405-409`, `SaveLoad.autosave` (`src/game/saveLoad.ts:144`), `saveAsync` | asynchronous write to `verticopolis-save` | the content (`engine.serialize`, settled first in frame mode, `wasmHost.ts:468-477`); never the container |
| Flushes: "Update now" and "Later", context loss, the flush before a 1994 import is adopted | `updateFlow.ts:77`, `:137`; `saveLoad.ts:189`, `:220`; `legacyImportAdopt.ts:27` | synchronous write | content and container |
| Quick Save | `UI.ts:192`, `saveLoad.ts:113` | synchronous write to the autosave key (Quick Save writes no slot) | content and container |
| Slot save | `appModals.ts:136`, `SaveGame.saveSlot` (`:255`) | synchronous write to `simtower-clone-slot-N` | content and container |
| `.TDT` import's slot copy | `legacyImportAdopt.ts:39-46`, right after the adopt | synchronous write to the first free slot | content and container |
| Slot list | the Saves dialog (`appModals.ts:130`) and the title picker (`appModals.ts:185`), `SaveGame.listSlots` (`:281`), `infoFrom` (`:130`) | a stored read and a full `Simulation.deserialize` per key, for the population | none |
| Load: slot, autosave, title picker | `appModals.ts:156`, `:221`; `SaveGame.load`/`loadSlot` (`:196`, `:265`) | stored read, deserialize, founder mark, then the attach | `Engine.fromSave` of the TypeScript re-serialization |
| Boot | `src/main.ts:194` `loadResult` (`SaveGame.ts:206`), both autosave keys, `preserveUnreadable` (`:244`), else `Simulation.newGame` (`main.ts:201`); runs inside `create()`, before the host starts (`startWasmHost.ts:418`) | stored read, deserialize, founder mark | `Engine.fromSave` at the attach |
| New tower | `saveLoad.ts:442` | `Simulation.newGame`, then the attach | `Engine.fromSave`; `Engine.newGame` is unused |
| `.vctower` export | `uiDialogs.ts:85-88`, `saveLoad.ts:355`, `runExportFlow` (`exportFlow.ts:68`), `SaveGame.export` (`:334`) | stamp, cap, `packVctower` | content and container |
| `.vctower` import | the file pick (`src/ui/uiImport.ts:17`), which sniffs a UTF-16 byte order mark, decodes text and sends a `.TDT` elsewhere (`:37-46`); `saveLoad.ts:390`, `SaveGame.import` (`:353`) | trim, the `VCTOWER\d+` magic (with the "newer version" message), whitespace removed, `atob`, `DecompressionStream` (raw deflate) under the cap, fatal UTF-8, parse, a shape check, deserialize, founder mark | `Engine.fromSave` at the attach; `Engine.fromVctower` is unused |
| `.TDT` export | `saveLoad.ts:366`, `buildTDT` (`src/storage/tdtExport.ts:40`), the report dialog | the TypeScript exporter and report | the content; `exportTdt` is unused |
| `.TDT` import | `saveLoad.ts:407`, `parseTDT` (`tdtParse.ts:57`), deserialize, the report, `adoptConfirmedLegacyImport` (`legacyImportAdopt.ts:15`) | the TypeScript importer and report; no founder mark (the import path never calls the rule, and a converted 1994 save carries no `appVersion`) | `Engine.fromSave` at the attach; `importTdt` is unused |
| Crash report | `crashScreen.ts:95-122`, `buildCrashReportZip` (`src/game/crashReport.ts:108`) | `SaveGame.export` (`:116`), else raw JSON (`:118`) | as the export |
| Undo and redo | `src/game/appHistory.ts:16-20` | in memory, no container | facade slice 5a (#1294); listed for completeness only |

In the TypeScript default, without the package, and after an engine fault
(once the writer is off), every row runs on TypeScript, with the content
taken from the newest restore point until a recovery. There is no
drag-and-drop or file-handler import and no production fixture or scenario
start. `src/storage/towerFileCodec.ts` has no production caller (the WASM
conformance suite keeps it). `SaveLoad.load()` (`saveLoad.ts:338`) and
`UI.promptExport` have no caller in the UI, and neither has `SimPort.save()`
(`src/simport/port.ts:50`) yet: facade slice 5b wires the saves to it.

### The Rust bindings (`engine-rs/src/wasm.rs`)

| Binding | Lines | Production caller |
| --- | --- | --- |
| `Engine.fromSave` | 332-340 | every attach (`shadow.ts:53`, `workerCore.ts:82`) |
| `Engine#serialize` | 356-359 | the host's saves and restore points (`wasmHost.ts:187`, `:203`, `:292`; `workerCore.ts:133`) |
| `encodeVctower` | 1000-1011 | the engine writer (`bootstrap.ts:388-389`, `vctowerWriter.ts:46`); required by the wasm-only build (`engineBoot.ts:250`) |
| `Engine.fromVctower` | 345-354 | none |
| `Engine.newGame` | 300-319 | none |
| `importTdt` | 976-982 | none (the TDT differential test only); refusals are thrown |
| `exportTdt` | 987-990 | none (the same); refusals are thrown |

`load::decode_vctower` (`engine-rs/src/load.rs:40`) and
`encode_simulation_vctower` (`:246`) have no binding. No binding decodes a
`VCZ1:` value, decodes a file without building an `Engine`, checks a save
without keeping an `Engine`, or returns the `.TDT` report's facts
(`tdt/import_report.rs` and `tdt/export_report.rs` hold the counts; "the
player-facing report text is the next phase of the port").

### What already runs on Rust

On the main-thread WASM host the content of every save is the engine's
(`engine.serialize`, re-printed by `JSON.stringify` for storage, EX-2), and
the container of every synchronous write is the engine's writer, pinned to
the TypeScript writer's bytes over every fixture (#939,
`conformanceWasmVctower.integration.test.ts:87-100`). The writer already
falls back to TypeScript and latches itself off on any throw
(`vctowerWriter.ts:49-60`), reported as `writer_latched`. Those paths need
no new Rust code; slice B moves them behind the boundary unchanged.

Reads are a different story. The engine does load every tower through
`Engine.fromSave`, which runs Rust's migrations and validation, but what it
reads is TypeScript's re-serialization of a save TypeScript already
decoded, migrated and loaded. Rust's migrations never see a stored save in
production.

### Gaps

| # | Gap | Where it is closed |
| --- | --- | --- |
| G1 | Every read decodes, migrates and checks on TypeScript; no binding decodes a stored value or a `.vctower` file without an `Engine`, and `decode_vctower` differs from `SaveGame.import` (a `VCTOWER1` prefix only, lenient base64, other error text) | C, D1 |
| G2 | The slot list and the boot read build a TypeScript `Simulation` to check a save, which slice 10's runtime guard forbids on the healthy path | C (`inspectSave`), D1, used by slice 10 |
| G3 | The founder rule runs only on TypeScript, and in Rust only inside `fromVctower` (#1066, first half) | C (the binding), D1 and facade 7 (its use) |
| G4 | `.TDT` import and export never reach `importTdt`/`exportTdt`, which throw their refusals and return no report facts (#1066, second half) | D2, after A7 (OD-8) |
| G5 | A new tower is founded on TypeScript | facade 5c and 7 (#1212, #1217) |
| G6 | The worker host never gets the engine writer | facade 12; the worker is a measurement-only override, held (#1068) and outside 3.0's scope |
| G7 | The asynchronous autosave deflates on `CompressionStream` | kept by design (decision O1) |
| G8 | The engine boots from TypeScript's re-serialization of a loaded save (#1158 A32, AD-8) | facade 7 (#1217) |

### Stays on TypeScript (storage)

`localStorage` reads and writes (no IndexedDB exists), the keys
(`verticopolis-save`, the legacy `simtower-clone-save`, `simtower-clone-slot-1`
to `-3`, `simtower-clone-unreadable`), the legacy-key migration and the
quota retry in `writeSlot` (`SaveGame.ts:431-471`), the unreadable stash,
the asynchronous token, the `VCZ1:` prefix, `CompressionStream`, the slot
metadata the dialogs show, the file pickers (with `uiImport.ts`'s byte
decode and `.TDT` routing) and downloads, and the crash zip.

### Byte pins today

`conformanceWasmVctower.integration.test.ts` (the engine's file equals the
TypeScript writer's; `packSync` equals `VCZ1:` and the payload),
`vctowerWriter.test.ts` (the latch-off and the size skip),
`towerFileCodec.test.ts`, `saveRehydrate.test.ts`, `saveCap.test.ts` and
`conformanceWasmSaves.integration.test.ts:208-219` (the 32 MiB edges),
`saveCompression.test.ts:163` (fflate 0.8.3), `tdtCases.integration.test.ts`
(SHA-256 locks), `conformanceWasmTdt.integration.test.ts` (TypeScript and
Rust `.TDT` bytes) and `elevatorSchedule.integration.test.ts:35` (the
TypeScript save version, 7, which Rust's `SAVE_VERSION` in
`engine-rs/src/sim.rs:32` matches). The asynchronous autosave's bytes are
not pinned; any valid raw deflate decodes.

## The boundary contract (acceptance 3)

The boundary owns the step between bytes and save text: the containers,
the decode, the check before a load and the `.TDT` conversion. The step
between save text and a tower belongs to the engine behind the port
(`Engine.fromSave`, `Engine#serialize`, `SimPort.load` and `save`), so
those bindings stay with the host and the port.

A new `src/storage/codec/` holds the boundary: the interface and the
selection, the TypeScript codec (today's functions moved behind it), and
the Rust codec. Slice B writes the exact types against facade 5c's readers
(5c's acceptance 6 and its D11 already fix their shape: decoded saves,
tried in order). The operations:

| Operation | Takes | Gives | TypeScript today | Rust |
| --- | --- | --- | --- | --- |
| `readStore` | a stored value (`VCZ1:` or legacy raw JSON) | a decoded save, or a refusal | `readSlot` | `decodeSave(text, "store")` (C) |
| `readFile` | `.vctower` text | a decoded save, or a refusal | `SaveGame.import`'s decode | `decodeSave(text, "file")` (C) |
| `inspect` | a decoded save | whether it loads, its population, whether it predates the stamp | `Simulation.deserialize`, the founder rule | `inspectSave` (C) |
| `writeFile` | stamped save JSON | `.vctower` text | `packVctower` | `encodeVctower` (on `main`) |
| `writeStore` | stamped save JSON | a `VCZ1:` value | `packSync` (`writeFile` and `payloadLine`) | through `writeFile` |
| `importLegacy` | `.TDT` bytes and a file name | a save and the report facts, or a refusal | `parseTDT` | `importTdt` returning facts and refusals as data (D2) |
| `exportLegacy` | save JSON | `.TDT` bytes and the report facts, or a refusal | `buildTDT` | `exportTdt` returning facts and refusals as data (D2) |

The asynchronous autosave stays in storage (`SaveGame.saveToAsync`): it
takes the stamped JSON and the cap check from the boundary and deflates on
`CompressionStream` itself (O1).

Rules:

- **C1. One door.** A guard test fails when a non-test file names a codec
  binding (`encodeVctower`, `importTdt`, `exportTdt`, `decodeSave`,
  `inspectSave`, `fromVctower`) outside `src/storage/codec/` and the
  engine's binding plumbing, which it lists by name: `src/dualrun/binding.ts`
  (the required-method check), `src/dualrun/exportTiers.ts`,
  `src/dualrun/engine.d.ts` and `src/wasmhost/engineBoot.ts` (the
  wasm-only build's writer check). Slice B moves the `encodeVctower` read at
  `bootstrap.ts:388-389` into the codec: bootstrap hands the codec the
  module.
- **C2. Selection.** Reads use the Rust codec when the package is loaded on
  the main thread, the read bindings are present, and the codec has not
  latched. The codec gets the module right after the package loads
  (`bootstrap.ts:243`), before `create()` (`:297`), so the boot read can use
  it although the host starts later. Writes keep today's rule exactly
  (slice B changes no behavior): the Rust writer is on once the host has
  started without latching (`bootstrap.ts:374-394`), a tower it refused
  cleanly included, and off after a latched fallback or a host fault
  (`:359-361`). A missing binding (an older package, a test double) means
  TypeScript, with no latch and no report; whether the wasm-only build
  then refuses the package, as it refuses one without `encodeVctower`
  (`engineBoot.ts:250`), is D1's call.
- **C3. A refusal is a value.** Every codec binding returns a refusal as data
  (`{ ok: false, code }`); D2 changes `importTdt` and `exportTdt`, which
  throw today. A JavaScript exception from a binding is a failure.
- **C4. A failure latches.** The first failure turns the Rust codec off for
  the page's life, reads and writes together, and the operation is redone
  on TypeScript in the same call. A failure that is a trap
  (`isEngineTrap`, `hostFault.ts:66`) means the module is suspect, and the
  module is the engine's: while the host is hosting, it faults the host
  under the existing `other` reason ("during a save", `hostFault.ts:38`),
  so the host stops reading from that module and recovers as for any
  trap; at boot, before the host starts, hosting does not start. Reporting
  is the console and the host status; any production field, reason code or
  safety-latch effect is decision O3.
- **C5. TypeScript's acceptance is the floor while both ship.** A save Rust
  refuses is read again on TypeScript. When TypeScript reads it: on today's
  host it loads as it does today (an attach that refuses it keeps that
  tower on TypeScript, today's clean refusal); on the facade it runs on the
  TypeScript fallback as a recorded fallback, which slice 10's
  no-`Simulation` guard must allow (carried to #1222). When TypeScript
  refuses it too, the player sees today's message. The other direction: a
  save Rust reads and TypeScript refuses still fails on today's host, whose
  instance needs TypeScript (today's message), and loads on the facade.
  No save that loads today stops loading (decision O2).
- **C6. Same bytes either way.** For one stamped save the Rust writer and the
  TypeScript writer write the same bytes, pinned per write path over every
  fixture, so a codec fallback never changes a file. The content can differ
  between engines in one known way, which is EX-2's: a transport's key
  order (the canonical JSON is equal, and both engines read both orders).
  So a save written after a fault recovery can list those keys in another
  order than the save before it. That is today's behavior and waits on the
  owner's EX-2 decision; #1301 adds no new difference.
- **C7. Wording stays in TypeScript.** Refusal codes (`not-a-tower-file`,
  `newer-version`, `too-large`, `damaged`, `not-a-save`) map to today's
  messages. `browser-too-old` (no `DecompressionStream`) is the TypeScript
  codec's own, since it describes the browser. The `.TDT` reports keep their
  TypeScript wording over facts from Rust, as facade slice 6c does for
  diagnostics.
- **C8. Storage stays TypeScript** (the list above).
- **C9. Cost.** No codec call runs per frame or per tick. Boot, loads, the
  slot list (up to four keys per opening), imports and exports are one-off
  paths, and each slice's PR carries the hot-path record. A save past 8 MiB
  reads on TypeScript, as the writer already skips the engine past that
  size, because the engine's shared memory grows for good; slice 13 (#1225)
  owns the load's memory peak and may lift the bound.
- **C10. Write order.** A synchronous write of the autosave key, C4's redo
  included, clears the asynchronous token first, as `saveTo` does today. An
  autosave in flight across an engine fault writes the save it took before
  the fault (a valid engine save, also the newest restore point); slice E1
  pins what happens when the recovery cannot load that point.

## The fallback policy per operation (requirement 4)

After slices B to D2. "Rust, else TS" means C4 and C5; "stopped" means the
wasm-only build's stop screen, where nothing reads or writes.

| Operation | TS default | WASM, healthy | Tower not hosted | Rust codec latched | Engine fault, switchable | Engine fault, wasm-only | Package unavailable | Worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Save content | TS | the engine's | TS | the engine's | the newest restore point, then TS after recovery | stopped | TS | the worker's (see Modes) |
| Synchronous writes, export, crash report | TS | Rust, else TS | Rust, else TS | TS | TS | stopped | TS | TS |
| Asynchronous autosave | TS (`CompressionStream`); the synchronous row where the browser lacks it | the same | the same | the same | the same | stopped | the same | the same |
| Boot read, loads, `.vctower` import | TS | Rust, else TS | Rust, else TS | TS | TS | stopped | TS | TS |
| Slot list check | TS | TS on today's host (its loads need TypeScript); Rust, else TS, on the facade | TS | TS | TS | stopped | TS | TS |
| `.TDT` import and export | TS | Rust, else TS (D2) | Rust, else TS | TS | TS | stopped | TS | TS |

- **The TypeScript default keeps the TypeScript codec.** Stage 0's default
  does not load the package, and loading it for the codec alone would change
  the default's cold start and offline behavior. At the 3.0.0 flip the
  default becomes the healthy WASM column.
- **Offline.** An installed game offline with its package cached runs the
  healthy column; without the cached package it runs the "package
  unavailable" column. If #932 moves the `.TDT` codec out of the main
  package, a healthy engine without that module runs `.TDT` on TypeScript.
- **After an engine fault the codec is TypeScript.** The restore point and
  the TypeScript writer keep saving, and an export after a trap writes the
  container the Rust writer would have written (C6).
- **The wasm-only build** stops instead of falling back: nothing is lost
  that was written before the trap, the play since the last write is, and
  nothing exports. It ships to no player today. The retirement issue
  carries the export it needs (policy item 4).
- **The worker override** keeps TypeScript containers until facade slice 12.

## Authority and deprecation policy (acceptance 4, its first half; slice F is the second)

1. **Authority.** `engine-rs/src/load.rs` (migrations, validation, the
   containers, the stamp, the founder rule) and `engine-rs/src/tdt/` are the
   source of truth for save semantics. A disagreement between the codecs is
   fixed in Rust first; the TypeScript codec follows only for the owner's
   maintenance classes.
2. **TypeScript is maintenance-only.** Correctness, security, crash and hang,
   real-save compatibility and fallback fixes. Forged-only shapes the
   TypeScript codec mishandles are recorded where they already are (#1282,
   #887's approved scope) and not pursued further.
3. **No silent format change.** The container magic (`VCTOWER1`, `VCZ1:`),
   the save `version` (7 in both engines, pinned), and the stored bytes'
   number form and key order change only by an owner decision (EX-2 holds
   the difference that exists today), with a test pinning both codecs'
   output, a release that reads the new form shipped before any release
   writes it, and #945's rollback rehearsal. No save-format bump ships in
   the flip release (#945, Rollback).
4. **Deprecation.** The TypeScript codec ships as the fallback through stages
   1 to 3, the 3.0.0 flip and the soak, and is retired with the TypeScript
   engine under `story-engine-retire-typescript.md`'s gates, tracked by its
   own backlog row and issue (#1336). Before it goes: a player build
   without it can still export a player's saves when the package fails (a
   stored `VCZ1:` value re-headers into a `.vctower` file with no decode,
   `towerFileCodec.ts`); every refusal code has Rust coverage; the `.TDT`
   reports take their facts from Rust; a measure of how often C5 rescues a
   save reads zero over the retirement window (its field is part of O3);
   and no save-format change rides along.
5. **Evidence.** Each slice's PR records its tests on #1301. Gate evidence
   comes from the candidate's WASM host (the facade, after slice 10):
   evidence from today's host does not carry across. Slice F posts it on
   #945, and the triage thread, which alone edits #1104, adds it to the live
   matrix.

## Freeze and gates

Every code slice changes the seeded-replay key or the tail's paths
(release plan 4.1 and 4.2): C and D2 change the crate, B and D1 change the
storage codecs inside the nightly's import closure and paths such as
`saveLoad.ts`, `exportFlow.ts` and `bootstrap.ts`. So each lands before
the freeze (OD-3), and the matrix marks them "changes the key". #1301 adds
an acceptance item to 3.0.0 and moves no stage date, threshold or gate. The
schedule risk is D2, which waits on A7 and #932: if it cannot land before
the freeze, the owner's OD-8 route decides (keep #1066 whole, or move its
`.TDT` half into the exception register); this story does not decide it.

## PR slices (acceptance 2)

Each code slice adds its temporary TypeScript to the "What it removes" list
of `story-engine-retire-typescript.md`, and bumps the app version only if a
player can notice the change (minor by default), per CONTRIBUTING.

| Slice | Scope | Depends on | Coordinates with | Review | Version |
| --- | --- | --- | --- | --- | --- |
| A | This story; the backlog rows for #1301 and the TypeScript codec's retirement (#1336); #1066's row and issue pointed at C and D2; comments on #1066, #1222 and #1301 | none | none | `/gds-code-review` (save round trip) | none |
| B | `src/storage/codec/` with the TypeScript codec behind it and no behavior change; `SaveGame`, `saveLoad.ts`, `exportFlow.ts`, `crashReport.ts` and `legacyImportAdopt.ts` call through it; the codec takes the module from bootstrap (C1, C2); the C1 guard. Every byte pin and both test projects unchanged | A | facade 5b (#1212, the same writers; this lane owns both, and the second to land rebases) | `/gds-code-review` and `/bmad-code-review`, hot-path record | none |
| C | Crate: `decodeSave(text, source)`, where `store` keeps `readSlot`'s forms (`VCZ1:` or raw JSON, no trim) and `file` keeps `SaveGame.import`'s (trim, the `VCTOWER` family with the newer-version code, JavaScript whitespace removed), both with `atob`'s rules (optional padding, trailing bits ignored, URL-safe symbols refused, a length of 1 mod 4 refused), raw deflate, the 32 MiB cap, fatal UTF-8 and the shape check; `inspectSave(text)` (loads, population, predates the stamp); an engine founder setter that only stored and `.vctower` loads call, never `fromSave`, the attach, undo, restore points, a new tower or a `.TDT` import (#1066's first half; no caller until D1 and facade 7). A differential test, per source, over the representative saves below, the loader table (`conformance/loader-cases.json`), the cap and Unicode cases (#856, #858), values a browser's `CompressionStream` wrote, and container refusals (bad magic, bad base64, truncated deflate, bad UTF-8, not JSON, the wrong shape): the same decoded save (canonical JSON), the same refusal code, and the same `inspect` answers. Forged save contents stay out, listed as known divergences (#1282). The save version pin stays | B (the refusal codes) | B6 (#1327, `load.rs`); the crate takes the next free version at merge | `/gds-code-review`, hot-path record | crate minor, `engine:compat` |
| D1 | Rust reads on the WASM path through the boundary: boot, quick and slot loads, the title picker, `.vctower` import, and the slot list on the facade only; the founder rule from the read's answer; C2, C4, C5, C9 and C10. Tests on `unitWasm` and `chromium-wasm`: every representative save loads to the same tower through either codec; a forced codec throw, and a forced trap, latch and the load completes on TypeScript; a Rust refusal TypeScript reads still loads; a file both refuse shows today's message; a save past 8 MiB reads on TypeScript | B, C; O3 answered before it merges | facade 5c (#1212, the same readers); slice 10 (#1222) reads boot and the slot list through it | `/gds-code-review` and `/bmad-code-review`, hot-path record | minor if a player can notice it, else none |
| D2 | `.TDT` through Rust (#1066's second half): `importTdt` and `exportTdt` return refusals and the report facts as data, the TypeScript report keeps its wording, C4 and C5 apply, and a `.TDT` import still earns no founder mark | B, C; A7 under OD-8: #885's real-save check, #886, #887 closed by whatever route the owner approves (this story does not ask for #1292's merge), #920; #932's measurement | the A7 lane | `/gds-code-review`, hot-path record | crate minor; app as above |
| E1 | The owner's trap-after-change test on today's write paths, as assertions added to `e2e/wasmFallback.spec.ts`: the tower changes before and after the newest restore point (a build, a day of play, a price), the engine traps, then a Quick Save, the autosave (one of them in flight across the trap), a slot save and an export. Saves written before the trap are unchanged; each new value decodes on both codecs, keeps its container and the save version, has the canonical JSON of the restore point the recovery chose, and loads to that tower (the recovery rewinds at most 30 s of play, slice 8's requirement R6). The same right after a load, when the attach save is the only point | B (or `main` directly) | facade slice 8 (#1218: its forced-trap tests, one offline) | `/gds-code-review` | none |
| E2 | The rest of E: a codec failure and a codec trap through a tooling-build hook; the package refused, or offline without its cache, so every read and write runs on TypeScript and an exported file reads back on the WASM build; an offline cold start with the package cached, where D1's reads run; the rollback, X2's rehearsal (OD-5) flipping the default back to TypeScript and loading saves the WASM build wrote, and the previous release's reader reading them; the `.TDT` cases. Run again on the facade before F | D1 (D2 for `.TDT`) | the Offline lane (#985's helpers); the Release lane (X2) | `/gds-code-review` | none |
| F | Evidence from the candidate's WASM host: a comment on #945 per row (Saves, stating EX-2's status; Rollback; Reliability's writer latch; Deployment's offline start; End to end; Authority), the triage thread's #1104 update, and this policy moved into `docs/` if the owner wants it there. No gate text, timing or stage changes | E2, slice 10 | the triage thread | `/bmad-code-review` | none |

**The representative saves.** `conformance/fixtures/` (v1 towers
`towerone*`, v4 towers `sixseven*`, current towers such as `split-tower*`,
stamped and unstamped), each also as a `VCZ1:` value from both writers, as
a legacy raw-JSON value, and under the legacy autosave key; the loader
table; and for `.TDT`, the lock cases plus #885's local check on the
owner's real saves (results recorded on #885; no real save enters the
repository).

Left to their owners, so #1301 does not duplicate them: a new tower through
the engine (facade 5c and 7), the engine booting from the decoded text
(facade 7, #1158 A32), the facade's boot and slot list (slice 10, on D1's
reads), the worker codec (slice 12, after #1068), the load's memory peak
(slice 13, #1225), undo copies (5a), restore points and recovery (7 and 8),
the stored number form and key order (EX-2, the owner's), the `.TDT`
fidelity checks (A7), and the rollback rehearsal itself (X2).

## Owner decisions

O1 and O2 keep today's behavior, so the slices go ahead on them until the
owner says otherwise. O3 changes what production reports, so D1 can be
written and reviewed before it, but merges only after the owner answers.

- **O1. The asynchronous autosave's container.** Recommended: it stays on
  `CompressionStream`. The `VCZ1:` value never leaves the browser, both
  codecs read any valid raw deflate, and moving it to the Rust writer puts
  a synchronous deflate on the main thread every 30 seconds, against slice
  9's 50 ms save budget on the large tower. The other option routes it
  through `encodeVctower` like the synchronous writes.
- **O2. A Rust refusal while both codecs ship.** Recommended: TypeScript
  reads it again (C5), so no save that loads today stops loading. The other
  option makes Rust's refusal final on the WASM path, which is stricter
  authority and can strand a save TypeScript reads.
- **O3. What a codec failure reports and triggers in production.** Three
  parts, recommended together through the analytics packet: (a) a codec
  trap is an engine trap, reported under the existing `other` reason and
  counted by the sticky safety latch like any engine trap, since the module
  is the engine's; (b) a codec failure that is not a trap latches the
  codec and reports through the existing `writer_latched` field, whose
  meaning widens to "the Rust save codec turned itself off", which changes
  what #945's Reliability row ("no engine-writer latch-off") measures, or
  through a new field instead; (c) a count of C5 rescues, which policy item
  4 needs before the retirement. Until the owner answers, D1 reports to the
  console and the host status only.

## Tasks

- [ ] A: this story, the backlog rows and #1336, #1066's row, comments on
      #1066, #1222 and #1301
- [ ] B: the boundary with no behavior change
- [ ] C: `decodeSave`, `inspectSave`, the founder setter, the differential
      test
- [ ] D1: Rust reads on the WASM path (merges after O3)
- [ ] D2: `.TDT` through Rust, after A7
- [ ] E1: trap after a change on today's write paths
- [ ] E2: codec failure, offline and rollback evidence
- [ ] F: #945 evidence and #1104 through the triage thread

## Review record

- Round 1 (`/gds-code-review` on `cd33fe42`, docs only, three layers: Blind
  Hunter, Edge Case Hunter, Acceptance Auditor; no hot-path layer since no
  code changes). About 45 findings after merging duplicates, all `patch` to
  this story except one dismissed: a fault before any restore point exists
  cannot happen, since the attach save is always a point
  (`hostFault.ts:260-264`), and E1 covers that moment anyway. The fixes:
  C2 split into a read rule that serves the boot read before the host
  starts and a write rule that keeps today's (a tower the host refused
  keeps the engine writer); codec traps fault the host (C4); refusals as
  data for the `.TDT` bindings too (C3); `decodeSave` takes a source and
  `atob`'s rules; the founder setter's callers named; C5's both directions
  and the facade's case; C6 scoped to the container with EX-2's key order
  named; C9's 8 MiB read bound; C10 write order; the C1 allowlist; the
  modes "tower not hosted" and "engine fault, wasm-only"; the worker's
  synchronous saves; the `.TDT` import's slot copy, the title picker's slot
  list and `uiImport.ts`'s decode; Rust's migrations never seeing a stored
  save; the freeze and the replay key; E split so the trap test runs first;
  the representative saves named; evidence from the candidate host; O3
  made the one decision D1 merges after.
