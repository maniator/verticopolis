---
title: Modern Expansion (rooms, freeform build, economy)
game: Verticopolis
mode: Modern only (Classic parity-locked)
created: 2026-07-22
status: living plan (party-ratified 2026-07-22); implemented phase by phase
---

# Modern Expansion

The design party (game designer, architect, developer, long-time SimTower
player, UX/copy, tower economist) ratified this on 2026-07-22. It is the living
plan referenced by `_bmad-output/project-context.md` under the Modern-sandbox
scope. Everything here is **Modern only**; **Classic stays byte-identical** and
**no feature adds TDT handling** (Modern persists through the native save format;
`.TDT` is Classic-only).

## Intent and pillars
Modern is "everything Classic does, plus what 1994 could not." This expansion
grows it on three tracks:
1. **Breadth** via "container" modules: one engine kind with a roster of reskin
   variants, reusing the proven `retailSubtypes` ordinal pipeline.
2. **Depth**: singular showpiece modules with distinctive art and placement
   rules.
3. **Structure**: a Modern freeform-build model (empty-lot founding, manual
   structure, deletable lobby).

Every net-new room kind must: be Modern-gated, carry build caps in
`src/engine/facilities.ts`, add its Classic-vs-Modern line to
`src/ui/templates/compare.ts` (+ a `RULE_TO_HELP` entry where it hangs off a
`GameRules` flag), bump the version + changelog, and pass `/gds-code-review`.

## Track 1: Container modules (breadth, cheap art)
One placeable kind each; the subtype is RNG-drawn and stored as one ordinal
byte, exactly like shops/restaurants today.

| Module | Size (w × floors) | Subtype roster (the art variants) | Income model | Notes |
|---|---|---|---|---|
| Food Hall | 24 × 1 | ramen, taco stand, bubble tea, poke, deli, coffee cart | demand-pool footfall | broadest unmet-demand coverage; lunch spike; resilient to any one cuisine falling off |
| Boutique Bay | 12 × 1 | florist, barber, phone repair, vintage, tattoo, record store, gallery | demand-pool footfall | the palette's variety engine |
| Fitness Club | 16 × 1 | weight floor, yoga, spin, boxing, climbing wall | membership lease + small halo | subsumes the loose "Gym" idea |
| Clinic | 8 × 1 | dental, urgent care, optometry, pharmacy, physio | lease | quiet service tenants want |
| Amusements | 12 × 1 | classic arcade, VR lounge, claw parlor, mini-golf bay | demand-pool footfall | subsumes the loose "Arcade" idea; teen/kid draw shifts elevator demographics by hour |

## Track 2: Showpiece modules (depth, singular)

| Module | Size | Income model | Art signature | Build cost |
|---|---|---|---|---|
| Daycare | 12 × 1 | lease / service | primary colors, play mat, blocks, cubbies, tiny kids | cheap; lifts family-condo demand |
| Spa / Wellness | 16 × 1 | high-margin footfall + halo | dim, candlelit, sauna, cold plunge, massage rooms | cheap |
| Nightclub | 20 × 1 | night-only demand-pool | dark room, pulsing colored light, DJ booth, crowd | medium; monthly DJ-booking carrying cost (cinema-style); NEGATIVE halo to adjacent sleeping tenants (placement tension) |
| Aquatic Center | 28 × 2 | halo-dominant (capped, distance-decayed) | turquoise leisure pool, loungers, diving board, swimmers, skylight | premium (faked caustics shimmer, new render behavior) |
| Rooftop Sky Bar | 20 × 1, top occupied floor only | premium night footfall | skyline-through-glass, warm bar, golden-lit at night | premium (renders exterior skyline, new behavior); placement = highest occupied floor |

## Track 3: Modern freeform build (structure, cheap)
Classic is guided and guardrailed; Modern earns editor-grade structural control.

