# Story: verified engine load (#985 criterion 5, slice 2)

Status: in progress (slice 2a). Design:
`_bmad-output/planning-artifacts/design/design-engine-package-set-consistency-2026-10-15.md`
(sections 5.3 to 5.5, 6, 10, 11). Slice 1 (#1103) shipped the record, the
verifier and the precache integrity. This story wires the verifier into every
route that loads the engine.

## Why

A page that loads the WASM glue from one deploy and the binary from another
(or a corrupted cache entry) runs a mixed engine. Slice 1 can tell the bytes
apart but nothing calls it. #985 criterion 5 is a 3.0 release blocker.

## Split

The design is too large for one reviewable PR, and the wasm-only flip needs
only the second half. Both halves are required before #985 can close.

**2a, the gate (this PR).** Every load route fetches, verifies and
instantiates the same bytes.

**2b, recovery and proof.** Reason-specific failure screens, Copy Diagnostics
and Repair engine files, cache-key rotation at the first schema 2 worker, the
install
race, eviction, repair and first-install e2e specs, and the pre-registered
load-cost measurement on the owner's PC (booked until about 02:00 UTC on
2026-10-21).

## 2a acceptance criteria

1. **One verified loader.** `loadEngineModule` (new, `src/wasmhost/`)
   fetches `BUILD.json`, the glue and the binary through
   `verifyEnginePackage`, imports the glue from a Blob made of the verified
   bytes, calls `init({ module_or_path })` with the verified binary, and
   revokes the Blob URL when the import settles. No file is fetched twice.
2. **Three routes use it.** The main-thread boot (`loadWasmEngine`), the
   engine worker (`engineWorker.ts`, which also covers the respawn path) and
   the dual run's worker (`dualrun/worker.ts`). No other module imports the
   glue by URL.
3. **The deadline is the loader's.** `loadBootEngine` hands the load an
   `AbortSignal` and aborts it at the existing 90 s limit. The loader checks
   the signal after every await and before the import and the init, and a
   result that arrives after the deadline is dropped.
4. **Failure codes.** A refusal keeps the closed `FALLBACK_REASONS` list as it
   is: `mismatch` reports `package-mismatch`, `load-failed` and `unverifiable`
   report `boot-error`, the deadline reports `boot-timeout`. The boot state's
   `failure` also carries the package detail (kind, file, both ids, whether a
   worker controlled the page), codes and hex ids only, never in analytics.
   `unverifiable` reported `boot-error` in 2a. The owner approved the new
   code on 2026-10-20; the follow-up PR (stacked on 2a) adds it to the closed
   lists, outside the fault rate, with its own line.
5. **Builds.** A switchable build that is refused stays on the TypeScript
   engine (existing behavior, one `console.error`). A wasm-only build stops
   with the existing engine failure screen. The screens' copy is 2b.
6. **The shell carries the id.** `__ENGINE_PACKAGE__` is referenced by the
   shipped loader chunk, and `scripts/verify-precache.ts` fails the build when
   a chunk carries another id, when no chunk carries it, or when the
   development-only skip survives into `dist/`.
7. **The dev skip cannot ship.** `import.meta.env.DEV` skips verification so
   `npm run wasm:build` during a dev session does not need a restart. The
   branch holds a unique marker string, and `verify-precache` (run by
   `postbuild`) fails when that string is in any emitted `.js`, `.mjs` or
   `.html` file (source maps carry the source text, so they are not scanned).
   A positive assertion that the loader chunk carries the check is a 2b item.
8. **Real second build.** The offline e2e builds deployment B with a second
   `vite build` (a public folder with the salted package), so B's shell
   carries B's id. The existing update spec then proves B's engine runs with
   no fallback.
9. **Tamper e2e.** A tampered precache entry (binary, then glue) is refused
   with the boot state naming both ids; an uncontrolled page routed to a
   salted binary is refused; a persisting mismatch causes no reload loop.
