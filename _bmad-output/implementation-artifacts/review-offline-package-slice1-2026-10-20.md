# Review: engine package set check, slice 1 (#985 criterion 5), 2026-10-20

Branch `claude/offline-package-985`. Spec: section 5.1 to 5.3 of
`_bmad-output/planning-artifacts/design/design-engine-package-set-consistency-2026-10-15.md`.
Surface: build output and a pure verifier (`src/wasmhost/enginePackage*.ts`,
`src/build/enginePackageBuild.ts`, `vite.config.ts`, `scripts/verify-precache.ts`,
`scripts/wasm-build.ts`). The loader is not wired to the verifier yet (slice 2,
after #874).

`/bmad-code-review` ran with its three layers (Blind Hunter, Edge Case Hunter,
Acceptance Auditor) and triage. The change is build and storage plumbing, so
the bmad skill is the one the repo asks for. Slice 2 touches engine boot and
will also get `/gds-code-review`.

## Patches applied

- Verifier: the record is parsed before the size comparison so a wrong-size
  glue or binary reports the served package id next to the expected one.
- Verifier: Content-Length is compared only for bodies that are not
  compressed (the stream yields decoded bytes, the header counts encoded ones).
- Verifier: an abort that arrives mid-body (the caller's deadline or a sibling
  failing) is a stop that must not outrank the real failure as a `load-failed`.
- Verifier: a redirect whose final URL cannot be parsed is `load-failed`, and a
  refused response cancels its body.
- Verifier: `isControlled` no longer throws when `navigator.serviceWorker` is
  missing; `browserDigest` accepts a missing `crypto`.
- Record: the file-name check is set based; unknown keys (top level or inside
  an entry) are ignored and dropped, so a later field cannot strand an older
  shell. A missing or extra file is still refused.
- Build: `readExpectedPackage` reads nothing outside a production build, so
  Vitest and dev never depend on whatever package is on disk.
- Build: the define mode is `command === "build"` only (no `VITEST` special case).
- Build: the integrity transform asks Vite for the resolved output folder
  instead of assuming `dist/`.
- Build: `manifestIntegrity` matches `url` and `integrity` only as whole keys,
  and `engineDistProblems` reports an engine entry that is missing from the
  manifest.
- CI: `src/wasmhost/enginePackageRecord.ts` joins the hashed script list of the
  `engine-wasm` cache key, since `scripts/wasm-build.ts` imports it.
- Tooling: `precacheUrls` in the perf bundle reader tolerates `integrity` in
  any position in a manifest entry.

## `/gds-code-review` pass (2026-10-20)

Blind Hunter, Edge Case Hunter and Acceptance Auditor ran on the PR diff.
Patches applied from it:

- `engineAssets.ts` said the page already hashes the package; reworded to say
  the loader will, since the loader is not wired in this slice.
- An empty `src/public/engine/` folder counts as no package (the same test
  `verify-precache.ts` uses). A leftover folder with a bad record still stops a
  `VC_ALLOW_NO_ENGINE=1` build, as it did before (the confirming pass showed
  that relaxing it only moved the failure to `verify-precache`).
- The build reads `BUILD.json` without a leading byte order mark, as the
  page's `TextDecoder` does.
- The Workbox integrity comment now says it covers newly fetched entries only.
  Workbox serves an entry already cached under the same revision key without
  re-checking, so caches filled by an earlier worker are covered by the page's
  byte check in slice 2 (and a cache key bump is an option there).
- The `captureOutDir` block no longer splits `emitVersionJson`'s doc comment;
  the "rejected" note cites decision 4; "X, not Y" phrasing reworded.

Dismissed: the served-record package comparison being redundant (the design
requires it and it catches a stale cached BUILD.json with a clear mismatch
screen); base-path handling in the integrity match (`base` is `./` and
`verify-precache` fails loudly if an entry is missed); brittle regex reading
of `sw.js` (an existing approach, covered by `verify-precache`).

## Deferred to slice 2 (tracked on #985, the open backlog row `offline-pwa-engine-audio`)

- Shell and dist package-id agreement check in `verify-precache.ts` (needs
  `__ENGINE_PACKAGE__` referenced in a shipped chunk, which slice 2 does).
- Dev skip (`import.meta.env.DEV` gives an unverified load) and its test that
  the skip cannot reach a production bundle.
- Routing the worker host and the dual-run worker through the verified loader.
- A short body that ends cleanly reads as `mismatch`; slice 2 decides whether
  the screen distinguishes a cut-off download.
- Stale HTTP-cache bytes on an uncontrolled page: the failure screen's Reload
  and Repair copy.
- The `unverifiable` fallback reason extends the closed `engine_status` list
  (`docs/analytics-data-map.md` and the governed definition test); it needs the
  owner's production OK.
- Shell and dist package id agreement was raised again by the Blind Hunter (a
  long-lived Vite process could bake an older package than `dist/` holds).
- Criterion 7 tests, the two-deployment fixture server specs, the CI offline
  job, the load-cost measurement and the version bump.

## Rejected

- A per-entry comparison branch in the verifier: the package id is recomputed
  from the served entries, so a forged entry already fails there.
- A JavaScript SHA-256 fallback for browsers without `crypto.subtle`: owner
  decision 3 on the design says no.
