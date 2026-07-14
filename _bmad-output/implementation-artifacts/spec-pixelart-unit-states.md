---
title: 'Pixel-art unit states: the reserved state visuals pinned unambiguous over the enrichment, and the E7 gallery-sweep acceptance harness'
type: 'feature'
created: '2026-07-14'
status: 'draft'
baseline_commit: '2edf133'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/gdd-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/epics-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible legibility rules and the arch enrich-in-place discipline; do not modify unless a human renegotiates the reserved state-cue canon">

## Intent

**Problem:** The overhaul enriches every wall (warm creams, geo-seeded bands, per-kind props) and composites two overlays the reserved state cues must survive: the night scrim and the heatmap. The state visuals themselves already exist and route correctly today: construction, the empty LEASE/SALE card, the vacating notice ribbon, hotel asleep/dirty/ready, fire, gutted, and the closed-hours shutter. The risk is not that they are missing, it is that the richer walls reduce their contrast, the overlays sit on top of them, and nothing pins the two structural properties that keep each cue readable: that every cue draws OUTSIDE the per-kind `maybeMirrored` wrapper, and that no cue varies by geography. The reserved literals are scattered across `pixelSprites/common.ts`, `pixelSprites/residential.ts`, and `sprites/structure/shell.ts`, and only three are test-pinned today (the dirty tray, the ready lamp, and the notice amber). Decoration has already reused one reserved literal (a restaurant candle paints the notice amber `#E8A030` at `food.ts:315`), which is exactly the collision the art bible reserves warm-orange for state to prevent. No acceptance harness sweeps every kind against every reserved state under lit, unlit, scrim, and heatmap, so a per-kind enrichment PR can dim a cue and ship green.

**Approach:** This is the cross-cutting pinning spec plus the E7 acceptance harness, and it changes little product code because the states already draw. It (1) freezes each reserved state visual to its exact call site and reserved literal; (2) pins the two invariants that keep a cue legible under enrichment, namely drawn outside any mirror wrapper and geo-invariant (no state cue calls `geoVariant`), plus the bake-signature fact that state is signature field 1 so every transition repaints; (3) records the one existing decoration-reuse (the food candle) as a cross-spec dependency for the food enrichment spec to retint, tracked in the backlog, and forbids a new one; and (4) builds the harness in two tiers. The unit tier extends `pixelSprites/common.test.ts` and `sprites.test.ts` to assert every reserved literal is emitted at its call site across every applicable kind and both `lit` values. The visual tier is the E7 gallery sweep: render each kind in each reserved state under lit, unlit, night scrim, and heatmap and confirm the cue stays the strongest read. Reserved literals stay byte-for-byte unchanged; the `pixelSpritesCommon` guard values move only if a non-reserved helper color legitimately moves, which this spec does not do.

## Boundaries & Constraints

**Always:**
- Reserved state literals stay byte-for-byte unchanged and are never reused for decoration: stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`. The enrichment may add richness, never a state-cue color identity.
- Every reserved state cue draws OUTSIDE any `maybeMirrored` wrapper. `construction` / `fire` / `gutted` route in `drawUnit` before the per-kind path; `vacancy` is an early `return` in `office` / `condo` before the wrapper opens; `noticeBadge` draws in `drawRoom` after the per-kind switch; the hotel dirty tray, ready lamp, and asleep "z" draw after the `maybeMirrored` block (`residential.ts:316-337`), the "z" at a flip-computed x. No text cue is ever drawn inside a mirror.
- Every reserved state cue is geo-invariant: no cue path calls `geoVariant`, so a unit in a given state reads pixel-identical at every `(floor, x)`. Hotel `asleep` overrides the geo wall band with the fixed dark wall `#3A3550`.
- State is bake-signature field 1 (`TowerEngine.ts:1632`), so every state transition resignatures and repaints. `fire` and `construction` are the only per-frame redraws (`animated`, `TowerEngine.ts:1635`); they alone read `d.anim` (the crane at `shell.ts:49`, the flames at `shell.ts:76-77`). `gutted` is static.
- The people-system impatient amber `#E8862A` is a distinct value and is deliberately not the reserved notice amber `#E8A030`; keep the two pinned as separate literals so neither collapses into the other.
- American English; no em-dashes in new prose or comments; integer pixel coordinates only.

