# Addendum — Verticopolis PRD

Depth that does not fit the PRD's capability-focused shape: technical realization,
aesthetic/tone direction, the relationship to the source of truth, and rejected
alternatives. The PRD (`prd.md`) is authoritative for requirements; this file is
supporting context for downstream architecture/UX work.

---

## A. Source-of-Truth Mapping (SimTower 1994 → Verticopolis)

| SimTower (1994) mechanic | Verticopolis realization | Divergence |
| --- | --- | --- |
| Build floors, then rooms; ground + sky lobbies every 15 floors | Two-layer grid; rooms auto-create floor beneath; lobbies at ground + every 15th | Faithful |
| ~100 floors up, basements below | 100 up, 10 basement levels below (B1…B10, floor 0 = B1 down to floor −9), 340 tiles wide | Faithful (basement depth tuned) |
| Offices, condos, hotel (single/double/suite), food, retail, cinema, party hall | All present with original cadences | Faithful |
| Services: security, medical, housekeeping, recycling, parking | All present | Faithful |
| Metro/subway brings visitors | Whole-basement Metro Station | Faithful |
| **Cathedral** on floor 100 for TOWER | **Wedding Hall** on floor 100 | **Renamed** — religion-agnostic |
| Stairs, escalators, standard/service/express elevators with cars + stops | All present; SCAN dispatch answers the real routed crowd (hall + cab calls); editable cars & per-floor stops; stairs/escalators are one-tap fixed two-floor flights that stack into columns | Faithful |
| Service elevators are staff/freight-only; housekeepers travel room to room | Staff-only service shafts + a staff network (service elevators, stairs, escalators) housekeepers physically travel on; rooms stay dirty until a housekeeper arrives | Faithful (since 2026-07-02) |
| Star ratings 2★/3★/4★/5★ at 300/1k/5k/10k; TOWER at **15,000** | Same thresholds incl. 5★=10k; **TOWER at 15,000** (lot widened to 340 so it's reachable) | Faithful (see 2026-06-30 update) |
| Fire, terrorist/bomb, VIP inspection, treasure | All present, plus thief + seasonal Santa cameo | Faithful + flavor additions |
| Aggregate congestion/stress model | **Individually-routed** crowd (BFS) + aggregate backstop | **Enhanced** + backstop |
| `.TWR` save format | JSON saves; `.TWR` import = documented stub | Modernized; `.TWR` import partial |

### Deliberate divergences (rationale)

1. **Cathedral → Wedding Hall.** A religion-agnostic events hall avoids
   reproducing the original's specific religious building while preserving the
   "grand capstone on floor 100 that triggers the win" role.
2. **TOWER population — RESOLVED to the canonical 15,000 (2026-06-30).** Earlier
   builds scaled the target down (12,000 → 8,000) because a 100×200 lot topped out
   near ~8,900 occupants under the spatial transport model. Per the owner's call
   the buildable lot was **widened to 340 tiles** (5★ = 10,000, TOWER = 15,000
   restored); a well-zoned tower now reaches ~15,066 occupants at healthy
   congestion, so the original numbers are met, not scaled. No longer a divergence.
3. **Individually-routed crowd + aggregate backstop.** The original used an
   aggregate stress model. This build pathfinds real commuters (walk → wait →
   ride a real car → transfer → arrive) so stress is *visible* and causal, but
   keeps a deterministic, DOM-free aggregate model underneath as the testable
   backbone and the on-screen crowd is capped (~140) for performance.

## B. Technical Realization (informs architecture, not a requirement)

- **Language/stack:** TypeScript on the **Excalibur.js** game engine (camera,
  scene, culling, collision, render loop). Build tooling: Vite (`build`,
  `preview`, `build:single` for a one-file inlined bundle).
- **Audio:** procedural **WebAudio** synth — no audio files. Location-aware
  scene crossfading driven by camera focus.
- **Rendering:** all sprites drawn in code (`src/render/pixelSprites.ts`,
  `sprites.ts`); no external art assets.
- **Simulation core (`src/engine/`):** single global `Clock`; `Simulation`,
  `Tower`, `EconomySystem`, `EventSystem`, `ElevatorDispatch`, `Crowd`,
  `SimContext`. Config centralized in `econConfig.ts` and `facilities.ts`. Seeded
  `rng.ts` so the simulation is deterministic and headless-testable.
- **Elevator dispatch (FR-26):** demand-driven **SCAN** (elevator/disk-scan
  algorithm) — a car continues in its current direction serving requests, then
  reverses; idles at the ground lobby when there is no demand (`ElevatorDispatch`).
  Since 2026-07-02 the drawn crowd feeds dispatch directly
  (`Crowd.elevatorCalls`): waiting people are per-floor **hall calls** layered
  over the statistical demand estimate, and riders' destinations are per-car
  **cab calls**; staff-only shafts consume hall calls exclusively (no
  statistical tenant demand).
- **Commuter routing (FR-30):** each person's path is computed by **BFS** over
  the connected transport graph (shafts + lobby transfers), in `Crowd`. Staff
  (housekeepers) route over a separate **staff adjacency** (service elevators +
  stairs + escalators, service-first on ties) with no ride cap; tenants never
  see staff-only shafts.
- **Determinism boundary (review F40):** the *authoritative* state — money,
  population, satisfaction, ratings, events — is recomputed deterministically from
  clock-edge snapshots under the seeded RNG, so headless runs and the test suite
  are reproducible. The *visible crowd* (individually-routed walkers/riders) is a
  presentation layer: its exact positions depend on frame/step cadence and it is
  re-seeded on load, so it is intentionally NOT part of the deterministic
  contract. The v2 hourly clock (Phase 2) makes the authoritative integration
  match between headless and browser; the crowd remains cosmetic.
- **Determinism boundary:** gameplay events use the seeded RNG; cosmetic weather
  uses a separate RNG so visuals never perturb gameplay (supports FR-54/FR-57).
- **Persistence:** `localStorage` autosave + slots; JSON export/import
  (`SaveGame.ts`); best-effort `.TWR` decoder stub (`twrImport.ts`).
- **Testing:** Vitest suite (282 tests across 28 files, all passing) covering
  placement rules (incl. structural support and stair stacking), economy,
  ratings gates, events (housekeeping/fire/bomb/weather), elevator dispatch
  (incl. crowd hall/cab calls and staff-only shafts), crowd BFS
  routing/movement, staff routing, transport rendering geometry, save/load, the
  `.TWR` parser, and an end-to-end run to the TOWER victory (`parity.test.ts`).
  `npm run typecheck`, `npm run lint`, `npm run screenshots`.

## C. Aesthetic & Tone

- **Visual reference:** the 1994 original's flat, readable, pixel cross-section
  of a tower — each floor a horizontal band, rooms as colored cells, tiny
  walking people. Code-drawn sprites in a restrained, period-appropriate palette
  (see `FACILITIES[*].color`).
- **Anti-references:** no glossy 3D, no skeuomorphic chrome, no asset-store look.
  Nothing that reads as a generic mobile "tycoon" cash-shop game.
- **Atmosphere:** calm and absorbing. Day/night arc with sun and moon, lit
  windows at night, shops closing, a metro train arriving — the building should
  feel *alive* and *quiet*.
- **Audio tone:** unobtrusive, location-aware muzak/ambience; jingles for
  build/sell/promotion are short and satisfying, never intrusive.

## D. Cross-Cutting Non-Functional Notes (for architecture/UX)

- **Performance:** must stay responsive on a tall, fully-populated tower on a
  mid-range laptop and phone; the ~140 visible-crowd cap and culling are the
  primary levers. Excalibur's physics pass is disabled (nothing in the game
  uses it; big towers froze phones at high speed with it on).
