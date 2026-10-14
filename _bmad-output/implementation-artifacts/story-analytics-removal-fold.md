---
story: analytics-removal-fold
status: review
issue: 873
pr: 1015
phase: 2 of 5 (migration step 2, the removal fold)
design: _bmad-output/party-mode/analytics-engine-events-party-findings-2026-10-09.md
---

# Story: `demolish` from the engine's `facility_removed`

## Why

Phase 2 (#938) moved every shell analytics site with an engine source onto the
bridge except `economy_action: demolish`. That one waited on an engine removal
command: the bulldozer and the editor's Sell removed through the tower and
refunded themselves, so the engine never saw them. #928 added
`removeFacility(id, method)` in both engines, which emits `facility_removed`
with its method, and both shell paths now call it. This story folds that event
into the bridge and retires the shell's two `demolish` calls.

## Scope

- `src/analyticsEngineBridge.ts` folds `facility_removed` into
  `economy_action { action: "demolish", detail: method }`, one send per
  removal, as the shell did.
- Removals get their own limiter, `REMOVAL_SEND_LIMIT` (40 in each one-minute window, per page). A
  bulldozer drag removes one facility per tile it crosses (a bare floor tile
  is a facility of its own), so the per-name limit of 20 would undercount a
  single floor clear, while an unlimited send would break the phase 2 gate
  that every per-occurrence send is rate limited.
  The client window and the ingest route's per-IP window (100 requests a
  minute, one request per event) start independently, so up to twice the
  budget can land in one ingest window; at 40, demolition from one page
  stays under the route's limit (several tabs or players behind one IP each
  bring a budget). The player's other events share that limit, as they did
  when the shell sent every removal unlimited.
  A drop counts in `rateLimited` like the shared limiter's. A closed window
  refills both budgets (only a session reset closes one since #991).
- `src/game/buildActions.ts` drops its two `trackEconomyAction("demolish", verb)`
  calls (`tryRemoveUnit` and `removeTransportWithRefund`).
- `src/analyticsCore.ts` documents the source change on `economy_action`.

## What changes on the wire

- The same removals report. In the game, `removeFacility` is called only by
  the two shell paths, so one engine event replaces one shell call; a refused
  removal emits nothing, as before. The engine's `sellAt` emits
  `facility_removed` too; no player path calls it, so only tooling could.
- `detail` is the engine's method (`sell` or `bulldoze`), which is the `verb`
  the shell passed.
- A send now leaves at the next frame's drain instead of at the click, and a
  page that removes more than 40 facilities in one one-minute window reports
  the first 40. Clearing more than 40 tiles of bare floor in a minute passes that, so
  a heavy clear is truncated; the count is a lower bound for those sessions.
- Under the WASM host the send follows the engine's verdict, like every other
  bridge fold; the instance's result still drives the toast and the sale sound.
- A removal the player then undid still counts, as a build does.

A patch bump (2.31.2), following the 2.29.5 precedent for analytics-only value
changes, so the dashboards have a clean boundary for the cap.

## Tests

- `src/analyticsEngineBridge.test.ts`: every removal sends `demolish` with its
  method; removals have their own budget (43 removals send 40, past a wire
  name's 20, and count 3 rate-limited; a new minute refills); a
  closed window refills an exhausted removal budget. A removal the player then undid
  still counts (its event rides the swap's hand-off). A source check keeps
  every other file from sending `demolish` itself.
- `src/tests/integration/gameControllers.integration.test.ts`: the shell's
  `tryRemoveUnit` and `removeTransportWithRefund` report `facility_removed`
  with the gesture as its method, and a refusal reports none.
- `src/tests/integration/wasmHostAnalyticsBridge.integration.test.ts`: a sell,
  a bulldoze and a refused bulldoze of a permanent lobby tile (its reason
  pinned) give the same two
  sends on the TypeScript engine and under the WASM host.

## Review record (`/bmad-code-review`)

- **Round 1.** Patched:
  - The first budget claim was wrong: the shared limiter is per wire name (three names at 20 each), so the removal limit dropped from 60 to 40 and the claim was restated.
  - Tests now show each budget actually running out.
  - Added a shell-path test and pinned the refusal reason.
  - The #611 event catalog and the phase 2 story now record the new source, and the backlog marks phase 2 done.
  - Patch bump to 2.31.2.

  Dismissed:
  - Unload loss: the bridge drains every frame and on page hide.
  - A method allow-list: `checkEvent` and the engine already validate the enum.
  - The WASM verdict: the bridge follows the engine for every fold, by design.
  - A separate drop counter: the spec says removals share `rateLimited`.
- **Round 2.** Patched:
  - The catalog's coverage section and its banners name 2.31.2 for `demolish`.
  - `sellAt` is named as a source.
  - The undo rule is written down.
  - Added the missing CHANGELOG heading.
  - The cap is worded per window.

  Dismissed:
  - Window-close discard and refill: only a session reset closes a window since #991.
  - The ingest constant: `analyticsIngest.ts` re-exports `RATE_LIMIT_MAX`.
- **Round 3.** Patched:
  - A source check keeps every other file from sending `demolish`.
  - An undo test.
  - The SPEC and the two dashboard tiles state the cap.
  - The comment says plainly that a heavy clear is truncated.
- **Round 4.** Patched:
  - The guard scans all of `src/`.
  - A lobby tile is permanent, so the comment counts only floor tiles.
  - The budget is per page, and the dashboard wording says so.
  - The budget test drops a preamble that proved nothing.
  - Rewrapped comments.
  - The guard's pattern also catches an object payload or a constant.
  - The cap's wording counts tiles of bare floor.
  - The two-engine test asserts its setup builds.

  Dismissed: the undo test calls `inherit` itself rather than `adoptSim`, the same pattern as the existing build-undo test.
- **Round 5.** The Edge Case Hunter found nothing. The other two layers found only wording: the cap is per page and per window, and the ingest bound holds for one page (several tabs or players behind one IP each bring a budget). Patched.
