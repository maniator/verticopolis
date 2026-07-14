---
title: 'Pixel-art people system: the person() family, two-scale figures, honest occupancy, and the elevator queue seam'
type: 'feature'
created: '2026-07-14'
status: 'draft'
baseline_commit: '3deb0d1'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/gdd-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/epics-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible and arch doc; do not modify unless a human renegotiates the people-system canon">

## Intent

**Problem:** The sims are the tower's most-repeated shape, and today they miss the ratified 1994 narrative style on three counts. (1) Geometry: `person()` in `pixelSprites/common.ts` draws a squat figure (head `2*s`, torso `2.4*s` wide, `(seated?3:4)*s` tall) with a translucent hair smudge, no eye highlight, no torso edge shading, and no contact shadow, so it reads "too tiny" and flat against the enriched dollhouse walls. (2) One scale: every call site scales the same build by a loose `s` multiplier, so a diner and a lobby crosser are the same silhouette at different zoom, not the two distinct human sizes the board calibrated. (3) Ghost people and invisible congestion: `scatterPeople` sprays seeded pedestrians along the party hall and metro strips regardless of population, the lobby/corridor walkers gate only on a coarse crowd fraction, elevator landings draw no waiting line at all, and the car interior draws a rider bucket that is not tied to the same tracked individuals who were queued. A player cannot see where the tower is congested, and an empty tower does not read empty.

**Approach:** This is the foundational spec of the overhaul: it redesigns the shared `person()` family every tenant, service, structure, and transport kind imports, so all later specs inherit correct humans. Rebuild the figure to the owner-approved finalized geometry (art bible, Figma pages 06 to 07): a small family of builds (seated occupant 15px, standing occupant 18px, walker 24px, transport rider 17px, hi-vis worker 22px) with a detailed head (skin plus a 1px hair line and a 1px eye highlight), torso edge shading (1px darker left, 1px lighter right), and a 1px contact shadow, all at integer pixels. Keep the exported `person()` signature call-compatible so no existing call site breaks; new detail sits behind defaulted parameters, and the build selector plus a mood helper name the two scales explicitly. Class silhouette is chosen from what the sim actually is (worker, guest, shopper, staff), never at random. Mood is the torso fill: content wears the class `SHIRTS` color, impatient warms to amber `#E8862A`, fed up turns the reserved stress red `#C24A3A`. No people are ghosts: room figures map to `visibleOccupants(u)` (already in the bake signature via `occupants` and `outForMeal`), and walker or queue figures map to real routed sims and appear only when traffic exists.

The work splits cleanly by boundary. Pure-render, ships now: the `person()` family redesign, the two-scale application at every call site, the mood-tint plumbing where the signal already exists (walker stress), the finalized transport-rider and car-fill builds (the cab already reads `t.carLoad`), and the walker bake canvases resized for the taller figure. Behind one engine seam, a distinct E6 story: the visible elevator queue at each landing (ordered waiters plus a bounded wait tier per floor) and the boarded-count reconciliation that ties queue and car fill to the same tracked individuals. The seam is a read-only projection of existing crowd state (`crowd.people`, the same population `elevatorCalls` already scans once per outer step), memoized once per step, never re-derived per frame, and it lives on the transport render path so no `cache:true` room bake is touched. Replacing the decorative `scatterPeople` crowds with occupancy or traffic gating is called out here and tracked as a backlog follow-up, not silently folded in.

## Boundaries & Constraints

