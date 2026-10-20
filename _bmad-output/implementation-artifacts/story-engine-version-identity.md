---
story: engine-version-identity
status: in progress
depends_on: engine-wasm-binding
---

# Story: the engine says which engine it is (#963)

## Why

A bug report, a perf run and a support question all start with "which build
was that?". Today the splash and About show the app version and a label for
the engine in use, but nothing says which engine package ran, whether it is the
one the page was built for, or what save and catalog contracts it speaks. When
the engine never loads, nothing says why. The 3.0 gate lists "Version
identity" as a row, and the crate needs a versioning rule before #893
publishes it.

## Design

One record, built in Rust, so the engine is the only author of its own facts:

```
engineIdentity() -> {
  schema: 1,
  crate: { name, version },
  saveVersion, oldestSaveVersion,
  frameLayoutVersion,
  catalogVersion, catalogDigests: { classic, modern },
  lockDigest
}
```

- `crate.version` and `lockDigest` come from `engine-rs/src/compat-record.json`
  (compiled in with `include_str!`; a file inside the crate, so the existing
  boundary rules and `engineSourceHash` already cover it). A Rust test asserts
  the version equals `env!("CARGO_PKG_VERSION")` (tests may read the
  environment; the library may not) and recomputes the lock digest.
- `catalogDigests` come from `catalog_digest(mode)`, computed at run time.
- `frameLayoutVersion` is a new `FRAME_LAYOUT_VERSION` in `frame.rs`. A test
  pins every slot offset and record width, and fails with the table when one
  moves; the author raises the version and the pin together.

### The build hash belongs to the host