**Ask First:**
- Moving any reserved literal. That is a review decision: it ripples every save gallery baseline, the visual snapshots, and the guard tests.
- Changing the layer a cue draws in (inside versus outside the mirror, before versus after the per-kind switch), or adding a `geoVariant` axis to any state cue.
- Adding a new `UnitState` or a new reserved cue color.
- Adopting the art-bible ink-outline plus white inner field hardening on the LEASE/SALE and CLOSED cards, or the ready-lamp ink socket ring, if it changes a non-reserved helper color the `pixelSpritesCommon` guard pins. The hardening is welcome as long as the reserved literals hold; it is a reviewed pixel change, not a silent one.

**Never:**
- No reserved literal reused for decoration. The `food.ts:315` candle `#E8A030` is the one existing violation: it is flagged for the food enrichment spec to retint off the reserved amber (for example to `signWarm` `#EE8844`) and tracked in the backlog. Do not add a new reuse and do not fold the candle fix into this PR.
- No state cue moved inside a mirror wrapper or made position-dependent.
- No new `d.anim` read on a `cache:true` state; only `fire` and `construction` animate.
- No `SAVE_VERSION` bump, no `Unit` shape change, no TDT format change. This is visual pinning plus tests.
- No mode branch (Classic or Modern) inside any state-cue draw routine.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Under construction | Any kind, `state === "construction"` | `drawUnit` routes to `drawConstruction` (`sprites.ts:68`) before the per-kind path, uniform for every kind, outside any mirror: concrete shell, yellow/black hazard band, scaffolding poles and cross-braces, a crane hook swinging on `d.anim`. Animated, so it redraws per frame. The art-bible girders and hard-hat worker are the structure spec's enrichment and must not obscure the hazard band or crane. |
| Empty office | `office`, `state === "empty"` | `office()` early-returns `vacancy(ctx, x, y, w, h, "LEASE")` (`residential.ts:37`) before `maybeMirrored` opens. Full-rect hatched gray shell `#C9CCC4` / `#B2B0A4`, LEASE plate and glyph when `w > 26`. The card fills the whole rect, so the glyph never lands on a warm wall. |
| Empty condo | `condo`, `state === "empty"` | `condo()` early-returns `vacancy(ctx, x, y, w, h, "SALE")` (`residential.ts:135`). Same hatched gray shell, SALE label. |
| Empty hotel | hotel, `state === "empty"` and lit | No LEASE/SALE card: hotels never call `vacancy`. Empty lodging reads "ready" via the ready lamp `#FFD86A` (`residential.ts:325`), not "for lease". |
| Empty food / shop / cinema | those kinds, `state === "empty"` | No vacancy card (only `office` and `condo` call `vacancy`). The interior draws with no patrons; emptiness reads through the absence of occupants. Adding a card here needs a spec decision, not a silent change. |
| Vacating (on notice) | Any `ROOM_KIND`, `state === "vacating"` | `drawRoom` draws `noticeBadge` (`pixelSprites.ts:85`) after the per-kind switch and after night dimming: an amber `#E8A030` top-right corner ribbon with an ink `#2A1E06` exclamation, on the top layer, outside any per-kind mirror. |
| Hotel asleep | hotel, `state === "asleep"` | Fixed dark wall `#3A3550` overrides the geo wall band (`residential.ts:257`); blanket and sleeper on the first occupied bed; a floating "z" (`residential.ts:334`) drawn OUTSIDE the mirror at a flip-computed x. The "z" stays legible (ink, or white with an ink edge over `hotelRed` per the art bible). No ready lamp while asleep. |
| Hotel dirty | hotel, `state === "dirty"` | Rumpled bedding on the mattress, plus the dirty tray `#D4623A` (`residential.ts:322`) on the nightstand, drawn OUTSIDE the mirror, keeping a 1px ink separator from any `signWarm` / `hotelRed` decoration. No ready lamp while dirty. |
| Hotel ready | hotel, lit and not `asleep` / `dirty` | Ready lamp `#FFD86A` (`residential.ts:325`) on the nightstand, outside the mirror, keeping its ink socket ring; `glowLit` / `cityLight` ambient never adjacent. |
| Fire | Any kind, `state === "fire"` | `drawUnit` draws `drawBurntShell` then `drawFlames` (`sprites.ts:71-75`) before the `ROOM_KINDS` path, uniform, outside any mirror. Flames animate on `d.anim`; `animated === true`, so the cache is off. |
| Gutted | Any kind, `state === "gutted"` | `drawUnit` returns `drawBurntShell` only, no flames (`sprites.ts:77`). Static, not animated: a scar to rebuild. |
| Closed hours | `ROOM_KIND` with business hours, not `empty` / `construction`, not open at `d.hour` | `drawRoom` gate draws `closedShutter` and returns (`pixelSprites.ts:32-40`) before the switch, outside any mirror: shutter body `shade(FACILITIES[kind].color, -60)`, slats, and a CLOSED plate with the `#E0556B` glyph when `w > 28`. |
| Decoration reuse check | Any kind, any state | No decoration emits a reserved literal. Current exception: the `food.ts:315` candle `#E8A030` equals the notice amber, flagged for the food spec to retint (backlog). A vacating restaurant would otherwise paint the ribbon amber and candle amber the same hue. |
| Enrichment overlay | Any state cue under the night scrim or heatmap | The cue stays the strongest read: its reserved literal is present in the draw log, and it reads under the in-room night dim (`pixelSprites.ts:79-82`) and the render-layer scrim plus heatmap composited by `TowerEngine`. Any cue that becomes ambiguous after enrichment is a bug. |
| Position invariance | Same unit and state at different `(floor, x)` | Pixel-identical cue; no `geoVariant` call in any cue path. |
| Mirror invariance | Same unit with `geoVariant(u, mirrorAxis, 2) === 1` | Cue pixel-identical to the unflipped room; every cue draws outside `maybeMirrored`, text at a flip-computed x. |
| Repaint on transition | `u.state` changes | Signature field 1 changes (`TowerEngine.ts:1632`), the room re-bakes; `fire` and `construction` animate per frame, every other cue is a static bake that repaints on the transition. |

