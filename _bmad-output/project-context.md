# Project Context: Verticopolis (AI agent rules)

Foundational context every BMAD agent (bmm / cis / **gds game agents**) must carry.
Concise on purpose. Only the non-obvious rules an LLM needs reminding of. For the
full spec see the PRD under `_bmad-output/planning-artifacts/prds/`.

## What this is
- **Verticopolis**: a from-scratch, browser-native clone of **SimTower (1994, Maxis/OPeNBooK)**.
- **The single source of truth is SimTower 1994**, specifically the GameFAQs/Kiwizoid
  FAQ (summarized with attribution under `_bmad-output/planning-artifacts/reviews/faq-parity-2026-06-30/faq-canon.md`).
  For **Classic**, the bar is **gameplay parity**, not reinvention: Classic is
  parity-locked to 1994 and new mechanics are out of scope there.

## Scope: Classic parity-locked, Modern is a curated sandbox (2026-07-22)
- **Classic** stays pixel-and-rule-faithful to SimTower 1994. No new mechanics,
  no new content. Its golden masters must stay byte-stable.
- **Modern** is the sanctioned home for **post-1994 additions**: new room types,
  new economy behaviors, and freeform build controls the original could not do.
  These are **added deliberately** through the design process (party ratification
  → design doc / spec → `/gds-code-review`), never ad hoc. A Modern addition must
  leave Classic byte-identical.
- **No TDT for Modern.** The 1994 `.TDT` format (`src/storage/tdt*`, save
  round-trip) is **Classic-only**. No Modern-only feature adds TDT handling (no
  new ordinals, no format-version bump for Modern content); Modern persists
  through the native save format only. Round-tripping post-1994 content through a
  1994 format is lossy by definition.
- **Connected / multi-tower** ideas remain an **owner-gated epic** (the 375-wide
  single-lot `LOT_WIDTH` and save format make it a rewrite, not a Modern toggle),
  not part of the standing Modern-sandbox sanction.
- The living plan for Modern additions is
  `_bmad-output/planning-artifacts/gdds/gdd-modern-expansion-2026-07-22.md`.

