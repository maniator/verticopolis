# Review record: #985 slice 2a (verified engine load)

Branch `claude/offline-package-slice2`. Spec:
`story-985-slice2-verified-engine-load.md`. Reviews run in the authoring
session, 2026-10-20: `/bmad-code-review` (plumbing: build guards, e2e
fixtures, loading line, perf harness) and `/gds-code-review` (engine boot),
each with a Blind Hunter, an Edge Case Hunter and an Acceptance Auditor, plus
a hot-path audit against `docs/performance/hot-path-review.md`.

## Hot-path record (HP-1 to HP-12)

Surface: `src/wasmhost` is a hot-path directory, but nothing this slice
changes runs per frame, per step, per chunk or per hour. The loader runs once
per page life, and once per engine worker spawn (boot, and a respawn after a
fault, once, on the next adopt).

| Item | Result | What was checked | Resolution |
| --- | --- | --- | --- |
| HP-1 | clear | Every caller traced. `loadWasmEngine` has one caller (`bootstrap.ts`); `loadEngineModule` has three (main-thread boot, engine worker, dual-run worker); `catalogVerdict` has two (a refused attach in `startWasmHost`, once at boot in `bootstrap`). Nothing reaches the frame loop, `advance_step`, render sync or `canBuild`. | none |
| HP-2 | clear | No collection of units, rooms, people, floors, transports or the route graph is walked. The loader makes one linear pass over about 1.47 MB per load; `catalogVerdict` reads two catalogs of about 20 KB (under 1 ms), and now only on a refusal. The independent review measured the three digests in headless Chromium: about 0.1, 0.4 and 4.8 ms (242 B, 48 KB, 1.44 MB), so the binary's SHA-256 is about 4.6 ms there, not the 1.2 ms Node figure; still once per load. | none |
| HP-3 | clear (info) | Transient copies at load only: stream chunks plus the joined buffer, the digest's input copy, the Blob copy of the 47 KB glue, the engine's own wire bytes. About 3 to 4.5 MB above `main` while loading, none kept (the glue keeps only the compiled module, the instance and its exports). Steady state is unchanged. | none |
| HP-4 | n/a | No sort or ordered rebuild added. `shellProblems` uses Set and Map at build time. | none |
| HP-5 | n/a | No container on a hot path, no Rust change. | none |
| HP-6 | n/a | No id lookup or removal. | none |
| HP-7 | clear | The catalog verdict moved from `startWasmHost` into `catalogVerdict` with the same cost and the same memo (`foreign` and `native` kept, `failing` asked again). It is called as a method now, so the binding keeps its `this`. | none |
| HP-8 | n/a | Nothing ported between engines; no cache, index or counter added or removed in either. | none |
| HP-9 | n/a | No HP-2 to HP-6 finding needed a remedy. | none |
| HP-10 | clear | No new cache; no RNG, engine state or event touched; the engine runs from the verified bytes, which are the same bytes. Conformance lock untouched. `foreignCatalog.test.ts` covers the three verdicts. | none |
| HP-11 | finding (low) | The glue's `init` now takes bytes, so compile starts after the download and the hash finish: the download and compile no longer overlap, and the binary no longer goes through the URL-keyed code cache. One time per page life or respawn. | Deferred by reference: the #985 row (load-cost measurement on the owner's PC; it must include a repeat boot from the precache and the first steps' time) and #1005. |
| HP-12 | clear | The loading line sets two timers, one element and one rAF, all cleared on stop; static CSS, no animation. | none |

## /bmad-code-review round

Fixed (`patch`):

- Perf harnesses (`perfCompare`, `perfWorker`) imported the glue by URL to reach
  the app's instance. The loader imports from a Blob now, so that was a second
  module and the memory read threw. The init probe keeps the first
  `WebAssembly` instance's memory and the read uses it.
- A worker package with no `catalog` export was coded `boot-error` where the
  main-thread host codes it `package-mismatch`. The worker now throws the
  mismatch.
- The worker's reply `reason` is validated against `FALLBACK_REASONS`.
- `catalog` is called as a method (`this` kept); the worker-host catalog verdict
  is computed only for a refused first tower.
