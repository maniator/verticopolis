# Review: #985 slice 2b-4b-1, install race and first install e2e (2026-10-27)

Surface: test-only (`e2e/engineInstall.spec.ts`, and `engineFrom()` plus per-build `digests` in
`e2e/deployments.ts`). BMAD layers run as a subagent: Blind Hunter on the diff, Edge Case Hunter with the
Workbox source, Acceptance Auditor against design 6.2 specs 4 and 9.

## Patches (fixed)

1. The first-install test passed with no worker at all: the page registers its worker after boot, so an
   empty registration was true from the start. The test now waits for the browser's `serviceworker` event
   (the install attempt) before accepting an empty registration, then checks the cache.
2. The record was not pinned. `digests` now carries the record's hash, the exact-key-set check covers all
   three engine entries, and the first-install loop rejects any engine key outside the first build's.
3. The 60 s waits were tight next to the known slow first update check. They are 90 s.
4. The refusal assertion now pins the expected package id and `controlled: false`. The served id is not
   pinned: the refusal can come from the binary before the record is read.
5. The first-install test gained the recovery half of spec 9: after the deployment settles, a revisit
   installs, takes control, matches the first build and cold-starts offline with no fallback.

## Deferred (on the `offline-pwa-engine-audio` row)

- Install-time integrity is shown through the first failing entry (the binary). A per-file `engineFrom`
  would test a bad glue or record at install.
- Spec 4's literal shape (an A-like script on an installed A) cannot fail an install: its keys are cached
  and Workbox never fetches them, so the worker waits. The design wording should say so; the mirror shape
  tested here is the failing one.
- The `from === "A"` clause in the update test is a tautology under `engineFrom("A")`; requiring the new
  `sw.js` request first would tie the fetch to the worker.

Dismissed: poll order in the update test (cannot pass before the install starts, and a successful install
would time it out loudly), the update-button count (gated on `registration.waiting`), and the server race.