**Always:**
- The exported `person(ctx, x, footY, s, seed, seated?, tint?)` signature stays call-compatible. Every current caller (residential, food, shop, facilities, transport `drawCar`, the `TowerEngine` walker bake) keeps working unchanged; new geometry detail and the build or mood selectors ride on defaulted parameters.
- Integer pixel coordinates only, in every build and at every call site. Round before `fillRect`.
- Mood is the torso fill, and only these three values: content equals the class `SHIRTS` color, impatient equals amber `#E8862A`, fed up equals the reserved stress red `#C24A3A`. No `SHIRTS` entry may equal `#C24A3A` (the rule already documented at `common.ts:26`; keep it pinned).
- Class and silhouette are chosen from what the sim is, deterministically per sim or per occupant seat, never a fresh random each frame.
- Room-occupant figures map to `visibleOccupants(u)`. Their count and presence read only inputs already in the bake signature (`occupants`, `outForMeal`), so room bakes still repaint correctly with no signature change.
- Walker and queue figures are real routed sims and draw only when traffic is present; an empty tower reads empty.
- The elevator queue projection is a read-only view of already-tracked crowd state, computed once per outer sim step in the single existing pass over `crowd.people`, memoized, and read (not recomputed) by the render frame. `src/engine/` stays free of DOM and rendering.
- Boarded equals `min(queue-at-arrival, remaining car capacity)`; whoever does not fit stays in the same queue as the same individuals. The projection surfaces this; it does not re-simulate boarding.
- American English; no em-dashes in new prose or comments. Reserved colors are never reused for decoration (stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`). Note the impatient mood amber `#E8862A` is a distinct people-system value and is deliberately not the reserved notice amber `#E8A030`.

**Ask First:**
- Adding any new input to the room bake signature (`TowerEngine.ts` ~1632). If a room-occupant visual must vary on a live input not already in the signature (for example, tinting seated diners by mood), that input is added deliberately as a reviewed decision, never read behind the signature's back.
- Changing `SHIRTS`, `SKIN`, or `PAL` entries, or the `geoVariant` axis integers. New palette keys only; no mutation of existing anchors (residential, food, shop reference them directly).
- Reading crowd or queue state anywhere outside the render layer and the one engine projection, or widening the projection beyond a read-only view (count plus tier per floor, boarded per car).
- Bumping `SAVE_VERSION` or touching any `Unit` shape or TDT format. This work is visual plus a read-only engine projection; it must not.

**Never:**
- No ghost people. Do not scatter seeded pedestrians independent of population. `scatterPeople`-style constant crowds become occupancy or traffic driven or are removed (tracked as a backlog follow-up; do not leave a constant lobby or platform crowd behind).
- No new full-collection scan (`find` / `filter` / `some` / a `for` over `crowd.people` or `tower.units`) nested in a per-tick or per-frame path. Occupant counts, queue lists, and boarded counts arrive as prepared inputs.
- No per-frame `d.anim` read added to a `cache:true` room; only fire, construction, and the existing cinema marquee redraw per frame. Queues and car fill live on the transport render path, which already redraws.
- No mode branch (Classic or Modern) inside any person or queue draw routine.
- No sub-3px silhouette width and no figure whose class is picked at random per frame.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Seated occupant | Diner, seated office or condo worker, reader, wedding guest, or behind-counter staff (receptionist, teller, pharmacist, guard, barista, cook) | The 15px seated build: head 5, torso 10, no legs, 6px wide, roughly one third of a 44px floor. Content torso color from the class `SHIRTS` seed. |
| Standing occupant | Staff standing in the open in a module (medical nurse or doctor, housekeeper) | The 18px standing build: head 5, torso 9, legs 4, 6px wide. |
| Walker | Ground or sky lobby crosser, the three entrances, the metro platform crowd, any corridor or transport-landing traffic | The 24px walker build: head 5, torso 13, legs 6, 7px wide, roughly 55 percent of a floor. |
| Transport rider | Stairs or escalator rider on the incline | The 17px rider build: head 4, torso 9, legs 4, 6px wide. Matches the shipped board figure; keep. |
| Hi-vis worker | Recycling-plant vested worker | The 22px hi-vis build: head 5, torso 12, legs 5, plus a hardhat, 7px wide. |
| Head detail, any build | Draw the head | Skin `#E8C9A0` field, a 1px hair line `#3A2E28` across the top, a 1px eye highlight `#F0D8B8`. Integer pixels. |
| Torso shading, any build | Draw the torso | Fill is the mood color; 1px left edge at `shade(fill, -26)`, 1px right edge at `shade(fill, +16)`. A 1px contact shadow sits under the feet. |
| Mood content | A settled occupant or an unstressed walker | Torso fill is the class `SHIRTS` color for the seed. Never `#C24A3A`. |
| Mood impatient | A waiter or walker whose wait crosses the mid tier | Torso fill is amber `#E8862A`. |
| Mood fed up | A waiter or walker whose wait crosses `STRESS_WAIT` | Torso fill is stress red `#C24A3A`. The `TowerEngine` fed-up walker also keeps its shape marker (the white-haloed "!"), so mood reads without color. |
| Legacy `person(...)` call | An existing site calls `person(ctx, x, footY, s, seed, true)` | Renders the seated build; no site edit required. `person(..., false)` renders the standing or walker build per the site's scale. |
| Room occupancy changes | `u.occupants` or `u.outForMeal` changes | Figure count equals `visibleOccupants(u)`; the room bake resignatures on the existing inputs and repaints. No new signature input. |
| Empty room | `visibleOccupants(u) === 0` | No occupant figures drawn. |
| Empty tower | Population is zero | No walkers, no queue figures, no car fill. Lobby and platforms read empty. |
| Elevator queue (seam) | Real sims wait at a served floor's shaft landing | A waiting line is drawn at that landing, its length equal to the projected waiter count for that shaft and floor, tinted by the floor's wait tier (content, then amber, then red as waits grow). |
| Car arrives (seam) | A car reaches a floor with a queue | Boarded equals `min(queue, remaining capacity)`. The car fill draws exactly the boarded silhouettes (up to capacity); the leftover line is the same individuals, now shorter. Nobody is spawned to fill a car or discarded when it leaves. |
| Car fill vs empty | A packed car versus a near-empty car | The cab draws `t.carLoad` silhouettes up to capacity, so packed versus empty reads at a glance and matches the queue math. |
| Service elevator queue (seam) | A staff-only shaft | Only real staff waiters appear in its queue; no tenant queue on a staff-only shaft. |
| Express skip-stop (seam) | A floor the express car skips | No queue drawn on the skipped floor (matches the blank shaft band already drawn by `drawTransport`). |
| Statistical demand rounds to zero (seam) | Visible waiters exist but the aggregate estimate is 0 | The projection reads the live crowd, so visible waiters are never stranded off-screen; the queue still draws. |
| Per-frame cost | A render frame runs between sim steps | The frame reads the cached projection and `t.carLoad`; it runs no scan over `crowd.people` or `tower.units`. |

</frozen-after-approval>

## Code Map

Real functions and files, grouped by boundary. Pure-render ships first; the engine seam is the separate E6 story.

### Pure-render: the person() family (`src/render/pixelSprites/common.ts`)

- `person(ctx, x, footY, s, seed, seated = false, tint?)`: rebuild the internals to the finalized geometry while keeping the 7-arg signature call-compatible. Replace the current `head = 2*s`, `bodyW = 2.4*s`, `bodyH = (seated?3:4)*s` block with the finalized builds. Head gets the skin field plus a 1px hair line `#3A2E28` (replacing the `rgba(30,24,20,0.65)` smudge) and a 1px eye highlight `#F0D8B8`. Torso gets the 1px left edge `shade(fill, -26)` and 1px right edge `shade(fill, +16)`. Add a 1px contact shadow under the feet. `seated` selects the 15px no-legs build; the default (`false`) selects the standing build.
- Add a defaulted build selector so the family is one routine (or a thin set of named wrappers), per the arch's `person()` guidance: introduce a `PersonBuild` union (`"seated" | "standing" | "walker" | "rider" | "hiVis"`) carried on a defaulted trailing options parameter (`opts?: { build?: PersonBuild }`) so the signature stays call-compatible. Export thin convenience wrappers `personWalker`, `personRider`, `personHiVis` for the taller builds so call sites read clearly. `seated` continues to map to the `"seated"` build for back-compat.
- Add `moodTint(mood: "content" | "impatient" | "fedUp", seed): string` returning the class `SHIRTS` color, amber `#E8862A`, or stress red `#C24A3A`. Callers pass the result as `tint`. Keep the `SHIRTS` / `#C24A3A` distinctness invariant (`common.ts:26-29`).
- Keep `SHIRTS`, `SKIN`, `shade`, `hash`, `geoVariant`, `maybeMirrored`, `shell`, `wallItem`, `POPULATED`, `noticeBadge`, `vacancy`, `closedShutter` unchanged. If this file crosses the 500-line ceiling after enrichment, extract the person family into `pixelSprites/person.ts` and re-export through the `pixelSprites.ts` barrel and `common.ts` so `import { person } from "./pixelSprites"` keeps resolving.

### Pure-render: two-scale application at call sites

- `src/render/pixelSprites/residential.ts`: seated office and condo workers and readers already pass `seated = true` (lines ~74, 85, 100, 125, 178, 197, 210); they inherit the 15px seated build. Confirm counts stay driven by `visibleOccupants(u)` (imported line 2, used line 44) and `home` (line 137).
- `src/render/pixelSprites/food.ts`: seated diners (lines ~77, 98, 122, 141, 159, 249, 265, 287, 302, 318) inherit the seated build; the standing chef (line 283) uses the standing build. Counts gate on the existing `busyAt` / occupancy predicate.
- `src/render/pixelSprites/shop.ts`: standing clerk and customer (lines ~74, 174, 274, 309) use the standing build; the mannequin keeps its white-tint `person(...)` call (line 174) via the `tint` argument.
- `src/render/sprites/facilities.ts`: the seated guard (line 41) uses the seated build; the standing nurse (line 63) and the medical or housekeeping attendants (lines 84, 139) use the standing build; the recycling vested worker uses `personHiVis`. Replace the two `scatterPeople` calls (party hall line 25, metro platform line 220) with occupancy or traffic gating, or route them through the walker actor path; if that lands as a follow-up, record it in the backlog (do not leave a constant crowd).
- `src/render/sprites/common.ts`: `scatterPeople` (line 65) is the decorative ghost-people idiom. Retire or gate it. `shade` / `shadeAlpha` / `rand` stay.
- `src/render/sprites/transport.ts`: `drawCar` rider loop (line 185) uses `personRider`-style spacing for cab passengers, drawn from the `riders` argument (which the caller derives from `t.carLoad`); it does not scan. `drawTransport` gains the queue draw on the transport path (see seam below).
- `src/render/excalibur/TowerEngine.ts`: the walker bake `bakePerson` (line 1532, canvas 8x14) and the fed-up `personGfxRed` (line 1544, canvas 8x16) must grow to fit the 24px walker build plus the contact shadow and the "!" marker; keep the two in step (the comment at 1529-1531 already warns). The walker gating (lines 2299-2319: `floorLive` per floor, `crowd` for lobby, `w.impatient && stress` for red) stays the honesty gate; add the amber impatient tier alongside the existing content and red states.

### Engine seam (E6 story): elevator queue and car fill

- `src/engine/Crowd.ts` / `src/engine/crowd/routing.ts`: add a read-only projection sibling to `elevatorCalls` (`routing.ts:153`). Prefer producing it in the SAME single pass over `crowd.people` that `elevatorCalls` already walks, so there is exactly one scan per outer step. Shape: `interface ElevatorQueueView { landings: ReadonlyMap<number /*shaftId*/, ReadonlyMap<number /*floor*/, { count: number; tier: 0 | 1 | 2 }>>; boarded: ReadonlyMap<number /*shaftId*/, ReadonlyMap<number /*carIndex*/, number>>; }`. Waiters are the `p.state === "waiting"` people already counted by `elevatorCalls`' `bump`; order is their stable order in `crowd.people`. Tier derives from `p.wait` (`crowd/person.ts:52`) against `STRESS_WAIT` (`person.ts:175`): tier 2 at `p.wait >= STRESS_WAIT`, tier 1 at `p.wait >= STRESS_WAIT / 2`, else tier 0; the floor's tier is the max over its waiters. Staff-only shafts (`isStaffOnlyTransport`) count only staff waiters. `boarded` is read from `t.carLoad[i]` (already engine truth), the same value the indicator reads.
- Memoize the projection once per outer step: store it on `Crowd` guarded by a step token (mirror the `Tower.stopsOf` / `stopsCache` memo pattern at `Tower.ts:395-399`, but keyed on the sim step counter rather than `tower.revision`, since queue contents change per step, not per structural edit). Compute it alongside `ElevatorDispatch.accumulate` (`ElevatorDispatch.ts:62`), which is already the once-per-outer-step scan point. Never recompute inside `moveCars` sub-steps or a render frame.
- Thread the snapshot to the render layer through the existing `DrawData` plumbing (the same channel that carries `stress`, `parkingUse`, `recycleFill` on the `DrawCtx` at `sprites/common.ts:34-53`), not by calling into the engine from a draw routine. `drawTransport` (`transport.ts:9`) reads `landings` for the shaft and draws the ordered waiting line at each served floor's landing, tinted per tier via `moodTint`. Express skip floors already draw a blank band (`transport.ts:94-97`); draw no queue there.
- Boarding reconciliation is a property of the existing crowd step (`crowd/motion.ts`: waiters transition to `riding` in order up to capacity, the rest stay `waiting`). The projection only surfaces `boarded = min(queue, remaining capacity)` and the same-individuals leftover; it adds no new boarding logic.
- Engine unit test (cheapest tier) pinning the projection: queue order preserved, `boarded === min(queue, remaining capacity)`, leftover are the same individuals, staff-only shaft shows only staff, express skip floor shows no queue.

### Tests and bookkeeping

- `src/render/sprites.test.ts` (person no-throw at line 292): extend to cover every build and the mood-tint path; assert integer output and the finalized heights.
- `src/render/pixelSpritesCommon` guard (arch section 9): pin the finalized head, hair, eye-highlight, torso-edge, and contact-shadow literals and the three mood colors; update only if a reserved-adjacent value moves.
- `fileSize.guard` and `barrelSurface`: re-verify after any extraction (person family or a queue helper).
- `_bmad-output/implementation-artifacts/backlog.md`: record the `scatterPeople` retirement follow-up if it does not fully land here; note the E6 elevator-queue seam story dependency.
- `package.json`: bump minor (player-facing visual capability).

## Tasks & Acceptance

**Execution (dependency order: shared family first, then call sites, then the seam story):**
- [ ] Redesign `person()` in `pixelSprites/common.ts` to the finalized builds, head detail, torso edge shading, and contact shadow; keep the exported signature call-compatible; add the `PersonBuild` selector, the `personWalker` / `personRider` / `personHiVis` wrappers, and `moodTint`.
- [ ] Extract the person family into `pixelSprites/person.ts` if `common.ts` crosses 500 lines; re-export through the barrel so no import path changes.
- [ ] Apply the two-scale builds at every call site in `residential.ts`, `food.ts`, `shop.ts`, `facilities.ts`, and the `drawCar` cab in `transport.ts`.
- [ ] Grow the `TowerEngine` walker bake canvases (`bakePerson`, `personGfxRed`) for the 24px walker; wire the amber impatient tier next to the existing content and fed-up states.
- [ ] Retire or gate `scatterPeople` (party hall, metro platform); record any deferral in the backlog.
- [ ] Engine seam story: add the read-only `ElevatorQueueView` projection in `crowd/routing.ts` in the existing single `crowd.people` pass, memoized once per outer step; thread it through `DrawData` to `drawTransport`; draw the ordered, tier-tinted landing queue; reconcile car fill from `t.carLoad`.
- [ ] Tests: person builds and mood in `sprites.test.ts`; the `pixelSpritesCommon` literal guard; the engine projection unit test; re-verify `fileSize.guard` and `barrelSurface`.
- [ ] `package.json`: bump minor.

**Acceptance Criteria:**
- Given the redesigned `person()`, when an existing call site invokes `person(ctx, x, footY, s, seed, true)`, then it renders the 15px seated build (head 5, torso 10, no legs, 6px wide) with the new head detail, torso edge shading, and contact shadow, at integer pixels, and no call site required a signature change.
- Given a module with `visibleOccupants(u) === n`, when the room bakes, then exactly `n` seated or standing occupants draw in content colors, and changing `u.occupants` or `u.outForMeal` repaints the room through the existing bake signature with no new signature input.
- Given a lobby, corridor, or platform, when population is zero, then no walker, queue, or car-fill figure draws; when traffic is present, the walkers are the real routed sims gated by the existing occupancy signals.
- Given a walker or waiter whose `p.wait` crosses `STRESS_WAIT / 2` then `STRESS_WAIT`, when it renders, then its torso fill is content `SHIRTS` color, then amber `#E8862A`, then stress red `#C24A3A`, and no `SHIRTS` entry equals `#C24A3A`.
- Given the engine seam, when a car arrives at a floor with a queue, then boarded equals `min(queue, remaining capacity)`, the cab draws exactly the boarded silhouettes up to capacity, and the leftover line is the same individuals now shorter (pinned by the projection unit test).
- Given a staff-only shaft, when it renders, then its landing queue shows only real staff waiters; given an express skip floor, then no queue draws there.
- Given a render frame between sim steps, when it draws queues and car fill, then it reads the cached projection and `t.carLoad` and runs no scan over `crowd.people` or `tower.units`.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e visual churn is limited to figure pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**Call-compatibility is the load-bearing contract.** `person()` is the single most-shared helper; every tenant, service, structure, and transport module imports it, plus the `TowerEngine` walker bake. Keeping the 7-arg signature and putting the build and mood selectors on defaulted parameters lets this spec land the geometry redesign without editing every caller in lockstep, and lets later per-kind specs adopt the taller builds incrementally.

**The two scales map to the two bake spaces.** Room figures bake into the small room canvas and read at roughly one third of a 44px floor (15px seated); walkers bake into their own small actor canvas (`bakePerson`, today 8x14) that scales to roughly 55 percent of a floor (24px). Growing the walker canvas is why the fed-up `personGfxRed` must move in step: it hand-rolls the same `person(...)` args plus its marker.

**Why the queue projection keys on the step, not `revision`.** `Tower.stopsOf` memoizes on `revision` because stop lists change only on structural edits. Queue contents change every sim step as people move, so the projection memoizes on the outer-step token instead, and it piggybacks the one `crowd.people` pass that `elevatorCalls` already runs, honoring the "no new full-collection scan on a per-tick or per-frame path" rule.

**The seam surfaces, it does not simulate.** Boarding order and the same-individuals leftover are already true in `crowd/motion.ts` (waiters become riders in order up to capacity; the rest keep `p.wait` climbing). The projection is a read-only view: count plus tier per floor, boarded per car from `t.carLoad`. This keeps `src/engine/` free of rendering and keeps the queue and fill visuals off the `cache:true` room bake path.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including the person-build and mood tests, the `pixelSpritesCommon` literal guard, and (with the seam story) the elevator-queue projection unit test.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the figure churn is expected, any non-art pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render plus the engine seam), per CLAUDE.md and arch section 9.
