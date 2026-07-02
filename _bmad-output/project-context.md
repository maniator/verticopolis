# Project Context — Verticopolis (AI agent rules)

Foundational context every BMAD agent (bmm / cis / **gds game agents**) must carry.
Concise on purpose — only the non-obvious rules an LLM needs reminding of. For the
full spec see the PRD under `_bmad-output/planning-artifacts/prds/`.

## What this is
- **Verticopolis** — a from-scratch, browser-native clone of **SimTower (1994, Maxis/OPeNBooK)**.
- **The single source of truth is SimTower 1994**, specifically the GameFAQs/Kiwizoid
  FAQ (summarized with attribution under `_bmad-output/planning-artifacts/reviews/faq-parity-2026-06-30/faq-canon.md`).
  The bar is **gameplay parity**, not reinvention. New mechanics are out of scope.

## Stack — NOT a Unity/Unreal/Godot game
- **TypeScript** on the **Excalibur.js** game engine, built with **Vite**. Runs in any
  browser; can export to a single self-contained HTML file. There is **no game-engine
  editor, no C#/C++/GDScript, no scene files** — do not assume Unity/Unreal/Godot
  workflows. (The gds module's `primary_platform` is pinned to `web` in
  `_bmad/custom/config.toml`; the installer's `unity/unreal/godot/other` default is wrong.)
- All art and audio are **generated in code** (no ripped/imported assets) — clean-room homage.
- The simulation is deterministic and **headless-testable** (seeded `rng.ts`); tests are Vitest.

## Where the truth lives (engine)
- `src/engine/facilities.ts` — **the tuning source of truth**: `GRID` (lot 340 wide, floors
  −9…100), `STAR_THRESHOLDS`, `TOWER_POPULATION`, per-facility cost/width/minStar/population,
  build caps. Quote numbers from here, never hard-code duplicates.
- `src/engine/Simulation.ts` — clock/tick, star evaluation, VIP, congestion (v1 + v2 spatial).
- `src/engine/Tower.ts` — placement/geometry, served-floor reachability, parking chains,
  structural support (`isSupported`, `removalReason`), staff connectivity (`staffConnected`).
- `src/engine/EconomySystem.ts`, `EventSystem.ts`, `Crowd.ts`, `econConfig.ts` — money, disasters,
  routing; housekeeping capacity constants (`HK_ROOMS_PER_CREW`=20, `HK_MAX_IN_FLIGHT`=4) live in
  `EconomySystem.ts`.
- `src/engine/ElevatorDispatch.ts` — SCAN car controller; consumes `Crowd.elevatorCalls(tower)`
  (per-shaft **hall** calls + per-car **cab** calls). Transport-kind predicates
  (`isStaffOnlyTransport`, `isStaffTransportKind`, `isFixedSpanTransport`) live in `facilities.ts`.
- `simModel` defaults to **`"v2"`** (hourly sub-stepping + spatial per-floor congestion).

## Canon rules that are easy to get wrong
- **Star ladder** (population + gates): 2★ 300 · 3★ 1,000 (Security) · 4★ 5,000
  (Medical + Recycling + >1 Suite + a favorable VIP) · 5★ 10,000 (Metro). **TOWER = 15,000.**
- **Rating census** counts office workers + condo residents. **Hotel guests count only
  while climbing to 3★, then drop out** (`ratingPopulation()`). Commercial visitors never count.
- **Two-ride rule:** a trip uses at most **two** transport rides (one sky-lobby transfer);
  floors reachable only via 3+ rides draw no commuters. Sky lobbies go every ~15 floors.
- **Parking** has a **Ramp** + **Spaces**; a space only functions when chained (contiguous
  spaces) back to a ramp — unconnected spaces are dead ("red X").
- **Office noise** caps adjacent hotel/condo satisfaction (≤0.6); it does not evict.
- **Cinemas** book an average (~$150k) or **blockbuster** (~$300k, bigger crowd) film monthly.
- Emergencies (fire-rescue / bomb-ransom) are **player choices** via a modal that **pauses** the sim.
- **Service elevators are staff-only**: tenants never route through or board them, and they
  do **not** count toward served-floor reachability. Staff (housekeepers) route over the staff
  network — service elevators + stairs + escalators — and **service elevators win route ties**
  (build order must not decide). Staff-only shafts answer **only real staff calls**, never the
  statistical tenant-demand estimate.
- **Housekeeping never cleans instantly**: a room stays `dirty` (distinct art) until a
  housekeeper physically arrives over the staff network. Capacity is finite (~20 rooms/crew/day);
  over-capacity and can't-reach conditions each have their own player advisory — don't collapse
  them, and don't let the cockroach event be the only symptom.
- **Stairs/escalators are fixed two-floor flights**: one-tap placement (no drag-to-size), a
  span cap enforced on **every** path including resize/extend, and stacking allowed only with an
  exact-footprint match (same x/width) sharing the landing floor.
- **Structure needs support both ways**: a floor above the ground story requires the story
  below fully built beneath it, and bulldozing is refused when it would leave the story above
  hanging (`Tower.isSupported` / `removalReason`).

## Ratified divergences from canon (intentional — do NOT "fix")
- **Wedding Hall** on floor 100 stands in for the original **Cathedral** (religion-neutral clean-room choice); mechanics are identical.
- Canon-non-removable structures are **kept removable** (partial-refund bulldoze) as a QoL choice.
- Both are owner-ratified and documented in the PRD addendum / decision log.

## Artifacts & working conventions
- BMAD output lives under `_bmad-output/` (`planning-artifacts/prds`, `.../reviews`).
- **Merge commits only** to `main` (never squash). Commit/push only when asked.
- **Deep adversarial review runs in the SAME session that writes the code** (find →
  verify → synthesize via `/gds-code-review` or `/bmad-code-review`) — before pushing,
  or immediately after opening/updating the PR. Never defer it to "before merge":
  sessions end and the review gets forgotten. A change isn't done until confirmed
  findings are fixed and re-verified on the branch. Resolve Copilot/Codex PR threads.
- Screenshots regenerate via **`npm run screenshots:docker`** (host Chromium is broken); the
  demo/camera reads the live `GRID.width`.

## Performance & platform gotchas
- **Excalibur physics is deliberately disabled** (nothing uses it; enabled, it froze phones on
  big towers at high speed) — do not re-enable it.
- **Never draw one oversized surface**: tall shafts and the ground plane are tiled into
  texture-size-safe bands or mobile GPUs render them as black rectangles. Keep new large
  visuals banded the same way.
- **WebGL context loss auto-recovers in place** — don't add "refresh the page" dead-ends; a
  frame-exception guard already keeps one bad frame from freezing the game.
- Dispatch must be fed the live crowd: pass `crowd.elevatorCalls(tower)` into
  `ElevatorDispatch` (`accumulate` once per outer step, `moveCars` per sub-step) or visible
  waiters get stranded when statistical demand rounds to zero.