| Change | Ruling | Behavior |
|---|---|---|
| Empty-lot founding | Adopt (parity-aligned) | Modern founds on an empty lot like 1994; the pre-laid starter lobby is removed. Reuses Classic's existing first-lobby onboarding. This is not a toggle; it is simply how Modern begins. |
| Manual structure | Adopt, Modern-only toggle, default auto | Off = you place/pay for floor and lobby yourself; dropping a room on empty space says "no floor here" instead of auto-bridging and silently billing. Invariants untouched; only who lays the substrate changes. |
| Deletable lobby | Adopt, Modern-only | Allowed, but a delete that severs reachability triggers a confirm ("this strands N floors"), not a refusal. Then the wing goes dark and bleeds tenants; the stranded space is pure monthly carrying cost until rebuilt. Seatbelt, not lockout. |

## Economy rules that are actually mechanics
- **Two income verbs:** fixed **lease** (occupancy-based: clinic, daycare,
  fitness memberships) vs statistical **demand-pool footfall** (food hall,
  boutique, amusements, nightclub, bars) with day/night + weekend multipliers.
- **Amenity halo must diminish:** cap it and decay with distance, or pool/spa
  spam becomes the meta.
- **Night inversion is a feature:** nightclub + sky bar earn after dark, when
  offices are empty, smoothing both cashflow and elevator load (their crowd
  rides up as the day crowd leaves).
- **Stranded space self-punishes:** unreachable units keep paying overhead, so
  consequences need no extra lockout.
- **Demand-gap coverage:** food hall and amusements broaden the reachable-venue
  coverage that Modern's unmet-demand erosion checks, so they double as
  satisfaction insurance for residents.

## Deferred epic: Connected towers (owner-gated)
Not a Modern toggle: `LOT_WIDTH = 375` is baked into the grid, camera,
reachability graph, and save format. If ever pursued, the cheapest real shape is
**one wider lot with a vertical gap + a skybridge transport kind**, never two
independent tower engines. Only worthwhile as a **shared-podium development**
(one big retail base feeding two residential stacks), the sole version the
economy makes interesting. Kept out of the standing Modern-sandbox sanction.

## Cross-cutting: help + Classic-vs-Modern copy
`src/ui/templates/compare.ts` is the single source of truth for the comparison,
and `help.test.ts` fails CI until every `MODERN_RULES` member is classified in
`RULE_TO_HELP`. So every divergence above must add or adjust its compare bullet
and Help mapping, and any repaint of the Help dialog trips the screenshot-drift
refresh. (Superseded: `_bmad-output/specs/spec-starter-lobby-mode-split`: the
starter-lobby mode split is retired now that both modes found empty.)

## Recommended sequencing
- **Phase 0: Freeform build.** Empty-lot founding (done first, parity-aligned),
  then manual-structure toggle + deletable lobby. Little/no new art.
- **Phase 1: The five containers + Daycare + Spa.** Mostly reskins on the
  subtype pipeline; proves the content pipeline cheaply.
- **Phase 2: Nightclub.** First module with real placement tension (negative
  halo) and a carrying cost.
- **Phase 3: Aquatic Center + Rooftop Sky Bar.** The two premium-render
  headliners, once the pipeline is proven.
- **Later: Connected-towers epic (owner-gated); grab-bag** (bowling, karaoke,
  escape room, co-working, rooftop garden, observation deck, bookstore, pet
  care/vet, conference center, ice rink), promoted individually.

Recorded tension (not smoothed): the designer wanted a premium headliner teased
in Phase 1 to sell "Modern"; the developer/player/economist wanted cheap-first
to prove the pipeline. Plan takes the cheap-first majority.

## Discipline every phase inherits
Modern-only (Classic byte-stable); **no TDT for Modern**; build caps in
`facilities.ts`; `compare.ts` + `RULE_TO_HELP` copy per divergence; version bump
+ changelog; screenshot-drift refresh when Help/render changes; deterministic
(economy/reachability probes draw no rng); `/gds-code-review`; American English;
no em-dashes.
