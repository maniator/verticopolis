# What the .TDT codec adds to the served engine package (#932)

> **Snapshot, measured 2026-11-03** on `main` at `7933cba0` (app 2.77.5, engine
> crate 1.5.2). It does not refresh. The live size of the served package is the
> `verticopolis_engine_bg.wasm` that `npm run build` emits (see the `precache`
> line of the build log); the commands under [Reproduce](#reproduce) redo this
> measurement. These are **sizes and a desktop compile time, not load time on
> the reference device**: that run needs the owner's PC under the benchmark
> protocol (`benchmark-protocol.md`) and is still open.

## Result

The package is the `.wasm` that `wasm-bindgen --target web` writes from the
release build, the file players download. "Without the codec" is the same build
with the four entry points that reach it (`importTdt`, `exportTdt`, and the
port's `loadTdt` and `tdtExport`) answering a refusal, so the linker drops what
only they reach. Code that other features share stays, so the figures are a
floor on what the codec costs.

| | With the codec | Without | The codec adds |
| --- | ---: | ---: | ---: |
| raw | 2,028,516 bytes | 1,779,823 bytes | 248,693 bytes (12.3%) |
| gzip -9 | 621,823 bytes | 547,402 bytes | 74,421 bytes (12.0%) |
| brotli, quality 11 | 447,923 bytes | 397,893 bytes | 50,030 bytes (11.2%) |

These are the sizes of the `wasm-bindgen` output. The file the game ships is the same output after `npm run wasm:build` (`scripts/wasm-build.ts`) stamps it with a build-metadata section, which adds the same bytes to both builds, so the codec's difference above does not change.

Vercel serves the brotli figure to browsers that accept it, so the download
cost is about 50 KB on a 448 KB file. The 2026-10-10 figure in the issue (56 KB
gzip) was the codec at its first merge; it has grown to 74 KB gzip as the
importer gained the stairs, parking and hotel rules.

Compile time on a desktop in Node (`WebAssembly.compile`, 15 runs, medians): 3.9
to 4.5 ms with the codec, 3.4 to 3.5 ms without, so about 0.5 ms. The browser
compiles lazily and in streaming fashion, so this says the codec is not a
compile-time cost on a fast machine; it does not say what a low-end phone sees.

## What the numbers support

- The cost is real and bounded: about 11 percent of the download and about
  half a millisecond of compile on a desktop.
- A cargo feature that drops the codec from the web package would not be a small
  change. The codec reads and writes through the live tower (`port_load_tdt`
  stages a `Simulation`; the streamed export walks the tower's own units), so a
  second package could take only the pure byte-in, JSON-out and JSON-in,
  byte-out calls, and would have to duplicate the loader's save checks. That is
  a second wasm module with its own loading, caching and update path.
- Recommendation: do not split the package for 3.0.0. Close #932 when the owner's
  PC run (below) shows that the time to ready on the reference throttle is within
  its budget with the codec in, which the desktop numbers suggest. If that run
  shows a visible cost, the split becomes a 3.x change with its own issue.

## What still needs the owner's PC

One run under the benchmark protocol at 4x CPU throttle, standing in for the
reference low-end device: the current package against the same tree built with
the codec entry points answering a refusal (the "without" build below), cold
and warm, compared by the protocol's M5 (time to ready). About 40 minutes. The
"without" build exists only for this comparison and must not ship.

## Reproduce

From a clean checkout of the commit to measure (this reproduces the unstamped `wasm-bindgen` output; `npm run wasm:build` produces the shipped, stamped file):

```
cd engine-rs
cargo rustc --locked --release --lib --target wasm32-unknown-unknown \
  --features wasm --crate-type cdylib
wasm-bindgen --target web --out-dir /tmp/with target/wasm32-unknown-unknown/release/verticopolis_engine.wasm
```

For the "without" build, change the bodies of `import_tdt` and `export_tdt` in
`src/wasm.rs` and the starts of `port_load_tdt` and `port_tdt_export` in
`src/wasm_port_files.rs` to return an error or `vec![0.0]` straight away, build
the same way into `/tmp/without`, and discard the change. Then compress each
`_bg.wasm` with `gzip -9` and Node's `zlib.brotliCompressSync` at quality 11, and
time `WebAssembly.compile` over repeated runs.
