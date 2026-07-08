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
| 2026-07-07 | tdt-importer | OpenSkyscraper docs | feature-request | P2 | — | — | idea | **Gated: needs PR-2's `timePacing.ts` first; spec lives in the approved session plan (PR 3).** Real `.TDT` importer replacing the `twrImport.ts` stub: bounds-checked binary walker → `TdtTower` intermediate → `SerializedGame`, per `docs/canon/tdt-format.md`. v1 synthesizes transports deterministically (elevator block only partially documented); fidelity-report modal ("brought over / couldn't bring over"), auto-save to a fresh slot; synthetic-fixture tests only (no copyrighted saves). **Minor** version bump. Must also reconcile the stub's `.TWR` extension assumption (`looksLikeTWR` regex + the `.twr` hard-codes in `UI.ts` accept/binary routing) with the real `.TDT` extension. **2026-07-07 update (dfloer/tower-docs `tdt_spec.md` merged into `docs/canon/tdt-format.md`):** the elevator block is now FULLY documented (194B header: type/capacity/cars/schedules/serviced-floors bitmap/car homes + per-floor queues + per-car passenger data): **real transport decode is now viable in v1**, demoting synthesis to the fallback for malformed tails. Also now decodable: `rentClass` (0–4 labels), hotel state flags (booked/occupied/dirty/infested + days-dirty), per-unit shop variant, parking connected-stall table. CRITICAL importer detail: multi-story units are stored as one part per floor (theatre 18/19 + screen 34/35, recycling 20/21, party hall 29/30, metro 31–33, cathedral 36–40): merge parts, never place each. Ramp = **44** ([TD]; [OS]'s 45 is the metro tunnel). TDT-110 ambiguity **resolved**: `ours = tdt − 9` confirmed by [TD]'s lobby table (floor 100 = index 109; 110–119 reserved). |
| 2026-07-07 | walkway-variants | OpenSkyscraper docs | review-deferral | P3 | — | — | open | **Gated: canon question, verify before touching the engine.** The TDT stairs table's type field supports 2- and 3-story stairs/escalators (`docs/canon/tdt-format.md` §8), but neither source says the shipped game ever creates them; our canon (CLAUDE.md) holds walkways to fixed two-floor flights. Party verdict (2026-07-07): format allowance ≠ game behavior, so HOLD; verify against the real game (play/screenshots) before any `maxSpanFor` change. |
| 2026-07-07 | service-capacity-10 | OpenSkyscraper docs | feature-request | P1 | — | — | done | **Implemented, targets v1.9.5.** `TRANSPORT_CAPACITY.elevatorService` 16 → **10** per the decoded capacity byte in dfloer's spec (42/21/10; the 42 and 21 match our already-sourced numbers; our 16 was uncited). Value flows through dispatch/congestion/stats via `transportCarCapacity()` (no test hard-coded 16); added a `canon.test.ts` tripwire pinning all three car capacities. Release note: "canon fix: service elevators carry 10, as in 1994." |
| 2026-07-07 | variable-pacing | OpenSkyscraper docs | feature-request | P2 | — | — | done | **Shipped 2026-07-07 (v1.9.4)**: wired per the party verdict below. Wire the 1994 "breathing clock" into the main loop: `accMinutes` × `paceFactor(minuteOfDay)` at `main.ts` (~:794). The factors are normalized so a day's TOTAL real time is unchanged (a harmonic invariant: ∫1/pace = 1440; the plain average of the factors is deliberately not 1, so never renormalize by the arithmetic mean). Presentation-only; sim stays a uniform 1440-min day. Party verdict (Samus/Cloud/Sally 2026-07-07, user-ratified): **ungated, all towers** (same species as the ×2 speed button; never serialized or mode-gated) + a device-level Preferences "Steady clock (disables the 1994 rhythm)" escape hatch. UX: no HUD gauges; one Help bullet + a noon "Lunch rush!" bulletin line. **Patch** bump. |
| 2026-07-07 | retail-subtypes | OpenSkyscraper docs | feature-request | P3 | — | — | idea | **Gated: needs a small spec.** Canon named retail subtypes (5 restaurants / 5 fast-foods / 11 shops, lists in `docs/canon/tdt-format.md` §7) as **cosmetic-only** flavor: optional `Unit.subtype` drawn randomly in Simulation's build path (it owns the RNG), no SAVE_VERSION bump (optional-field convention à la `filmPolicy`), old units stay generic (no re-roll on load), inspector title + signage display, "Change variety" reroll in the inspector editor, NO build-palette picker, and a test asserting the economy never reads `subtype`. **Minor** bump. |
| 2026-07-07 | finance-1010 | OpenSkyscraper docs | feature-request | P3 | — | — | idea | **Ready: S–M.** Align the income report with the original's finance taxonomy (`docs/canon/tdt-format.md` §9): 10 income + 10 maintenance categories. Extend `LedgerCat` additively (hotel single/double/suite split; parking/metro/service maintenance lines; `Ledger.restore`'s `sanitizeDay` drops unknown keys so no version bump), rework `buildIncomeHtml` as a two-ledger Income \| Maintenance layout keeping our net-summary line; dim zero rows; stacks on phone. Patch bump if lines change. |
| 2026-07-07 | secom-exe-ideas | OpenSkyscraper docs | feature-request | P3 | — | — | idea | **Gated: Modern-only, needs a spec.** SECOM (TDT tenant ID 17, a cut 1994 feature) as a Modern-mode security contractor alternative, never Classic (cut content isn't canon). Also parked: user-supplied-`SIMTOWER.EXE` asset-extraction spike (NE-resource docs in `docs/canon/tdt-format.md` provenance repo; we can never ship extracted assets); revisit only after the importer + pacing land. |
| 2026-07-07 | authenticity-checklist | OpenSkyscraper docs | review-deferral | P3 | low (cosmetic) | — | open | **Ready: process artifact.** Turn the ~10 original-game screenshots in OpenSkyscraper `doc/simtower/` into a renderer-authenticity checklist for review sessions (underground palette, elevator shaft/car rendering, lobby dressing, hotel room states), incl. the insight that the original's day/night is a **palette swap** (resource 0xFF03): our dusk/dawn should read as a global tint ramp, not per-sprite lighting. |
| 2026-07-07 | deserialize-coercion | — | review-deferral | P2 | med | — | open | **Ready.** `Simulation.deserialize` assigns `sim.star = data.star`, `sim.money = data.money`, and `sim.clock = new Clock(data.minutes)` (~:2041–2043) **raw**: the numeric `data.*` reads there that skip the finite/range coercion every other field gets (same class as the towerName/builtWeddingHall row below; `Clock`'s constructor doesn't harden either). A forged `star: NaN`/`money: Infinity`/`minutes: NaN` flows into rating gates, the ledger, and every `clock.minutes` consumer (completeAt/vacate timers, the lunch bulletin, etc.). Coerce star to an integer 1–6, money to a finite number, and minutes to a finite number on load. (The lunch-bulletin symptom of the `minutes` case is already guarded locally in `emitLunchRush`; this row is the source fix. Found by the dev/architect pass over the importer seam + Copilot on PR #154, 2026-07-07; pre-existing, independent of the importer work.) |
| 2026-07-07 | e1c-migration | SimTower parity | review-deferral | P3 | low | — | open | **Ready — quality, not correctness.** The v1→v2 reflow safety net (`saveMigration.ts` `upgradeV1toV2`) is tower-WIDE all-or-nothing: if `migrationLooksValid` rejects the reflow (one overflowing/degenerate floor), the WHOLE tower reverts to legacy widths — clean floors don't canon-ize either. It's always *safe* (no corruption — the Edge Case Hunter confirmed no overlap/off-lot ever reaches the player), just coarse, and the fallback is *silent*. Enhancement: fall back **per-floor** (reflow the clean floors, keep legacy only on the offending one) and log a `migrationNotes`/telemetry line when a fallback fires so a no-op load is diagnosable. Also (Acceptance Auditor F4): re-pave doesn't enforce "a floor may not be wider than the floor below" — harmless on real saves, add a clamp if a pathological save ever trips it. (Edge Case Hunter + Acceptance Auditor, E1c review.) |
| 2026-07-07 | e1b-widths | SimTower parity | review-deferral | P3 | low | — | open | **Ready — arguably-correct, watch-only.** After E1b widened stairs/escalator 4→8, an OLD-save 4-wide walkway run can't be *continued* with a new 8-wide flight in the same column: the stacked-flight landing-share exemption (`Tower.ts:541-548`) requires `t.width === f.width`, so the mixed-width overlap is rejected as "shafts cannot overlap." Only affects extending a pre-E1b stair/escalator run; mixed-width shafts arguably *shouldn't* merge, so this may be correct-as-is. If it reads as a bug, allow the landing-share when the columns align regardless of width, or bulldoze+rebuild the run. (Edge Case Hunter, E1b review, Finding 2.) |
| 2026-07-07 | w3-basement-depth | SimTower parity | review-deferral | P3 | low | — | open | **Ready — likely by-design, watch-only.** W3 (`nearestLobbyFloorDistance`) anchors only on ground (floor 1), so a deep-basement commercial venue (B3 = floor −2 and below) sits >2 floors from a lobby and takes the permanent ×0.5 traffic penalty — and, because a lobby can never be placed in a basement (`isLobbyFloor` = floor 1 or ×15 only), it can **never** be restored, unlike an above-ground shop a sky lobby can rescue. Matches canon (deep-basement retail is genuinely far from the concourse) so shipping as-is, but if it reads as unfair, consider treating an operational **metro** floor as a W3 anchor (the canon underground entrance draws visitors), or clamp basement distance to the ground. (Edge Case Hunter, E2 review, Finding 3.) |
| 2026-07-07 | w3-push-signal | SimTower parity | review-deferral | P3 | low | — | open | **Ready — legibility polish.** W1/W2 redden the stats overlay and raise an on-notice ribbon; W3 only halves income and writes an inspector line, so a player who plops commercial on the lobby-dead floors (4–12, 18–27, …) silently loses half their trade (and ~0.25× in rain, since `lobbyMult` composes with `rainMult`) unless they hover each unit. Give W3 an at-a-glance pull cue consistent with the satisfaction penalties — a stats-overlay tint on far commercial, or fold into the existing underperforming-venue signal. (Game Designer + UX, E2 review.) |
| 2026-07-07 | w1w2-post-migration-wave | SimTower parity | review-deferral | P3 | low | — | open | **Ready — feel, not correctness.** After a v1→v2 reflow re-lays a returning player's wide tower on the 375 lot, a cohort of offices can cross the 79-tile (W1) / 11–21-tile (W2) lines and begin eroding together — a batched-but-large notice a day or two after load on a tower that "was fine." The erosion is gradual and telegraphed (one batched toast, 2-day notice, recoverable), so it's not a contract violation, but it can read as the game breaking a working tower. Consider a short post-migration grace (suppress W1/W2 erosion for the first in-game day after a v1 load) or a one-time explanatory toast ("Canon spacing rules now apply — check flagged units"). At minimum, confirm the golden `towerone_6` fixture doesn't dump a mass notice on first load. (Game Designer, E2 review, Finding 3.) |
| 2026-07-07 | parking-ramp-connectivity | SimTower parity | feature-request | P2 | — | — | idea | **Gated — own story + own SAVE_VERSION bump; do NOT fold into the segment-parity initiative.** Full 1994 ramp parity: first ramp under the lobby, ramps vertically stacked, a space works only if its ramp column connects up to the lobby — replaces the per-ramp independent-seed model in `functionalParkingSet` (`Tower.ts:971`). Party verdict (Cloud Dragonborn/Samus Shepard/Link Freeman, 2026-07-07): **defer.** Deciding factor: it's a spatial-regime change that re-evaluates on load, and W1 (transport-too-far) already is one — shipping both in one migration makes the change unattributable to the player. **Must-haves if built:** (1) migration **heals not harms** — build the missing ramp column up to the lobby so no existing tower loads with newly-dead parking ("heal or don't touch it"); (2) exactly **one** spatial-regime change per load — never combine with the W1/W2/W3 rollout; (3) **telegraph the repair loudly** (one honest toast, never a silent mutation); (4) **no split-brain** legacy-seed flag in `functionalParkingSet` — connectivity applies to all towers once shipped, which is *why* the healing migration is mandatory. Design merits are sound (more faithful, more strategic depth); this is purely a sequencing/legibility deferral. |
| 2026-07-06 | event-log-persistence | — | feature-request | P3 | — | — | idea | **Gated — needs a spec (save-size tradeoff).** The event log is transient (not serialized), so a manual refresh, a PWA update, OR the game's own auto-reloads (GPU-context-loss recovery, "Update now") blank it — scrollback history vanishes often. If a durable, scrollable history is wanted, serialize a **bounded tail** (~50 entries) and harden it on load like every other `data.*`. Real value (the game reloads itself a lot) vs real cost (per-write save weight + untrusted-load hardening). Party-mode (game/UX/architect, 2026-07-06) split this out from the scrollable-panel work as its own ticket. |
| 2026-07-06 | crane-fix | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Crane can sit a story low over a multi-floor top unit (pre-existing). `Tower.highestFloor` returns max *base* floor and ignores multi-floor extents, so a top row formed only by the upper story of a 2-floor unit based at `hi−1` yields `highestFloor=hi−1`; the crane perches a story below the visual roof. More visible than the edge-overhang case below — do this one first when the crane/render code is open. Fix: derive the crane's floor from the true topmost occupied row (`u.floor + facilityFloors(u.kind) − 1`). (Edge Case Hunter, floating-crane fix.) |
| 2026-07-06 | crane-fix | — | review-deferral | P3 | low (cosmetic) | — | open | **Ready.** Narrow top-run at a tower edge can overhang the crane body past the lot. `syncCrane` anchors the mast over the widest run's center, but `CRANE_W=128px` (~11.6 tiles) with the mast near center means a run narrower than the crane flush to `x=0`/`x=GRID.width` hangs the jib over open sky. Rare (needs a <~12-tile top block flush to an edge). Bundle with the crane fix above. Clamping the body would pull the mast off the run it aligns to — only clamp `pos.x` when the run is near an edge. (gds-code-review, floating-crane fix.) |
| 2026-07-07 | pwa-notes-sanitizer-coverage | — | review-deferral | P3 | low | — | open | **Gated — needs a small source extraction.** `src/pwa.ts` is excluded from vitest coverage as un-unit-testable SW plumbing, but its `fetchUpdateInfo` contains pure, security-relevant logic (filters update `notes` to strings, trims, drops empties, clamps each to 200 chars, caps at 3, type-guards `version`/`sha`) that bounds malformed/hostile update payloads before the modal renders them. That sanitizer currently has no unit coverage and is masked by the file-level exclude. Fix: extract the sanitizer into a pure module (or export it), unit-test the clamps/guards, and drop the pwa.ts exclude to measure just that function. Pre-existing (the exclude predates the coverage-thresholds PR). (gds-quick-dev adversarial review, coverage PR #146.) |
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

### Deferred from: code review of story-e1a-platform-port (`/gds-code-review`, 2026-07-08)

- **Native export feedback is wrong-shaped for the platform port.** `exportGame`
  (`src/game/saveLoad.ts:168-170`) toasts "Tower exported (X KB). Check your
  downloads." synchronously, before the port's async `saveFile` settles. Inside
  a native wrapper that means contradictory toasts on failure (good toast, then
  the "Couldn't save your tower file" bad toast), a "Check your downloads"
  message for a share sheet the player may have just cancelled, and copy that
  is wrong for a share/save flow even on success. Browser behavior is
  unaffected (its saveFile is synchronous-resolve and never rejects), which is
  why this is deferred and not patched: the fix (await the port, pick copy per
  `isNativeWrapper`, decide cancel semantics) is native-UX design that belongs
  with E3b (native bridge shell) in the mobile-distribution epics. (Edge Case
  Hunter, E1a review.)
- **The real native-mode resolution path is unreachable from vitest.** Only
  `resolvePlatform` is unit-tested with a hand-passed `"native"` mode string;
  `getPlatform()` reading `import.meta.env.MODE` (vitest pins it to `"test"`)
  and the one-shot module cache (no reset seam, per the story's
  no-test-only-setter rule) mean a mode-string rename or env misread would ship
  as a permanent silent fallback to browser behavior. Covered operationally by
  E1c, whose acceptance includes verifying the `--mode native` bundle through a
  local static server; keep that check when E1c lands. (Blind Hunter + Edge
  Case Hunter, E1a review.)

### Deferred from: code review of breathing-clock wire-up (PR #154, `/gds-code-review`, 2026-07-07)

- **Backgrounded-tab burst simulation is amplified by night pacing (pre-existing
  class, wider now).** `main.ts update()` accrues `accMinutes` from raw `dtMs`;
  Excalibur clamps a >200 ms frame down to 1 ms, which bounds ordinary hitches,
  but the pacing multiplier (up to 3.25x at night) scales whatever burst does
  get through, and any `accMinutes` overflow past the 2000x20-min guard carries
  into later frames as a fast-forward. Watch-only: verify Excalibur's clamp
  covers the tab-restore path on real devices before adding any `accMinutes`
  cap of our own.

### Deferred from: traffic-indicator fix (PR #141, `/gds-code-review`)

- **Traffic chip's hotspot floor can jitter and spam the `aria-live` region on
  near-tie crossings** — `updateTraffic` (`src/main.ts`) recomputes
  `peakCongestionFloor()` raw each ~160ms tick with a strict-`>` argmax. The tier
  word is hysteresis-smoothed, but the floor suffix is not, so two floors at
  nearly-equal congestion whose curves cross flip the label `Backed up · 42F` ↔
  `· 47F`, and because `#traffic` is `aria-live="polite"` every flip re-announces
  the whole chip to screen readers. Fix direction: move the floor number out of
  the live region (announce the tier word, not the floor), or debounce the shown
  floor. Plausible-not-certain (needs genuine near-tie crossings; exact ties are
  stable). a11y polish, low severity.
- **Multi-tier upward jumps enter the higher tier ~0.02 congestion early** —
  the hysteresis up-guard indexes `B` by the current tier, not `raw-1`, so a
  0→2 or 1→3 jump validates against the lower boundary's deadband. Pre-existing
  behavior (not introduced by this change), no flicker, ~0.02 calibration
  asymmetry. Negligible; noting for completeness.

### Deferred from: gds-code-review E3.1 (parking ratio + one-car sprite), 2026-07-07

- **Dev sprite catalog stretches parking to the cell width** — `gallery.ts:144`
  (`w≈292`) and `preview.ts:79` render `drawParking` at the full catalog-cell
  width, so the new single-stall parking sprite reads as one small car adrift in
  a wide empty bay. Dev-only tooling (not player-facing), cosmetic. Fix (optional):
  render parking at its true `u.width * TILE` footprint in the catalog rather than
  stretching to the cell. _Note: relevant when the E1b width change (parking 6→4)
  lands and screenshots regenerate — revisit the sprite-gallery shot then._

### Deferred from: gds-code-review E4 (mobile floor/lobby drag-paint), 2026-07-07

- **Jittery touch tap with floor/lobby can over-paint one adjacent tile** — the
  "action" path has no movement slop (`TowerEngine.pointerMove` fires
  `onActionMove`→`paintFloorRun` on any movement), while the pan-tap path allows
  14px. So a touch tap that jitters across a tile boundary lays the anchor strip
  **and** one extra adjacent tile. Low: floor/lobby runs are contiguous by intent
  and cheap, and the deferred anchor still lays exactly one strip on a pure
  (no-move) tap. Fix if it annoys: gate `paintFloorRun` behind a small on-touch
  movement threshold mirroring the tap slop. (Blind Hunter finding 2.)

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
