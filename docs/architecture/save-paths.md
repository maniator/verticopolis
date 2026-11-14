# Save, load, import and export paths

State on `main` once #1642, #1646 and #1653 land (#1301, #1498, #1522). The
engine package is the Rust/WASM engine (`engine-rs/`); there is no TypeScript
fallback engine in the shipped game.

## Who owns what

| Layer | Owner | What it covers |
| --- | --- | --- |
| Save semantics | Rust engine | What a save means: the loader and its refusals (`load::deserialize_owned`, a version above `SAVE_VERSION` is refused with the update sentence), migration up the version ladder, the founder rule, the unit cap, the writer (`encode_simulation_vctower`). |
| External files | Rust engine | `.vctower` and `.TDT` in and out: `loadVctower` (`vctower_import.rs`, every refusal is a sentence for the player), `exportVctower`, `loadTdt`, `tdtExport`. |
| Storage container | TypeScript | The `VCZ1:` value (`src/storage/SaveGame.ts`, `vctowerWriter.ts`, `saveCompression.ts`), slots, the autosave key, the unreadable stash, quota handling, and where they are kept: the IndexedDB save store with a `localStorage` mirror (`saveStore.ts`, below). |
| Page | TypeScript | Formats: shows the engine's `lastReason()`, toasts, downloads, the confirm dialogs and fidelity reports. No save rule lives here. |

## Call graph

| Action | Path | Codec |
| --- | --- | --- |
| Boot, load autosave or a slot | `SaveGame.loadResult` reads the `VCZ1:` value (TypeScript container) and hands the save text to `loadStored`, then `port.loadSave` | Rust loader |
| Autosave, Quick Save, slot save | `saveText()` (`port.serialize`, camera stamped) then `SaveGame.save`/`saveAsync` stamp and pack the container, then `saveStore.set` (`localStorage` at once, IndexedDB in the background) | Rust serializer, TypeScript container (the engine writer packs it when the package is loaded, `fflate` otherwise) |
| Export `.vctower` | `SaveLoad.exportGame` then `exportFileText` then `port.exportVctower(appVersion, now)` | Rust writer |
| Import `.vctower` | `SaveLoad.importGame` then `port.loadVctower(text)` | Rust reader (container checks, shape check, loader) |
| Import `.TDT` | `SaveLoad.importLegacy` then `port.loadTdt`, report, confirm, `adoptConfirmedLegacyImport` | Rust codec |
| Export `.TDT` | `SaveLoad.exportLegacy` then `port.tdtExport` and `port.tdtFile` | Rust codec |
| Undo, redo, restart | `port.restore`, `port.serialize` | Rust |
| Crash report | `SaveGame.export(lastGoodSaveText)` packs the text the page already holds | TypeScript container, no engine |
| Recovery copy | `readRecoveryText()` returns the stored autosave (or the unreadable stash) byte for byte | none: no parse, no decode |

`src/tests/vctowerCodecPin.guard.test.ts` fails when production code calls a
TypeScript `.vctower` reader or writer outside the named allowances.

## Where the saves are kept

`src/storage/saveStore.ts` keeps every save in an IndexedDB database
(`verticopolis`, object store `saves`), a compressed save as its raw deflate
bytes. Boot opens it beside the engine package and reads every save into
memory, so the save code stays synchronous; a write updates memory at once and
reaches the database in the background, in order. The first open copies the
`localStorage` saves in, reads them back, and only then marks the copy done.

For the first release on IndexedDB every save is also written to
`localStorage`, and at boot the newer copy of each wins (a tie goes to the
database); a key `localStorage` no longer holds was deleted outside the store,
and its database copy is deleted too. A tab killed right after a write still has the save, and a rollback
to a build from before the store still finds every tower; what that build
writes wins here on the next boot when it is newer. The release after it
keeps only the autosave in `localStorage`; a slot that leaves the mirror
reports a database write that fails later through `saveStore.onFailure`, said
like a refused slot. When IndexedDB will not open (some private windows), the
store is plain `localStorage`, as before; so it is when the database does not
answer within 4 seconds. Another tab hears each write over a
`BroadcastChannel`, and a tab writing `localStorage` alone (an older build, a
store that did not open) through the `storage` event. A later build that
upgrades the database (`onversionchange`) closes this tab's connection, and
the tab goes back to `localStorage`.

`e2e/saveRoundTrip.spec.ts` checks the towers come back from IndexedDB alone,
the same game, after a reload.

## Failure and recovery guarantees

- **No engine, or a trapped engine.** `.vctower` and `.TDT` import and export
  refuse (the engine does the work), and nothing writes a file the engine did
  not make. A trapped engine refuses every save (`TRAPPED_SAVE_REFUSED`), so
  the last good save stays. The recovery copy and the crash report work
  without the engine package.
- **A refused import changes nothing.** The engine refuses before it swaps, so
  the live tower and every stored save stay as they were
  (`e2e/saveRoundTrip.spec.ts`).
- **A save from a newer build** is refused on every route a save takes in, with
  "This save was made by a newer version of Verticopolis. Update the game to
  load it." Open follow-up: #1643 (a newer autosave at boot is stashed once,
  then the fresh tower autosaves over the slot, and the stash cannot be
  re-imported).
- **Nothing changes format silently.** A save is written at `SAVE_VERSION`; the
  container version is `VCTOWER1`; a later container is refused.

## Migration and deprecation

The TypeScript `.vctower` readers and writers (`SaveGame.import`,
`importText`, `readVctower`, `writeVctower`, `decodeVctower`) stay as test
referees until the TypeScript save codec is deleted after the cutover (#1336).
Production code may not call them (the pin above). The loader conformance lock
(`conformance/loader-cases.json`) is replayed by Rust.

## Left for a person with a browser

See the PC checklist in the project thread: Firefox and WebKit determinism
hashes, the installed-PWA update rehearsal (both #1522), and inflate time for a
crafted 32 MiB file on the engine thread (#1652).