</frozen-after-approval>

## Code Map

Real functions and files. This spec pins them and adds the harness; it does not rewrite them. Line numbers are at `baseline_commit`.

### Routing: where each state cue is drawn (`src/render/sprites.ts`)

- `drawUnit(d, u, x, y, w, h)` (lines 63-87): the single entry. `state === "construction"` returns `drawConstruction` (line 68); `state === "fire"` draws `drawBurntShell` then `drawFlames` (lines 71-75); `state === "gutted"` returns `drawBurntShell` (line 77); `ROOM_KINDS` route to `drawRoom` (line 81). All three damage/construction cues are drawn before any per-kind routine, so they are structurally outside every `maybeMirrored` wrapper and uniform across kinds.

### Structural and damage shells (`src/render/sprites/structure/shell.ts`)

- `drawConstruction(d, x, y, w, h)` (lines 20-58): concrete shell `#6f6a5e`, hazard band `#e8c14a` / `#2a2a2a`, scaffolding strokes, crane hook reading `d.anim` (line 49). Per-frame animated. Enrichment (girders, hard-hat worker) is the structure spec's; this harness pins the hazard-band and crane read.
- `drawBurntShell(ctx, x, y, w, h)` (lines 61-69): charred `#241c18`, ember floor `#3a2a20`, smoke smudges. Used by both `fire` and `gutted`.
- `drawFlames(d, x, y, w, h)` (lines 72-98): orange `#e8631e` tongues, yellow `#ffd23a` core, ember wash, reading `d.anim` (lines 76-77). Per-frame animated, `fire` only.

### Room path and top-layer cues (`src/render/pixelSprites.ts`)

- `drawRoom(d, u, x, y, w, h)` (lines 29-86): the closed-hours gate (lines 32-40) draws `closedShutter` and returns before the per-kind switch; the night-dim overlay (lines 76-82) paints `rgba(8,10,22,0.5)` for `emptyAtNight` / `asleepHome`; `state === "vacating"` draws `noticeBadge` (line 85) on the top layer after the switch. Gate and badge are both outside any per-kind mirror.

### Reserved-literal helpers (`src/render/pixelSprites/common.ts`)

- `noticeBadge(ctx, x, y, w, h)` (lines 141-155): amber `#E8A030` corner ribbon (line 144) plus the `#2A1E06` exclamation.
- `vacancy(ctx, x, y, w, h, label)` (lines 157-176): hatched gray shell via `shell(ctx, x, y, w, h, "#C9CCC4", "#B2B0A4")` (line 158), then the LEASE/SALE plate and glyph when `w > 26`.
- `closedShutter(d, x, y, w, h, accent)` (lines 178-201): shutter body `shade(accent, -60)`, slats, and the `#E0556B` CLOSED glyph (line 195) when `w > 28`. `accent` is the per-kind `FACILITIES[kind].color`, so only the CLOSED glyph is reserved.
- `geoVariant` (lines 67-70), `maybeMirrored` (lines 75-82), `shell` (lines 116-128), `POPULATED` (line 138): the variety and mirror machinery the cues must stay outside of. Pin: none of the reserved-cue helpers call `geoVariant`.

### Hotel state cues, outside the mirror (`src/render/pixelSprites/residential.ts`)