- **Mobile GPU robustness (2026-07-02):** oversized draw surfaces (tall
  elevator/stair shafts, the ground plane) are tiled into texture-size-safe
  bands so mobile GPUs never drop them as black rectangles; WebGL context loss
  auto-recovers in place instead of dead-ending on a "refresh the page" card;
  a frame-exception guard prevents a single bad frame from freezing the game.
- **Determinism/testability:** the aggregate model + seeded RNG must keep the
  headless suite green; rendering must be separable from simulation.
- **No network dependency:** everything runs offline, including the single-file
  build.
- **Accessibility (open):** color-blind-safe congestion cue, keyboard play, and
  reduced-motion are unresolved (Open Question 6) — flagged for UX.

## E. Rejected / Deferred Alternatives

- **Reproduce the Cathedral verbatim** — rejected (clean-room + neutrality).
- **Match 15,000 TOWER population** — **DONE (2026-06-30):** achieved by widening
  the buildable lot to 340 tiles rather than a new population model; the canonical
  15,000 / 5★ 10,000 are now reachable (~15,066 measured).
- **Full `.TWR` import** — deferred; the format is under-documented and the
  effort outweighs MVP value. Stub documents the v2 decode path.
- **Single aggregate stress model (original-style only)** — superseded by the
  individually-routed crowd; the aggregate model was retained, not removed, as a
  deterministic backstop rather than the primary mechanic.
- **Native/desktop app packaging** — rejected; zero-install browser + single-file
  HTML covers the sharing/play goals without a distribution pipeline.
