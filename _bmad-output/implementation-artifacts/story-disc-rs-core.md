---
story: disc-rs-core
status: review
depends_on: design-disc-ingest-rust-2026-10-09 (owner-confirmed 2026-10-09)
routes_to: /gds-code-review (decoded bytes feed the TDT import path) and /bmad-code-review (new crate, CI, WASM build, fuzz and oracle tooling)
---

# Story: the disc reader core (`disc-rs`)

## Why

Story A of the desktop disc design imports a player's own SimTower towers off
their disc. The disc's files are KWAJ-compressed inside an ISO9660 image. The
reader for both is the hostile-input surface of the feature, so it is one
public, host-agnostic Rust crate that every host (a native worker, WASM, a C
ABI later) builds, instead of a hand-written parser per host. This story is
slice 1: the crate itself. The confined worker process is slice 2; the
desktop integration that shows the import to players waits for the desktop
save-file service.

## Acceptance criteria

1. **AC1 A separate crate.** `disc-rs/` (package `verticopolis-disc`), its
   own lock, Rust 1.97, `publish = false`, `wasm-bindgen = "=0.2.129"` behind
   a `wasm` feature. No dependency on `engine-rs`, and none from it.
2. **AC2 ISO9660.** The primary volume descriptor, a depth-first walk and file
   extents, under budgets checked before the work they bound: image size,
   volume descriptors, directory depth, total records (with empty-sector
   skips), per-file size. A directory reached twice is walked once. Every
   hostile case of the reviewed TypeScript reader (PR #57) is ported.
3. **AC3 KWAJ.** Methods 0 to 3 expand; method 4 (MS-ZIP) and unknown methods
   refuse as `unsupported-compression`. Output is capped by the per-file limit
   and an expansion ratio.
4. **AC4 Fidelity.** The decoder is written from the format description, not
   from libmspack's source. libmspack is a test-time oracle only: our own
   encoder's vectors must expand under libmspack to their input, damaged
   streams must match it under one documented comparison rule, and CI fails
   if the oracle is missing.
5. **AC5 One result on every host.** A versioned result (`schema: 1`): the
   listing, read info with SHA-256, and typed refusals. The WASM module must
   report exactly what the native build reports for the committed synthetic
   disc.
6. **AC6 Clean-room.** Every fixture is our own bytes, and a test fails if the
   committed image is anything other than what the test kit builds.
7. **AC7 Fuzzing.** A seeded fuzzer (no panics, no hangs, the libmspack rule)
   runs as a smoke step on every change and nightly at volume.
8. **AC8 The owner's disc.** A developer-only tool runs the reader over the
   owner's ISO and prints only sizes, hashes and importer counts.

## Out of scope

- The confined `disc-worker` process and its per-OS confinement (slice 2).
- The desktop shell wiring and any player-facing import (gated on the desktop
  save-file service).
- NE resources and DIB decode (Story B-prime, gated on the art-rule
  clarification).
- Any use in the web build.

## Dev notes

- Found by black-box probes against libmspack and now pinned in tests: a
  Huffman table must be a complete code; the stream ends at the first read
  past the input and the symbol that read belongs to is not emitted (literals
  before it in the same run stay); a full 32-byte literal run hands the next
  code back to MATCHLEN (the description says only that a short run hands it
  to MATCHLEN2).
- libmspack's one departure from the description: it prefetches input ahead of
  its reads, and when that prefetch reaches past the end of the input it stops
  at the next token or literal boundary, dropping whatever the last few bytes
  would still have decoded (fewer than 24 bits of input, in every case
  probed), even in a well-formed stream. We keep those bytes; the owner's
  real-disc check compares both against the disc's size manifest.
- The quirk was first pinned too narrowly (a final short literal run). After
  the bmad round's fixes gave the fuzzer independent seed streams, seed 3560
  found the same early stop on a cut stream ending in a match. The allowance
  is now the general, bounded rule (exact agreement up to a token or literal
  boundary with fewer than 24 input bits left), pinned by
  `libmspack_stops_early_on_a_cut_stream_that_ends_in_a_match`.
- AC8 result (owner's retail disc, 2026-10-09, Windows and WSL): 26 KWAJ
  files, all identical to libmspack, 13 matching the setup manifest's sizes,
  no refusals, and no towers on the disc. The end-of-input quirk did not
  occur on real Microsoft output.
- Deliberate strictness where libmspack accepts: a stream cut before or inside
  its tables, code lengths outside 0 to 15, over-subscribed tables, and an
  expansion that does not match the length its header declares (libmspack
  ignores the declaration).
- `scripts/wasm-build.ts` now takes the crate (`engine`, the default, or
  `disc`), so both bindings share one build script.

## Tasks

### Review Findings (gds-code-review, 2026-10-09: 24 patch, 0 defer, 5 dismissed)

- [x] [Review][Patch] KWAJ declared expanded length is never enforced
  (libmspack ignores it; refuse a mismatch as listed strictness)
  [disc-rs/src/kwaj/mod.rs]
- [x] [Review][Patch] One out-of-range file extent refuses the whole listing;
  list it as unreadable and refuse on read; skip the peek for empty files
  [disc-rs/src/disc.rs]
- [x] [Review][Patch] Names may carry `/` or `\`, and duplicate paths list
  silently [disc-rs/src/iso.rs]
- [x] [Review][Patch] A version-stripped name can be empty or keep a trailing
  dot [disc-rs/src/iso.rs]
- [x] [Review][Patch] Unsupported record layouts (extended attributes,
  interleave, multi-extent) and associated files are read as plain files; the
  LE/BE halves are never cross-checked [disc-rs/src/iso.rs]
- [x] [Review][Patch] The primary volume's logical block size is never checked
  against 2048 [disc-rs/src/iso.rs]
- [x] [Review][Patch] Host-supplied limits are not bounded [disc-rs/src/limits.rs]
- [x] [Review][Patch] The output cap counts the KWAJ header toward the
  expansion ratio [disc-rs/src/kwaj/mod.rs]
- [x] [Review][Patch] Refusals carry no schema number [disc-rs/src/refusal.rs,
  src/tests/disc/wasmDisc.ts]
- [x] [Review][Patch] `openBytes` copies an oversized image into WASM memory
  before any size check; the host callback's return type is unchecked
  [src/tests/disc/wasmDisc.ts, disc-rs/src/wasm.rs]
- [x] [Review][Patch] Release builds wrap on integer overflow, hiding
  arithmetic bugs from the fuzzer [disc-rs/Cargo.toml]
- [x] [Review][Patch] The fuzzer cannot name a hanging seed, and the oracle
  has no timeout for `kwajd` [disc-rs/src/bin/fuzz.rs,
  disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The fuzz seed range can overflow or be empty and still
  pass [disc-rs/src/bin/fuzz.rs, .github/workflows/disc-fuzz.yml]
- [x] [Review][Patch] The oracle rule accepts any output-cap refusal [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The end-quirk allowance never checks the six-bit
  condition [disc-rs/src/testkit/oracle.rs, disc-rs/src/kwaj/lzh.rs]
- [x] [Review][Patch] The oracle reads a crashed `kwajd` as a refusal and
  reuses temp paths [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The strictness list matches free-text details and its
  doc disagrees with the code [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The fixture expectation is generated by the decoder it
  checks; pin the encoder's plaintext hashes [disc-rs/tests/fixtures.rs]
- [x] [Review][Patch] disc-check ignores the ISO path without `--kwajd`,
  accepts `--kwajd` with no value, and misreads a block device
  [tools/simtower/disc-check.ts]
- [x] [Review][Patch] disc-check echoes manifest text verbatim and never
  compares sizes; compressed manifests are skipped
  [tools/simtower/disc-check.ts]
- [x] [Review][Patch] disc-check crashes on a refused manifest, skips
  libmspack when we refuse, uses non-shipping limits, and frees outside
  `finally` [tools/simtower/disc-check.ts]
- [x] [Review][Patch] Docs contradict the code: the fuzzer as "never a PR
  gate", the huffman comment on over-subscription, the end rule's "token"
  wording [disc-rs]
- [x] [Review][Patch] The coverage floor sits two points under the first
  measurement instead of at it [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] New prose uses the "X, not Y" restatement pattern in
  several places [disc-rs, design note]

### Review Findings (bmad-code-review, 2026-10-09: 27 patch, 1 defer, 4 dismissed)

- [x] [Review][Patch] The oracle rule let any declared-length refusal through;
  allowed now only when libmspack misses the declared length too
  [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The binding's unit tests (`--features wasm`) never ran
  in CI [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] The coverage floor scored the test kit and the binaries;
  it now measures shipped code only, floor 98 from 98.18%
  [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] disc-check: an unguarded `readStored` aborted the run;
  exits inside `try` skipped cleanup; a crashed, hung or silent `kwajd` read
  as a refusal [tools/simtower/disc-check.ts]
- [x] [Review][Patch] The parity suite read by array index and never checked
  `readStored`; the expectation now carries stored-byte hashes
  [src/tests/integration/discWasm.integration.test.ts,
  disc-rs/src/bin/fixtures.rs]
- [x] [Review][Patch] The adapter duplicated the module's default limit; the
  module now exports `defaultLimits`, and the module's own size refusal is
  tested through a source [disc-rs/src/wasm.rs, src/tests/disc/wasmDisc.ts]
- [x] [Review][Patch] Tokens outside u32 wrapped in the glue and read the
  wrong file [src/tests/disc/wasmDisc.ts]
- [x] [Review][Patch] A read copied the expanded bytes twice (`takeBytes` now
  hands them over) [disc-rs/src/wasm.rs]
- [x] [Review][Patch] A failed host read lost the host's error text [disc-rs/src/wasm.rs]
- [x] [Review][Patch] The fuzzer dropped panic locations, shared one seed
  across roles, ignored unknown options and could not name a seed lost to an
  abort [disc-rs/src/bin/fuzz.rs]
- [x] [Review][Patch] The oracle runner left files behind on a hang, a crash
  or a panic [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The nightly replay hint never printed on failure, and a
  manual run repeated the nightly seeds [.github/workflows/disc-fuzz.yml]
- [x] [Review][Patch] The wasm-bindgen pin step failed without a message
  [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] `wasm-build.ts` accepted prototype keys and extra
  arguments [scripts/wasm-build.ts]
- [x] [Review][Patch] The lane's path filters missed `vite.config.ts`, the
  importer and disc-check, and nothing compiled or ran disc-check (now
  type-checked and run over the synthetic disc, including its refusal path)
  [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] Malformed fuzz seed ranges and options are now exercised
  in CI [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] The design note still contradicted the code (fuzz
  gating, the strictness list, the schema on reads) and the binding's doc
  omitted the refusal schema [design note, disc-rs/src/wasm.rs]
- [x] [Review][Patch] "X, not Y" restatements remained in new prose [design note, disc-rs/README.md]
- [x] [Review][Patch] The ported TypeScript cases are now mapped one by one in `tests/iso.rs`
- [x] [Review][Patch] CONTRIBUTING did not describe the new lane, scripts or
  switches [CONTRIBUTING.md]
- [x] [Review][Defer] CI caches no cargo build or tool install (shared with
  engine-rs.yml) [.github/workflows/disc-rs.yml]: deferred to backlog row
  `disc-rs-ci-cache` (#876)

### Review Findings (confirming gds-code-review pass, 2026-10-09: 19 patch, 0 defer)

- [x] [Review][Patch] A name of dots only (`...`) stripped to `..` and passed;
  names now keep to the ISO9660 character set, lose their trailing dots, and
  refuse when empty or dots only [disc-rs/src/iso.rs]
- [x] [Review][Patch] A version suffix that is not digits was accepted; it
  now refuses as a malformed version [disc-rs/src/iso.rs]
- [x] [Review][Patch] Several versions of one file refused the disc; the
  highest version now wins, and only a true duplicate refuses
  [disc-rs/src/iso.rs]
- [x] [Review][Patch] A file with an unsupported layout or mismatched halves
  refused the whole disc; it now lists as unreadable, while a directory with
  one still refuses the walk [disc-rs/src/iso.rs, disc-rs/src/disc.rs]
- [x] [Review][Patch] A big-endian half of zero (written by some mastering
  tools) was read as a mismatch [disc-rs/src/iso.rs]
- [x] [Review][Patch] Duplicate detection ran per sector, so a duplicate in a
  later sector of the same directory slipped through [disc-rs/src/iso.rs]
- [x] [Review][Patch] The declared-length allowance skipped the byte
  comparison; the oracle now compares the bytes behind the refusal
  (`expand_ignoring_declared`) [disc-rs/src/testkit/oracle.rs,
  disc-rs/src/kwaj/mod.rs]
- [x] [Review][Patch] The cut-stream allowances accepted any libmspack output;
  they now hold only when libmspack's output is empty
  [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] Limits were checked only in `Disc::open`; `kwaj::expand`
  now checks them too, and the tests and fuzzer hold the ratio at the hard
  ceiling [disc-rs/src/kwaj/mod.rs, disc-rs/src/bin/fuzz.rs, disc-rs/tests]
- [x] [Review][Patch] The fuzzer accepted a duplicated option or `--seed`
  with `--seeds`, and the watchdog could not tell a finished case from a hang
  [disc-rs/src/bin/fuzz.rs]
- [x] [Review][Patch] The binding read `.message` off a thrown non-object
  [disc-rs/src/wasm.rs]
- [x] [Review][Patch] `defaultLimits` was written by hand beside the Rust
  constant, and hosts had no way to read the hard limits [disc-rs/src/wasm.rs,
  disc-rs/src/limits.rs]
- [x] [Review][Patch] The adapter passed a limit above the hard ceiling to the
  module and copied buffers past 2 GiB before refusing them
  [src/tests/disc/wasmDisc.ts]
- [x] [Review][Patch] disc-check skipped a tower whenever `readStored`
  refused, and its block-device message did not say what to do
  [tools/simtower/disc-check.ts]
- [x] [Review][Patch] Both CI lanes threw the fuzzer's stderr away, so a
  failing seed left no trace [.github/workflows/disc-rs.yml,
  .github/workflows/disc-fuzz.yml]
- [x] [Review][Patch] The refusal step in CI checked only the exit code
  [.github/workflows/disc-rs.yml]
- [x] [Review][Patch] Manual fuzz runs could overlap the nightly's seed
  ranges [.github/workflows/disc-fuzz.yml]
- [x] [Review][Patch] Docs: the design note's `method` type, the oracle
  header's pin names, and wording in bits.rs, disc.rs and source.rs
  disagreed with the code [disc-rs, design note]
- [x] [Review][Patch] Prose nits: "X, not Y" restatements and lines past the
  wrap width [design note, story, disc-rs/README.md]

### Review Findings (second confirming gds-code-review pass, 2026-10-09: 9 patch, 0 defer, 1 dismissed)

- [x] [Review][Patch] The root directory's own record problems were never
  checked, so a damaged root was walked as plain data [disc-rs/src/iso.rs]
- [x] [Review][Patch] Duplicate detection depended on record order (`A;1`,
  `A;3`, `A;1` passed); every name and version pair is now tracked
  [disc-rs/src/iso.rs]
- [x] [Review][Patch] A multi-extent file's second record refused the disc as
  a duplicate; the file now lists once, as unreadable [disc-rs/src/iso.rs]
- [x] [Review][Patch] `A..` listed as `A.`, which a filesystem that trims
  dots merges with `A`; every trailing dot is dropped, and the doc says hosts
  sanitize DOS device names [disc-rs/src/iso.rs]
- [x] [Review][Patch] The fuzz watchdog's exit could orphan a hung `kwajd`
  and leave its files; live runs are tracked, killed and removed
  [disc-rs/src/bin/fuzz.rs, disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] disc-check and the README described `unreadable` as an
  out-of-range extent only [tools/simtower/disc-check.ts, disc-rs/README.md]
- [x] [Review][Patch] disc-check threw a stack trace on a path it could not
  open instead of usage text [tools/simtower/disc-check.ts]
- [x] [Review][Patch] disc-check's header promised more privacy than its
  importer sentences give [tools/simtower/disc-check.ts]
- [x] [Review][Patch] The public party memlog named private shell, signing
  and native-client detail; the full entries moved to the private memlog
  [_bmad-output/party-mode/memories/installed/.memlog.md]
- Dismissed: the oracle rule accepts `LENGTH_RANGE` and `OVER_SUBSCRIBED`
  refusals without a condition on libmspack's output. Both are refused before
  any output exists, and a regression in reading code lengths fails the
  encoder-vector tests, which require exact agreement on every valid stream.

### Review Findings (third confirming gds-code-review pass, 2026-10-09: 5 patch, 0 defer, 0 dismissed)

- [x] [Review][Patch] disc-check's unreadable label left out disagreeing
  endian halves [tools/simtower/disc-check.ts]
- [x] [Review][Patch] The public memlog still used the private brief's "red
  line" and "never gated" wording
  [_bmad-output/party-mode/memories/installed/.memlog.md]
- [x] [Review][Patch] The watchdog could miss a `kwajd` started between its
  kill and the exit; the live map now closes, and a run is set up under its
  lock [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] disc-check blocked opening a named pipe before it could
  print usage text; it checks the path before opening it
  [tools/simtower/disc-check.ts]
- [x] [Review][Patch] Found while verifying the fixes: every oracle test
  process left an empty temp directory behind; a run's files now remove the
  directory once it is empty [disc-rs/src/testkit/oracle.rs]

### Review Findings (fourth confirming gds-code-review pass, 2026-10-09: 3 patch, 0 defer, 0 dismissed; the poisoned-lock finding came from two layers)

- [x] [Review][Patch] A poisoned run lock stopped every later run from
  removing the oracle directory [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The watchdog's `kill_live` could wait forever on a
  worker stuck while holding the run lock; it now waits at most two seconds,
  and a hung run is killed outside the lock [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] `expand`'s doc did not list the watchdog-closed panic
  [disc-rs/src/testkit/oracle.rs]

### Review Findings (fifth confirming gds-code-review pass, 2026-10-09: 4 patch, 0 defer, 1 dismissed)

All four sit in the test oracle's shutdown path for the fuzz watchdog; the
reader itself had no findings.

- [x] [Review][Patch] `kill_live` gave up after its lock wait without
  refusing later runs; a lock-free closed flag now refuses them at once, and
  the doc says a run it cannot reach in time may outlive the process
  [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The timeout branch released the lock before signaling
  its hung child, so the watchdog could miss it; the child is now signaled
  under the lock and reaped outside it [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] `kill_live` could still block reaping a child stuck in
  the kernel; it now signals and never waits [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] A run dropped while another thread held the lock left
  the oracle directory behind; the drop now waits for the lock unless its
  own thread is mid-setup [disc-rs/src/testkit/oracle.rs]
- Dismissed: the claim that a run holds the lock for its whole 20-second
  poll. The poll takes the lock per iteration and releases it before each
  sleep.

### Review Findings (sixth confirming gds-code-review pass, 2026-10-09: 2 patch, 0 defer, 0 dismissed; the Edge Case Hunter found nothing and reproduced the watchdog paths with a stand-in hung kwajd)

- [x] [Review][Patch] The setup flag stayed set after a panic in the input
  write or the spawn, so that thread's later runs skipped removing the
  oracle directory; a drop guard now clears it (found by two layers)
  [disc-rs/src/testkit/oracle.rs]
- [x] [Review][Patch] The setup comment promised `kill_live` always finds the
  child; it does only when it gets the lock within its wait
  [disc-rs/src/testkit/oracle.rs]

Review loop closed by the owner on 2026-10-09 after the sixth confirming
pass. Its two patches are applied; no finding is open and none is deferred.