- `office` (line 35): empty returns `vacancy(..., "LEASE")` (line 37). `condo` (line 133): empty returns `vacancy(..., "SALE")` (line 135). Both before `maybeMirrored`.
- `hotel` (line 243): `asleep` forces the dark wall `#3A3550` (line 257); the `maybeMirrored` block (lines 296-315) draws the beds; the state cues draw after it (comment lines 316-318): nightstand, dirty tray `#D4623A` (line 322), ready lamp `#FFD86A` (line 325), and the asleep "z" (lines 328-337) at a flip-computed x.

### Decoration-reuse finding (cross-spec)

- `src/render/pixelSprites/food.ts:315`: the French-dining candle sets `#E8A030`, the reserved notice amber. This is the food enrichment spec's to retint; recorded in the backlog. Not fixed here.

### Bake signature (`src/render/excalibur/TowerEngine.ts`)

- Signature (line 1632): `` `${u.state}:${litState?1:0}:${u.width}:${u.occupants}:${u.outForMeal ?? 0}:${u.subtype ?? ""}:${open}${lateNight}${dead}${liveBits}` ``. `u.state` is field 1, so every state transition repaints. `animated = u.state === "fire" || u.state === "construction"` (line 1635) is the only per-frame redraw set. The fed-up walker's stress red `#C24A3A` (line 1551) and its haloed "!" marker (line 1951) are the people-system's, cited here only to keep the impatient-amber-versus-notice-amber distinctness visible.

### The harness (tests and bookkeeping)

- `src/render/pixelSprites/common.test.ts`: extend the existing helper coverage (it already pins `#E8A030` at line 43) to pin all four `common.ts` reserved literals at their helpers: `noticeBadge` -> `#E8A030`, `vacancy` -> `#C9CCC4` and `#B2B0A4`, `closedShutter` -> `#E0556B`.
- `src/render/sprites.test.ts`: the "hotel state cues survive every variant" block (lines 432-444) already pins the dirty tray `#D4623A` (line 439) and ready lamp `#FFD86A` (line 442) across positions; extend it into the full gallery sweep so every ROOM_KIND is asserted in each reserved state under both `lit` values, and add construction / fire / gutted / closed-hours literal assertions on the `drawUnit` path.
- `pixelSpritesCommon` guard (arch section 9): the pinned helper-color set. Update its values only if a non-reserved helper color legitimately moves; the reserved literals never move.
- `e2e/visual.spec.ts-snapshots` (the E7 gallery sweep): the visual tier renders every kind in each reserved state under lit, unlit, night scrim, and heatmap. Regenerate only via the pinned Playwright image (CLAUDE.md).
- `_bmad-output/implementation-artifacts/backlog.md`: record the `food.ts:315` candle retint as a cross-spec follow-up owned by the food enrichment spec.
- `package.json`: no version bump for a pure test-plus-pin PR (internal-only). If a legibility hardening that moves rendered pixels ships here (a card ink-outline or the candle retint, both currently deferred), bump patch.

## Tasks & Acceptance

**Execution (dependency order: pin the literals, then the structural invariants, then the sweep, then bookkeeping):**
- [ ] Extend `pixelSprites/common.test.ts` to pin every `common.ts` reserved literal at its helper: `noticeBadge` `#E8A030`, `vacancy` `#C9CCC4` / `#B2B0A4`, `closedShutter` `#E0556B`.
- [ ] Extend `sprites.test.ts` into the cross-kind sweep: for every `ROOM_KIND`, assert the reserved literal for `empty` (office/condo card), `vacating` (notice), and the hotel `asleep` / `dirty` / ready cues under both `lit` values and across several `(floor, x)` positions (position and mirror invariance). Add `construction` / `fire` / `gutted` / closed-hours assertions on the `drawUnit` path.
- [ ] Pin the two structural invariants in the sweep: each cue emits from outside `maybeMirrored` (identical draw log flipped and unflipped), and no cue path calls `geoVariant` (same log across positions).
- [ ] Pin the animation invariant: `fire` and `construction` read `d.anim` and re-bake per frame; every other state is a static bake keyed by signature field 1; `gutted` draws no flames.
- [ ] Pin the distinctness assertion: notice amber `#E8A030` is not the people-system impatient amber `#E8862A`.
- [ ] Record the `food.ts:315` candle reserved-amber reuse in the backlog as a food-spec follow-up. Do not fix it here.
- [ ] Build the E7 visual gallery sweep: every kind in each reserved state under lit, unlit, night scrim, and heatmap; regenerate `e2e/visual.spec.ts-snapshots` and `docs/screenshots/**` only via the pinned image.
- [ ] `package.json`: no bump for the test-plus-pin PR; patch only if a pixel-moving legibility fix ships here.