A hash of the Rust sources cannot be compiled into the same sources. Baking it
in needs `option_env!` or a `build.rs`, which `engine-rs/tests/independence.rs`
bans on purpose (a build script runs on every consumer's machine). The
host already holds both facts a build hash would give: `BUILD.json` carries
`sources` and the package id, and the loader (#985) hashes the bytes it
instantiates against that record. About joins them: the engine's record,
`BUILD.json`'s record, and the hash of what actually loaded. A mismatch
between any two is a named state. **No change to the boundary guard.**

### BUILD.json

An additive `crate: { name, version }` key, read from `Cargo.toml` by
`scripts/wasm-build.ts`. The reader ignores unknown keys by design
(`enginePackageRecord.ts`), so this is not a schema bump and an older shell is
unaffected. About can then show the crate version even when the engine never
loaded.

### The crate version rule (plan 7.4)

The crate version changes when any of these change: the conformance lock, the
save version (`SAVE_VERSION`, and the oldest save it loads), or the public
Rust/WASM interface or compatibility contract (the frame layout, catalog and
identity record versions, and the checked-in `src/dualrun/engine.d.ts`). An
internal optimization that keeps all of them is told apart by the build hash
and needs no bump. The app version stays the number players see. Publishing
waits for #893.

Made mechanical where the tree can show it: `engine-rs/src/compat-record.json`
records the crate version with the lock digest, the five version constants and
a digest of `engine.d.ts` (comments and spacing aside). The lock is five
files: the scenario, catalog, loader and `.TDT` tables and the gameplay event
catalog. A TS guard recomputes all of it from the tree and fails when a pin
moved and the record did not, or when the recorded version differs from
`Cargo.toml` or the native consumer's lockfile. `FRAME_LAYOUT_VERSION` and
`IDENTITY_SCHEMA` each have a pin table with one entry per version. A new
layout fails until an entry is appended and the version raised; overwriting an
old entry still passes the tests and shows in the diff as an old pin changing,
which review refuses (#1153 tracks a record field that lets the guard see it).

`npm run engine:compat` rewrites the record. It fetches `origin/main`, names
the commit it compared with, refuses a pin that differs from main's record
under the same crate version, refuses a version that is not a later plain
`x.y.z`, and refuses when main's record is missing, deleted or unreadable. A
version that has not merged yet can be re-recorded as main's lock moves under
it. A record edited by hand in the same PR skips that comparison, since CI has
no base branch to compare against; review owns that case until #1153 lands.

What the guard does not see, each tracked: what a frame slot or state code
means (#1154); the Rust `pub` API, JSON shapes that the declaration only
describes in a doc comment, and save fields added through the loader's
optional seam (#1161). The rule still asks for a bump in those cases.

While the crate is 0.x, the bump size follows the trigger: a minor for a save,
frame layout, catalog, identity schema or interface change, and a patch for a
lock change on its own.

**Starting version: 0.1.0 to 0.2.0 in the first PR.** `engineIdentity()` is a
public interface addition, so the new rule requires a bump at once. The crate
stays 0.x until #893 publishes it, because 0.x semver allows a breaking change
at a minor, which fits an interface still settling. #893 decides 1.0.0 with its
compatibility policy; the app's 3.0.0 does not decide it.

## Acceptance criteria

1. **AC1** The binding exports `engineIdentity()` (a module function, like
   `catalog`) returning the record above as canonical JSON; the Rust test pins
   every field, nested ones included.
2. **AC2** `FRAME_LAYOUT_VERSION` exists, and a test pins the slot table.
3. **AC3** `BUILD.json` carries `crate`; `parseEngineRecord` reads it as
   optional; old records still parse.
4. **AC4** The compat-record guard fails on each of: a changed lock file,
   a changed version constant, a changed `engine.d.ts`, a recorded version that
   differs from `Cargo.toml`; and `npm run engine:compat` refuses a pin that
   differs from main's record under an unmoved version. A mutation test proves each.
5. **AC5** A pure diagnostics model builds one report from app version and
   SHA, the active engine and placement (and the fallback reason), the
   engine's record, `BUILD.json`'s record, the loaded package id, `lastError`
   and `droppedErrors`. States: ok, engine in use is TypeScript, engine not
   loaded (with the reason), record mismatch (naming the field), identity
   unavailable (an engine too old to have the call).
6. **AC6** About shows the report and a Copy Diagnostics button that works in
   every state, including when the engine never loaded.
7. **AC7** A source guard fails on an identity literal (crate name, version,
   save version) outside the binding call and the build script.
8. **AC8** e2e: `?engine=wasm` shows the record; a blocked engine load shows
   the unavailable state with the crate version from `BUILD.json`; a served
   `BUILD.json` with a wrong package id shows the mismatch.
9. **AC9** Plan 7.4 states the crate version rule; CONTRIBUTING.md's
   Versioning section links it; #1104's "Version identity" row and the
   backlog row `engine-identity-diagnostics` are current.

## PR slices

| # | Slice | Review | Owns |
| --- | --- | --- | --- |
| 1 | Rust `engineIdentity()`, `FRAME_LAYOUT_VERSION`, `compat-record.json`, crate 0.2.0, the TS version-rule guard and `engine:compat` script, binding export, `engine.d.ts`, export tier entry | `/gds-code-review` (the guard is tooling, read by the same pass) | `engine-rs/src/identity.rs`, `frame.rs`, `load.rs` (one visibility), `wasm.rs` (additive export only), `src/dualrun/engine.d.ts`, `exportTiers.ts`, `src/build/engineCompat.ts`, `scripts/engine-compat.ts`, `package.json` script |
| 2 | `BUILD.json` `crate` key and its reader. It changes `scripts/wasm-build.ts`, which is in the replay-window key, so it lands before the freeze | `/bmad-code-review` | `scripts/wasm-build.ts`, `src/wasmhost/enginePackageRecord.ts` (with the "Offline package integrity" lane) |
| 3 | Diagnostics model, About rendering, Copy Diagnostics, literal guard | `/bmad-code-review` | `src/wasmhost/` (new files; `engineLabel.ts` call sites), `src/ui/` About |
| 4 | e2e, plan 7.4 text, CONTRIBUTING, backlog, #1104 | `/bmad-code-review` | tests, docs |

Slice 3 is the player-visible one and takes the next minor at merge time.
Slices 1 and 2 are internal. Each slice merges on green required checks and an
independent verdict, with a merge commit. Slice 1 changes the engine hash, so
the coordinator is told when it merges (PC perf runs pin fixed SHAs).

## Tests

- Rust: record fields, crate version equals `CARGO_PKG_VERSION`, slot table.
- TS unit: compat-record guard with a mutation per rule, `parseEngineRecord`
  with and without `crate`, the diagnostics model for every state.
- e2e: the three cases in AC8.

## Risks

- **`wasm.rs` and `wasmHost` are shared with the runtime fallback lane (#1101).**
  Slice 1 adds one export and touches nothing else there; slice 3 reads host
  status and adds no host behavior.
- **`BUILD.json` is shared with #985.** The key is additive, and the owner is
  told before slice 2 opens.
- **The interface digest reads the committed `engine.d.ts`** with comments
  and whitespace removed (strings and comments are told apart in one pass), so
  a doc edit is not an interface change. CI already requires the file to match
  the generated one.
- **Copy Diagnostics must not throw when the engine is absent.** The model takes
  every input as optional.
- **Temporary TS-engine code:** none. Classification: permanent frontend plus
  Rust-authoritative.
