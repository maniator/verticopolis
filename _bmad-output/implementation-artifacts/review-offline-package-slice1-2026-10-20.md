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
  failing) is a stop, not a `load-failed` that could outrank the real failure.
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
- Criterion 7 tests, the two-deployment fixture server specs, the CI offline
  job, the load-cost measurement and the version bump.

## Rejected

- A per-entry comparison branch in the verifier: the package id is recomputed
  from the served entries, so a forged entry already fails there.
- A JavaScript SHA-256 fallback for browsers without `crypto.subtle`: owner
  decision 3 on the design says no.