**Acceptance Criteria:**
- Given every ROOM_KIND, when it is drawn in `empty` (office/condo), `vacating`, and the hotel `asleep` / `dirty` / ready states under both `lit` values, then each reserved literal (`#C9CCC4` / `#B2B0A4`, `#E8A030`, dark wall plus "z", `#D4623A`, `#FFD86A`) is emitted at its pinned call site and no literal has changed.
- Given a unit in a fixed state at two different `(floor, x)` positions and with the mirror axis flipped, when both are drawn, then the state-cue draw log is identical: the cue is geo-invariant and drawn outside `maybeMirrored`.
- Given `construction` and `fire`, when a frame runs between sim steps, then both read `d.anim` and re-bake per frame; given `gutted`, then `drawBurntShell` draws and no flame path runs; given every other state, then the cue is a static bake that repaints only when signature field 1 changes.
- Given the closed-hours gate, when a business-hours kind is closed at `d.hour` and not empty or under construction, then `closedShutter` draws the `#E0556B` CLOSED glyph and returns before the per-kind switch.
- Given the reserved-literal audit, when the render tree is swept, then the only decoration emitting a reserved literal is the `food.ts:315` candle, and it is recorded in the backlog for the food spec; no new reuse exists.
- Given the E7 gallery sweep, when every kind is rendered in each reserved state under lit, unlit, night scrim, and heatmap, then each cue stays the strongest read and any non-cue pixel move is treated as a bug.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; visual regeneration is via the pinned image only.

## Design Notes

**Outside the mirror plus geo-invariant is the whole legibility contract.** A state cue's job is to broadcast the same unambiguous shape no matter which layout, wall band, or mirror the enrichment rolled for that footprint. Two code facts already guarantee it, and this spec pins them so a later enrichment PR cannot quietly break them: construction, fire, and gutted route in `drawUnit` before any per-kind routine, and the room cues (vacancy card, notice ribbon, hotel tray/lamp/z) draw either as an early `return` or after the `maybeMirrored` block, never inside it. Because no cue path calls `geoVariant`, the same state paints pixel-identical everywhere. The hotel `asleep` dark wall `#3A3550` is the one place a cue deliberately overrides the geo band, which is what makes "asleep" read the same in every room of a corridor.

**State is signature field 1, so cues repaint for free.** `TowerEngine`'s bake key leads with `u.state`, so any transition (a lease going `empty`, a tenant `vacating`, a room turning `dirty` then ready) re-bakes the room without a new signature bit. Only `fire` and `construction` flip `animated` and redraw per frame; every other cue is a static bake. This is why the harness can be a draw-log assertion at the cheapest tier: the cue is a pure function of state plus the rect, with no live input behind the signature's back.

**The vacancy card is safe because it is a full-rect return.** The art-bible rule "never paint a card directly onto a warm wall" is satisfied structurally: `office` and `condo` return `vacancy(...)` before drawing any interior, so the hatched gray shell replaces the whole rect and the LEASE/SALE glyph never sits on `warmWall`. If the card later adopts the art-bible ink-outline plus white inner field hardening, that is welcome as a reviewed pixel change as long as the reserved grays `#C9CCC4` / `#B2B0A4` and the `pixelSpritesCommon` guard hold.

**One reserved-amber collision exists, and it belongs to the food spec.** `food.ts:315` paints a restaurant candle the notice amber `#E8A030`. A `vacating` restaurant would then show the corner ribbon and the candle in the same hue, which is the collision the art bible reserves warm-orange for state to avoid. This harness surfaces it and pins the amber as the ribbon's identity; the retint (for example to `signWarm` `#EE8844`) is the food enrichment spec's change, tracked in the backlog so it is not lost and not smuggled into this PR.

**Impatient amber is not notice amber.** The people-system tints an impatient sim `#E8862A`; the vacating ribbon is `#E8A030`. They are close but distinct, and the harness pins the distinctness so a future palette tidy does not merge them and make a slow elevator queue read like an at-risk lease.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including the extended `pixelSprites/common.test.ts` reserved-literal pins, the `sprites.test.ts` cross-kind state sweep, and the position / mirror / animation invariants.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): the E7 gallery sweep renders every kind in each reserved state under lit, unlit, night scrim, and heatmap; regenerate only via the pinned Playwright image per CLAUDE.md. Cue pixels are expected to hold; any non-cue pixel move is a bug.
- Deep review: `/gds-code-review` in-session (gameplay-facing render legibility of engine states), per CLAUDE.md and arch section 9.
