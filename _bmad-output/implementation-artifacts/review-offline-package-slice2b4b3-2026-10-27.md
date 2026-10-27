# Review: #985 slice 2b-4b-3, Repair e2e (2026-10-27)

Surface: test-only (`e2e/engineRepairDeployments.spec.ts`) plus design 6.2 spec 8 wording. BMAD layers run as a
subagent against the Workbox source, `bootstrap.ts`, `pwa.ts` and design spec 8.

## Confirmed

A stop screen with no tower to save calls `registerPWA` with an activate-at-once handler, and the vite config
sets neither `skipWaiting` nor `clientsClaim`, so that handler is the only way a waiting build activates. The
third test's sequence is race-free: the `load` listener exists before `registration.update()`, and nothing
else navigates the stopped page. The cut in the second test lands on the Repair fetch (a query-bearing URL
that the precache route does not match), so nothing is written because all three files are fetched before any
write, and the same click path succeeds once the cut ends.

## Patches (fixed)

1. An unused `engineEntriesOf` import (would fail `npm run lint`).
2. The save test could pass vacuously if the 30 s autosave landed first. It now checks slot 1 in storage
   before the damage and after the repair, and that the booted game has no lobby before `loadFromSlot`.
3. The other-tab check read in-memory values that nothing could change. The other tab is now reloaded after
   the switch and must land on the second build's consistent set. The offline cold start also asserts build B's
   entries.
4. The cut was described as "at the worker". It is at the server socket, and the title and notes say so.
5. Repair "stops at the first failed file" is now checked from the request log (no binary or record request).

## Design wording

Spec 8's last sentence and the Repair text said Repair meets a waiting B. It does not on a stop screen, so
both are amended (the activation is the stop screen's handler, not Repair).

## Deferred (on the `offline-pwa-engine-audio` row)

A waiting B that exists before the stop screen loads and a Repair in flight when B activates are not tested
end to end. The shell not being re-precached after total precache loss stays open from 2b-4b-2.
