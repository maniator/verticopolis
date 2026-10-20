# Review: criterion 7 tests for #985, 2026-10-20

Branch `claude/offline-criterion7`. Test-only change: `e2e/deployments.ts` (a
two-deployment fixture server), `e2e/offlineUpdate.spec.ts`, extra cases in
`src/pwa.test.ts`, and the #985 backlog row. No product code, no version bump.
The surface is service worker and PWA plumbing, so `/bmad-code-review` is the
skill the repo asks for (no engine boot or gameplay code is touched).

`/bmad-code-review` ran with its three layers (Blind Hunter, Edge Case Hunter,
Acceptance Auditor) and triage.

## Patches applied

- The cache check is exact: one cache name, one key per entry in the
  deployment's own `sw.js`, and the three engine files (glue, binary, record)
  each under that build's revision. The first draft compared a count before
  and after, which would have passed a cache that was wrong from the start, and
  looked only at the glue key.
- The second deployment's binary differs too (a valid WebAssembly custom
  section with a one-byte payload), so all three engine entries must be replaced by an update.
- The revisions and the entry count come from each deployment's `sw.js`; the
  fixture computes none of its own.
- The offline window opens before the network is cut, and `updateTo` waits for
  no installing or waiting worker before the test goes on (a controller alone
  was already true under the old worker).
- The fixture throws, with the reason, when the second `sw.js` equals the first
  (the browser would never find an update); it removes its scratch folder when
  its own setup throws; the test opens its `try` right after
  `startDeployments()` and closes the context, then the server, in nested
  `finally` blocks.
- Server: `dist` is resolved, request targets with a `//` start, a NUL, a colon
  or a bad escape are refused, paths are percent-decoded, more MIME types.
- `src/pwa.test.ts`: `{}`, array and wrong-type bodies; the success case finds
  the `version.json` call by URL and checks the cache-busting query.
- Comments say what the fixture does not model (ETag, Range, rewrites).

## Independent review (2026-10-20): CONDITIONAL GO at f973f3b

Conditions fixed in the follow-up commit:

- The PR body no longer carries a closing keyword (the earlier `Closes #` line
  made GitHub list the PR as closing #985, a release blocker).
- `updateTo` waited on an `async` predicate, which resolves on the first poll;
  it now uses `expect.poll`.
- The offline window kept the server on the first build, so Chromium's own
  `sw.js` update check (about two seconds after a load, not stopped by
  `setOffline`) could install it in the background. The server now keeps
  answering with the second build, the window is held four seconds past that
  check, and the log must show nothing but the update check (`sw.js` and the
  imported `workbox-*.js`). Only after the window does the flow switch to the
  first build and make `version.json` answer 404, and the prompt is asserted to
  name no build (and to name `999.0.0` when `version.json` arrives).
- Online reads of the glue and `BUILD.json` assert the service worker answered.
- "A bounded precache": the byte bound is the build gate
  `scripts/verify-precache.ts` (4 MiB, run by `postbuild`); named in the spec
  docblock, the backlog row and the PR body. The e2e covers no growth across
  an update.
- "Best effort `version.json`": the claim now says it holds on the
  `onNeedRefresh` path. A unit case pins that the hourly backstop offers
  nothing when `version.json` is missing (`isDifferentBuild(null)` is false);
  whether that should change is recorded on the row.
- Unit cases assert `version.json` was requested, and the stall case asserts
  the signal aborted at four seconds. The salt comment says one payload byte.
- The "one-minute hold" is no longer a rationale: it appeared locally, not in
  CI (the spec runs in about 20 s there). The 240 s limit stays as headroom.

## Deferred to slice 2 (on the #985 backlog row)

- Deployment B's page bundle still carries deployment A's compiled-in
  `__ENGINE_PACKAGE__`. Nothing reads it yet. When the loader checks the engine
  against it, B needs a real second `vite build` (design section 6.2): an
  in-place rewrite of the chunk keeps A's cached copy, since `/assets/` is
  immutable and keeps its precache key. Recorded in the fixture's header
  comment.
- Design 6.2 specs 1 (hash the three cached bodies against `BUILD.json`), 3
  (uncontrolled mix) and 6 (no reload loop); this change compares key
  revisions only.
- "One precache and no other cache" cannot fail while both builds share the
  Workbox cache name; slice 2's key rotation should seed an old-named precache
  and assert it is gone.
- A bad integrity in B shows as a long timeout; watching `installing` become
  `redundant` would name the cause. `registration.update()` has no timeout of
  its own.
- The no-telemetry half passes because `telemetryHostAllowed()` is false on
  127.0.0.1.
- "B's engine runs" is shown by the glue the worker serves and the host
  reporting no errors. The instantiated package id cannot be read until the
  shell references it.
- The offline step reloads in the same context. Design spec 5's cold start on
  B needs a browser restart, the pattern `offlineColdStart.spec.ts` uses.
- A stalled `version.json` and a 500 in the e2e flow (the unit tests cover
  both on the `onNeedRefresh` path).
- Per-path overrides in the fixture for the tampered-cache, install-race and
  eviction specs.

## Rejected

- Range requests, ETag and the `/help` and `/gallery` rewrites in the fixture:
  the flow needs none, and the comment says so.
- A `Promise.race` around `registration.update()`: the first update can hold
  for about a minute in Chromium on a slow machine, and the 90 s wait on the prompt already fails
  with a named locator.
- The version `999.0.0` for B being unrealistic: the prompt is driven by the
  waiting worker, and the step going back to the first build passes with it.
- The file-wide `no-explicit-any` disable: the sibling offline specs do the
  same for `window.game`.

## Measured

`e2e/offlineUpdate.spec.ts` ran in about 20 s on `chromium-wasm` and
`chromium-wasm-only` in CI (about 80 s on a slow local machine, where Chromium
held the first `registration.update()` for about a minute). It skips on
`chromium`.
