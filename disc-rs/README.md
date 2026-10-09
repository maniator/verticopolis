# Verticopolis disc reader

`disc-rs/` reads a player's own legacy disc image: an ISO9660 walk and
Microsoft KWAJ expansion (the format the retail SimTower disc's files ship
in, named with the last character replaced, `SIMTOWER.EX_`). It is
host-agnostic: a native worker process, a WASM module and later a C ABI
build the same crate, so every host runs one parser and gets one result.
Design: `_bmad-output/planning-artifacts/design/design-disc-ingest-rust-2026-10-09.md`.

The crate stops at bytes. It lists files and expands them; deciding what a
tower is stays with the game's importer (`looksLikeLegacyTower` and
`parseTDT`). Its input is attacker-controlled, and every host runs it inside
a confined process or worker it can kill. Rust's memory safety is an extra
layer inside that boundary.

## Layout

| File | What it does |
| --- | --- |
| `iso.rs` | Primary volume descriptor, depth-first directory walk, file extents |
| `kwaj/` | The header, methods 0 to 3 (store, XOR, the QBasic SZDD LZSS, LZ + Huffman); MS-ZIP is refused |
| `disc.rs` | `Disc`: open, list, read with expansion; the versioned result shapes (`schema: 1`, refusals included). A file whose extent lies outside the image, or whose record uses a layout the reader does not support (extended attributes, interleaving, several extents) or has disagreeing endian halves, lists as `unreadable` and refuses when read, so one bad entry never hides the rest of the disc |
| `limits.rs`, `refusal.rs`, `source.rs` | Budgets, typed refusal codes, the `ReadAt` byte source |
| `wasm.rs` (feature `wasm`) | The JavaScript binding; `src/tests/disc/wasmDisc.ts` drives it |
| `testkit/` (feature `testkit`) | Our own KWAJ encoder and ISO builder, the libmspack oracle rule, the synthetic fixture |

## Budgets and refusals

Every parse runs under `Limits` (image size, volume descriptors, directory
depth, total records walked, per-file size, expansion ratio), each checked
before the allocation or loop it bounds. Every failure is a `Refusal` with a
stable code (`not-an-image`, `truncated`, `too-large`, `budget-exceeded`,
`corrupt-image`, `unsupported-compression`, `corrupt-stream`, `output-cap`,
`bad-request`) that hosts turn into player-facing text.

## Fidelity: the format description, checked against libmspack

No crate on crates.io decodes KWAJ, so the decoder is written here from the
format description in libmspack's `doc/szdd_kwaj_format.html`; its source
was never read (this repository is MIT; libmspack is LGPL). Its fidelity is checked
against libmspack itself, a decoder we did not write, used only as a
test-time oracle: `tests/oracle.rs` and the fuzzer run the harness's
`tools/simtower/docker/kwajd.c` wrapper against the system libmspack.

- Every vector our test encoder writes (every method, every code-length
  encoding, runs read from either match table, matches into the initial
  space fill, window wraparound) must expand under libmspack back to its
  input before it counts.
- Damaged streams must expand to the same bytes or be refused where
  libmspack refuses, under one comparison rule with three listed exceptions
  (`testkit/oracle.rs`, which documents it in full).

What the description leaves implicit was settled against libmspack by
black-box probes, with its code left unread: a Huffman table must be a
complete code; the stream ends at the first read past the input, and the
symbol that read belongs to is not emitted (literals before it in the same
run stay); a full 32-byte literal run hands the next code back to MATCHLEN.

The rule's exceptions: where we are deliberately stricter (`kwaj::strict`: a
stream cut before or inside its tables, out-of-range code lengths,
over-subscribed tables, and an expansion that does not match the length the
header declares, which libmspack ignores); the output cap, only when
libmspack's own expansion is longer than the cap; and libmspack's one
departure from the description: it prefetches input ahead of its reads, and
when that prefetch reaches past the end of the input it stops at the next
token or literal boundary, dropping whatever the last few bytes would still
have decoded (fewer than 24 bits of input, in every case probed), even in a
well-formed stream. We keep those bytes. The owner's real-disc check
(`tools/simtower/disc-check.ts`) compares both decoders against the KWAJ
headers' declared lengths and the disc's own size manifest, which settles that
case on real Microsoft output.

## Running

```sh
cd disc-rs
cargo test                                   # unit tests
cargo test --features testkit                # plus the suites over our own images and vectors
sudo apt-get install libmspack-dev           # the oracle (Ubuntu/Debian)
cc -O2 -o /tmp/kwajd ../tools/simtower/docker/kwajd.c -lmspack
VC_KWAJ_ORACLE=/tmp/kwajd cargo test --release --features testkit
VC_KWAJ_ORACLE=/tmp/kwajd cargo run --release --features testkit --bin disc-fuzz -- --seeds 2000
cargo run --features testkit --bin disc-fixtures   # rewrite fixtures/ after a deliberate change
```

The oracle tests skip without `VC_KWAJ_ORACLE`, except under
`VC_REQUIRE_KWAJ_ORACLE=1`, which CI sets (`.github/workflows/disc-rs.yml`).

## The WASM binding

`Disc.openBytes(bytes, limits?)` and `Disc.openSource({ read(offset,
length) }, size, limits?)` open an image (the second reads on demand, so a
disc is never copied whole); `opened()` returns the listing as JSON;
`read(token)` returns the expanded bytes and their `ReadInfo` JSON;
`readStored(token)` the bytes as stored. A refusal throws an error whose
message is the refusal's JSON.

```sh
npm run disc:wasm:build     # cargo rustc (cdylib) for wasm32 + wasm-bindgen into disc-rs/pkg/
npm run test:disc-wasm      # the module must report exactly fixtures/expected.json
```

`disc-rs/pkg/` is build output and is not checked in.

## Fixtures

`fixtures/synthetic-disc.iso.bin` and `fixtures/expected.json` are our own
bytes, built by the test kit; `tests/fixtures.rs` fails if the committed
image is anything other than what `testkit::synthetic_disc` builds. No byte
of an original disc, game file or game-written save is ever committed (see
`tools/simtower/README.md`).
