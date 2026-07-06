# Engineering Backlog

This is the **single** backlog for cross-cutting or future action items that
emerge from reviews and planning — the successor to the old
`deferred-work.md`. Everything that used to land there lands here now.

Routing guidance:

- Use this file for non-urgent optimizations, refactors, or follow-ups that span
  multiple stories/epics, plus review deferrals that are real but intentionally
  not actioned in the PR that found them.
- Must-fix items to ship a story belong in that story's `Tasks / Subtasks`.
- Same-epic improvements may also be captured under the epic Tech Spec
  `Post-Review Follow-ups` section.

How items flow:

1. The BMGD/BMAD review skills (`gds-code-review`, `bmad-code-review`,
   `*-quick-dev`) append each `defer` finding to the **Deferral inbox** below,
   under a dated `## Deferred from:` heading.
2. Triage folds inbox entries into the table as a curated row (and removes the
   raw inbox note once captured). Pick items up when you next touch the area.
3. `Type` legend: `review-deferral` (a real finding parked for scope),
   `perf` (a measured/suspected optimization), `feature-request` (unbuilt
   capability awaiting a spec). `Status`: `open`, `in-progress`, `idea`
   (feature not yet specced), `done`.

| Date | Story | Epic | Type | Severity | Owner | Status | Notes |
| ---- | ----- | ---- | ---- | -------- | ----- | ------ | ----- |
| 2026-07-06 | condo-eviction | Modern condos | feature-request | — | — | idea | Player-facing condo departures **beyond** the canon full-price buy-back already shipped (#123). Three flavors to spec: (a) **player-initiated evict/buy-out** — owner pays to reclaim a sold condo; (b) **household-aware departures** — a family leaves for reasons other than neglect (job move, upsize/downsize), Modern-only; (c) **relocation offer** — the tower offers a departing household a different unit before they leave. Needs a BMAD spec before build; the original 1994 game had no condo evict. |
| 2026-07-06 | crane-fix | — | review-deferral | low (cosmetic) | — | open | Narrow top-run at a tower edge can overhang the crane body past the lot. `syncCrane` anchors the mast over the widest run's center, but `CRANE_W=128px` (~11.6 tiles) with the mast near center means a run narrower than the crane flush to `x=0`/`x=GRID.width` hangs the jib over open sky. Rare (needs a <~12-tile top block flush to an edge). Clamping the body would pull the mast off the run it aligns to — only clamp `pos.x` when the run is near an edge. (gds-code-review, floating-crane fix.) |
| 2026-07-06 | crane-fix | — | review-deferral | low (cosmetic) | — | open | Crane can sit a story low over a multi-floor top unit (pre-existing). `Tower.highestFloor` returns max *base* floor and ignores multi-floor extents, so a top row formed only by the upper story of a 2-floor unit based at `hi−1` yields `highestFloor=hi−1`; the crane perches a story below the visual roof. Fix when touching vertical placement: derive the crane's floor from the true topmost occupied row (`u.floor + facilityFloors(u.kind) − 1`). (Edge Case Hunter, floating-crane fix.) |
| 2026-07-06 | condo-modes | Modern condos | review-deferral | medium | — | open | A `null`/malformed unit entry in a forged save crashes `deserialize` (pre-existing). The unit loop does `(data.units ?? []).filter((u) => isFacilityKind(u.kind))` — reading `u.kind` on a `null` entry throws and aborts the whole load. Predates the condo work and is orthogonal to it. Fix when hardening the loader: guard the unit and transport filters with `u != null &&` (same for `data.transports`). (Blind Hunter, condo-modes final pass; forged/corrupt-save only.) |
| 2026-07-06 | congestion-overlay | — | perf | low | — | open | Per-frame `congestion()` rebuilds the spatial map every frame (pre-existing; **MEASURE FIRST**). `TowerEngine.tick()` and `main.ts updateTraffic()` each call `sim.congestion()`, rebuilding `spatialCongestionByFloor()` per frame. A memo keyed on `(revision, rush)` is **wrong** — the map also depends on live `isPresent` occupancy, which drifts within a rush bucket. Likely fix: cache the *scalar* `congestion()` on the sim and refresh on the hour tick (where presence changes), not a map memo. Profile a maxed tower first. |
| 2026-07-05 | condo-stickiness | — | review-deferral | low (test-only) | — | open | D25's horizon margin is thinner (deterministic, not flaky). With the gentle condo noise rate, a permanent noisy neighbor reaches a notice at ≈151 game-hours; `faqComplete.test.ts` D25/D25b loop `24*8=192`, a fixed ~41-tick (~27%) cushion. Safe today (fully deterministic), but coupled to `CONDO_NOISE_EROSION` and the `24*8` horizon — if either is retuned, re-derive time-to-notice and widen the loop. (Edge Case Hunter, CONDO_NOISE_EROSION.) |
| 2026-07-04 | event-visuals | — | review-deferral | low (cosmetic) | — | open | VIP inspection limo replays every 5 game-days on a persistently-failing tower. `Simulation.checkVip` fires `triggerVip()` before the pass/fail check, and a failed inspection reschedules `vipVisitDay=day+5`, so a tower stuck below TOWER criteria replays the 6.5s limo every 5 days with no throttle (unlike the nag lines, which throttle on `lastVipNagDay`). Arguably in-character; fix by throttling the limo or only firing on a passing inspection if it reads as noisy. |
| 2026-07-03 | pr-110-compress-saves | — | review-deferral | medium | — | open | `localStorage.setItem` `QuotaExceededError` unhandled on the pre-reload paths (`SaveGame.ts saveTo`; `saveLoad.ts:55`/`72`). `recoverFromContextLoss` and `onUpdateReady` call `save()` immediately before `location.reload()`; an uncaught quota/private-mode throw there aborts the reload. Pre-existing; PR #110 mitigates it (~20× smaller writes). Fix when hardening persistence: wrap `setItem` and, on failure, keep the prior good value + surface a toast rather than throwing across the reload. |

---

## Deferral inbox

_Raw `## Deferred from:` sections appended by the review skills land here.
Triage them into the table above, then delete the raw note._

_(empty — all current deferrals are triaged into the table above.)_

## Completed / superseded

- ~~**Out-of-band legacy condo prices aren't re-clamped on load**~~ — fixed in
  #123: `deserialize` clamps an unsold condo's `rent` into the re-anchored
  `ECON.rent.condo` band; sold condos are left untouched so buy-back mirrors the
  historical sale price. `everOccupied` is coerced to a strict boolean on load.
- ~~**`floorHeatmap` recomputes the spatial congestion map once per built floor
  (O(F²))**~~ — fixed in the congestion-overlay PR: the branch builds
  `spatialCongestionByFloor()` once and reads each floor from it.
- ~~**`hasSave()` ≠ `load()` for an unreadable present save**~~ — done
  2026-07-04: `SaveGame.loadResult()` distinguishes absent from
  present-but-unreadable; boot snapshots readability once and uses it for both
  the splash and the "new tower" confirm; emits a bulletin before starting
  fresh; `preserveUnreadable()` backs up unreadable bytes at boot.
- ~~**Inspector card re-shows on continued hover after ✕-dismissal**~~ — done
  2026-07-02: `inspectDismissed` latch in `main.ts` keeps the card closed while
  the pointer keeps picking the same facility; spent as soon as the pick moves.
- ~~**`escapeAttr` used for text content / raw engine-string interpolation**~~ —
  done 2026-07-02: single shared `escapeHtml` in `src/ui/escape.ts`; the
  previously raw user-controlled `u.label` in the inspector card is now escaped.
