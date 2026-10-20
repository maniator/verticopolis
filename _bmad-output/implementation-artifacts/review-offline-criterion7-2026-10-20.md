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
- The second deployment's binary differs too (a valid empty WebAssembly custom
  section), so all three engine entries must be replaced by an update.
- The revisions and the entry count come from each deployment's `sw.js`, not
  from values the fixture computes on its own.
- The offline window opens before the network is cut, and `updateTo` waits for
  no installing or waiting worker before the test goes on (a controller alone
  was already true under the old worker).
- The fixture throws, with the reason, when the second `sw.js` equals the first
  (the browser would never find an update); it removes its scratch folder when
  setup throws; the test closes its browser context and the server in a
  `finally`.
- Server: `dist` is resolved, request targets with a `//` start, a NUL, a colon
  or a bad escape are refused, paths are percent-decoded, more MIME types.
- `src/pwa.test.ts`: `{}`, array and wrong-type bodies; the success case finds
  the `version.json` call by URL and checks the cache-busting query.
- Comments say what the fixture does not model (ETag, Range, rewrites).

## Deferred to slice 2 (on the #985 backlog row)

- Deployment B's page bundle still carries deployment A's compiled-in
  `__ENGINE_PACKAGE__`. Nothing reads it yet. When the loader checks the engine
  against it, the fixture must rewrite it in B's chunk (the Edge Case Hunter's
  high finding; recorded in the fixture's header comment).
- "B's engine runs" is shown by the glue the worker serves and the host
  reporting no errors. The instantiated package id cannot be read until the
  shell references it.
- The offline step is a reload in the same context, not a browser restart
  (`offlineColdStart.spec.ts` has that pattern); design spec 5's cold start on
  B needs it.
- A stalled `version.json` and a 500 in the e2e flow (the unit tests cover
  both).
- Per-path overrides in the fixture for the tampered-cache, install-race and
  eviction specs.

## Rejected

- Range requests, ETag and the `/help` and `/gallery` rewrites in the fixture:
  the flow needs none, and the comment says so.
- A `Promise.race` around `registration.update()`: the first update holds for
  about a minute in Chromium, and the 90 s wait on the prompt already fails
  with a named locator.
- The version `999.0.0` for B being unrealistic: the prompt is driven by the
  waiting worker, and the step going back to the first build passes with it.
- The file-wide `no-explicit-any` disable: the sibling offline specs do the
  same for `window.game`.

## Measured

`e2e/offlineUpdate.spec.ts` runs in about 80 s: Chromium holds the first
`registration.update()` on a new registration for about a minute (the next
ones answer at once), so the flow keeps a single install and makes both
updates on it. Passes on `chromium-wasm` (switchable build) and
`chromium-wasm-only`; skips on `chromium`.
