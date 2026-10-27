# Review: #985 slice 2b-2 (Repair engine files), 2026-10-21

`/bmad-code-review`, plumbing surface (Cache Storage, the stop screen, the build gate; no gameplay or engine data). Three layers run as separate subagents: Blind Hunter (diff only), Edge Case Hunter (diff plus repo and the built `dist/`), Acceptance Auditor (diff plus design 5.4, 6 and the story). Hot-path review: not applicable, Repair runs only from a button on the stop screen.

## Patch findings, all fixed

- **`shellRevisionProblems` could never fail** (all three layers). It scanned every script, and `dist/sw.js` carries all three revisions in its manifest. It now skips `sw.js` and `workbox-*.js`; a unit test puts the revisions only in those two files and expects three problems. The real `dist/` still passes.
- **A record with the right package id and damaged entries was accepted** (Edge Case). Repair now recomputes the id from the entries as the loader does, and a unit test covers it.
- **Repair offered for failures it cannot fix** (Acceptance, Edge Case): a build published without an engine package, and any untyped load failure with correct files (a compile error, out-of-memory). It is now offered only for a `mismatch` or `load-failed` package detail with an expected package, or for a `package-mismatch` without detail (a link error).
- **The precache could be created by Repair** (Acceptance). It asks `caches.has` first and returns `unavailable` when the worker's cache is absent.
- **A stale shell left the player with only Reload** (Blind, Edge Case). A mismatch now also asks for one registration update, and the message adds "If the game was just updated, wait a moment and reload."
- **"Nothing was changed" was false after a partial write** (all three layers). The cache failure message now says some entries may have been replaced; the header comment says the same; a unit test fails the second put.
- **e2e compared byte lengths** (Blind). It compares SHA-256 of each body, for the engine entries and for every other entry, and a second reload before Repair asserts the damaged entry is still there.
- **The offline hint was dropped when Repair is offered** (Blind, Acceptance; the existing `wasmOnly` evicted-binary e2e failed on it). The hint about connecting and reloading once for a new engine now shows offline whether or not Repair is offered.
- Unit tests added for the other caches and a waiting build's key staying untouched, and an em-dash regex literal in a test is written as `—`.

## Dismissed

- The service worker answering the `vc-repair` request, or `vercel.json` rewriting it: `dist/sw.js` has only `precacheAndRoute` and a navigation route that denies `/engine/`, and the e2e proves the request reaches the network.
- Cache name, key format and base path match Workbox for the default config (checked against `dist/sw.js`); compiled-in MD5s equal the manifest's.
- Concurrent presses, 206, opaque responses, redirects (Repair is stricter than the loader and fails safe).
- A waiting worker's entries use other revisions and are not written.

## Deferred (on the #985 backlog row)

Repair has no timeout or size cap; the awaited registration update; the stop screen's own update handler activating a newer worker after the status text; the stored entry carrying only a content type; the waiting-build and other-tab repair e2e and an online-save-survives check (2b-4).
