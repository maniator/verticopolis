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

## Deferred from: gds-code-review (2026-07-06, condo modes — final adversarial pass)

- **A `null`/malformed unit entry in a forged save crashes `deserialize` (pre-existing).**
  `Simulation.deserialize`'s unit loop does `(data.units ?? []).filter((u) => isFacilityKind(u.kind))` — reading `u.kind` on a `null` entry throws a TypeError and aborts the whole load, turning a recoverable save into a hard failure. This predates the condo work (the migrateSave backfill this PR adds correctly short-circuits on falsy `u`, so it doesn't introduce or worsen it) and is orthogonal to condos, so it's deferred to keep the PR scoped. Fix when hardening the loader: guard the unit and transport filters with `u != null &&` (and the same for `data.transports`). (Blind Hunter, final pass; forged/corrupt-save only.)

## Deferred from: gds-code-review (2026-07-06, condo modes — price/buy-back/variant households)

- ~~**Out-of-band legacy condo prices aren't re-clamped on load.**~~ Fixed in the
  same PR (Copilot review): `deserialize` now clamps an UNSOLD condo's `rent` into
  the re-anchored `ECON.rent.condo` band, so a legacy save priced at the old
  min/max ($60k/$240k) can't sell below build cost or above the new ceiling (or
  render past the slider). Sold condos are left untouched so the buy-back still
  mirrors the historical sale price. (Also hardened: `everOccupied` is coerced to
  a strict boolean on load, so a forged truthy value can't fake a sold condo.)

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

## Deferred from: bmad-code-review (2026-07-06, GitHub PR + issue templates — PR #129)

- ~~**PR template references AGENTS.md mode guidance that lands with #123, not on `main` yet.**~~
  **Resolved in this PR (159cb4e).** The "Game mode impact" section was rewritten to be
  self-contained — it describes the "keep mode-divergent behavior in one mode-resolved rule-set,
  don't smear mode checks" convention inline, with no reference to AGENTS.md and no dependency on
  #123's merge order. No merge-order requirement remains.

- ~~**No filing path for security / docs issues (`blank_issues_enabled: false`).**~~
  **Resolved in this PR.** Added `SECURITY.md` + a "Report a security vulnerability" contact link
  pointing at GitHub Private Vulnerability Reporting (2759058), and a `documentation.yml` issue
  form for docs/README/setup reports (d538141). (Note: the advisory link requires Private
  Vulnerability Reporting to be enabled in repo Settings → Security.) A dedicated "question"
  path is intentionally left to the issue-search contact link; revisit if Discussions is enabled.

- ~~**`parity` label does not exist in the repo.**~~
  **Resolved — label created by the maintainer.** `parity_report.yml` now applies
  `["parity", "classic"]`. The full label taxonomy is checked in at `.github/labels.yml` as the
  source of truth (with one-time `gh label create` commands). Remaining action items for the
  maintainer: create the other new labels listed in `.github/labels.yml`
  (`security`, `documentation`, `classic`, `modern`, `needs-triage`, `needs-repro`,
  `good first issue`, `help wanted`). Area labels are intentionally deferred until a subsystem
  has 3+ open issues (documented in the manifest).
