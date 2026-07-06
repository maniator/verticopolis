# Deferred work

Items surfaced by reviews that are real but intentionally not actioned in the
PR that found them. Pick these up when touching the relevant area.

## Deferred from: gds-code-review (2026-07-06, congestion overlay legibility)

- **`floorHeatmap` recomputes the spatial congestion map once per built floor
  (pre-existing O(F²)).** Its congestion branch calls `congestionAt(floor)` in
  the per-floor loop, and each v2 call rebuilds the entire
  `spatialCongestionByFloor()` map — so a tower with F built floors builds that
  map F times per overlay refresh. The Edge Case Hunter confirmed this predates
  the legibility change (the old `congestionAt/1.2` code had the identical
  per-floor calls); the fix only added one extra full build via
  `peakCongestion()` per refresh. It is **off the per-frame path** (the renderer
  caches the heatmap hourly / on layout / on mode flip), so it isn't hot today.
  When next touching `floorHeatmap`, compute the spatial map once and read
  per-floor values from it (and have `peakCongestion` reuse the same pass).

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