- Loading line: an announcement made just before the stop no longer lands after
  it; the slow-load text no longer claims a first visit; the fast-load e2e
  skips on a machine too slow to come up inside the delay.
- E2E: deployment B's `vite build` has its own budget (`beforeAll`) and error
  reporting; its engine mode is spelled out both ways and unknown is an error;
  `BUILD.json` is read lazily; the tamper tests assert the served package id;
  spec 1 also hashes the cached `BUILD.json`; spec 6 counts the player's reload.
- Build guard: `PACKAGE_MEMBER` reads backtick and escaped quotes;
  `Dirent.parentPath` has a fallback.
- Docs: CHANGELOG 2.41.0 section; stale "imported by URL" comments in five
  files; AC7 wording; the retirement story names the bootstrap worker-host
  branch.

Deferred (recorded on the #985 backlog row, "Slice 2b still owes"): load cost
and code cache (with the harness boot-path probe now timing `instantiate` from
bytes), the respawn refusal latch and its lost detail, `verified: false`
reporting, a positive assertion that the loader chunk carries the check, a
test of the worker-side `controlled` flag, the two source-citing notes of
design section 11, a CSP note for `blob:` scripts.

## /gds-code-review round

Run on the diff after the bmad round's fixes, with the engine boot as the
focus. Layers: Blind Hunter (diff only), Edge Case Hunter (engine boot walk),
Acceptance Auditor (story and design). No finding touched simulation
behavior, save fidelity, which engine is adopted, or the `engine_status`
codes; all three confirmed the same bytes run on the main thread, the engine
worker (respawn included) and the dual-run worker.

Fixed (`patch`):

- The backlog gained blank lines around the #1132 row, which ended the table
  for `backlogIssueMirror.test.ts` and `backlog-priority-labels.yml`, so 19
  rows were no longer checked or label-synced. Removed.
- A wasm-only boot failure threw an error whose message held the refused
  package's file and digests, and the exception tracker groups by message. It
  now names the code and kind only (the detail stays on the console and in
  `__vcEngineBoot`).
- A worker's failed-load reply is held to the load codes (`boot-error`,
  `package-mismatch`, `boot-timeout`) and its package detail is rebuilt from
  known values (kind and file from their lists, ids as 12 hex digits).
- `loadWasmEngine` took no options, so its tests went through the dev skip.
  It takes them now, and two tests cover the verified route (the code for a
  binding the shell cannot use, and the deadline signal).
- The fast-load e2e skipped on nearly every machine (it timed from
  navigation). It now warms the HTTP cache, times from when boot settles, and
  holds only a load that beat the delay to the claim.
- E2E: the spy also counts `new WebAssembly.Module` and `Instance`; the
  uncontrolled-route tests send the new `Content-Length`; the no-reload test
  counts `load` events, not same-document navigations; the update spec builds
  deployment B only on the projects that run it.
- The slow-load note is announced too. The CHANGELOG no longer says the game
  "tells you why". The #1132 and #1086 backlog text matches the code. Smaller
  copy and comment fixes (the dual-run worker's comment, the loader's doc
  comment, one spelling).
- A test pins that the glue has no imports of its own and reads its URL only
  for the default binary path, since a Blob URL has no folder.

Deferred (added to the #985 row): an engine that finishes compiling after the
deadline stays in memory (the streaming load did the same); the perf
harness's raw WASM mode still imports the glue by URL; the shell-id check
accepts any chunk that carries the id.

Dismissed: the temp-folder leak when deployment B's build throws
(`startDeployments` removes it).

## Verification

`npm run typecheck`, `npm run lint`, `npm test` (413 files, 5710 tests), and
`VC_TOOLING=1 npm run build` (switchable) and `VC_TOOLING=1 VC_ENGINE=wasm npm
run build` (wasm-only) green. E2E: `engineIntegrity`, `bootLoading`,
`offlineUpdate` and `wasmOnly` on the wasm-only lane (21 tests), and the first
three on `chromium-wasm` against the switchable build (10 tests). One tamper
spec failed once on `chromium-wasm` and passed on five reruns; watch it in CI.
