# Story 1301: the save codec boundary (Rust authority, TypeScript fallback)

Status: planning (slice A of #1301: the audit, the boundary contract, the
fallback policy and the PR plan; this slice changes no code)

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
also owns #1066 and facade slice 5 (#1212). Relates by reference only, with
no closing keyword: #1066, #945, #1104, the facade tracker #1207 and its
slices 5 (#1212), 7 (#1217), 8 (#1218), 10 (#1222) and 13 (#1225), A7
(#885, #886, #887, #920) under OD-8, B6 (#856, #858), #932 and EX-2. #1301
closes only when its four acceptance items hold.

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
   `.vctower` and the 1994 `.TDT`) have a tested integration path to Rust.
   Audit first, and do not assume every operation needs new code.
3. **One boundary.** A coherent frontend codec boundary instead of WASM calls
   scattered through the UI. Browser storage may stay TypeScript;
   serialization, validation, conversion and codec semantics move to Rust.
4. **Nothing gets worse.** The approved stage-0 default, the TypeScript
   fallback, trap and crash recovery, offline and PWA use and rollback all
   keep working. A Rust codec failure never strands a player from their
   saves or blocks a safe export or recovery. The story says which
   operations fall back to TypeScript, and when.
5. **Recovery after a trap that follows a change.** The tower has changed,
   then the engine traps: no save is lost or corrupted, and no format drifts
   without notice.
6. **Scope.** #1292 stays scoped to #887's approved fixes; this story adds no
   forged-only work to it and is no reason to merge it. #1271 and the owner's
   gates (OD-8 among them) stand: this story adds an acceptance item and
   changes no timing, stage or gate. It duplicates none of #1066, #945, #885,
   #886, #920 or the facade issues; it links and amends them, sequences small
   PRs, and tracks the TypeScript codec's retirement as its own post-cutover
   item.
7. **Not an instruction** to merge PRs, change cohorts, turn on telemetry,
   change timing or change release policy. Branch overlap with open PRs is
   coordinated: #1292 (the TypeScript `.TDT` exporter), #1298 (Rust step
   work; a crate version only) and #1327 (B6, `load.rs`). #1266 merged on
   2026-10-23.

## Audit (acceptance 1)

Read on `main` at `8594e3b1` (2026-10-27) and rechecked at `b7ebe830`; the
cited files did not change between the two.

### Modes