## Stack: NOT a Unity/Unreal/Godot game
- **TypeScript** on the **Excalibur.js** game engine, built with **Vite**. Runs in any
  browser; can export to a single self-contained HTML file. There is **no game-engine
  editor, no C#/C++/GDScript, no scene files**. Do not assume Unity/Unreal/Godot
  workflows. (The gds module's `primary_platform` is pinned to `web` in
  `_bmad/custom/config.toml`; the installer's `unity/unreal/godot/other` default is wrong.)
- All art and audio are **generated in code** (no ripped/imported assets), a clean-room homage.
- The simulation is deterministic and **headless-testable** (seeded `rng.ts`); tests are Vitest.

## Distribution targets (packaging only, game scope unchanged)
- The web game at https://verticopolis.com is browser and PWA only, and the single
  source of truth. The Android TWA loads that same live site (marked by `?src=twa`),
  so it is a browser surface too; `src/public/.well-known/assetlinks.json` and the
  Android application ID it names stay public for it (PRD N2).
- **Wrapper builds are retired (2026-10-14, #991).** There is no Electron
  (`--mode desktop`) or Capacitor (`--mode native`) build mode, no `src/platform/`
  injection seam, no host-command bridge, no shell save store, no desktop consent
  flow and no `/api/ingest/desktop` route. Do not reintroduce a build mode or a
  wrapper-detection branch: other frontends consume the Rust engine
  (`engine-rs/`, the `verticopolis-engine` crate) directly rather than wrapping
  this web build. Historical planning documents that describe the wrapper epics
  stay as records.
- Store configs, CI signing, and anything monetization-shaped never live here.
  This does not loosen the parity scope: no new mechanics, `primary_platform`
  stays `web`.

## Where the truth lives (engine)
- `src/engine/facilities.ts`: **the tuning source of truth**: `GRID` (lot 375 wide, floors
  −9…100), `STAR_THRESHOLDS`, `TOWER_POPULATION`, per-facility cost/width/minStar/population,
  build caps. Quote numbers from here, never hard-code duplicates.
- `src/engine/Simulation.ts`: clock/tick, star evaluation, VIP, congestion (v1 + v2 spatial).
- `src/engine/Tower.ts`: placement/geometry, served-floor reachability, parking chains,
  structural support (`isSupported`, `removalReason`), staff connectivity (`staffConnected`).
- `src/engine/EconomySystem.ts`, `EventSystem.ts`, `Crowd.ts`, `econConfig.ts`: money, disasters,
  routing; housekeeping capacity constants (`HK_ROOMS_PER_CREW`=20, `HK_MAX_IN_FLIGHT`=4) live in
  `EconomySystem.ts`.
- `src/engine/ElevatorDispatch.ts`: SCAN car controller; consumes `Crowd.elevatorCalls(tower)`
  (per-shaft **hall** calls + per-car **cab** calls). Transport-kind predicates
  (`isStaffOnlyTransport`, `isStaffTransportKind`, `isFixedSpanTransport`) live in `facilities.ts`.
- `simModel` defaults to **`"v2"`** (hourly sub-stepping + spatial per-floor congestion).

## Canon rules that are easy to get wrong
- **Star ladder** (population + gates): 2★ 300 · 3★ 1,000 (Security) · 4★ 5,000
  (Medical + Recycling + >1 Suite + a favorable VIP) · 5★ 10,000 (Metro). **TOWER = 15,000.**
- **Rating census** counts office workers + condo residents + commercial venue
  customers. Commercial counts LIVE customers (`Unit.customersIn`, whoever is
  eating right now, often 0); the catalog values (fast food 25 / restaurant 35 /
  shop 20, chosen per footprint) are what TDT export writes, not a flat census
  add. `censusCount()` in `facilities.ts` owns the rule. **Hotel guests count
  while climbing up through 4★, then drop out** (`ratingPopulation()`).
- **Two-ride rule:** a trip uses at most **two** transport rides (one sky-lobby transfer);
  floors reachable only via 3+ rides draw no commuters. Sky lobbies go every ~15 floors.
- **Parking** has a **Ramp** + **Spaces**; a space only functions when chained (contiguous
  spaces) back to a ramp. Unconnected spaces are dead ("red X").
- **Office noise** caps adjacent hotel/condo satisfaction (≤0.6). In **Classic** that is all it does (canon: caps but never evicts). In **Modern** it also erodes below the cap and can eventually evict (`GameRules.noiseErosionScale()` gates this; Classic returns 0).
- **Cinemas** book an average (~$150k) or **blockbuster** (~$300k, bigger crowd) film monthly.
- Emergencies (fire-rescue / bomb-ransom) are **player choices** via a modal that **pauses** the sim.
- **Service elevators are staff-only**: tenants never route through or board them, and they
  do **not** count toward served-floor reachability. Staff (housekeepers) route over the staff
  network (service elevators + stairs + escalators) and **service elevators win route ties**
  (build order must not decide). Staff-only shafts answer **only real staff calls**, never the
  statistical tenant-demand estimate.
- **Housekeeping never cleans instantly**: a room stays `dirty` (distinct art) until a
  housekeeper physically arrives over the staff network. Capacity is finite (~20 rooms/crew/day);
  over-capacity and can't-reach conditions each have their own player advisory. Don't collapse
  them, and don't let the cockroach event be the only symptom.
- **Stairs/escalators are fixed two-floor flights**: one-tap placement (no drag-to-size), a
  span cap enforced on **every** path including resize/extend, and stacking allowed only with an
  exact-footprint match (same x/width) sharing the landing floor.
- **Structure needs support both ways**: a floor above the ground story requires the story
  below fully built beneath it, and bulldozing is refused when it would leave the story above
  hanging (`Tower.isSupported` / `removalReason`).

## Ratified divergences from canon (intentional: do NOT "fix")
- **Wedding Hall** on floor 100 stands in for the original **Cathedral** (religion-neutral clean-room choice); mechanics are identical.
- Canon-non-removable structures are **kept removable** (partial-refund bulldoze) as a QoL choice.
- Both are owner-ratified and documented in the PRD addendum / decision log.

## Artifacts & working conventions
- BMAD output lives under `_bmad-output/` (`planning-artifacts/prds`, `.../reviews`).
- **Shift-left + regression testing** (full rule in `AGENTS.md` -> Testing
  discipline): every bug fix ships a regression test pinning the failure,
  including the shift into and out of the failing condition; pin each invariant
  with a unit-level guard at the cheapest tier, never only a heavy integration
  run; test fixtures must assert every construction step the claim depends on
  (`expect(r.ok)`), because a silently degraded fixture tests a different tower
  than the one described.
- **No em-dashes in prose** (player-facing copy, docs, comments, commit and PR
  text) in anything new you write. Use commas, colons, parentheses, or separate
  sentences instead. Two standing exceptions: en-dashes in numeric ranges
  (`2–5`, floors `30–60`), and the standalone "—" empty-value placeholder glyphs
  in the stats/editor panels. Existing `src/` code comments are grandfathered;
  don't sweep them, but don't add new em-dashes either. Skip the "X, not Y"
  emphatic-restatement pattern and AI marketing vocabulary (leverage, seamless,
  robust, comprehensive, elevate, streamline, and the like). Keep copy plain,
  human, and grammatically correct.
  The Rust engine in `engine-rs/` follows these rules with no grandfathered
  comments, plus the 500-line file ceiling (see CONTRIBUTING "Conventions").
- **Merge commits only** to `main` (never squash). Commit/push only when asked.
- **Version bump on player-facing change:** bump `package.json` `version` (semver
  by player impact: **minor** for a new player-facing capability, **patch** for a
  player-noticeable fix/behavior change) in the same PR; internal-only work
  (refactor / perf-with-identical-behavior / tests / docs / tooling) needs none.
  It's injected as `__APP_VERSION__` on the splash and anchors the update flow, so
  a missing bump on a player-facing change is a review finding.
- **Deep adversarial review is MANDATORY and runs in the SAME session that writes the
  code, and it means actually invoking `/gds-code-review` (gameplay/engine) or
  `/bmad-code-review` (everything else, incl. storage/persistence/tooling/UI plumbing).
  TDT / save round-trip work (`src/storage/tdt*`, save import/export) routes to
  `/gds-code-review` despite being storage-mechanism: its correctness is
  engine-data fidelity (population census, elevator/transport behavior,
  floor/lobby/view mapping); run both if it also carries a big tooling/UI surface.**
  Its parallel layers (Blind Hunter → Edge Case Hunter → Acceptance Auditor → triage)
  ARE the deep review; a self-read or a generic `/code-review` does not count. Run it
  before pushing, or immediately after opening/updating the PR. Never defer to "before
  merge" (sessions end and it gets forgotten). Fix every `patch` finding; record every
  `defer` finding in `_bmad-output/implementation-artifacts/backlog.md`. A change
  isn't done until confirmed findings are fixed and re-verified on the branch. Resolve
  Copilot/Codex PR threads.
- **Backlog rows mirror to GitHub issues (standing rule, 2026-07-15).** Every
  unresolved curated row in `_bmad-output/implementation-artifacts/backlog.md`
  carries its issue number in the `GH` column. Create the matching issue when a
  row lands (a plain title, a type label and a `P1`-`P3` label, row notes as
  the body) and close it when the row finishes. The row's `Priority` owns the
  P label: `backlog-priority-labels.yml` re-syncs it whenever a push to `main`
  changes the backlog, and weekly. The full rule lives in the
  backlog's "How items flow" section; `src/tests/backlogIssueMirror.test.ts`
  enforces the row half of the invariant (row shape, status vocabulary, refs
  present on unresolved rows, cleared on finished rows, and unique).
- Screenshots regenerate via **`npm run screenshots:docker`** (host Chromium is broken); the
  demo/camera reads the live `GRID.width`.

## UI design system
- `docs/design-system.md` is the contract for all UI/CSS work: tokens + components
  (`.btn`/`.win`/`.win-title`/`.well`/`.field`/`.kv`) in `src/styles.css`, organized as ONE
  generation of CSS. **No skin on IDs; edit rules, never out-specify them; press-only button
  feedback; one primary per dialog; the splash is box art and stays un-unified.**

## Performance & platform gotchas
- **Hot paths get a complexity review, and it is a review gate.** The tick loop
  (`Simulation.tick` → `Crowd`, `ElevatorDispatch`, `EconomySystem`), the hosts and the render/UI
  refresh run over the whole tower every step or frame, and the reference towers hold 12,062 to
  43,358 units (most of the large one floor tiles), 110 floors and thousands of people. Look up
  entities by id (`Tower.getUnit` / `getTransport`, `get_unit` / `get_transport`), hoist
  tower-wide facts out of per-unit and per-person loops, keep counters instead of re-scanning, and
  memoize per-`revision` work (see `Tower.stopsOf`). The checklist,
  `docs/performance/hot-path-review.md` (HP-1 to HP-12), applies to Rust and TypeScript alike, to
  ported and inherited code, and to scans hidden in helpers. The deep review flags a
  whole-collection scan under any HP-2 multiplier and resolves it under that page's section 7:
  fixed, or deferred with evidence and an issue, never dismissed as pre-existing. The review
  skills load the page through `_bmad/custom/gds-code-review.toml` and
  `_bmad/custom/bmad-code-review.toml`.
- **Excalibur physics is deliberately disabled** (nothing uses it; enabled, it froze phones on
  big towers at high speed). Do not re-enable it.
- **Never draw one oversized surface**: tall shafts and the ground plane are tiled into
  texture-size-safe bands or mobile GPUs render them as black rectangles. Keep new large
  visuals banded the same way.
- **WebGL context loss auto-recovers in place**. Don't add "refresh the page" dead-ends; a
  frame-exception guard already keeps one bad frame from freezing the game.
- Dispatch must be fed the live crowd: pass `crowd.elevatorCalls(tower)` into
  `ElevatorDispatch` (`accumulate` once per outer step, `moveCars` per sub-step) or visible
  waiters get stranded when statistical demand rounds to zero.
