---
story: m5-engine-cold-start
status: in-progress
issue: 1254
refs: 1005, 1183, 1185, 1207, 1225, 900, 932, 945
---

# Story: the Rust engine starts at least as fast as TypeScript (M5, PF5)

> **Snapshot.** Written 2026-10-21 between 02:15 and 03:00 UTC, on `main` at
> `272e0e1` and then `4b1e440`. Every figure here is dated and none refreshes.
> The PC figures are Naftali's PC run of commit `a532572`, measured 2026-10-20
> 18:55 to 20:28 UTC, committed in
> `docs/performance/results/2026-10-20-a532572-1051-after/`. The cloud figures
> are diagnostics from this lane's container (headless Chromium, 5 pairs at
> 1x), measured 2026-10-20 about 23:20 UTC to 2026-10-21 about 01:55 UTC on
> `main` at `d06e2a6` and, for the variant table, on the open #1183 and #1185
> heads. They are **not evidence**: they only say where the time goes. The
> live number is whatever the next `npm run perf:compare` on Naftali's PC
> prints (`src/tests/perfCompare`, `report.ts` `coldStartDifferenceLines`,
> tested in `coldStartDifference.test.ts`).

## Why

M5 is the protocol's cold-start row (`docs/performance/benchmark-protocol.md`
section 6). On the last PC run the WASM main-thread host reached `window.game`
later than TypeScript at both throttles:

| Throttle | TypeScript median | WASM median | WASM ÷ TS, paired (95% CI) | ε cap (5% of TS) |
| --- | --- | --- | --- | --- |
| 1x | 404 ms | 472 ms | 1.17x (1.04 to 1.21) | about 20 ms |
| 4x | 542 ms | 676 ms | 1.23x (1.14 to 1.28) | about 27 ms |

That run predates #1201, so its report prints ratios only. Reading its
`results.json` with the harness's own statistic (`coldStartDifferenceLines` in
`report.ts`, the code #1201 added) gives M5 in milliseconds:

| Start | Throttle | Paired median, WASM minus TS | 95% CI of the median | Upper end against the ε cap |
| --- | --- | --- | --- | --- |
| Cold | 1x | +71.8 ms | 19.0 to 79.4 ms | 79.4 against about 20 |
| Cold | 4x | +127 ms | 80.3 to 146 ms | 146 against about 27 |
| Warm | 1x | +19.6 ms | 14.0 to 20.6 ms | reported only |

On that run the boot path's WASM download took about 6.5 ms and its streaming
compile and instantiate about 5 ms at 1x. Those two account for little of the
gap, so on the PC it is mostly the serial wait between DOMContentLoaded and
app creation plus the host attach. The PC report has no mark between those
two, which is the first thing W1 adds. The calendar names M5 as a blocker for the Oct 27
technically ready candidate.

## Frozen intent

Make M5 pass on the host the candidate ships, by making the WASM boot do less
work in series. Today that host is the `wasm` main-thread host A1 measures;
under the facade (slices 7 to 10) it becomes the facade's main-thread host,
and the candidate's run measures that one. Without:

- changing the M5 gate, ε, its cap, or any other approved gate;
- changing gameplay, simulation results, determinism, conformance hashes or
  save bytes;
