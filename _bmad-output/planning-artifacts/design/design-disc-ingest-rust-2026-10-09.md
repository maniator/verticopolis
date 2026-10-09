---
status: CONFIRMED 2026-10-09 by the owner (after two party rounds, one on the public home and one a backlog pass). Slice 1 is in progress.
scope: legacy disc ingest (ISO9660 image reading, Microsoft KWAJ expansion; later NE resources and DIB decode) as one host-agnostic Rust crate
amends: the implementation language of the shell-side readers in the desktop disc-ingest design (Story A tasks); its acceptance criteria and security gate stand as written
routes_to: /gds-code-review (decoded bytes feed the TDT import path, an engine-data fidelity concern) plus /bmad-code-review (new crate, CI, WASM build, fuzz and oracle tooling). Both on the crate PR.
---

# Design note: legacy disc ingest as a Rust crate

## Summary

Read the player's own 1994 disc image with a small Rust crate, `disc-rs/`,
that sits beside `engine-rs/` and borrows its toolchain, its WASM build
pattern and its CI shape. One crate, built three ways (a sandboxed native
worker process, a WASM module, and a C ABI for a non-Rust native frontend),
so every host runs the same parser and gets the same normalized result.

Nothing on crates.io decodes KWAJ, so the decoder is written here from the
published format description. CI checks its fidelity against libmspack,
the decoder the developer harness
already trusts, used only as a test oracle and never shipped. A one-time
local check against the owner's real disc closes the remaining gap without
committing a byte of it.

## 1. Where the crate lives

**A separate crate, `disc-rs/` (package `verticopolis-disc`), with its own
`Cargo.lock`, beside `engine-rs`.**

- The engine is the simulation and answers to the conformance referee. Disc
  ingest is hostile-input format parsing with a different review route, a
  different threat model and a different release cadence. Sharing a crate
  would put attacker-facing parsers inside the conformance and coverage gates
  of the simulation, and would make every engine WASM bundle carry a disc
  reader it never calls.
- It reuses everything the engine already settled: Rust 1.97, edition 2021,
  `publish = false`, `wasm-bindgen = "=0.2.129"` behind a `wasm` feature,
  `cargo rustc --crate-type cdylib` for the module, a CommonJS `pkg/` loaded
  through `createRequire`, and the "required in CI, skipped without a
  toolchain" test pattern.
- No root Cargo workspace yet. A workspace would move `engine-rs/Cargo.lock`
  and touch every engine workflow path filter for no gain today. If a third
  crate appears, folding both into one workspace is a mechanical follow-up.
- It is public. ISO9660, KWAJ, NE and DIB are generic, documented formats;
  the crate holds no game bytes and no distribution-specific code, and the
  web build and any native frontend can use it.

## 2. Does a maintained crate remove the fidelity risk?

