# Review: #985 slice 2b-4b-2, eviction and recovery e2e (2026-10-27)

Surface: test-only (`e2e/engineEviction.spec.ts`, the shared helpers moved to `e2e/engineDeployHelpers.ts`,
and `failNetwork()` in `e2e/deployments.ts`). BMAD layers run as a subagent against the Workbox source and
design 6.2 spec 7.

## Confirmed from the Workbox source

A precache miss on a controlled page is refetched with the integrity in the manifest and stored under the
same revisioned key (`PrecacheStrategy._handleFetch`, `cachePut` only when the manifest carries integrity).
So the refill check in the first test also shows that each of the three engine entries carries integrity.
The navigation fallback passes no integrity, which is why a lost shell is not re-precached (see below).

## Patches (fixed)

1. The lost-precache test accepted any thrown error, including a timeout. It now requires
   `page.reload: net::ERR_`.
2. An emphatic "X, not Y" in an assertion message was reworded.
3. A near-vacuous `expectControlledWithEngineShell` helper was removed (`controlled: true` in the
   failure detail already shows it).
4. The offline and other-build tests now check what the server saw: the binary was requested, and in the
   other-build case it was answered by the other build, so the failure is attributed to the integrity check.
5. The lost-precache test now checks the recovered state: after an online revisit the cache holds exactly
   the first build's three engine entries again (it passes: engine misses do refill).

## Deferred (on the `offline-pwa-engine-audio` row)

The spec 7 gaps and one product question are listed in the 2b-4b-2 note on the backlog row: per-file and
full-network offline `load-failed`, the section 5.4 result assertions, a real second deployment during
eviction, removal of the precache while already offline, Repair after eviction and with the fetch cut at the
worker, and whether a worker should re-precache the shell after the whole precache is lost.

Dismissed: a `mismatch` flake in the other-build test (the page check could only fire if the worker had
delivered the wrong bytes, which the digest check would also catch), the HTTP cache serving the first
build's binary (`max-age=0, must-revalidate`, no validators), and the `afterEach` reset when `beforeAll`
skipped (every use is optional-chained).
