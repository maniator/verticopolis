---
title: 'Per-kind elevator car looks: standard, service, express cabs read differently'
type: 'feature'
created: '2026-07-13'
status: 'done'
context: []
baseline_commit: 'cab5f888597e6d3546123b2a2b923c39d6c8c34d'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** Backlog `service-elevator-car-color` (P3, UI legibility). Since spec-standard-elevator-dimensions all three elevator kinds share the same 4-tile shaft width, so the cab sprite is the only thing left that could tell them apart at a glance, and `drawCar` (`src/render/sprites/transport.ts`) paints one generic cab for every kind. The shaft backing is already tinted per kind (`drawTransport` shades `FACILITIES[kind].color`), but the car riding it reads identical, so a player cannot eyeball which shafts are staff-only or express.

**Canon note:** the backlog asks for the 1994 service-car color "if confirmable". Text canon (GameFAQs/Kiwizoid FAQ, our faq-canon.md) describes elevator behavior, never car pixels, and this project is a clean-room homage that never rips assets, so the exact original palette is not confirmable inside our rules. The backlog's fallback clause applies: make each cab clearly distinct, keyed to the catalog palette that already encodes each kind's identity (`facilities.ts`: standard `#5a5a6a`, service `#4a4a52`, express `#3a3a8a`).

**Approach:** Thread the elevator kind into `drawCar` and give each kind a distinct cab: standard keeps today's look pixel-for-pixel (it is the baseline players know), service becomes a dark steel staff cab with a hazard-striped kick plate, express becomes a bright liveried cab with a solid accent band derived from the express catalog blue. Each kind differs in brightness and in shape (stripe pattern vs solid band vs none), so the cue is not hue-only (color-blind safe, same principle as the dead-parking X under-stroke). Render-only: no engine, save, dispatch, or catalog change.

## Boundaries & Constraints

**Always:** Keep `src/engine/` free of DOM/rendering; the kind flows render-side only. Standard cab output stays byte-identical to today. Rider figures, direction lantern, and FULL bar keep their current positions and colors on every kind (the top edge stays reserved for FULL/arrow; kind accents live at the cab bottom). Derive accent colors from `FACILITIES[kind].color` via `shade` where a tint is wanted, not from new near-duplicate hex constants. Quality gates green before push. Patch version bump (player-noticeable visual change).

**Ask First:** Any change to the standard cab's look. Any new indicator semantics (this story adds no new state, only per-kind dressing).

**Never:** No engine/save/TDT impact of any kind. Do not touch shaft pooling, widths, car counts, or the shaft-backing render. Do not mint visual baselines or docs screenshots from a host browser; only the pinned-container workflows (`[update-baselines]` / `[update-screenshots]` markers) produce the committed set.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Standard cab | `drawCar(..., "elevatorStandard")` any indicator state | Pixel-identical to the pre-change cab | N/A |
| Service cab | `drawCar(..., "elevatorService")` | Darker steel frame, dim interior, hazard-striped kick plate; riders/arrow/FULL unchanged | N/A |
| Express cab | `drawCar(..., "elevatorExpress")` | Bright interior, express-blue trim band; riders/arrow/FULL unchanged | N/A |
| FULL + moving | full=true, arrow set, each kind | FULL bar and lantern render exactly where they do today, legible on every kind | N/A |
| Kind omitted | Existing callers that pass no kind (tests) | Defaults to the standard cab | N/A |
| Cache reuse | Same shaft, same indicator state twice | Cab canvas cached per car as today; kind is constant per shaft so the key needs no kind component | N/A |
| Sprite gallery | gallery.html elevator entries | Each elevator entry shows its kind's cab riding the shaft (entries already carry cars/carPositions data, currently unused) | N/A |

</frozen-after-approval>

## Code Map

