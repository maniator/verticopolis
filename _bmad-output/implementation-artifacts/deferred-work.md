# Deferred work

Items surfaced by reviews that are real but intentionally not actioned in the
PR that found them. Pick these up when touching the relevant area.

## Deferred from: gds-code-review (2026-07-06, floating-crane fix)

- **Narrow top-run at the tower's edge can overhang the crane body past the lot.**
  `syncCrane` anchors the crane's *mast* over the center tile of the widest built
  run (`craneAnchorTile`), but the graphic is `CRANE_W = 128`px (~11.6 tiles) wide
  with the mast near center. When the widest run is narrower than the crane and
  sits against `x = 0` or `x = GRID.width`, the jib/counter-jib (and for the far-left
  case, negative world-X) hang over open sky/off the lot. Cosmetic and rare (needs a
  top row built as a <~12-tile block flush to a tower edge). Not worth clamping now:
  clamping the body would pull the mast off the actual build run (the thing the fix
  aligned it to). Revisit if a real tower ever exhibits it — likely by clamping
  `pos.x` to keep the *body* on-lot only when the run is near an edge.

- **Crane can sit a story low over a multi-floor top unit (pre-existing).**
  `Tower.highestFloor` returns the max *base* floor and ignores multi-floor extents,
  so a top row formed only by the upper story of a 2-floor unit based at `hi−1` yields
  `highestFloor = hi−1`; the crane perches at `worldYTop(hi−1)` while the visual roof
  is at `hi`, reading as embedded one story down. Unchanged by this fix (`worldYTop(hi)`
  was already the Y source) — flagged by the edge-case pass, not a regression. Fix when
  touching vertical placement: derive the crane's floor from the true topmost occupied
  row (`u.floor + facilityFloors(u.kind) − 1`), not the max base floor.

## Deferred from: gds-code-review (2026-07-06, condo modes — price/buy-back/variant households)

- **Out-of-band legacy condo prices aren't re-clamped on load.** The condo price
  band re-anchored to `min 80k / default 160k / max 200k` (`econConfig.ts`), but
  `deserialize` coerces a stored per-unit `rent` to a finite number without
  re-clamping to the new band. A pre-existing save with a custom condo price at
  the old max (240k) or min (60k) keeps that out-of-band value — it displays past
  the slider's ends and, for an unsold condo, sells at it. Benign and pre-existing
  (the band has moved before; player edits clamp, loads don't), and sold condos
  can't be repriced anyway. If we ever add load-time band validation, clamp condo
  `rent` into the current `ECON.rent.condo` range here. (Blind Hunter; no code
  change now — no reachable exploit, and the shipped save has no custom condo
  prices.)

## Deferred from: gds-code-review (2026-07-06, congestion overlay legibility)

- ~~**`floorHeatmap` recomputes the spatial congestion map once per built floor
  (O(F²)).**~~ Fixed in the same PR (Copilot + party review): the congestion
  branch now builds `spatialCongestionByFloor()` once and reads each floor from
  it, instead of calling `congestionAt(floor)` (a full rebuild) per floor.

- **Per-frame `congestion()` rebuilds the spatial map every frame (pre-existing;
  MEASURE FIRST).** `TowerEngine.tick()` reads `sim.congestion()` for the walker
  stress value and `main.ts updateTraffic()` reads it for the traffic cue; in v2
  each call rebuilds `spatialCongestionByFloor()`. This predates the overlay
  work and is genuinely on the frame path. A naive memo keyed on
  `(revision, rush)` is **wrong** — the map also depends on live tenant
  `isPresent` occupancy, which drifts with sim-time within a rush bucket, so a
  correct key is as expensive to compute as recomputing. The right fix is likely
  to cache the *scalar* `congestion()` on the sim and refresh it on the hour
  tick (where presence actually changes), not a map memo — but **profile a maxed
  tower first** to confirm it's a real cost before touching the hot loop.

## Deferred from: gds-code-review (2026-07-05, condo stickiness — CONDO_NOISE_EROSION)

- **D25's horizon margin is now thinner (deterministic, not flaky).** With the
  gentle condo noise rate, a permanent noisy neighbor reaches a notice at ≈151
  game-hours; `faqComplete.test.ts` D25/D25b loop `24*8 = 192`, a fixed ~41-tick
  (~27%) cushion (was ~2.3× at the old hotel rate). Safe today — the drift is
  fully deterministic (`star=1` disables event RNG; the 2-floor tower never
  congests) — but the cushion is coupled to two constants: nudging
  `CONDO_NOISE_EROSION` toward the +0.05/hr recovery, or shrinking the `24*8`
  horizon, erodes it fast. If either is ever retuned, re-derive the time-to-
  notice and widen the loop. (Edge Case Hunter; no code change warranted now.)

## Deferred from: code review (2026-07-03, PR #110 — compress localStorage saves)

- **`localStorage.setItem` `QuotaExceededError` unhandled on the pre-reload paths**
  (`SaveGame.ts` `saveTo`; `saveLoad.ts:55`/`72`). `recoverFromContextLoss` and `onUpdateReady`
  call `save()` immediately before `location.reload()`; an uncaught quota/private-mode throw
  there aborts the reload. Pre-existing (no guard before), and this PR *mitigates* it (~20×
  smaller writes). Fix when hardening persistence: wrap `setItem` and, on failure, keep the
  prior good value + surface a toast rather than throwing across the reload.

## Deferred from: code review (2026-07-04, event visuals — thief/treasure/VIP)

- **VIP inspection limo replays every 5 game-days on a persistently-failing tower**
  (`Simulation.ts` `checkVip` — `triggerVip()` fires before the pass/fail check, and a
  failed inspection reschedules `vipVisitDay = day + 5`). A tower with a Wedding Hall
  stuck below the TOWER criteria replays the 6.5s limo cosmetic every 5 days with no
  throttle — unlike the nag lines, which throttle on `lastVipNagDay`. Low/cosmetic and
  arguably in-character ("the VIP keeps coming back to inspect"); fix by throttling the
  limo (or only firing it on a passing inspection) if it ever reads as noisy.

## Completed

- ~~**`hasSave()` ≠ `load()` for an unreadable present save**~~ — done 2026-07-04:
  `SaveGame.loadResult()` distinguishes an absent save from a present-but-unreadable one;
  boot (`main.ts`) snapshots readability once (`hadReadableSave`) and uses it — not mere
  presence — for both the splash ("Continue" no longer appears over a corrupt save) and the
  "new tower" confirm (no false "abandons your current tower" when the boot sim is already
  fresh). It emits a bulletin/toast telling the player their save couldn't be read before
  starting fresh, and `SaveGame.preserveUnreadable()` copies the unreadable bytes to a backup
  key at boot so the 30s autosave can't clobber a save that's only unreadable *here* (e.g.
  written by a newer build) and might be recoverable by a later version. Unit-tested
  (`storage.test.ts`) and live-verified.

- ~~**Inspector card re-shows on continued hover after ✕-dismissal**~~ —
  done 2026-07-02: `inspectDismissed` latch in `main.ts` keeps the card closed
  while the pointer keeps picking the same facility; the latch is spent as soon
  as the pick moves to anything else (fresh hover = fresh intent). The ✕ routes
  through the new `onInspectorClose()` callback so the app owns the state.
- ~~**`escapeAttr` used for text content / raw engine-string interpolation**~~ —
  done 2026-07-02: single shared `escapeHtml` in `src/ui/escape.ts` replaces the
  two duplicate local helpers, and the previously **raw** user-controlled
  `u.label` in the inspector card (settable via Rename) is now escaped — the
  exact regression this entry predicted had already shipped.
