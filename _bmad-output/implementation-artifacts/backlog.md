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
   under a dated `### Deferred from:` heading.
2. Triage folds inbox entries into the table as a curated row (and removes the
   raw inbox note once captured). Pick items up when you next touch the area.
3. `Type` legend: `review-deferral` (a real finding parked for scope),
   `perf` (a measured/suspected optimization), `feature-request` (unbuilt
   capability awaiting a spec), `bug` (a player-reported defect awaiting a
   fix). `Status`: `open`, `in-progress`, `idea` (feature not yet specced),
   `done`.
4. `Priority` is the do-first order (impact × effort × risk, and whether the
   item is blocked) — distinct from `Severity`, which is impact alone. **P1**:
   work next; real correctness/data-safety impact and ready to pick up. **P2**:
   worthwhile — do opportunistically when you next touch the area. **P3**:
   low/cosmetic, blocked on investigation, watch-only, or a feature awaiting a
   spec. The `Priority` value stays strictly `P1`/`P2`/`P3` so the column is
   machine-sortable. Within P3, _ready_ cheap fixes are ordered before _gated_
   ones (blocked on profiling / a spec / watch-only), and each P3 row's Notes
   lead with **Ready.** or **Gated.** so nobody burns a session grabbing a
   blocked "easy P3."
5. Priorities validated by an agent party (game architect + game designer +
   persistence architect, 2026-07-06): P1/P2 and the P3 tier confirmed
   unanimously; the design voice dissented on the VIP-limo row (argued P2 on
   player-visibility) — resolved by ranking it first among the P3 cosmetics
   rather than a tier bump.