| Mode | How it is chosen | Codec module on the main thread |
| --- | --- | --- |
| TypeScript default | a switchable build with no WASM asked for (stage 0's default); `typescriptBoot()` returns `module: null` (`src/wasmhost/engineBoot.ts:224`) | none |
| WASM, main thread | `?engine=wasm` or `wasm-frame`, the Settings choice "Rust engine (experimental)", a cohort arm that resolves to WASM (`selectBootEngine`, `src/bootstrap.ts:239`), or the wasm-only build. The package loads before `create()` (`src/bootstrap.ts:239-243`, `:297`); `startWasmHost` wraps `adoptSim` (`src/wasmhost/startWasmHost.ts:445-462`); the host replaces `sim.serialize` with the engine's save (`src/wasmhost/wasmHost.ts:185-191`, `:445-449`), and every such save is also a restore point | the engine package; its writer is set at `src/bootstrap.ts:386-394` once the host is hosting |
| Worker | `?engine=wasm-worker`, switchable builds only; the module loads inside the worker (`src/wasmhost/engineWorker.ts:30`) | none, so the engine writer is never set |
| Engine fault | a hosted call throws and `FaultLatch` freezes the host. A save answers with the newest restore point (`wasmHost.ts:446-447`, `hostFault.ts:265`); `onFallback` turns the writer off (`bootstrap.ts:355-361`, "a trapped module may be corrupt"). Switchable builds recover onto a TypeScript `Simulation` from the newest loadable restore point (`hostFault.ts:244-258`) and never host again (`startWasmHost.ts:386`); the wasm-only build stops at `onFatal` | the package, unused |
| Package unavailable | refused, missing, offline without its cache, or timed out (`engineBoot.ts:194`, `:230`, `:240-243`). A switchable build runs on TypeScript; the wasm-only build throws before `create()` (`bootstrap.ts:280-291`), so storage is never touched | none |

The wasm-only build is a CI variant today (`.github/workflows/test.yml`,
`e2e-wasm-only`); no deploy ships it. It keeps the TypeScript
`Simulation`, `serialization` and the migrations in its bundle
(`scripts/engine-bundle.allow.txt`), so every TypeScript codec path below
also ships and runs there.

### The shared pipelines

- **Synchronous write.** `SaveGame.saveTo` (`src/storage/SaveGame.ts:302`)
  calls `packSync` (`:295`): stamp `savedAt` and `appVersion`
  (`:488-492`), `JSON.stringify`, the 32 MiB check (`encodeSaveJson`,
  `saveCompression.ts:151`), then `packVctower`
  (`src/storage/vctowerWriter.ts:42`), which uses the engine writer when one
  is set and the save is at most 8 MiB and fflate's level-1 deflate
  otherwise. The `.vctower` base64 line becomes the `VCZ1:` store value
  (`payloadLine`), written by `writeSlot` (`SaveGame.ts:426`).
- **Asynchronous write.** `saveToAsync` (`:316`) stamps and encodes the
  same way, then deflates with the browser's `CompressionStream`
  (`saveCompression.ts:226`) under a latest-write token (`SaveGame.ts:62`,
  `:325-329`).
  It never uses the engine writer (`vctowerWriter.ts:15-16`). Without
  `CompressionStream` it falls back to the synchronous write.
- **Stored read.** `readSlot` (`SaveGame.ts:76`) inflates a `VCZ1:` value
  with fflate under the cap (`inflateCapped`, `saveCompression.ts:168`),
  decodes UTF-8 with a fatal decoder, or takes a legacy raw-JSON value as is,
  then `parseSaveJson`. Callers then run `Simulation.deserialize`
  (`src/engine/sim/serialization.ts:75`, which migrates at `:77`) and
  `markFounderFromLoadedFile` (`src/engine/sim/founderStatus.ts:32`).
- **Host attach after a load.** `adoptSim` reaches `attachWasmHost`
  (`wasmHost.ts:112`), whose load command re-serializes the TypeScript
  tower (`src/dualrun/mirror.ts:34-39`) for `Engine.fromSave`
  (`src/dualrun/shadow.ts:53`). The worker host does the same through
  `workerCore.ts:74-82`.

### Every operation

| Operation | Entry | Codec work | Rust today |
| --- | --- | --- | --- |
| Autosave (30 s) | `src/game/appBoot.ts:405-409`, `SaveLoad.autosave` (`src/game/saveLoad.ts:144`), `saveAsync` | asynchronous write to `verticopolis-save` | the save content on WASM (`engine.serialize`, settled first in frame mode, `wasmHost.ts:468-477`); never the container |
| Flushes: "Update now" and "Later", context loss, the flush before a 1994 import is adopted | `updateFlow.ts:77`, `:137`; `saveLoad.ts:189`, `:220`; `legacyImportAdopt.ts:27` | synchronous write | content and container (`encodeVctower`) on the main-thread host |
| Quick Save | `UI.ts:192`, `saveLoad.ts:113` | synchronous write to the autosave key (Quick Save writes no slot) | as above |
| Slot save | `appModals.ts:136`, `SaveGame.saveSlot` (`:255`) | synchronous write to `simtower-clone-slot-N` | as above |
| Slot list | `appModals.ts:130`, `SaveGame.listSlots` (`:281`), `infoFrom` (`:130`) | a stored read and a full `Simulation.deserialize` per key, for the population | none |
| Load: slot, autosave, title picker | `appModals.ts:156`, `:221`; `SaveGame.load`/`loadSlot` (`:196`, `:265`) | stored read, deserialize, founder mark, then the attach | `Engine.fromSave` of the TypeScript re-serialization |
| Boot | `src/main.ts:194` `loadResult` (`SaveGame.ts:206`), both autosave keys, `preserveUnreadable` (`:244`), else `Simulation.newGame` (`main.ts:201`); the host attaches later (`startWasmHost.ts:418`) | stored read, deserialize, founder mark | `Engine.fromSave` at the attach |
| New tower | `saveLoad.ts:442` | `Simulation.newGame`, then the attach | `Engine.fromSave`; `Engine.newGame` is unused |
| `.vctower` export | `uiDialogs.ts:85-88`, `saveLoad.ts:355`, `runExportFlow` (`exportFlow.ts:68`), `SaveGame.export` (`:334`) | stamp, cap, `packVctower` | content and container on the main-thread host |
| `.vctower` import | `uiImport.ts:17`, `saveLoad.ts:390`, `SaveGame.import` (`:353`) | the `VCTOWER\d+` magic (with the "newer version" message), strict base64, `DecompressionStream` under the cap, fatal UTF-8, parse, a shape check, deserialize, founder mark | `Engine.fromSave` at the attach; `Engine.fromVctower` is unused |
| `.TDT` export | `saveLoad.ts:366`, `buildTDT` (`src/storage/tdtExport.ts:40`), the report dialog | the TypeScript exporter and report | the save content on WASM; `exportTdt` is unused |
| `.TDT` import | `saveLoad.ts:407`, `parseTDT` (`tdtParse.ts:57`), deserialize, the report, `adoptConfirmedLegacyImport` (`legacyImportAdopt.ts:15`) | the TypeScript importer and report; no founder mark, by design (`saveLoad.ts:414`) | `Engine.fromSave` at the attach; `importTdt` is unused |
| Crash report | `crashScreen.ts:95-122`, `buildCrashReportZip` (`src/game/crashReport.ts:108`) | `SaveGame.export` (`:116`), else raw JSON (`:118`) | as the export |
| Undo and redo | `src/game/appHistory.ts:16-20` | in memory, no container | facade slice 5a (#1294); listed for completeness only |

There is no drag-and-drop or file-handler import, no production fixture or
scenario start, and `src/storage/towerFileCodec.ts` has no production caller
(the WASM conformance suite keeps it). `SaveLoad.load()` (`saveLoad.ts:338`)
and `UI.promptExport` have no caller in the UI.

### The Rust bindings (`engine-rs/src/wasm.rs`)

| Binding | Lines | Production caller |
| --- | --- | --- |
| `Engine.fromSave` | 332-340 | every attach (`shadow.ts:53`, `workerCore.ts:82`) |
| `Engine#serialize` | 356-359 | the host's saves and restore points (`wasmHost.ts:187`, `:203`, `:292`; `workerCore.ts:133`) |
| `encodeVctower` | 1000-1011 | the engine writer (`bootstrap.ts:388-389`, `vctowerWriter.ts:46`); required by the wasm-only build (`engineBoot.ts:250`) |
| `Engine.fromVctower` | 345-354 | none |
| `Engine.newGame` | 300-319 | none |
| `importTdt` | 976-982 | none (the TDT differential test only) |
| `exportTdt` | 987-990 | none (the same) |

`load::decode_vctower` (`engine-rs/src/load.rs:40`) and
`encode_simulation_vctower` (`:246`) have no binding. No binding decodes a
`VCZ1:` value, decodes a file without building an `Engine`, checks a save
without keeping an `Engine`, or returns the `.TDT` report's facts
(`tdt/import_report.rs` and `tdt/export_report.rs` hold the counts; "the
player-facing report text is the next phase of the port").

### What already runs on Rust

On the main-thread WASM host the content of every save is the engine's
(`engine.serialize`, re-printed by `JSON.stringify` for storage, EX-2), the
container of every synchronous write is the engine's writer, pinned to the
TypeScript writer's bytes over every fixture (#939,
`conformanceWasmVctower.integration.test.ts:87-100`), and every load reaches
the engine through `Engine.fromSave`, which migrates and validates in Rust
(`load::migrate_save`, `load::deserialize`). The writer already falls back to
TypeScript and latches itself off on any throw (`vctowerWriter.ts:49-60`),
reported as `writer_latched`. Those paths need no new Rust code; slice B
moves them behind the boundary unchanged.

### Gaps

| # | Gap | Where it is closed |
| --- | --- | --- |
| G1 | Reads decode, migrate and check on TypeScript first in every mode; no binding decodes a stored value or a `.vctower` file without an `Engine`, and `decode_vctower` differs from `SaveGame.import` (a `VCTOWER1` prefix only, lenient base64, other error text) | C, D1 |
| G2 | The slot list and the boot read build a TypeScript `Simulation` to check a save, which slice 10's runtime guard forbids on the healthy path | C (`inspectSave`), D1; slice 10 uses it |
| G3 | The founder mark runs only on TypeScript, and in Rust only inside `fromVctower` (#1066, first half) | C |
| G4 | `.TDT` import and export never reach `importTdt`/`exportTdt`, and those return no report facts (#1066, second half) | D2, after A7 (OD-8) |
| G5 | A new tower is founded on TypeScript | facade 5c and 7 (#1212, #1217) |
| G6 | The worker host never gets the engine writer | facade 12 (the worker adapter; #1068 is on hold) |
| G7 | The asynchronous autosave deflates on `CompressionStream` | kept by design (decision O1) |
| G8 | The engine boots from the TypeScript re-serialization of a loaded save (#1158 A32, AD-8) | facade 7 (#1217) |

### Stays on TypeScript (storage)

`localStorage` reads and writes (no IndexedDB exists), the keys
(`verticopolis-save`, the legacy `simtower-clone-save`, `simtower-clone-slot-1`
to `-3`, `simtower-clone-unreadable`), the legacy-key migration and the
quota retry in `writeSlot` (`SaveGame.ts:431-471`), the unreadable stash,
the asynchronous token, the `VCZ1:` prefix, `CompressionStream`, the slot
metadata the dialogs show, the file pickers and downloads, and the crash zip.

### Byte pins today

`conformanceWasmVctower.integration.test.ts` (the engine's file equals the
TypeScript writer's; `packSync` equals `VCZ1:` and the payload),
`vctowerWriter.test.ts` (the latch-off and the size skip),
`towerFileCodec.test.ts`, `saveRehydrate.test.ts`, `saveCap.test.ts` and
`conformanceWasmSaves.integration.test.ts:208-219` (the 32 MiB edges),
`saveCompression.test.ts:163` (fflate 0.8.3), `tdtCases.integration.test.ts`
(SHA-256 locks) and `conformanceWasmTdt.integration.test.ts` (TypeScript and
Rust `.TDT` bytes). The asynchronous autosave's bytes are not pinned; any
valid deflate decodes.

## The boundary contract (acceptance 3)

A new `src/storage/codec/` holds the boundary: the interface and the
selection, the TypeScript codec (today's functions moved behind it), and the
Rust codec (the only frontend file that calls a codec binding). Slice B
writes the exact types against facade 5c's readers; the operations are:

| Operation | Takes | Gives | TypeScript today | Rust |
| --- | --- | --- | --- | --- |
| `readStore` | a stored value (`VCZ1:` or legacy raw JSON) | a decoded save, or a refusal | `readSlot` | new `decodeSave` (C) |
| `readFile` | `.vctower` text | a decoded save, or a refusal | `SaveGame.import`'s decode | new `decodeSave` (C) |
| `inspect` | a decoded save | whether it loads, its population, whether it predates the stamp | `Simulation.deserialize`, `markFounderFromLoadedFile` | new `inspectSave` (C) |
| `writeFile` | stamped save JSON | `.vctower` text | `packVctower` | `encodeVctower` (on `main`) |
| `importLegacy` | `.TDT` bytes and a file name | a save and the report facts | `parseTDT` | `importTdt` with facts (D2) |
| `exportLegacy` | save JSON | `.TDT` bytes and the report facts | `buildTDT` | `exportTdt` with facts (D2) |

Rules:

- **C1. One door.** A guard test fails when a file outside
  `src/storage/codec/` and the engine loader names a codec binding
  (`encodeVctower`, `importTdt`, `exportTdt`, `decodeSave`, `inspectSave`,
  `fromVctower`).
- **C2. Selection.** The Rust codec runs when the engine package is loaded on
  the main thread, the host is hosting, and the codec has not latched;
  otherwise the TypeScript codec runs. `setEngineWriter` becomes the codec's
  one setter, called where it is today (`bootstrap.ts:386-394`, `:359-361`).
- **C3. A refusal is a value.** The new bindings return a refusal as data
  (`{ ok: false, code }`); a JavaScript exception from a binding is a
  failure.
- **C4. A failure latches.** The first failure turns the Rust codec off for
  the page's life, reads and writes together (a trapped module may be
  corrupt), reports it through the writer's latch path (`writer_latched`,
  decision O3), and redoes the operation on TypeScript in the same call. The
  player sees nothing.
- **C5. TypeScript's acceptance is the floor while both ship.** A save Rust
  refuses is read again on TypeScript; when TypeScript reads it, it loads,
  with a console warning naming Rust's refusal code (no new analytics
  field); when TypeScript refuses it too, the player sees today's message.
  No save that loads today stops loading (decision O2).
- **C6. Same bytes either way.** For one stamped save the Rust writer and the
  TypeScript writer write the same bytes, pinned per write path over every
  fixture, so a fallback never changes a file. Stored and exported bytes
  change only by an owner decision (EX-2's class).
- **C7. Wording stays in TypeScript.** Refusal codes (`not-a-tower-file`,
  `newer-version`, `too-large`, `damaged`, `not-a-save`, `browser-too-old`)
  map to today's messages; `.TDT` reports keep their TypeScript wording over
  facts from Rust, as facade slice 6c does for diagnostics.
- **C8. Storage stays TypeScript** (the list above).
- **C9. Cost.** No codec call runs per frame or per tick. Boot, loads, the
  slot list, imports and exports are one-off paths; each slice's PR carries
  the hot-path record, the 8 MiB writer skip stays, and slice 13 (#1225)
  owns the load's memory peak.

## The fallback policy per operation (requirement 4)

After slices B to D2. "Rust, else TS" means C4 and C5.

| Operation | TS default | WASM, healthy | Rust codec latched | Engine fault (switchable) | Package unavailable or offline | Worker |
| --- | --- | --- | --- | --- | --- | --- |
| Save content | TypeScript | the engine's save | the engine's save | the newest restore point, then TypeScript after recovery | TypeScript | the worker's settled save |
| Synchronous writes, export, crash report | TS | Rust, else TS | TS | TS | TS | TS until slice 12 |
| Asynchronous autosave container | TS | TS (O1) | TS | TS | TS | TS |
| Boot read, loads, slot list, `.vctower` import | TS | Rust, else TS | TS | TS | TS | TS until slice 12 |
| `.TDT` import and export | TS | Rust, else TS, after D2 | TS | TS | TS | TS |

- **The TypeScript default keeps the TypeScript codec.** Stage 0's default
  does not load the package, and loading it for the codec alone would change
  the default's cold start and offline behavior. At the 3.0.0 flip the
  default becomes the healthy WASM column.
- **After an engine fault the codec is TypeScript.** The writer already turns
  off there; the restore point and the TypeScript writer keep saving, and an
  export after a trap writes the bytes the Rust writer would have written
  (C6).
- **The wasm-only build** never falls back: a package that fails stops boot
  before storage is touched, so nothing is lost, but nothing can be exported
  either. It ships to no player today; the retirement issue carries this.

## Authority and deprecation policy (acceptance 4, first half)

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
   the save `version`, and the stored bytes' number form and key order change
   only by an owner decision, with a test pinning both codecs' output, a
   release that reads the new form shipped before any release writes it, and
   #945's rollback rehearsal. No save-format bump ships in the flip release
   (#945, Rollback).
4. **Deprecation.** The TypeScript codec ships as the fallback through stages
   1 to 3, the 3.0.0 flip and the soak, and is retired with the TypeScript
   engine under `story-engine-retire-typescript.md`'s gates, tracked by its
   own backlog row and issue. Before it goes: a player build without it can
   still export a player's saves when the package fails; every refusal code
   has Rust coverage; the `.TDT` reports have their facts from Rust.
5. **Evidence.** Each slice's PR records its tests on #1301; slice F posts
   the summary on #945, and the triage thread, which alone edits #1104, adds
   it to the live matrix's Saves row.

## PR slices (acceptance 2)

| Slice | Scope | Depends on | Coordinates with | Review | Version |
| --- | --- | --- | --- | --- | --- |
| A | This story; the backlog rows for #1301 and the TypeScript codec's retirement (with its issue); comments on #1066, #1222 and #1301 | none | none | `/gds-code-review` (save round trip), proportional | none |
| B | `src/storage/codec/` with the TypeScript codec behind it and no behavior change; `SaveGame`, `saveLoad.ts`, `exportFlow.ts` and `crashReport.ts` call through it; `setEngineWriter` becomes the codec's setter; the C1 guard. Every byte pin and both test projects unchanged | A | facade 5b (#1212, same writers; this lane owns both, the second to land rebases) | `/gds-code-review` + `/bmad-code-review`, hot-path record | none |
| C | Crate: `decodeSave(text)` for `VCZ1:` values, legacy raw JSON and the `VCTOWER` family (refusal codes, strict base64, a leading byte order mark, fatal UTF-8, the 32 MiB cap); `inspectSave(text)` (loads, population, founder); the engine's founder mark at load (#1066's first half). A differential test over every fixture, the loader table, the cap and Unicode cases and crafted refusals: the same decoded save (canonical JSON) and the same refusal code on both codecs | none | B6 (#1327, `load.rs`); the crate takes the next free version at merge (#1298 and others) | `/gds-code-review`, hot-path record | crate minor, `engine:compat` |
| D1 | Rust reads on the WASM path through the boundary: boot, quick and slot loads, the title picker, the slot list, `.vctower` import, with C4 and C5 and the engine's founder mark. Tests on `unitWasm` and `chromium-wasm`: every fixture loads to the same tower through either codec; a forced codec throw latches and the load completes on TypeScript; a Rust refusal TypeScript reads still loads; a file both refuse shows today's message | B, C | facade 5c (#1212, the same readers); slice 10 (#1222) reads boot and the slot list through it | `/gds-code-review`, hot-path record | none unless a message changes (then patch) |
| D2 | `.TDT` through Rust (#1066's second half): `importTdt` and `exportTdt` return the report facts, the TypeScript report keeps its wording, C4 and C5 apply | B, C; A7 under OD-8 (#885's real-save check, #886, #887 within #1292's approved scope, #920); #932's measurement | the A7 lane; #1292 | `/gds-code-review`, hot-path record | crate minor |
| E | Failure and rollback evidence on `chromium-wasm`, extending `e2e/wasmFallback.spec.ts` and the offline helpers: (1) the tower changes (a build, a day of play, a price), the engine traps, then a Quick Save, the autosave, a slot save and an export each decode on both codecs, keep the container and the save version, and load to the tower as of the restore point (at most the 30 s rewind R6 states); (2) the Rust codec fails through a tooling-build hook, and the save is written by TypeScript with the same bytes while the latch is reported; (3) the package is refused or offline, and every read and write runs on TypeScript, with an exported file read back on the WASM build; (4) saves written by the WASM build load on the TypeScript default after the flag flips, and on the previous release's reader | D1 (D2 for the `.TDT` cases); #874's spec, #985's offline helpers | the Offline lane | `/gds-code-review` | none |
| F | Evidence: a comment on #945 per row (Saves, Rollback, the writer latch under Reliability, offline under Deployment), the triage thread's #1104 update, this policy moved into `docs/` if the owner wants it there. No gate text, timing or stage changes | E | the triage thread | `/bmad-code-review` | none |

Left to their owners, so #1301 does not duplicate them: a new tower through
the engine (facade 5c and 7), the engine booting from the decoded text
(facade 7, #1158 A32), the facade's boot and slot list (slice 10, on D1's
reads), the worker codec (slice 12, after #1068), the load's memory peak
(slice 13, #1225), undo copies (5a), restore points and recovery (7 and 8),
the stored number form and key order (EX-2, the owner's), and the `.TDT`
fidelity checks (A7).

## Owner decisions

None blocks slices A to C; D1 needs O1 to O3, and the slices go ahead on the
recommended options until the owner says otherwise.

- **O1. The asynchronous autosave's container.** Recommended: it stays on
  `CompressionStream`. The `VCZ1:` value never leaves the browser, both
  codecs read any valid deflate, and moving it to the Rust writer puts a
  synchronous deflate on the main thread every 30 seconds, against slice 9's
  50 ms save budget on the large tower. The other option routes it through
  `encodeVctower` like the synchronous writes.
- **O2. A Rust refusal while both codecs ship.** Recommended: TypeScript
  reads it again (C5), so no save that loads today stops loading. The other
  option makes Rust's refusal final on the WASM path, which is stricter
  authority and can strand a save TypeScript reads.
- **O3. Reporting the codec latch.** Recommended: the reader's failure uses
  the writer's latch and its existing `writer_latched` field, whose meaning
  widens to "the Rust save codec turned itself off". The other option is a
  new field, which goes through the analytics packet. Either way it changes
  what a production field reports, so it is the owner's call.

## Tasks

- [ ] A: this story, the backlog rows and the retirement issue, comments on
      #1066, #1222 and #1301
- [ ] B: the boundary with no behavior change
- [ ] C: `decodeSave`, `inspectSave`, the founder mark, the differential test
- [ ] D1: Rust reads on the WASM path
- [ ] D2: `.TDT` through Rust, after A7
- [ ] E: failure, offline and rollback evidence
- [ ] F: #945 evidence and #1104 through the triage thread