- `src/render/sprites/transport.ts:116` -- `drawCar` gains a trailing `kind: FacilityKind = "elevatorStandard"` parameter; per-kind cab styling lives here, branching only on the three elevator kinds (any other value renders the standard cab)
- `src/render/sprites/common.ts:3` -- `shade(hex, amt)` is the tint helper; accents derive from `FACILITIES[kind].color`
- `src/engine/facilities.ts` -- read-only source of the per-kind palette; no change
- `src/render/excalibur/TowerEngine.ts:2021` -- `carGfx` entry gains `kind` (from `c.t.kind`); both call sites (`syncMotion` :2048, `updateMotion` :2237) already have the transport in scope. `carKey` (:2014) unchanged: the gfx cache is per-car and a car never changes kind
- `src/gallery.ts:58-87` -- `transportEntry` draws each elevator entry's cars with the new per-kind cab (translate to the existing `carPositions`, call `drawCar` with the entry's kind); stairs/escalators unaffected (cars=0)
- `src/tests/sprites.test.ts:144` -- extend: the three kinds render pairwise-different signatures; the standard cab's signature is unchanged when the kind argument is omitted vs passed explicitly; FULL/arrow still alter every kind's output
- `_bmad-output/implementation-artifacts/backlog.md:101` -- `service-elevator-car-color` row resolves
- `package.json` -- patch bump on top of main at merge time (currently 1.25.1 over main's 1.25.0; re-resolves the same way if main moves again)
- `e2e/visual.spec.ts-snapshots/sprite-gallery-chromium-linux.png`, `docs/screenshots/**` -- re-mint via bot workflows: final commit message carries `[update-baselines]` and `[update-screenshots]`

## Tasks & Acceptance

**Execution:**
- [x] `src/render/sprites/transport.ts` -- per-kind cab styling in `drawCar`; standard branch byte-identical to today's draw order and colors
- [x] `src/render/excalibur/TowerEngine.ts` -- thread `t.kind` through the carGfx entry
- [x] `src/gallery.ts` -- elevator entries draw their cars with the kind's cab
- [x] `src/tests/sprites.test.ts` -- pairwise-difference + standard-unchanged + indicator-still-visible regression tests (red first: pairwise test failed against the single-look cab, green after)
- [x] `_bmad-output/implementation-artifacts/backlog.md` -- resolve the `service-elevator-car-color` row
- [x] `package.json` -- patch bump on top of main at merge time (1.25.1 over 1.25.0 as of the ready-for-review merge; was 1.24.1 over 1.24.0 pre-merge)
- [x] Quality gates: `npm run typecheck`, `npm run lint`, `npm test` (78 files / 1279 tests), `npm run build` -- all green
- [x] Review round (BMGD 3-layer, `/gds-code-review`) -- 7 patch findings, all fixed and re-verified (gates green); 0 defers; 4 dismissed as noise -- see Review Findings and Spec Change Log
- [ ] Final commit message carries `[update-baselines]` and `[update-screenshots]` so the pinned-container bots re-mint any changed pixels

### Review Findings

- [x] [Review][Patch] `carGfx` doc comment claimed the cache key and drawing derive only from the CarIndicator; now names the entry's fixed kind and why the key can skip it [src/render/excalibur/TowerEngine.ts:2018]
- [x] [Review][Patch] Express shade amounts clamped to pure white, dropping the catalog hue (strip +197 saturated all three channels); interior 185 -> 160, strip 197 -> 190 keep a visible blue cast while the express strip stays the brightest [src/render/sprites/transport.ts:143]
- [x] [Review][Patch] `accent = ""` sentinel was a latent invalid-fillStyle trap; accent is now always the real catalog color (unused on the standard path) [src/render/sprites/transport.ts:136]
- [x] [Review][Patch] Hazard stripe could cross the kick plate's right edge at the gallery's fractional cab width (`x < w-3` bound vs plate width w-4); loop bound is now `x <= w-4` so a 2px stripe never passes x = w-2 [src/render/sprites/transport.ts:152]
- [x] [Review][Patch] Gallery drew the 1px dressing rows at fractional coordinates, antialiasing the cue; car translate is now rounded to whole pixels [src/gallery.ts:89]
- [x] [Review][Patch] The FULL/lantern per-kind test also varied riders, so riders alone could satisfy it; riders now held at 0 so only the top-edge indicators make the difference [src/tests/sprites.test.ts:184]
- [x] [Review][Patch] Spec completion note said "idle down car" for a car drawn with a lit down lantern; reworded to "empty descending car" [spec, Dev Agent Record]

**Acceptance Criteria:**
- Given the three elevator kinds at the same indicator state, when their cabs are drawn, then all three produce visibly (and signature-)different output.
- Given the standard kind (or no kind argument), when the cab is drawn, then output is identical to the pre-change cab for every indicator state.
- Given full=true or a direction arrow on any kind, when the cab is drawn, then the FULL bar and lantern appear in today's position and colors.
- Given gallery.html, when the sprite gallery renders, then each elevator entry shows its own cab style riding the shaft.
- Given the full quality gates, when run, then all four pass.

## Spec Change Log

- 2026-07-13 (ready-for-review merge, version re-resolution): the owner merged main into the branch (PRs #199/#201 landed; main moved 1.24.0 -> 1.25.0) and the patch bump re-resolved to 1.25.1 over 1.25.0, per the merge-time rule in the Code Map. The three Copilot threads flagging the stale 1.24.1 references in this spec and the backlog row are fixed by this entry's commit.

- 2026-07-13 (review round, BMGD 3-layer): all three layers ran (Blind Hunter, Edge Case Hunter, Acceptance Auditor); the auditor confirmed full spec compliance, including byte-identity of the standard cab against HEAD. Seven patch findings fixed in-branch (see Review Findings): the biggest was the express shade clamp (strip +197 saturated to pure white, erasing the hue leg of the triple-encoded cue; re-tuned to interior +160 / strip +190, verified in a preview screenshot to keep a visible blue cast). Dismissed as noise: a floorH<8 degenerate no caller can hit (engine 44, gallery 24), a FacilityKind-import doubt (the import exists), the patch-vs-minor bump question (legibility fix of an owner-observed problem, patch per the versioning rule; flagged for the owner in the PR), and the absent golden signature of the standard cab (the pinned-container visual baseline is the pixel-level pin). Zero defers, so no backlog inbox entries. Gates re-run green after the patches.

## Design Notes

Cab looks (all accents at the cab bottom so the top edge stays the FULL/lantern zone):

- **Standard:** unchanged: `#8e94a0` frame, `#d8dce2` interior, `#f3f6fa` ceiling light strip.
- **Service:** staff freight cab. Frame and interior stepped down via `shade` from the current neutrals (or from the service catalog color) so the whole cab reads darker and flatter; ceiling strip dimmer than standard's; a 2-3px kick plate across the cab bottom carrying short diagonal hazard stripes (dark alternating with a desaturated amber). Riders (housekeepers) still draw on top of the plate.
- **Express:** liveried shuttle cab. Interior brighter/cooler than standard; frame trimmed with `shade(FACILITIES.elevatorExpress.color, +N)`; a solid express-blue band with a single light pinstripe across the cab bottom. Reads as the "premium" cab next to the neutral standard.

Distinctness is triple-encoded: overall brightness (dark / neutral / bright), bottom-edge pattern (hazard stripes / none / solid band), and hue (amber-on-dark / neutral / blue). Any one channel alone identifies the kind.

The gfx cache in TowerEngine stays keyed by indicator state only: each cache map already lives on one car of one shaft, and a shaft's kind is immutable, so adding kind to the key would only duplicate entries.

## Dev Agent Record

**Implementation plan:** red-green: the pairwise-difference test was written first and failed against the single-look cab; then `drawCar` gained a trailing `kind: FacilityKind = "elevatorStandard"` parameter. Standard renders through the exact original literals (`#8e94a0` / `#d8dce2` / `#f3f6fa`, same draw order), so omitting the kind is byte-identical to the old output. Service and express derive every tint from their catalog color via `shade` (the one new constant is the hazard amber `#bfa04a`, a deliberate accent with no near-duplicate in the palette). Both kind accents sit in the bottom rows of the interior (kick plate rows floorH-5..floorH-3), drawn after the light strip and before riders, so riders stand on the plate and the door seams draw over it; the top edge stays the FULL/lantern zone on every kind.

**Completion notes:** TowerEngine threads `t.kind` through the carActors entry and `carGfx`; the cab cache stays keyed by indicator state only (a car never changes kind, cache is per-car). The sprite gallery's elevator entries now draw the two cars their transport data always declared (ascending car with riders, empty descending car), so gallery.html shows all three cab styles. Quality gates all green (typecheck, lint, 1279 tests, build).

**File list:**
- `src/render/sprites/transport.ts` (modified)
- `src/render/excalibur/TowerEngine.ts` (modified)
- `src/gallery.ts` (modified)
- `src/tests/sprites.test.ts` (modified)
- `_bmad-output/implementation-artifacts/backlog.md` (modified)
- `package.json` (modified)
- `_bmad-output/implementation-artifacts/spec-elevator-car-visuals.md` (new)

## Verification

**Commands:**
- `npm run typecheck && npm run lint` -- expected: clean
- `npm test` -- expected: green, including the new sprite regression tests
- `npm run build` -- expected: clean

**Manual checks:**
- `npm run dev`, build one shaft of each kind side by side: the three cabs are tellable at a glance at default zoom; FULL and the lantern still read on all three. Open `/gallery.html`: the three elevator entries show their distinct cabs.
