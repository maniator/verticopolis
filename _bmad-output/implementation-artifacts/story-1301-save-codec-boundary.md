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
boundary that uses the Rust codec for what the main-thread WASM host reads
and writes once its package is loaded, and the TypeScript codec otherwise,
with these stated exceptions: the asynchronous autosave's container (O1);
a save past the 8 MiB bounds, read and written on TypeScript (C9 and the
writer's existing skip); the slot list's check on today's host (C5); and
`.TDT` until D2 lands, or where #932 moves its module out of the main
package (Offline). The worker override keeps TypeScript containers until
facade slice 12 (G6),
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
   `.TDT` exporter) and #1327 (B6, `load.rs`); #1266 merged on 2026-10-23
   and #1298 (Rust step work) on 2026-10-27.

Three changes to the six-slice outline the owner endorsed, each explained
below and put on #1301 for the owner to see: C's "Rust boot/import wiring"
splits into C (the bindings), D1 (the reads on today's host) and facade
slice 7 (the engine booting from the bytes it read, which is what finishes
#1066); `.TDT` import moves from C to D2, because OD-8 makes A7 its
prerequisite; and E splits in two, so the trap-after-change test runs on
today's write paths without waiting for the new reads.

## Audit (acceptance 1)

Read on `main` at `8594e3b1` (2026-10-27) and rechecked at `b7ebe830`; the
cited files did not change between the two.

### Modes

| Mode | How it is chosen | What the codec does today |
| --- | --- | --- |
| TypeScript default | a switchable build with no WASM asked for (stage 0's default); `typescriptBoot()` returns `module: null` (`src/wasmhost/engineBoot.ts:224`) | TypeScript throughout; no package on the page |
| WASM, main thread | `?engine=wasm` or `wasm-frame`, the Settings choice "Rust engine (experimental)", a cohort arm that resolves to WASM (`selectBootEngine`, `src/bootstrap.ts:239`), or the wasm-only build. The package loads before `create()` (`:239-243`, `:297`); `startWasmHost` (`:348`) wraps `adoptSim` (`src/wasmhost/startWasmHost.ts:445-462`); the host replaces `sim.serialize` with the engine's save (`src/wasmhost/wasmHost.ts:185-191`, `:445-449`), and every such save is also a restore point | reads on TypeScript; the engine writer (`encodeVctower`) is set once the host has started without latching (`bootstrap.ts:374-394`), even when the first tower stayed on TypeScript, because the host follows every later adopt |
| Tower not hosted | the host started but refused a tower cleanly (`attach-refused`, or `package-mismatch` when the catalog check calls the package foreign; not latched; `startWasmHost.ts:400-412`) | that tower's content is TypeScript's; the engine writer stays set and writes its container (the same bytes, #939) |
| Worker | `?engine=wasm-worker`, switchable builds only, measurement only; the module loads inside the worker (`src/wasmhost/engineWorker.ts:30`) | TypeScript containers; the engine writer is never set. The autosave and the export settle first and take the engine's exact save; a synchronous save takes the exact save when the last reply carried one, and otherwise the read model's own save with the engine's minute (`workerHost.ts:453-477`, #1018) |
| Engine fault | a hosted call throws and `FaultLatch` freezes the host. A save answers with the newest restore point (`wasmHost.ts:446-447`, `hostFault.ts:265`); one always loads, since a merge's save or the attach save is kept (`hostFault.ts:260-264`) | `onFallback` turns the writer off (`bootstrap.ts:355-361`, "a trapped module may be corrupt"). Switchable builds recover onto a TypeScript `Simulation` from the newest loadable restore point (`hostFault.ts:244-258`) and never host again (`startWasmHost.ts:386`) |
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
| G3 | The founder rule runs only on TypeScript, and in Rust only inside `fromVctower` (#1066, first half) | C (the setter), facade 7 (its first caller) |
| G4 | `.TDT` import and export never reach `importTdt`/`exportTdt`, which throw their refusals and return no report facts. The import is #1066's second half; the export is #1301's own (requirement 2), under the same A7 prerequisites | D2, after A7 (OD-8); on today's host TypeScript still loads the import's result before the attach, so #1066 finishes with facade 7 |
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
`conformanceWasmSaves.integration.test.ts:208-232` (the 32 MiB edges),
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
those bindings stay with the host and the port. The stamp (`savedAt`,
`appVersion`) and the 32 MiB write cap stay in TypeScript storage
(`SaveGame`'s `stamp`, `encodeSaveJson`), before the boundary; Rust's
writer checks both again (`load::stamp_save`), and its rules decide what a
stamp may hold.

A new `src/storage/codec/` holds the boundary: the interface and the
selection, the TypeScript codec (today's functions moved behind it), and
the Rust codec. Slice B writes the exact types against facade 5c's readers
(5c's acceptance 6 and its D11 already fix their shape: decoded saves,
tried in order). A decoded save is the exact text the container
held, so a decode in either codec hands the same string to whatever loads
it. The operations:

| Operation | Takes | Gives | TypeScript today | Rust |
| --- | --- | --- | --- | --- |
| `readStore` | a stored `VCZ1:` value (a legacy raw-JSON value is its own text and never reaches a codec) | the decoded text, or a refusal | `readSlot` | `decodeSave(text, "store")` (C) |
| `readFile` | `.vctower` text | the decoded text, or a refusal | `SaveGame.import`'s decode and shape check | `decodeSave(text, "file")` (C) |
| `inspect` | decoded text | whether it loads, its population, whether it predates the stamp | `Simulation.deserialize`, the founder rule | `inspectSave` (C) |
| `writeFile` | stamped save JSON | `.vctower` text | `packVctower` | `encodeVctower` (on `main`) |
| `writeStore` | stamped save JSON | a `VCZ1:` value | `packSync` (`writeFile` and `payloadLine`) | through `writeFile` |
| `importLegacy` | `.TDT` bytes and a file name | a save and the report facts, or a refusal | `parseTDT` | `importTdt` returning facts and refusals as data (D2) |
| `exportLegacy` | save JSON | `.TDT` bytes and the report facts, or a refusal | `buildTDT` | `exportTdt` returning facts and refusals as data (D2) |

The asynchronous autosave stays in storage (`SaveGame.saveToAsync`): it
stamps and caps as today and deflates on `CompressionStream` itself (O1).

**What each source accepts** (slice C pins every case in its differential test, so up to C9's bounds
Rust accepts what TypeScript accepts today and refuses what it refuses, with
the one difference stated below; past the bounds Rust answers `over-bound`
and TypeScript decodes):

- `store`: the `VCZ1:` prefix; base64 by `atob`'s rules (WHATWG
  forgiving-base64: ASCII whitespace anywhere is dropped; when the length
  is a multiple of 4, one or two trailing `=` are dropped; a length of 1 mod
  4 is refused, and so is any other character, so a partial pad such as
  `QQ=` is refused; trailing bits are ignored); raw deflate as fflate reads
  it (bytes after the final block are ignored); the 32 MiB cap (reached
  only on TypeScript, after C9's `over-bound`); fatal UTF-8, with one
  leading byte order mark dropped; the text parses as JSON with the
  lone-surrogate repair both codecs share (`parseSaveJson`,
  `load::parse_save_json`), else `damaged`; no shape check. A store
  refusal shows as today's unreadable save.
- `file`: the text trimmed; the greedy `^VCTOWER(\d+)` match over ASCII
  digits, where any digit run other than exactly `1` is `newer-version`
  (`VCTOWER01` and `VCTOWER0` among them, since the code compares strings,
  `SaveGame.ts:362`) and the newline after the magic is
  optional (so a version-1 file with no newline whose payload starts with a
  digit reads as `newer-version`, as it does today); every JavaScript
  whitespace character dropped from the rest, then `atob`'s rules; raw
  deflate as `DecompressionStream("deflate-raw")` reads it; the cap (on
  TypeScript, as above);
  fatal UTF-8 with one leading byte order mark dropped; the shape check
  (`minutes` a number, `units` an array).
- The one difference: in `file`, Rust refuses data after the final deflate
  block as `damaged`. Browsers' `DecompressionStream` may not agree on such
  data, so where one accepts the file, C5 reads it on TypeScript and the
  player sees today's result in every browser. C pins Rust's refusal; the
  end-to-end projects pin each browser's answer.

Rules:

- **C1. One door.** A guard test scans `src/` and fails when a file outside `src/tests/` and `*.test.ts` names a codec binding (`encodeVctower`,
  `importTdt`, `exportTdt`, `decodeSave`, `inspectSave`, `fromVctower`) as
  code, outside `src/storage/codec/` and the engine's binding plumbing,
  which it lists by name: `src/dualrun/binding.ts` (the required-method
  check), `src/dualrun/exportTiers.ts`, `src/dualrun/engine.d.ts` and
  `src/wasmhost/engineBoot.ts` (the wasm-only build's writer check).
  Comments do not count. Slice B moves the `encodeVctower` read at
  `bootstrap.ts:388-389` into the codec: bootstrap hands the codec the
  module.
- **C2. Selection.** The codec gets the module right after the package
  loads (`bootstrap.ts:243`), before `create()` (`:297`), so the boot read
  can use it although the host starts later. Reads use Rust while the read
  bindings are present, the codec has not latched (C4), and the host has
  not latched or faulted, its start did not throw (`bootstrap.ts:359-361`,
  `:380-384`), and it has not refused a tower as `package-mismatch`
  (`startWasmHost.ts:405`), since that verdict calls the package foreign.
  `importTdt` and `exportTdt` follow the read rule. From D1 on, the writer
  turns off after a `package-mismatch` refusal too: that verdict means a
  shell and an engine from different deploys (`foreignCatalog.ts`), and
  `encodeVctower` parses, stamps and re-prints the whole save
  (`vctowerWriter.ts:32-33`), so another deploy's rules could change the text.
  C6 keeps this invisible to the player: the TypeScript writer writes the
  bytes the matching package would. Writes keep today's rule exactly (slice B changes no
  behavior): the Rust writer is on once the host has started without
  latching (`bootstrap.ts:374-394`), a tower it refused cleanly included,
  and off after a latched fallback or a host fault; from D1 on, a host start
  turns it on only if the codec has not latched and no tower has been
  refused as `package-mismatch` (the first tower is attached inside the
  host start, before bootstrap sets the writer), and a later such refusal
  turns it off for the page's life. A missing binding (an older
  package, a test double) means TypeScript, with no latch and no report;
  whether the wasm-only build then refuses the package, as it refuses one
  without `encodeVctower` (`engineBoot.ts:250`), is D1's call.
- **C3. A refusal is a value.** The new bindings (`decodeSave`,
  `inspectSave`) return refusals as data (`{ ok: false, code }`), and D2
  changes `importTdt` and `exportTdt`, which throw today, the same way.
  `encodeVctower` keeps throwing, which the writer's latch handles as today.
  Slice B's answer type lists every refusal code and `over-bound` (C9), and
  D2 adds the `.TDT` codes. Any other JavaScript exception from a binding,
  and a code the boundary does not list (a skewed package), is a failure.
- **C4. A failure latches.** The first failure turns the Rust codec off for
  the page's life, reads and writes together, and the operation is redone on
  TypeScript in the same call. That extends today's writer latch to the
  reads, and it is all a failure does until the owner answers O3. Whether a
  failure that is a trap (`isEngineTrap`, `hostFault.ts:66`) also ends
  hosting, since the module is the engine's, and what any failure reports in
  production, is O3; its effects are listed there. On the facade, the
  TypeScript redo after a latch, including every later `inspect` at boot
  and in the slot list while the host stays healthy, is a recorded case
  slice 10's no-`Simulation` guard allows (carried below).
- **C5. TypeScript's acceptance is the floor while both ship.**
  - A save Rust refuses is read again on TypeScript. On today's host, a Rust
    answer TypeScript then cannot load (a decoded save, a `.TDT`
    conversion) counts as a Rust refusal too: the whole operation is redone
    on TypeScript. When TypeScript reads it, it loads as today (an attach
    that refuses it keeps that tower on TypeScript, today's clean refusal);
    on the facade it runs on the TypeScript fallback as a recorded
    fallback, which slice 10's no-`Simulation` guard must allow. When
    TypeScript refuses it too, the player sees today's message. No save
    that loads today stops loading (O2).
  - Content Rust reads and TypeScript's load refuses fails on today's host
    with today's message, since its instance needs TypeScript. A container
    only Rust decodes (a browser without `DecompressionStream`, where
    TypeScript says `browser-too-old`) does load on today's host after D1,
    since the instance needs only the decoded text: a change a player can
    notice, which D1 records and versions. On the facade such content
    loads on Rust (O2): such a save does not load at all today, and on the
    facade it has no TypeScript fallback, so an engine fault leaves that
    tower stopped (`startWasmHost.ts:323-326`, slice 8's "no point loads")
    and a rollback to the TypeScript default cannot open it. These are the
    forged shapes of #1282; real saves load in both codecs, which C's
    differential shows over the representative saves.
  - The same holds for `.TDT` exports: a tower Rust refuses to export is
    exported by TypeScript as today.
  - On today's host the slot list keeps TypeScript's check, since its loads
    still need TypeScript; on the facade it is Rust's, wired by slice 10.
- **C6. Same bytes either way.** For one stamped save the Rust writer and the
  TypeScript writer write the same `.vctower` and `VCZ1:` bytes, pinned over
  every fixture through `packSync`, which every synchronous write path
  shares (today's conformance pins, which slice B keeps), so a codec fallback never changes a file.
  `.TDT` bytes are pinned by the TDT lock and differential (A7's scope). The
  content can differ between engines in one known way, EX-2's: a
  transport's key order (the canonical JSON is equal, and both engines read
  both orders). So a save written after a fault recovery can list those keys
  in another order than the save before it. That is today's behavior and
  waits on the owner's EX-2 decision; #1301 adds no new difference.
- **C7. Wording stays in TypeScript.** Refusal codes (`not-a-tower-file`,
  `newer-version`, `too-large`, `damaged`, `not-a-save`) map to today's
  messages. `browser-too-old` (no `DecompressionStream`) is the TypeScript
  codec's own, since it describes the browser. The `.TDT` reports keep their
  TypeScript wording over facts from Rust, as facade slice 6c does for
  diagnostics.
- **C8. Storage stays TypeScript** (the list above).
- **C9. Cost.** No codec call runs per frame or per tick. Boot, loads, the
  slot list (up to five keys per read: both autosave keys and three slots,
  read again when the title picker renders), imports and exports are one-off
  paths, and each slice's PR carries the hot-path record. The engine's
  shared memory grows for good, and a binding copies its argument into it
  before Rust checks anything, so every Rust codec call is bounded twice.
  Before the call, TypeScript checks the input's size, as the writer does
  today (`vctowerWriter.ts:44`): a stored value or `.vctower` text longer
  than an 8 MiB save can occupy (about 11 MiB of base64), `.TDT` bytes past
  the importer's 4 MiB limit (`TDT_MAX_FILE_BYTES`, `tdt/format.rs`), and
  save JSON past 8 MiB for `exportTdt` or decoded text past 8 MiB for
  `inspectSave` are never sent to Rust. Inside the
  call, the decode inflates at most 8 MiB, the writer's existing bound.
  Either way the boundary answers `over-bound`, which is neither a refusal
  nor a failure and latches nothing, and the TypeScript codec runs that
  operation as today (for a decode, a container step that builds no
  `Simulation`; for `inspect`, the TypeScript check, which does build one,
  so slice 10 allows it in the facade's boot read and slot list, as carried below). The bounds cover the codec only: a load parses the whole
  save in the engine anyway. Slice 13 (#1225) owns the load's memory peak
  and may lift them.
- **C10. Write order.** A synchronous write of the autosave key, C4's redo
  included, clears the asynchronous token first, as `saveTo` does today (slice B keeps
  this). In a switchable build, an autosave in flight across an engine
  fault commits only when the save it took is the point TypeScript loaded
  after the fault: the point the faulted host's saves answer with
  (`hostFault.ts:270-276`), whether the recovery's walk chose it or a save
  asked of the faulted host did first (`newestSave` loads it
  through `restore`, `hostFault.ts:238-267`, and the recovery starts from
  it). An undo's or a redo's snapshot that traps and answers with the
  autosave's own point counts, since TypeScript loaded that point. In
  every other case the token is cleared and that save never commits: the
  recovery skipped the point as one TypeScript cannot load, a newer point
  (a merge's, a pulled tick's, or another save's, such as an undo
  capture's) replaced it during the deflate, no point
  loads, or a load, undo or redo replaced the tower before any save
  answered with a point, so none was loaded. The comparison is by the save
  itself (its text, or a count that `note` and `noteMerge` advance and the
  autosave's save records): `answered` carries only the point's kind and
  how many were skipped, and two `latest` points look alike there. The key then keeps its last committed save
  until the recovered tower's next autosave, which in the newer-point case
  can be up to one autosave interval older than what commits today; that
  is the price of never committing a save TypeScript has not loaded. A
  synchronous write right after the recovery is no substitute, since the
  recovered tower can be older than the last committed save. The verdict
  comes before the commit: the recovery runs in a microtask after the
  fault (`startWasmHost.ts:241-247`), and an autosave whose deflate
  finishes first waits for it. Today the in-flight autosave always
  commits, so E1 makes this change. In the wasm-only build,
  which has no recovery, it commits its pre-fault save as today.

## The fallback policy per operation (requirement 4)

After slices B to E1, before any O3 change. "Rust, else TS" means C4 and
C5, within C9's bounds; "Package unavailable" is the switchable builds'
column, since the wasm-only build does not start without its package; "stopped" means the wasm-only build's stop screen, where nothing new is
read or written (an autosave already in flight commits, C10).

| Operation | TS default | WASM, healthy | Tower not hosted | Rust codec latched | Engine fault, switchable | Engine fault, wasm-only | Package unavailable | Worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Save content | TS | the engine's | TS | the engine's | the newest restore point, then TS after recovery | stopped | TS | the worker's (see Modes) |
| Synchronous writes, export, crash report | TS | Rust, else TS | Rust, else TS; TS after a `package-mismatch` refusal (C2) | TS | TS | stopped | TS | TS |
| Asynchronous autosave | TS (`CompressionStream`); the synchronous row where the browser lacks it | the same | the same | the same | the same; one in flight commits only if it holds the point TypeScript loaded after the fault (C10) | stopped | the same | the same |
| Boot read, slot and autosave loads, `.vctower` import | TS | Rust, else TS | Rust, else TS; TS after a `package-mismatch` refusal (C2) | TS | TS | stopped | TS | TS |
| Slot list check | TS | TS on today's host; Rust, else TS, on the facade | TS | TS | TS | stopped | TS | TS |
| `.TDT` import and export | TS | Rust, else TS (D2) | Rust, else TS; TS after a `package-mismatch` refusal (C2) | TS | TS | stopped | TS | TS |

- **The TypeScript default keeps the TypeScript codec.** Stage 0's default
  does not load the package, and loading it for the codec alone would change
  the default's cold start and offline behavior. At the 3.0.0 flip the
  default becomes the healthy WASM column.
- **Offline.** An installed game offline with its package cached runs the
  healthy column; without the cached package it runs the "package
  unavailable" column. If #932 moves the `.TDT` codec out of the main
  package, a healthy engine without that module runs `.TDT` on TypeScript.
- **After an engine fault the codec is TypeScript** (C2). The restore point
  and the TypeScript writer keep saving, and an export after a trap writes
  the container the Rust writer would have written (C6).
- **The wasm-only build** stops instead of falling back: what was written
  before the trap survives, the play since the last write is lost, and
  nothing exports. It ships to no player today; #1336 carries the export it
  needs (policy item 4).
- **The worker override** keeps TypeScript containers until facade slice 12.

## Authority and deprecation policy (acceptance 4, its first half; slice F is the second)

1. **Authority.** `engine-rs/src/load.rs` (migrations, validation, the
   containers, the stamp's rules, the founder rule) and `engine-rs/src/tdt/`
   are the source of truth for save semantics. A disagreement between the
   codecs is fixed in Rust first; the TypeScript codec follows only for the
   owner's maintenance classes.
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
   own backlog row and issue (#1336). Before it goes:
   - a player build without it can still export a player's saves when the
     package fails (a stored `VCZ1:` value re-headers into a `.vctower` file with no decode in `toTowerFile`'s preserve mode, `towerFileCodec.ts`, whose default mode checks the value through the TypeScript inflate; a value the browser's
     `CompressionStream` wrote is valid there but not byte-pinned, and a
     legacy raw-JSON value needs a deflate first);
   - every C9 bound (the decode, `inspect`, the write and `exportTdt`)
     is lifted, or the saves past them
     have another Rust path, since without the TypeScript codec a larger
     save has no writer, reader, check or `.TDT` export;
   - every refusal code has Rust coverage;
   - the `.TDT` reports take their facts from Rust;
   - a measure of how often C5 rescues a save reads zero over the
     retirement window (its field is part of O3);
   - no save-format change rides along.
5. **Evidence.** Each slice's PR records its tests on #1301. Gate evidence
   comes from the candidate's WASM host (the facade, after slice 10):
   evidence from today's host does not carry across. Slice F posts it on
   #945, and the triage thread, which alone edits #1104, adds it to the live
   matrix.

## Freeze and gates

Every code slice changes the seeded-replay key or the tail's paths
(release plan 4.1 and 4.2): C and D2 change the crate, B and D1 change the storage codecs inside the
nightly's import closure and paths such as `saveLoad.ts`, `exportFlow.ts`
and `bootstrap.ts`, and E1 changes the fault path's write order (C10). So
B, C, D1, D2 and E1 each land before the freeze (OD-3). Slice A asks the
triage thread to list them in #1104's "Changes the key" column now, since
Phase C ends when none of that work is open; E2 and F add tests and
evidence only. #1301 adds
an acceptance item to 3.0.0 and moves no stage date, threshold or gate.
Two schedule risks, both the owner's to settle if they come due: D2 waits
on A7 and #932 (if it cannot land before the freeze, the owner's OD-8 route
decides: keep #1066 whole, or move its `.TDT` half into the exception
register; on that route D2 and the `.TDT` cases of E2 and F move with
#1066's `.TDT` half, this story proposes the `.TDT` export goes the same
way as the import, and #1301 closes on the rest with that exception
named), and D1 merges only after O3 (if O3 is still open as the freeze
nears, D1 comes to the owner as a schedule question). This story decides
neither.

## PR slices (acceptance 2)

Each code slice adds its temporary TypeScript to the "What it removes" list
of `story-engine-retire-typescript.md`, and bumps the app version only if a
player can notice the change (minor by default), per CONTRIBUTING. #1301
closes when slices B to F have landed and its four acceptance items hold.

| Slice | Scope | Depends on | Coordinates with | Review | Version |
| --- | --- | --- | --- | --- | --- |
| A | This story; the backlog rows for #1301 and the TypeScript codec's retirement (#1336); #1066's row and issue pointed at C, D2 and facade 7; comments on #1066, #1217, #1218, #1222 and #1301; a message asking the triage thread to list #1301 in #1104 as a 3.0.0 acceptance item, with B, C, D1, D2 and E1 as "Changes the key" | none | the triage thread | `/gds-code-review` (save round trip) | none |
| B | `src/storage/codec/` with the TypeScript codec behind it and no behavior change; `SaveGame`, `saveLoad.ts`, `exportFlow.ts`, `crashReport.ts` and `legacyImportAdopt.ts` call through it; the codec takes the module from bootstrap (C1, C2); the answer type with every refusal code and `over-bound` (C3); C10's first sentence kept; the C1 guard. Every byte pin and both test projects unchanged | A | facade 5b and 5c (#1212: 5b's writers, and 5c's readers `readAuto`, `readSlotSave`, `import` and `SaveGame.readLegacy`; this lane owns all three, and the second to land rebases) | `/gds-code-review` and `/bmad-code-review`, hot-path record | none |
| C | Crate: `decodeSave(text, source)` with each source's rules above, and the `over-bound` answer (C9); `inspectSave(text)` (loads, population, predates the stamp); an engine founder setter, or a founder flag on the boot call, that runs before the first restore point and any save, which only stored and `.vctower` loads use, never the attach, undo, restore points, a new tower or a `.TDT` import (#1066's first half; no caller until facade 7). A differential test, per source, over the representative saves below as `VCZ1:` values and `.vctower` texts, the loader table (`conformance/loader-cases.json`), the cap and lone-surrogate cases (`conformanceWasmSaves.integration.test.ts:164-232`), values a browser's `CompressionStream` wrote, each listed acceptance case (whitespace inside, `QQ=`, a byte order mark, no newline after the magic, a digit-led payload, `VCTOWER01`, a 30-digit version, data after the final block) and container refusals (bad magic, bad base64, truncated deflate, bad UTF-8, not JSON, the wrong shape): the same decoded text, string for string, the same refusal code, and the same `inspect` answers, except the one stated difference (data after the final block in `file`). Forged save contents stay out, listed as known divergences (#1282). A test that a decode stops at 8 MiB inflated and answers `over-bound`; for the cap cases Rust answers `over-bound` and TypeScript's answer stands. The save version pin stays | B (the refusal codes) | B6 (#1327, `load.rs`); facade 7 (#1217, the setter's first caller, see its carry); the crate takes the next free version at merge | `/gds-code-review`, hot-path record | crate minor, `engine:compat` |
| D1 | Rust reads on today's WASM host through the boundary: boot, slot and autosave loads, the title picker's loads, `.vctower` import; the founder rule stays `markFounderFromLoadedFile` on the TypeScript instance that loads the decoded text (the engine's setter waits for facade 7); C2, C4, C5, and C9 with its input bounds; a tooling-build hook that forces a codec failure or a codec trap, which E2 reuses. `inspect` through the boundary, for slice 10 to wire into the slot list. Tests on `unitWasm` and `chromium-wasm`: every representative save loads to the same tower through either codec, as a legacy raw-JSON value and under the legacy autosave key too; a container only Rust decodes loads (C5); a forced codec throw, and a forced trap, latch the codec and the load completes on TypeScript; a Rust refusal TypeScript reads still loads; a Rust answer TypeScript cannot load is redone on TypeScript; a file both refuse shows today's message; an over-bound save, or input past C9's bounds, reads on TypeScript; after a codec latch at boot, the host start leaves the writer off; after a `package-mismatch` refusal of the first tower at host start, reads run on TypeScript and the engine writer is never called (a spy, since C6 makes the bytes equal either way); and, if O3 changes the trap path, a writer trap too | B, C; O3 answered before it merges | facade 5c (#1212, the same readers) | `/gds-code-review` and `/bmad-code-review`, hot-path record | minor if a player can notice it (C5's container case), else none |
| D2 | `.TDT` through Rust, the import (#1066's second half) and the export (#1301's own): `importTdt` and `exportTdt` return refusals and the report facts as data, behind C9's input bounds, the TypeScript report keeps its wording, C4 and C5 apply (a conversion TypeScript cannot load is redone on TypeScript), and a `.TDT` import still earns no founder mark | B, C; A7 under OD-8: #885 whole (the fuzzer, its round-trip properties, the nightly and the real-save check), #886, #887 closed by whatever route the owner approves (this story does not ask for #1292's merge), #920; #932's measurement | the A7 lane | `/gds-code-review`, hot-path record | crate minor; app as above |
| E1 | The owner's trap-after-change test on today's write paths, as assertions added to `e2e/wasmFallback.spec.ts`, and C10's fault rule. The tower changes before and after the newest restore point (a build, a day of play, a price), the engine traps, then a Quick Save, the autosave (one of them in flight across the trap), a slot save, a `.vctower` export, a `.TDT` export, and "Update now" with the reload's boot read. Saves written before the trap are unchanged; the in-flight autosave commits only when it holds the point TypeScript loaded after the fault (C10), tested when it does (the recovery's walk, and a trap in an undo's own snapshot that answers with the autosave's point), after a skipped point, with a merge between the autosave's save and the trap, with an undo capture's save (another `latest` point) between them, and with a load replacing the tower before any save answered; each later value but the `.TDT` export reads with today's reader, keeps its container and the save version, loads in the engine (`Engine.fromSave`), and loads to the tower the player sees at that moment, which the recovery rewound to the newest point TypeScript loads. The `.TDT` export equals what `buildTDT` writes for that tower and reads back through `parseTDT` with only the losses its report lists. The same right after a load, when the attach save is the only point | B (or `main` directly) | facade slice 8 (#1218: its forced-trap tests, one offline); runs again on the facade before F | `/gds-code-review` | none |
| E2 | The rest of E: a codec failure and a codec trap through D1's tooling-build hook; the package refused, or offline without its cache, so every read and write runs on TypeScript and an exported file reads back on the WASM build; an offline cold start with the package cached, where D1's reads run; persistence assertions inside X2's rollback rehearsal (OD-5: saves the WASM build wrote load on the TypeScript default) and the previous release's reader reading them; Rust-decoded stored values; the `.TDT` cases. Run again on the facade before F, with the C5 cases a facade adds (a save only Rust reads, and its fault) | D1 (D2 for `.TDT`); X2's rehearsal for the rollback assertions | the Offline lane (#985's helpers); the Release lane (X2, which runs the rehearsal) | `/gds-code-review` | none |
| F | Evidence from the candidate's WASM host: a comment on #945 per row (Saves, stating EX-2's status; Rollback; Reliability's writer latch; Deployment's offline start; End to end; Authority), the triage thread's #1104 update, and this policy moved into `docs/` if the owner wants it there. No gate text, timing or stage changes. On OD-8's exception-register route, the `.TDT` evidence is replaced by that exception | E1 and E2 run again on the facade; slices 8 and 10 | the triage thread | `/bmad-code-review` | none |

**The representative saves.** `conformance/fixtures/`: the version-1
towers `towerone*` and the version-4 towers `sixseven*`, which carry no
stamp, and the current towers `split-tower*`, which do; each also as a
`VCZ1:` value from both writers (C's differential), and as a legacy
raw-JSON value and under the legacy autosave key (D1's load tests, since
storage handles both before any codec); the loader table; and for `.TDT`, the lock cases plus
#885's local check on the owner's real saves (results recorded on #885; no
real save enters the repository).

**Carried to slice 10 (#1222)**, in the comment there: the C5 fallbacks
(a save only TypeScript reads runs on the TypeScript fallback) as a
recorded case its no-`Simulation` guard allows; the slot list's check
wired to `inspect`; C9's oversized `inspect` (decoded text past 8 MiB),
which runs the TypeScript check at boot and in the slot list, as a second
recorded case the guard allows; the TypeScript redo and checks after a
codec latch while the host stays healthy (C4), a third; and, since slice 10 moves the `Simulation` module into
a lazy chunk, that the TypeScript redo of C4 and C5 can reach it: preloaded
before any synchronous caller can need it (the boot read inside
`create()`, `listSlots`, `loadSlot`), or with those paths made
asynchronous by slice 10, and precached for offline play.

**Carried to slice 7 (#1217)**, in a comment there: RustSim's stored and
`.vctower` loads apply the founder rule through C's setter, before the
first restore point and any save, and never for the attach, undo, restore
points, a new tower or a `.TDT` import (which boots from D2's output with
no founder mark). So slice 7's stored and `.vctower` loads depend on C
(`decodeSave` and the setter): `Engine.fromVctower` is no substitute,
since a legacy raw-JSON value has no container to re-header and its
decoder is not C's. If the rest of slice 7 is ready first, those loads
wait for C.

**Carried to slice 8 (#1218)**, in a comment there: the facade's recovery
keeps C10's rule for an autosave in flight across a fault, so E1's run on
the facade holds.

Left to their owners, so #1301 does not duplicate them: a new tower through
the engine (facade 5c and 7), the engine booting from the decoded text
(facade 7, #1158 A32), the facade's boot and slot list (slice 10, on D1's
reads), the worker codec (slice 12, after #1068), the load's memory peak
(slice 13, #1225), undo copies (5a), restore points and recovery (7 and 8),
the stored number form and key order (EX-2, the owner's), the `.TDT`
fidelity checks (A7), and the rollback rehearsal itself (X2).

## Owner decisions

O1 and O2 keep today's behavior, so the slices go ahead on them until the
owner says otherwise. O3 changes what production does and reports, so D1
can be written and reviewed before it, but merges only after the owner
answers.

- **O1. The asynchronous autosave's container.** Recommended: it stays on
  `CompressionStream`. The `VCZ1:` value never leaves the browser today,
  both codecs read any valid raw deflate, and moving it to the Rust writer
  puts a synchronous deflate on the main thread every 30 seconds, against
  slice 9's 50 ms save budget on the large tower. The other option routes it
  through `encodeVctower` like the synchronous writes.
- **O2. Acceptance while both codecs ship.** Recommended, as C5: a save Rust
  refuses is read again on TypeScript, so no save that loads today stops
  loading (Rust's stricter refusals then protect nothing until the
  retirement, and the TypeScript codec's known issues on forged shapes stay
  as today, #1282); and on the facade a save only Rust reads loads, without
  a TypeScript fallback or rollback for that tower. The other options make
  Rust's refusal final on the WASM path (stricter, and it can strand a save
  TypeScript reads), or refuse on the facade a save TypeScript refuses
  (which needs a TypeScript load on the healthy path that slice 10's guard
  forbids).
- **O3. What a codec failure does and reports in production.** Until the
  owner answers, a failure latches the codec and is reported to the console
  and the host status only (C4). Recommended, through the analytics packet:
  - (a) a codec trap also ends hosting, since the module is the engine's.
    While hosting, the handle latches as for any trap: `onFallback` with
    `latched` true (`bootstrap.ts:359-368`) turns the writer off, calls
    `rustFailed` and so the sticky safety latch (`noteRustFailed`,
    `src/engineCohort/boot.ts:115-134`), stops the engine label, sends an
    `engine_status` fallback row with reason `other`, and recovers with a
    rewind to the newest loadable point; the stop-screen and console text
    name a load where the trap was in one. With the host started but the
    tower not hosted, the same latch, so the next adopt does not attach on
    the suspect module. At boot, before the host starts, hosting does not
    start: a boot failure (stage `start`, reason `boot-error`) in the boot
    state and its settle row, `rustFailed("start", ...)` so later boots
    stay on TypeScript as after any start failure (`bootstrap.ts:380-384`),
    and in the wasm-only build the stop screen (`stopForEngine("start")`).
    The cost to weigh: a codec call on a path that takes no save first (the
    slot list, a `.TDT` parse whose report the player cancels, a load both
    codecs refuse) can trap with the live tower hosted, and the recovery
    then rewinds it to the newest restore point, losing up to R6's 30
    seconds of play and possibly the undo trail. A trap inside a write
    loses nothing, since that save was just taken as a point. In the
    wasm-only build a trap that repeats on the stored autosave stops every
    boot, as a repeating `Engine.fromSave` trap does today; that build
    ships to no player. If the owner declines, a trap latches the
    codec only, as a writer trap does today.
  - (b) a codec failure that is not a trap reports through the existing
    `writer_latched` field, whose meaning widens to "the Rust save codec
    turned itself off" (a read latch turns the writer off too, so the field
    stays true to what #945's Reliability row, "no engine-writer latch-off",
    reads), or through a new field.
  - (c) a count of C5 rescues, which policy item 4 needs before the
    retirement.

## Tasks

- [ ] A: this story, the backlog rows and #1336, #1066's row, comments on
      #1066, #1222 (the slice 10 carries above) and #1301 (the three
      outline changes and O1 to O3), #1217 and #1218 (the carries above),
      and the triage thread asked to list the slices in #1104
- [ ] B: the boundary with no behavior change
- [ ] C: `decodeSave`, `inspectSave`, the founder setter, the differential
      test
- [ ] D1: Rust reads on today's WASM host (merges after O3)
- [ ] D2: `.TDT` through Rust, after A7
- [ ] E1: trap after a change on today's write paths, and C10's fault rule
- [ ] E2: codec failure, offline and rollback evidence
- [ ] F: #945 evidence and #1104 through the triage thread

## Review record

- Round 1 (`/gds-code-review` on `cd33fe42`, docs only, three layers: Blind
  Hunter, Edge Case Hunter, Acceptance Auditor; no hot-path layer since no
  code changes). About 45 findings after merging duplicates, all `patch` to
  this story except one dismissed: a fault before any restore point exists
  cannot happen on today's host, since TypeScript loaded the attach save
  and it is always a point (`hostFault.ts:260-264`); E1 covers that moment
  anyway. Fixed at `03807204`: the read rule before the host starts and the
  write rule kept; refusals as data; `decodeSave` per source; the founder
  setter's callers; C5 both ways; C6 scoped to the container; C9 and C10;
  the C1 allowlist; the modes "tower not hosted" and "engine fault,
  wasm-only"; the worker's synchronous saves; the missed call sites; Rust's
  migrations never seeing a stored save; the freeze; E split; the
  representative saves; evidence from the candidate host.
- Round 2 (the same layers on `aa4341fe`; every citation checked and
  correct but one test range). About 40 findings, all `patch`, most where
  round 1 overreached. Fixed: reads also stop after a host fault or a
  latched host (C2); a codec trap no longer faults the host by default (C4),
  since that is O3's call, now listed with its exact effects; a decoded save
  is the original text; legacy raw-JSON values never reach a codec; the
  per-source acceptance rules match `readSlot`, `SaveGame.import` and
  `atob`; C5 redoes on TypeScript a Rust answer TypeScript cannot load, and
  names the facade's forged-shape cost, which O2 now covers both ways; C9
  measures the inflated bytes and answers `over-bound`; C10 states the rule
  (a fault drops the in-flight autosave in a switchable build, which E1
  implements); the founder setter runs before the first point and has no
  caller until facade 7; #885 whole; E1 checks through `Engine.fromSave`
  instead of the decode C adds, and adds the `.TDT` export and the update
  reload; the slice 10 carries; D1's O3 risk in the freeze section; the
  three outline changes; #1336's preconditions; the scope statement's
  exceptions; small citation fixes.
- Round 3 (the same layers on `e7ce0510`, a confirming pass). About 25
  findings after merging duplicates, all `patch` and narrower than round
  2's; every citation spot-checked was correct. Fixed: the exceptions
  listed in full (the write bound, the worker, `.TDT` until D2) with no
  count; Rust codec input bounded in TypeScript before the call, since a
  binding copies its argument into the engine's memory (C9); the
  differential scoped to C9's bounds; one Rust rule for data after the
  final block in `file`, with C5 covering browsers that accept it; the
  store's JSON parse; the magic's digit run compared as a string;
  `over-bound` in slice B's answer type; reads stop after a
  `package-mismatch` refusal; a container only Rust decodes loads on
  today's host (a change D1 versions); the in-flight autosave commits when
  it holds the point the recovery loaded (C10); the `.TDT` export as
  #1301's own, with its own E1 check; D1 keeps the TypeScript founder call
  and owns the forced-trap hook; E1 and E2 run again on the facade before
  F; E1 in the freeze list, and the triage thread asked to list the slices
  in #1104 now; #1301's closure on OD-8's exception-register route; B
  coordinates with 5c's readers; O3(a)'s boot latch and its cost to recent
  play; the slice 10 chunk preloaded for synchronous callers;
  `toTowerFile`'s preserve mode in policy item 4.
- Round 4 (the same layers on `380c39e5`, a confirming pass; every new
  size and citation checked and correct). Nine findings, all `patch`.
  Fixed: C10's rule stated once, with every case that drops the in-flight
  autosave (a skipped point, a newer point, no point, a replaced tower),
  its cost, and the verdict coming before the commit; `inspect` bounded
  in C9; `package-mismatch` named in the modes and the fallback table, the
  `.TDT` bindings following the read rule, and the writer's reason; carries
  to facade slices 7 (the founder setter's caller and the order with C)
  and 8 (C10 in its recovery); E2 depends on X2's rehearsal; one style
  fix.
- Round 5 (the same layers on `aa52c2ff`, a confirming pass). Six
  findings, all `patch`, in round 4's rules and carries. Fixed: C10's
  committed point defined once as the point TypeScript loaded after the
  fault, which settles a trap in an undo's own snapshot; the writer turns
  off after a `package-mismatch` refusal from D1 on, since
  `encodeVctower` re-prints the save; slice 7's loads depend on C with no
  `fromVctower` alternative; slice 10 allows the oversized `inspect`;
  O3(a)'s wasm-only boot cost.
- Round 6 (the same layers on `0ef93e7b`, a confirming pass; C10's cases
  traced against the code and holding). Six findings, all `patch`, all
  narrow. Fixed: C10 compares the save itself, since `answered` cannot
  tell two `latest` points apart, with an undo capture's save as a drop
  case; the table and E1 use C10's definition; a host start leaves the
  writer off after the first tower's `package-mismatch` refusal, tested
  with a spy; the TypeScript redo after a codec latch as a third case
  slice 10's guard allows; every C9 bound in policy item 4; the cap and
  lone-surrogate cases cited to their test.