- weakening the engine package check (#985 criterion 5: nothing from the
  package runs before its bytes match the shell's package id) or the TypeScript
  fallback and its 90 s boot limit;
- timing anything in the cloud and calling it evidence.

## Acceptance

### A1. M5, the gate (unchanged)

`npm run perf:compare`, cold start to ready (`window.game` published), a fresh
browser context, no save (new game, title screen), the `wasm` main-thread host
against `ts` from the same `VC_TOOLING=1` build, at least 10 paired
repetitions, at 1x and 4x. It passes when, at each throttle, the upper end of
the 95% order-statistic interval of the median paired difference (WASM minus
TypeScript, in ms) is at most that throttle's ε. ε comes from
`perf:calibrate` A/A passes and is never above 5% of TypeScript's median cold
start. It is read from the candidate's protocol run (RUN-2 or RUN-3, or the
facade's slice 9 run), on Naftali's PC.

### A2. Warm start, reported only

The same statistic for the warm start (a reload in the same context, so the
HTTP cache and V8's code cache are warm). Target: within the 1x ε. It gates
nothing, because the protocol does not make it a gate and changing that is the
owner's call. On the last PC run the medians were TypeScript 67 ms and WASM
85 ms at 1x, a paired difference of +19.6 ms (14.0 to 20.6 ms).

### A3. Cold start with a saved tower, proposed rows (owner's call)

A returning player's boot loads their autosave (the title screen offers
Continue), and M5's empty tower misses the largest WASM-only cost found here.
W1 adds: `perf:compare` also reports the cold start to ready with the medium
and the large scenario's save seeded as the autosave, with the same statistic,
at 1x only. Reported only. Whether these rows join M5 is a gate change, so it
goes to Naftali and nothing here assumes it; joining would also need the 4x
rows, which W1 does not take. The rows run last in each process, so they
compare the engines with each other and say nothing against M5's own row.
Cloud diagnostic (5 pairs, 1x, each boot in its own fresh context): about
+230 ms on the medium save and about +480 ms on the large one, where the empty
tower shows about +90 ms.

### A4. What must not move

- `npm run typecheck`, `lint`, `test` and `build` green; conformance and the
  dual-run tests unchanged; no conformance hash moves.
- The package check: `engineIntegrity.spec.ts`, `workerPackageCheck.test.ts`,
  `engineGlueImport.guard.test.ts` and `verify-precache` stay green with no
  weaker assertion. A new early entry is in the precache and carries the
  shell's package id.
- The TypeScript control: the TS arm's cold start on the AFTER commit is
  within 5% of BEFORE's, so a change that slows both cannot read as a WASM win.
- The engine identity still reaches About, Copy Diagnostics and
  `identityMismatches`; deferring it must not drop it.
- The fallback: a refused package, a boot timeout and a failed attach end the
  way they do today, with their tests.

### A5. Measuring honestly

Any change to a measuring file (`src/tests/perfCompare`, `src/tests/perfWorker`,
`scripts/perf-*.ts`) follows protocol section 6.2: the AFTER run uses the
BEFORE harness, or the harness diff is additions only, outside the timed
windows, and the independent reviewer confirms it at both commits. Harness
PRs land before the BEFORE run, so BEFORE and AFTER measure with the same code.

W1's harness diff and its two named exceptions:

- The engine-loaded probe is its own init script, which only `perf:compare`
  adds (`installEngineBootProbe`); `perf:worker` shares `installProbes`, which
  is unchanged, so its harness does not move. The probe runs inside every
  timed start on both engines: Playwright evaluates the script at each
  document start (compile, one closure, one `defineProperty`), and its setter
  runs once when boot publishes its state (one `performance.now()`). That is
  the same kind of work as the existing `window.game` and `__vcEngine`
  accessors, and it costs microseconds; a reviewer who wants it measured can
  ask for a same-commit pair with and without the script.
- `newContext` gains an optional storage-state argument; the existing calls
  pass the same options as before.

Everything else W1 adds runs after the repetition's measurements or in Node
before the first browser. #1183 also edits `page.ts` and `runner.ts`, so a
BEFORE/AFTER pair must have #1183 on both sides or on neither.

## Where the time goes (cloud diagnostic, not evidence)

The TypeScript boot creates the app during module evaluation. The WASM boot
first awaits the engine package (download, compile, glue, `init`, and
`readEngineIdentity`), then creates the same app (which still builds a
TypeScript `Simulation`), then attaches the host: both catalogs read and
checked, the TS tower serialized (`loadCommand`), and `Engine.fromSave` on it.
Medians over 5 pairs at 1x, each boot in a fresh context, main at `d06e2a6`:

| Boot | Load phase after DCL (WASM only) | App create (both) | Host attach (WASM only) | Ready, paired WASM minus TS |
| --- | --- | --- | --- | --- |
| Empty tower | about 53 ms | about 220 ms | about 27 ms | about +90 ms |
| Medium save | about 50 ms | about 290 ms | about 186 ms | about +230 ms |
| Large save | about 46 ms | about 430 ms | about 415 ms | about +480 ms |

The large-save attach, from a CPU profile of an unminified build: `fromSave`
about 340 ms (deserialize 239, `migrate_save` 93 of it, `dlmalloc` growth 119,
`parse_save_json` 77, the `serde_json::Value` trees about 82, `widen_legacy` 51,
`RandomState` 22; the items overlap) plus the TS serialize about 52.

#1183 (the verified engine load, not merged yet) adds about 25 ms to the load
phase in the cloud: the compile now waits for the whole download and the three
digests, and `WebAssembly.compile(bytes)` cannot use V8's code cache. #1185
sits on top of #1183, so its head carries both. Three changes tried on top of
that head in a scratch worktree (never pushed), each from 3 to 5 boots with no
spread worked out, so read them as a direction only:

| Variant, each row adding to the one above | Load phase after DCL |
| --- | --- |
| the #1185 head (#1183 and #1185) as is | 77 to 83 ms |
| plus an early entry that starts the package load from `index.html` | 68 ms |
| plus the identity read off the boot path | 52 ms |
| plus compile started on the verified sizes, digests in parallel, glue imported after its own digest | 44 ms |

End-to-end cloud pairs are too noisy at 5 pairs to show these as a ready-time
change, which is why every claim waits for the PC.

## Work items

Each is a small PR with merge commits only, `/gds-code-review` (engine boot) and
`/bmad-code-review` (plumbing) before review, an HP-1 to HP-12 record on any
hot-path diff, and an independent review through the coordinator. No item
changes gameplay or determinism. Order is by dependency, and W1 lands first.

| # | What | Files | Owner or agreement | Depends on | Tests | Bump |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Harness: the engine-loaded mark (when boot publishes its state, just before the app is created; on WASM the end of the package load) and the split after it, the M5 statistic for the warm start, the mark and the split (reported only), and the saved-tower cold-start rows (A3). #1005's idle-page split of fetch and compile stays on its own row (`perf-compare-startup-rows`) | `src/tests/perfCompare/page.ts`, `runner.ts`, `report.ts`, `types.ts`, `metrics.ts`, `validate.ts`, `savedStart.ts`, `main.ts`, tests beside them | this lane; #1183 also edits `page.ts` and `runner.ts` | whichever of W1 and #1183 merges second resolves the overlap; a BEFORE/AFTER pair has #1183 on both sides or neither (A5) | report, metrics, validation, seed and probe tests, a boot-order guard; a `--quick` run in the cloud for wiring only | none (tooling) |
| W2 | Early package start and the identity off the boot path: a small entry starts `loadEngineModule` from `index.html` before the main bundle; `loadBootEngine` takes its promise; the identity is read after the first frame and on demand in diagnostics | new `src/engineEarly.ts`, `vite.config.ts`, `src/bootstrap.ts`, `src/wasmhost/engineBoot.ts`, `engineDiagnostics.ts`, `e2e/engineIdentity.spec.ts`, `scripts/verify-precache.ts` | Offline (#985) and Runtime agree first; facade told | #1183, #1185 merged | early entry used once and only for a wasm choice; identity present in About and Copy Diagnostics; precache carries the entry; boot-timeout and refusal unchanged | patch |
| W3 | Verified load in parallel (#1183's HP-11): compile starts as the verified bytes arrive, the glue and binary digests run together, the glue is imported only after its own digest, `init` runs only after both match; keep V8's code cache where a URL-backed streaming compile allows it | `src/wasmhost/loadEngineModule.ts`, `enginePackageCheck.ts`, tests | Offline lane owns the files; this lane proposes the PR | W2 | the package-check suite unchanged and green, plus a test that nothing runs before both digests match | none or patch |
| W4 | Attach budget for the facade host: catalogs read once (a Rust memo of the catalog value shared by `catalog_json` and the identity digests), no TS serialize at boot, a new game made in Rust | `engine-rs/src/catalog.rs`, `identity.rs` (unowned, hash-preserving); the attach path belongs to facade slices 7 and 10 | facade thread decides the host side | slice 7 | conformance unchanged; catalog and identity byte-equal to today | none for the memo |
| W5 | Saved-tower attach (if A3 rows are accepted, or as plain speed): `fromSave` without the `serde_json::Value` trees, cheaper `migrate_save` and `widen_legacy`, memory grown once | `engine-rs/src/load.rs`, `load_stream.rs`, `from_save` body | A8 (#1225) owns them; this lane hands it the profile | A8's plan | A8's save round-trip suite | per A8 |
| W6 | Overlap app creation with the engine load (the first tower must still be hosted before its first tick) | `src/bootstrap.ts`, `src/main.ts` | facade slice 7 builds it: the app shell and renderer are made while the package loads, with no TS `Simulation`, and the first tick and first input wait on the port (agreed 2026-10-21 02:13 UTC, written on #1217) | slice 7 | slice 7's | slice 7's |
| W7 | #932: the TDT codec's share of the served package (about 17% of the gzipped binary). Build the package with and without the codec behind a cargo feature and compare cold start on the PC at 1x and 4x; on the PC's local server the download is about 6.5 ms, so expect a compile-time share there and a larger one on a real network. Measuring without the codec is fine; a shipped change must keep TDT import and export working (the codec loaded lazily, or a second package under the same integrity rules), never drop it. A change to the default package moves the replay key, so it lands before the engine freeze | `engine-rs/Cargo.toml`, `scripts/wasm-build.ts`, the codec's module gate | this lane; the design is agreed with the TDT import lane (A7) and Offline before it is built, since a split package touches the package-integrity gates | W1 | the package-hash and compat guards; TDT round trip on the native build | crate minor if the default package changes |
| W8 | #900: M7's WASM baseline. `e2e/perf.spec.ts` runs on both Playwright projects, `e2e/perf/baseline.json` keyed by engine, `update-perf-baseline.yml` mints each engine's baseline without overwriting the other, each engine compared with its own baseline only. M7 is a CI tripwire by protocol design and gives no desktop number | `e2e/perf.spec.ts`, `e2e/perf-harness.ts`, `e2e/perf/baseline.json`, `.github/workflows/update-perf-baseline.yml`, `scripts/` perf compare | this lane | none | guards for a missing or mismatched engine key | none (tooling) |

## PC run spec

Written for the coordinator to hand to the PC thread (the project's
`release-3.0/m5-startup/pc-run-m5-startup-spec.md`). P1 is a diagnostic run of
`main` once W1 merges. For the BEFORE/AFTER pair, BEFORE is `main` with W1
merged and AFTER is the candidate, with #1183 on both sides or neither (A5).
The empty-tower verdict is read from the facade's slice 9 run on the
candidate, so it needs no run of its own.

## Risks

- **ε is small.** 20 ms at 1x is a little over one frame at 60 Hz. If the cold-start
  A/A spread exceeds the cap, calibration does not adopt and, after two
  rounds, the coordinator takes it to Naftali (protocol 6.1 step 4). Nothing
  here widens it.
- **Code cache.** Headless Chromium in the cloud and Chrome on the PC can treat
  the code cache differently; warm-start numbers are only read on the PC.
- **Package check.** Starting the compile before the digest finishes is safe
  only because compiling runs nothing; W3 must keep the glue import and `init`
  behind both digests, and its review checks that first.
- **The early entry.** A second entry chunk must be in the precache, carry the
  package id, and fall back to the normal path when absent; `verify-precache`
  checks it.
- **Ownership.** `bootstrap.ts` and the engine loader files are shared with
  Runtime and Offline, and slices 7 and 10 will change the boot again. W2 is
  kept small so it rebases cleanly under them.
- **The facade can change the picture.** Under slice 10 there is no TS
  `Simulation` in the WASM boot, so app creation gets cheaper on WASM and the
  attach becomes a Rust new game or `fromSave`. M5 is decided by the
  candidate's run, and today's host only guides the work.