| Date | Story | Epic | Type | Priority | Severity | Owner | Status | Notes |
| ---- | ----- | ---- | ---- | -------- | -------- | ----- | ------ | ----- |
| 2026-07-06 | event-log-toast-freeze | — | review-deferral | P3 | low | — | open | **Ready.** `UI.toastTimers` grows unbounded: `toast()` pushes each 3.6s `setTimeout` id onto the array (`src/ui/UI.ts` ~61, ~507) but nothing ever reads or trims it — a session-long slow leak of stale numbers. Pre-existing; the toast-per-frame cap (TOAST_MAX) added in the freeze fix slows its growth but doesn't bound it. Fix: drop the array (the timeout self-removes its node) or splice each id when its timeout fires. (gds-code-review Edge Case Hunter, event-log-toast-freeze.) |
| 2026-07-06 | event-log-persistence | — | feature-request | P3 | — | — | idea | **Gated — needs a spec (save-size tradeoff).** The event log is transient (not serialized), so a manual refresh, a PWA update, OR the game's own auto-reloads (GPU-context-loss recovery, "Update now") blank it — scrollback history vanishes often. If a durable, scrollable history is wanted, serialize a **bounded tail** (~50 entries) and harden it on load like every other `data.*`. Real value (the game reloads itself a lot) vs real cost (per-write save weight + untrusted-load hardening). Party-mode (game/UX/architect, 2026-07-06) split this out from the scrollable-panel work as its own ticket. |
| 2026-07-06 | crane-fix | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Crane can sit a story low over a multi-floor top unit (pre-existing). `Tower.highestFloor` returns max *base* floor and ignores multi-floor extents, so a top row formed only by the upper story of a 2-floor unit based at `hi−1` yields `highestFloor=hi−1`; the crane perches a story below the visual roof. More visible than the edge-overhang case below — do this one first when the crane/render code is open. Fix: derive the crane's floor from the true topmost occupied row (`u.floor + facilityFloors(u.kind) − 1`). (Edge Case Hunter, floating-crane fix.) |
| 2026-07-06 | crane-fix | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Narrow top-run at a tower edge can overhang the crane body past the lot. `syncCrane` anchors the mast over the widest run's center, but `CRANE_W=128px` (~11.6 tiles) with the mast near center means a run narrower than the crane flush to `x=0`/`x=GRID.width` hangs the jib over open sky. Rare (needs a <~12-tile top block flush to an edge). Bundle with the crane fix above. Clamping the body would pull the mast off the run it aligns to — only clamp `pos.x` when the run is near an edge. (gds-code-review, floating-crane fix.) |
| 2026-07-04 | event-visuals | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** VIP inspection limo replays every 5 game-days on a persistently-failing tower. `Simulation.checkVip` fires `triggerVip()` before the pass/fail check, and a failed inspection reschedules `vipVisitDay=day+5`, so a tower stuck below TOWER criteria replays the 6.5s limo every 5 days with no throttle (unlike the nag lines, which throttle on `lastVipNagDay`). **Most player-visible of the P3 cosmetics** — the design voice argued P2 (a recurring cosmetic loop reads as a bug); parked at the head of P3 as a compromise. Fix by throttling the limo or only firing on a passing inspection. |
| 2026-07-06 | event-visuals | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Thief cosmetic can play fully **off-screen**. `TowerEngine.renderThief` anchors the thief's Y to a random tenanted floor (`worldToScreenY(thiefFloor)`); in a tall tower that floor is often outside the viewport, so the run animates invisibly (regression from the old always-visible `viewHeight*0.66`). Accepted tradeoff of grounding the thief on a real floor + the engine/render separation (the engine can't know the camera), and the player still gets the log/toast line. If it reads as "missing the cosmetic," bias selection toward the lobby / a low floor (like the VIP limo), or nudge the camera to the thief's floor for the run. (gds-code-review, thief-grounding: Blind + Edge Case Hunter.) |
| 2026-07-06 | pr-129-gh-templates | — | review-deferral | P3 | low | maintainer | open | **Ready — maintainer action:** run the "Sync labels" workflow once (Actions → Sync labels → Run workflow, from the default branch) to create the labels introduced with #129's issue/PR templates — `security`, `documentation`, `classic`, `modern`, `needs-triage`, `needs-repro`, `good first issue`, `help wanted`. `.github/labels.yml` is the source of truth and also lists equivalent `gh label create` commands. Migrated from the retired `deferred-work.md`. |
| 2026-07-06 | congestion-overlay | — | perf | P3 | low | — | open | **Gated (measure first).** Per-frame `congestion()` rebuilds the spatial map every frame (pre-existing; **MEASURE FIRST** — blocked on profiling a maxed tower; do not touch the hot loop first). `TowerEngine.tick()` and `main.ts updateTraffic()` each call `sim.congestion()`, rebuilding `spatialCongestionByFloor()` per frame. A memo keyed on `(revision, rush)` is **wrong** — the map also depends on live `isPresent` occupancy, which drifts within a rush bucket. Likely fix: cache the *scalar* `congestion()` on the sim and refresh on the hour tick (where presence changes), not a map memo. |
| 2026-07-06 | condo-eviction | Modern condos | feature-request | P3 | — | — | idea | **Gated.** Player-facing condo departures **beyond** the canon full-price buy-back already shipped (#123). **Gated: needs a BMAD spec before build — the next actionable step is writing the spec, not coding.** Three flavors to spec: (a) **player-initiated evict/buy-out** — owner pays to reclaim a sold condo (the 1994 game had no condo evict); (b) **household-aware departures** — a family leaves for reasons other than neglect (job move, upsize/downsize), Modern-only, bigger families cost more / warn earlier; (c) **relocation offer** — offer a departing household a different empty condo before the forced buy-back. |
| 2026-07-06 | deserialize-null-hardening | — | review-deferral | P3 | low | — | open | **Ready.** `deserialize` assigns `sim.tower.towerName = data.towerName` and `sim.tower.builtWeddingHall = data.builtWeddingHall` (Simulation.ts ~2148–2149) **raw**, with no coercion — the only two `data.*` reads in the method that skip the trust-boundary hardening every other field gets. A forged non-string `towerName` flows on into the export slug / UI (and a non-boolean `builtWeddingHall` into a truthiness branch). Pre-existing; out of scope of the null-entry P1 fix that surfaced it. Fix: coerce `towerName` to a string (fallback to the default name) and `builtWeddingHall` to a strict boolean on load. (bmad-code-review, Edge Case Hunter, deserialize-null-hardening.) |
| 2026-07-05 | condo-stickiness | — | review-deferral | P3 | low (test-only) | — | open | **Gated (watch-only).** D25's horizon margin is thinner (deterministic, not flaky; **watch-only — no code change now**). With the gentle condo noise rate, a permanent noisy neighbor reaches a notice at ≈151 game-hours; `faqComplete.test.ts` D25/D25b loop `24*8=192`, a fixed ~41-tick (~27%) cushion. Safe today (fully deterministic), but coupled to `CONDO_NOISE_EROSION` and the `24*8` horizon — if either is retuned, re-derive time-to-notice and widen the loop. (Edge Case Hunter, CONDO_NOISE_EROSION.) |

---

## Deferral inbox

_Raw `### Deferred from:` sections appended by the review skills land here.
Triage them into the table above, then delete the raw note._

_(empty — all current deferrals are triaged into the table above.)_

## Completed / superseded

- ~~**P1 — `deserialize` crashes on a `null`/malformed unit or transport entry (condo-modes)**~~
  — fixed in #134: `u != null`/`t != null` guards before the `isFacilityKind` filter,
  plus an `Array.isArray(...)` container guard (a bmad-code-review Blind Hunter catch — a
  forged non-array `units`/`transports` still threw), with corrupt-save tests. A corrupt
  save now drops the bad entries and loads instead of hard-crashing.
- ~~**P2 — `QuotaExceededError` unhandled on the pre-reload save paths (pr-110-compress-saves)**~~
  — fixed here: `recoverFromContextLoss` now guards its pre-reload flush and, on a storage
  failure, shows the boot card (Reload button) instead of letting the throw abort the reload
  and strand the player on a dead GPU canvas. A failed `setItem` is atomic (never clobbers),
  so any prior autosave survives; the update path was already guarded in `main.ts`
  (`saveBeforeUpdate` throws → the update pauses rather than reloading). Both paths covered
  by tests.
- ~~**#129 GitHub-template deferrals (PR-template mode guidance; security/docs issue path)**~~
  — shipped in #129: the PR template's "Game mode impact" section is self-contained (no
  `AGENTS.md` dependency or merge-order requirement), and `SECURITY.md` + a
  private-vulnerability-reporting link + a `documentation.yml` issue form were added. The
  remaining one-time label-creation step is tracked as an open row in the table above.
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