10. **Perf harness.** The perf harnesses no longer import the glue to reach
    the app's instance (that is a second module now). Their init probe keeps
    the first `WebAssembly` instance's memory and the memory read uses it.
    The boot-path probe now times `instantiate` from bytes, not
    `instantiateStreaming` (2b measures the load cost).
11. **Hot path.** The loader runs once per page life and once per worker
    (checklist `docs/performance/hot-path-review.md`): one linear pass over
    about 1.45 MB for the digests, no per-frame or per-step code.
12. **Version.** Minor bump (opt-in players on `?engine=wasm` see refusals,
    and `sw.js` and the shell change).

## Code classification

Permanent host infrastructure: the loader, the failure detail, the shell id
check, the dev-skip guard, the e2e deployments.

Temporary, removed with the TypeScript engine (line added to "What it
removes" in `story-engine-retire-typescript.md`): the switchable build's
branch that keeps the game on the TypeScript engine after a refused package
(`loadBootEngine`'s `!wasmOnly` path and its tests), the non-wasm-only branch
of `e2e/engineIntegrity.spec.ts`'s refusal check, and the `!__WASM_ONLY__`
worker-host catalog verdict in `bootstrap.ts`. The first already exists and
this slice only gives it a reason; the other two are small and listed in the
retirement story.

## Coordination

- #963 stamps a `verticopolis.build` wasm custom section in
  `scripts/wasm-build.ts` before any digest is taken, and adds an optional
  `crate` key and `sources` to the expected record. This slice reads
  `BUILD.json` and never writes it; it changes neither the record nor the
  digest code, and the e2e fixture recomputes B's record with
  `engineBuildRecord`.
- #874 (merged) owns the runtime fallback; this slice only feeds it a reason.

## Out of scope for 2a

Failure copy (slice 2b-1), Repair, cache-key rotation, the
the respawn latch, eviction, install-race and first-install specs, the load
measurement, Safari and Firefox passes (a merge condition for the wasm-only
flip, design section 11).

## Slice 2b plan (2026-10-21)

Slice 2b is split into four small PRs so each gets its own review:

1. **2b-1, failure screens.** `engineFailureCopy` gives each load cause its own
   sentence (design 5.4): `mismatch` with the package ids it knows (an
   "unavailable" label for the rest, and the file that differs when both sides
   name the same package), `load-failed` (with a corrected-deployment sentence
   when the build carries no package, and no "connect to the internet" for an
   online player), `timeout`, `unverifiable` (HTTPS on an insecure connection,
   a plain retry on a secure one) and the missing save writer, which carries a
   `cause` of its own. The sentence comes from the code, the cause and the
   package detail. Every failure at the load stage has one; a start or host
   failure keeps its message. Copy Diagnostics already renders on every stop
   screen. No player sees these screens until the wasm-only build ships, so
   there is no version bump.
2. **2b-2, Repair.** The **Repair engine files** action, offered when a worker
   controls the page and the reason is `mismatch` or `load-failed` (design 5.4,
   "Corrupted-entry recovery"): replace the running build's three engine keys in
   place after the digests match, one registration update, never delete first.
   Done in this slice; the record is `review-offline-package-slice2b2-2026-10-21.md`.
   The Repair fetch carries a `vc-repair` parameter, because a plain fetch of an
   engine URL from a controlled page is answered by the precache route from the
   damaged entry. The revisions are compiled into the shell as
   `__ENGINE_PACKAGE__.revisions`.
3. **2b-3, cache-key rotation.** Design section 8: change the engine cache keys
   with the first schema 2 worker, or purge the three engine keys at its first
   activation, so a mixed set stored by a pre-integrity worker does not survive
   the update.
4. **2b-4, remaining e2e.** Install race, eviction, first install, Repair with a
   waiting build or another tab and with an online save kept, plus
   the respawn refusal latch and the deferred notes on the #985 row. The
   load-cost measurement on the owner's PC runs alongside and is not a merge
   condition.