**No, for KWAJ. Yes in a different way: an independent oracle is
available.** Checked in this environment on 2026-10-09 (crates.io sparse
index and `static.crates.io` reachable; the crates.io search API and
libmspack's upstream host return 403):

| Need | What exists | Verdict |
| --- | --- | --- |
| KWAJ method 3 (LZ+Huffman) | Nothing under any plausible name (`kwaj`, `mspack`, `libmspack-sys`, `szdd`, `lzexpand`, `msexpand`, and others). `ms-compress` 0.1.2 covers LZNT1, XPRESS, LZX, LZMS, Quantum and DEFLATE but not KWAJ or SZDD, needs Rust 1.99, and is LGPL. `delharc` and `lzhuf` are the LHA and TeleDisk LZHUF families, a different bitstream. | Write it. |
| KWAJ method 4 (MS-ZIP) | `flate2` (already in `engine-rs`) | Use it if a real file ever needs it; refuse with a typed code until then. |
| ISO9660 | `hadris-iso` 3.0.0-rc.1 (prerelease, large read/write/boot surface), `iso9660_simple` 0.2.7 (small, `deny(unsafe_code)`, single maintainer), `isomage`, `cdfs` | Write it. We need the primary volume descriptor, a directory walk and file extents, under hard budgets (record count, depth, cycle set, per-file cap) that none of these expose. A general crate would bring its own allocation policy into the attacker-facing path. |

The ground-truth problem that blocked the TypeScript path has a better
answer than "trust our own encoder":

- **libmspack is fetchable as a package.** Ubuntu noble ships
  `libmspack-dev` 0.11 in `main`; it installs with `apt-get` on the CI runner
  and in this sandbox. The repository's existing `tools/simtower/docker/kwajd.c`
  wrapper compiles against it unchanged (`cc kwajd.c -lmspack`), decodes a
  KWAJ file authored here, and refuses libmspack's CVE-2018-14681 regression
  input with a typed error. That makes it a black-box oracle: a decoder we did
  not write, which has expanded real Microsoft COMPRESS.EXE output for two
  decades and which the Wine harness already relies on.
- **libmspack cannot encode KWAJ** (its `kwajc.c` is a stub), and its own KWAJ
  test vectors exercise headers and filenames with method 0 only. So it is an
  oracle for decoding only; it cannot supply LZH vectors.
- **The format is fully described.** libmspack's
  `doc/szdd_kwaj_format.html` specifies method 3 completely: the six-nybble
  table-encoding header, the four length-list encodings, the five canonical
  Huffman trees (MATCHLEN, MATCHLEN2, LITLEN, OFFSET, LITERAL), the 4096-byte
  ring buffer filled with spaces and starting at 4096 - 17, and the
  match/literal-run loop. We implement from that description and never read
  or translate libmspack's C: this repository is MIT, and a line-by-line
  port of LGPL code would bring LGPL obligations with it.

The fidelity ladder, from cheapest to strongest:

1. **Spec unit tests.** Hand-built streams for each length-list encoding
   (types 0 to 3), the MATCHLEN to MATCHLEN2 switch, the `x == 31` literal-run
   rule, matches that reach back into the initial space fill, and ring
   wraparound.
2. **Oracle-checked vectors (committed, our bytes).** A test-only encoder
   written from the same description compresses our own text and seeded
   random data. libmspack must expand every stream back to its input before
   the vector is accepted, and our decoder must match. The committed vectors
   are our bytes, but their correctness is vouched for by a decoder we did not
   write. This is the step the TypeScript path could not take.
3. **Differential fuzzing against libmspack.** Seeded random and mutated
   streams go through both decoders. Where libmspack succeeds, ours must
   produce identical bytes, with three listed exceptions documented and
   implemented once in `disc-rs/src/testkit/oracle.rs`: deliberate
   strictness (a stream cut before or inside its tables, out-of-range code
   lengths, over-subscribed tables, an expansion that misses the length its
   header declares), the output cap when libmspack's own expansion is
   longer than the cap, and libmspack's one end-of-input departure found in
   slice 1 (below). Where libmspack fails, ours must refuse. Any other
   outcome is a finding.
4. **The owner's real disc, locally.** A developer-only
   `tools/simtower/disc-check.ts` opens the owner's ISO through the WASM
   module, expands every KWAJ file with both decoders (libmspack through the
   harness's `kwajd`), and prints only names, sizes, SHA-256 equality and the
   size check against the disc's own setup manifest (for example
   `simtower.exe` must be exactly 6,566,400 bytes). It writes nothing into the
   tree. This closes the last gap: the case where our decoder and libmspack
   share a misreading of a stream shape that only real Microsoft output
   contains.
5. **The disc's sample towers through the importer, locally.** The same tool
   runs every expanded tower through `looksLikeLegacyTower` and `parseTDT` and
   prints only counts (shafts by kind, units, the import report's warnings).
   Those towers were written by the original game, so they measure the open
   import questions that have been waiting on game-written files:
   `tdt-express-desync` (#740), `tdt-1994-room-reachability` (#737) and
   `tdt-degenerate-shaft-payload` (#739). Nothing from them is committed.

What slice 1 found (`story-disc-rs-core.md`): on well-formed streams the
description and libmspack agree byte for byte across every method and table
encoding. Black-box probes settled three behaviors the description leaves
implicit (tables must be complete codes, the stream ends at the first read
past the input, a full 32-byte literal run hands the next code back to
MATCHLEN) and found one place libmspack departs from it: it prefetches input
ahead of its reads, and when that prefetch reaches past the end of the input
it stops at the next token or literal boundary, dropping whatever the last few
bytes would still have decoded (fewer than 24 bits of input, in every case
probed). Our decoder keeps those
bytes, and checks a declared expanded length where libmspack ignores it;
step 4 settles which behavior real Microsoft output needs.

Step 4 is a one-time owner run outside CI. Steps 1 and 2 run
everywhere. Step 3 runs in CI wherever the oracle is installed (required
there, skipped locally without it, like the WASM suite).

## 3. Hosts and the sandbox per host

The security gate is host-independent and unchanged: every parser that
consumes attacker-controlled bytes runs in a separate, privilege-dropped,
killable process (or, on the web, the browser's sandboxed renderer plus a
dedicated worker) under a wall-clock and memory budget. It never runs in a
UI thread or a main process. Rust memory safety and the WASM linear memory
are an extra layer inside that boundary.

The crate is split so the hosts that only consume results never link a
parser:

- `disc-rs` library: the parsers, budgets and the normalized result types.
- `disc-worker` binary (in the same crate): reads a request on stdin, writes
  framed JSON plus bytes on stdout, confines itself before it reads a byte of
  input, and exits.
- `wasm` feature: the same API for JavaScript, built as a module.
- `capi` feature (later, only when a non-Rust native frontend needs it): a C
  ABI exposing the result types and a "spawn the worker" helper; the parsers
  never load into the caller's process.

| Host | How the crate runs | Isolation | Budget and kill |
| --- | --- | --- | --- |
| Native Rust desktop client | Spawns `disc-worker`; links only the result types | The worker confines itself at start. Linux: `no_new_privs`, Landlock with no filesystem rights, a seccomp allowlist (read, write, exit, memory management). macOS: a deny-all `sandbox_init` profile. Windows: the worker relaunches itself into an AppContainer (LowBox) token inside a Job Object. | Parent timer kills on wall clock; `RLIMIT_AS` / `RLIMIT_CPU` on Unix, Job Object memory and process limits on Windows |
| Non-Rust native frontend | Launches the same `disc-worker` through its own process API, or through the `capi` spawn helper; parsers never load into the frontend's process | Same as above | Same as above |
| Embedding desktop shell (for example Electron) | Main spawns the same `disc-worker` with the selected file as its stdin handle | Same as above. Not an Electron `utilityProcess`: its fork options in Electron 43 have no sandbox setting, and it runs Node with the app's privileges. Not a native Node addon, which would load the parser into main. | Same as above |
| Web build | The WASM module inside a dedicated Web Worker | The browser's sandboxed renderer process, plus the worker boundary | `WebAssembly.Memory` maximum; `worker.terminate()` on a timer |

One worker binary serves every native host, so there is one confinement
implementation to review per OS instead of one per host. The selected file is
the worker's only capability: the host opens it and passes it as stdin. The
worker reads it through a `ReadAt` trait (seek and read), so a 650 MB image is
never copied into memory. The WASM binding implements the same trait over a
JavaScript callback (a `File` read with `FileReaderSync` inside the worker).

Using this crate in the web build is possible but is not part of this note.
The disc-ingest design keeps the web build unchanged; wiring it in is a
separate decision.

### The normalized result (identical on every host)

Versioned JSON plus raw bytes. Hosts turn refusal codes into player-facing
text; the crate emits codes, and the wording is the host's.

```text
Opened   { schema: 1, source: "iso", entries: [Entry] }
Entry    { token: u32, path: "SIMTOWER/TOWER5.TDT", size: u32,
           stored: "plain" | "kwaj" | "unreadable",
           method?: u16 (the header's method; only 0 to 3 expand),
           expandedSize?: u32 }
Read     { schema: 1, token: u32, size: u32, sha256: hex }  + the expanded bytes
Refusal  { schema: 1, code, detail }
code     = "not-an-image" | "truncated" | "too-large" | "budget-exceeded"
         | "corrupt-image" | "unsupported-compression" | "corrupt-stream"
         | "output-cap" | "bad-request"
```

The crate does not decide what a tower is. It lists files and expands them;
the existing `looksLikeLegacyTower` plus `parseTDT` path stays the judge, and
`Simulation.deserialize` stays the second trust layer. The crate stops at
bytes on purpose: a second TDT parser would repeat the kind of divergence the
Rust and TypeScript save loaders already show on edge-case input
(`engine-rs-hand-edited-save-fidelity`, #858), this time on the most hostile
files we accept.

The worker protocol is declared once, beside the worker, and every message
carries the `schema` number. A host never re-declares the format, a CI check
fails when a host and the worker disagree on it, and the worker refuses a
request whose schema it does not know (`bad-request`). This is the failure
`desktop-origin-cross-repo-pin` (#790) describes, a string shared across two
repositories drifting silently, kept off a security boundary.

Budgets enforced before any allocation: image size, volume descriptors
scanned, directory depth, total records walked (including empty-sector
skips), a visited-extent set so a directory that points back at an ancestor
is walked once (skipped, as the reviewed TypeScript reader does), a per-file
cap on stored and
expanded size, and an expansion-ratio cap against decompression bombs. The
starting values come from the reviewed TypeScript reader (8 MiB per tower,
50,000 records, depth 16, 64 volume descriptors, 900 MiB image).

## 4. Testing and CI

- `disc-rs.yml`, mirroring `engine-rs.yml`: `cargo fmt --check`, clippy with
  `-D warnings` (native, `--features wasm`, and the wasm32 lib), `cargo test`,
  the libmspack oracle tests (`apt-get install libmspack-dev`, compile
  `kwajd.c`, `VC_REQUIRE_KWAJ_ORACLE=1`), the WASM build plus a Node suite that
  checks native and WASM give identical results on every fixture
  (`VC_REQUIRE_DISC_WASM=1`), the real-disc tool run over the synthetic
  disc, and a line-coverage floor on the shipped code set at the first
  measurement.
- Fuzzing in two sizes: a seeded, structure-aware fuzzer on stable (the
  same style as `engine-rs/src/bin/fuzz.rs`) for the ISO walker and the KWAJ
  decoder, plus the libmspack differential run. A few hundred seeds run as a
  step of `disc-rs.yml` on every change; `disc-fuzz.yml`, a sibling of
  `engine-fuzz.yml`, runs tens of thousands nightly. A failing seed is pinned
  as a named regression test in the fix PR. `cargo-fuzz` targets can come
  later if a nightly toolchain is
  available, but nothing depends on them.
- Fixtures are our own bytes: synthetic ISO images built by a test helper, and
  KWAJ vectors from our encoder that libmspack has verified. The hostile-input
  cases already written for the TypeScript reader are ported one for one.
- No root `npm test` dependency on Rust: the Node suite skips without the
  package, exactly like the engine's WASM suite.

## 5. Slices and review routing

| PR | Content | Review |
| --- | --- | --- |
| This note | Design only | Owner confirmed 2026-10-09; the deep review runs on the code PRs |
| 1. `disc-rs` core | ISO9660 reader, KWAJ methods 0 to 3 (4 refused), budgets, normalized result, WASM binding, test encoder, oracle and differential tests, seeded fuzzer, `disc-check`, `disc-rs.yml`, nightly fuzz job | `/gds-code-review` and `/bmad-code-review` |
| 2. `disc-worker` | Worker protocol, per-OS self-confinement, confinement probes (the worker cannot open an ambient file or read the environment; memory and wall-clock limits terminate a runaway) on Linux, macOS and Windows runners | `/bmad-code-review` |
| 3. NE and DIB (later) | Resource walk and DIB to RGBA, positive and malformed synthetic fixtures | `/gds-code-review` and `/bmad-code-review`, gated on the original-art rule clarification |

None of these is player-facing on its own, so none bumps the version. The PR
that first exposes the import affordance to players carries the bump.

Sequencing (owner, 2026-10-09): the crate and the worker proceed now. The
desktop integration that puts the import in front of players waits for the
desktop save-file service, so an imported tower is saved as a real
`.vctower` file the player can find and back up, outside the browser
profile's storage.

## 6. Owner decisions (2026-10-09)

1. The separate public `disc-rs/` crate, a KWAJ decoder written from the
   format description and verified against libmspack: confirmed.
2. One `disc-worker` binary as the isolation unit for every native host:
   confirmed.
3. The player-facing desktop integration waits for the desktop save-file
   service: confirmed.
4. Real-disc check: the owner runs `tools/simtower/disc-check.ts` locally once
   slice 1 lands and reports the printed counts. **Done 2026-10-09** on the
   owner's retail disc, natively on Windows and under WSL: 43 files listed, 26
   of them KWAJ (all method 3, none declaring a length). All 26 expand to
   bytes identical to libmspack's, the 13 with a setup-manifest entry match
   its size exactly (`SIMTOWER.EXE` 6,566,400 bytes), and neither decoder
   refused a file. The libmspack end-of-input departure never occurred on
   real Microsoft output. The disc carries no `.TDT` or `.TD_` file, so
   step 5 of the fidelity ladder has nothing to measure on this disc.
