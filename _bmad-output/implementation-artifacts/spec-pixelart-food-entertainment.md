---
title: 'Pixel-art food and entertainment: five distinct fast-food rooms, five dining rooms, and the two-floor cinema and party hall'
type: 'feature'
created: '2026-07-14'
status: 'draft'
baseline_commit: '2edf133'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixel-art-overhaul.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pixelart-people-system.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/arch-pixel-art-overhaul-2026-07-14.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-retail-subtypes-and-variety.md'
  - '{project-root}/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent ratified in the art bible and arch doc; do not modify unless a human renegotiates the food and entertainment canon">

## Intent

**Problem:** The retail-subtype seam shipped (`Unit.subtype`, `retailSubtypes.ts`), but the food and entertainment art still under-delivers on the ratified 1994 narrative style (art bible, Figma page 03). Three gaps. (1) The five fast-food subtypes and five restaurants read as light recolors rather than genuinely different rooms: `fastFood` and `restaurant` in `pixelSprites/food.ts` carry thin per-subtype interiors that miss most of the board's props (no noren fringe on Soba, no boba counter on the Chinese Cafe, no soda fountain on Ice Cream, no espresso bar or pastry case on Coffee Shop, no bottle wall or lazy-Susan on the pub and Chinese dining rooms). (2) Cinema draws a single generic band with no green EXIT signage and no two-floor auditorium; the party hall (now a two-floor catalog venue, PR #242) still paints one flat strip with a `scatterPeople` crowd, which is exactly the ghost-people idiom the overhaul bans. (3) Diners and dancers are seeded by a `hash(u.id + tx)` predicate, not by real occupancy, so a room shows the same crowd whether full or empty, and TDT import (which renumbers `u.id`) reshuffles the crowd.

**Approach:** Port each tile from the committed reference draw code (`pixelart-figma/build-scripts/page-03-food-entertainment.build.js`) into the existing per-kind draw routines, mechanically, one `F(A, x, y, w, h, c, o)` rectangle to one `ctx.fillRect` (arch section 7), at integer coordinates. Keep the fast-food sign band and the restaurant dark dining room as the kind anchors; the subtype furnishes the rest, so each of the five fast foods (Hamburger, Japanese Soba, Chinese Cafe, Ice Cream, Coffee Shop) and five restaurants (French, English Pub, Chinese, Sushi Bar, Steak House) reads as its own room. Cinema gains the curtain-framed two-floor auditorium with raked seats, a balcony rail, and green EXIT signs on BOTH floors, while keeping its animated marquee and screen (the one accepted `d.anim` exception). The party hall targets the shipped `floors: 2` rect with tall draped arched windows, chandeliers and a string-light banner, a stage with a mirror ball and DJ, a checker dance floor, and a long banquet table.

Occupancy becomes honest. Every seated diner, behind-counter cook or barista, cinema audience head, and party-hall guest or dancer is a real occupant: figures fill their seat or stand grid in seed order up to `visibleOccupants(u)` (rooms) or the hall's occupancy (party hall), so an empty venue reads empty and a full one reads full. This keys only on inputs already in the room bake signature (`occupants`, `outForMeal`, `subtype`), so nothing new is added to the signature and no `cache:true` room reads a live input behind its back. People geometry is inherited unchanged from the people-system spec: this spec redefines no figure, it only chooses the correct build (seated occupant for diners and counter staff, standing occupant for dancers) and the occupancy count. File size is handled before enrichment: the look tables move to `pixelSprites/food.looks.ts` (re-exported through the barrel), and the per-interior draw bodies move to a sibling if `food.ts` would cross the 500-line ceiling.

## Boundaries & Constraints

**Always:**
- Port from the committed build script `pixelart-figma/build-scripts/page-03-food-entertainment.build.js` via the `F(A, x, y, w, h, color, opacity)` to `ctx.fillStyle = color; ctx.globalAlpha = opacity ?? 1; ctx.fillRect(x, y, w, h)` mapping (arch section 7). Integer coordinates only: `Math.round` before every `fillRect`; fractional rects antialias into smears and break the crisp pixel style.
- Inherit the `person()` family from the people-system spec unchanged. Do NOT redefine figure geometry. Food occupants (seated diners AND behind-counter cook, soba chef, tea or boba server, barista, sushi chef) are the seated 15px occupant build (finalized geometry table: "behind-counter/desk staff (... barista, cook)"); party-hall dancers standing in the open are the standing 18px build; the DJ behind the console and seated banquet guests are the seated build.
- Figure counts map to real occupancy, filled in seed order: `visibleOccupants(u)` for `fastFood`, `restaurant`, and `cinema`; the hall's occupancy (`u.occupants`, already in the bake signature) for the party hall. An empty venue draws no figures. This replaces the `hash(u.id + tx)` predicate (`food.ts:62`, `food.ts:224`) and the `scatterPeople` crowd (`facilities.ts:25`).
- Decorative art reads ONLY inputs already in the bake signature (`state`, `lit`, `width`, `occupants`, `outForMeal`, `subtype`, and the `open` + `lateNight` + `dead` flags). Cinema's marquee and screen are the one accepted `d.anim` exception; every other food and entertainment room is static.
- The look tables stay subtype-keyed with the canon names AND order untouched (the load-bearing TDT ordinal in `retailSubtypes.ts`), and every entry stays pairwise-distinct (pinned by `subtypeVisuals.integration.test.ts`).
- Reserved colors never decorate: stress red `#C24A3A`, vacancy grays `#C9CCC4` / `#B2B0A4`, notice amber `#E8A030`, dirty tray `#D4623A`, ready lamp `#FFD86A`, closed sign `#E0556B`. Any new or variant color holds luminance within 10 per RGB channel of its anchor and enters no reserved value.
- Files stay under 500 lines: extract `FASTFOOD_LOOKS` / `RESTAURANT_LOOKS` to `pixelSprites/food.looks.ts` (re-exported via the barrel) BEFORE enriching; extract per-interior draw bodies next if a file would still overflow. New files ship under 500 with no new `fileSize.ratchet.txt` entry.
- American English; no em-dashes in new prose or comments. This spec is render-only; `src/engine/` stays free of DOM and rendering.

**Ask First:**
- Adding any input to the room bake signature (`TowerEngine.ts` ~1632). Enrichment must vary only on inputs already there. If a food visual must vary on a live input not in the signature, add it as a reviewed decision, never read it behind the signature's back, or the room will not repaint when it changes.
- Changing `PAL`, `SHIRTS`, or `SKIN` anchors, or the `geoVariant` axis integers. Cinema keeps axis 4 (audience) and adds axis 5 (marquee color seed) per the art bible; no axis is reused within a kind.
- Reordering or renaming any `FASTFOOD_SUBTYPES` / `RESTAURANT_SUBTYPES` key, or touching `retailSubtypes.ts`. Enriching a look table's VALUES and adding fields is fine; touching keys or order is not.
- Widening `drawPartyHall` beyond adding the `(d, u)` parameters (matching `drawParking` / `drawRecycling`). No new engine read from a draw routine.

**Never:**
- No ghost people. Do not scatter seeded figures independent of population in the party hall; retire the party-hall `scatterPeople` call. (The metro-platform `scatterPeople` at `facilities.ts:220` is out of scope here; it stays with the people-system/structure work and its backlog follow-up.)
- No new `d.anim` read in `fastFood`, `restaurant`, or the party hall, or any static room. Only the cinema marquee and screen animate.
- No new full-collection scan (`find` / `filter` / `some` / a `for` over `tower.units` or `crowd.people`) inside a draw routine. Occupant counts arrive as prepared inputs (`visibleOccupants(u)`, `u.occupants`).
- No `Unit` shape change, no `SAVE_VERSION` bump, no TDT format change. The subtype ordinal is untouched. This is visual-only.
- No mode branch (Classic or Modern) inside any draw routine. The art is identical in both.
- No fractional coordinates and no sub-3px silhouettes.

## I/O & Edge-Case Matrix

| Scenario | State / action | Expected behavior |
|----------|----------------|-------------------|
| Hamburger fast food | `subtype === "Hamburger Stand"` or `undefined` | Classic quick-serve room: service counter with grill, soda machine, and a cook (seated occupant), a checker floor, round pedestal two-tops with trays. Ketchup-red band, mustard-yellow stripe. No pixel is `#C24A3A`. |
| Japanese Soba | `subtype === "Japanese Soba"` | Full-width indigo noren fringe under the band, a long noodle bar with stools, steaming bowls, a chef at the broth pot, diners seated along the counter. Plank floor. |
| Chinese Cafe | `subtype === "Chinese Cafe"` | A tea and boba counter: stainless urn, colored boba dispensers, a drinks menu, a window stool bar of patrons holding boba, jade wainscot, a bamboo plant. Visibly distinct from the Chinese banquet restaurant. |
| Ice Cream | `subtype === "Ice Cream"` | A parlor: chrome display freezer with colored tubs and a cone rack, a soda-fountain counter with tall stools and kids, a pink booth, a scalloped valance. |
| Coffee Shop | `subtype === "Coffee Shop"` | A cafe: espresso bar with machine and grinder and a pastry case tended by a barista, a chalkboard menu, a window bench of patrons, a lounge armchair with a laptop. |
| Unknown or absent fast-food subtype | `subtype` not in `FASTFOOD_LOOKS` | Falls back to the Hamburger (classic) look, no throw, byte-identical to the pre-variant composition. |
| French restaurant | `subtype === "French"` or `undefined` | Chandelier, pendants and sconces, framed art and a gilt mirror, a wine rack, dressed white-cloth tables with candles, seated diners on patterned carpet. Candle is `#E8C14A` / `#F8E2B4`, never `#E8A030`. |
| English Pub | `subtype === "English Pub"` | Back bar with a lit bottle wall, brass taps and stools with seated regulars, hanging pub lamps, a framed print, wood tables with pints. |
| Chinese restaurant | `subtype === "Chinese"` | Red papered wall, paired glowing lanterns and a carved screen, round banquet tables with a gold lazy-Susan, parties of seated diners. |
| Sushi Bar | `subtype === "Sushi Bar"` | A long light-wood counter with a glass case, colored nigiri plates, a chef in whites (seated occupant behind the bar), a bottle shelf, diners seated along the front. |
| Steak House | `subtype === "Steak House"` | Dark leather room, a hooded grill glowing orange (ember), framed art, high-back leather booths with candlelit tables and seated diners. |
| Restaurant fixture unlit | `d.lit === false` | The fixture glow dims via the existing `d.lit` branch; no reserved color is introduced by the dim path. |
| Cinema, two floors | 31 tiles x 2 floors (88px) | A curtain-framed screen with a projector beam, a balcony rail, raked seat rows, and green EXIT signs on BOTH floors. The marquee bulbs and screen still animate. |
| Cinema audience | `visibleOccupants(u) === n` | Raked seat-heads fill in seed order up to a density derived from `n`; `n === 0` draws empty seats (no audience). |
| Two cinemas, different footprints | distinct `(floor, x)` | Audience (geo axis 4) and marquee color (geo axis 5) differ; two cinemas never screen the identical crowd or bulb color. |
| Party hall, two floors | catalog `floors: 2` (88px rect) | Tall draped arched windows, chandeliers and a string-light banner, a stage with mirror ball, colored spotlights and a DJ, a checker dance floor, a long banquet table with seated guests. Fills the full 88px. |
| Party hall empty | hall occupancy `=== 0` | No dancers, DJ, or seated guests. The shell, windows, fixtures, stage, and table still draw; the venue reads empty. |
| Party hall occupied | hall occupancy `> 0` | Dancers (standing build) plus seated banquet guests and a DJ (seated build), count from occupancy, filled in seed order. |
| Closed hours | `fastFood` / `restaurant` / `cinema` outside business hours | `closedShutter` draws (`pixelSprites.ts:32-40`); the enriched interior is not shown. |
| Vacating tenant | `fastFood` / `restaurant` `state === "vacating"` | The amber `noticeBadge` still overlays (`pixelSprites.ts:85`), unchanged. |
| Reserved-color audit | any food or entertainment pixel | No decoration uses `#C24A3A`, `#E8A030`, `#D4623A`, `#FFD86A`, `#E0556B`, `#C9CCC4`, or `#B2B0A4`. |
| Bake repaint | `u.subtype` or `u.occupants` changes | The room resignatures on the existing inputs and repaints. No new signature input; the draw runs no scan over `tower.units` or `crowd.people`. |
| Integer coordinates | every ported rect | `Math.round` applied before `fillRect`; no fractional coordinate reaches the canvas. |

</frozen-after-approval>

## Code Map

Real files and functions, grouped by boundary. Extract for file size first, then enrich per kind. All render-only; no engine change.

### File-size prep (extract before enriching, arch section 5)

- `src/render/pixelSprites/food.looks.ts` NEW: move `FastFoodLook`, `FASTFOOD_DEFAULT`, `FASTFOOD_LOOKS`, `RestaurantLook`, `RESTAURANT_DEFAULT`, `RESTAURANT_LOOKS` (`food.ts:14-46`) here verbatim, then enrich the values. Keep the exact exported names. This is where any added look field lives (for example `floor` and `floorStyle` on `FastFoodLook` for the per-subtype fast-food floor, since `interior` is 1:1 with the subtype and a `Record`-keyed table stays trivially pairwise-distinct).
- `src/render/pixelSprites/food.ts`: import the tables and types from `./food.looks`; keep `fastFood`, `restaurant`, and `cinema` as the exported draw entries. Frees ~33 lines (currently 358). If it still crosses 500 after enrichment, extract the ten interior bodies (five fast-food, five restaurant) plus the cinema body into `src/render/pixelSprites/food.interiors.ts` with thin dispatchers left in `food.ts`; the new file ships under 500 with no ratchet entry.
- `src/render/pixelSprites.ts:96`: re-export the look tables and types from `./pixelSprites/food.looks` instead of `./pixelSprites/food`. The barrel surface is unchanged: `FASTFOOD_LOOKS`, `RESTAURANT_LOOKS`, `FastFoodLook`, `RestaurantLook` still resolve from `./pixelSprites`, so `barrelSurface.test.ts:29,114` and `subtypeVisuals.integration.test.ts:5` (both import from the barrel) keep passing.

### Fast food (`pixelSprites/food.ts` `fastFood`, port burger / soba / teaCafe / parlor / cafe)

- Keep the sign band anchor (`food.ts:56-60`). Port each interior from the build script's `burger` (page-03 lines 24-29), `soba` (30-37), `teaCafe` (38-53), `parlor` (54-61), `cafe` (62-72) via the `F` to `fillRect` mapping. The `interior` discriminant already routes: `classic`, `counterBar`, `teahouse`, `parlor`, `cafe` (`FastFoodLook.interior`).
- Replace the `busyAt` hash predicate (`food.ts:62`) with occupancy fill: compute `const n = visibleOccupants(u)` and fill the first `n` seats or stools in seed order; draw no diner past `n`. Import `visibleOccupants` from `../../engine/Crowd` (render may import engine; `residential.ts` already does).
- Behind-counter cook (burger), soba chef, tea or boba server, and barista are seated-occupant figures (`person(ctx, ..., true)`), matching the build script (its `person()` is the legless seated build) and the finalized geometry table.
- Port-time reserved-color fix: the build-script `burger` paints `#C24A3A` (page-03 lines 25, 28) as the menu-board patty and a tray dot. DO NOT port that literal. Substitute a non-reserved patty red (for example `#D8442C`) so the stress red is never decoration.

### Restaurant (`pixelSprites/food.ts` `restaurant`, port rest french / pub / chinese / sushi / steak)

- Adopt the build-script `RL` wall and floor values (page-03 line 23) into `RESTAURANT_LOOKS` in `food.looks.ts`, keeping every entry pairwise-distinct. Port the shared `twall` + `wainscot` dado and the per-variant fixtures and dining floors from `rest` (page-03 lines 73-79). The `fixture` (`chandelier`, `lamps`, `lanterns`, `ember`, `none`) and `interior` (`cloth`, `pub`, `banquet`, `sushi`, `booths`) discriminants already route.
- Replace the `busyAt` predicate (`food.ts:224`) with the same `visibleOccupants(u)` seed-order fill.
- Reserved-color fix: the French candle currently uses `#E8A030` (reserved notice amber) at `food.ts:316`. Replace with `#E8C14A` and a `#F8E2B4` glow (the build-script candle colors). Notice amber is state-only; it never paints a candle.
- The sushi chef and any host behind the bar are seated-occupant figures per the finalized geometry table (this reconciles the people-system spec's Code Map note that called `food.ts:283` a standing chef; follow the ratified table, and flag the single-line reconciliation for the reviewer).

### Cinema (`pixelSprites/food.ts` `cinema`)

- Keep the animated marquee bulbs and the cycling screen (`food.ts:335-348`): this is the one accepted `d.anim` exception. Add NO other `d.anim` read.
- Port the two-floor auditorium from the build-script `cinema` (page-03 lines 80-98): the maroon shell, the curtain-framed screen with the projector beam, the balcony rail band, and the raked seat rows.
- Add green EXIT signs on BOTH floors (canon). Port `exitSign` (page-03 line 20) at the four placements (page-03 line 97): one pair at the upper-floor base (~`y + 44`) and one pair at the lower floor (~`y + h - 14`). EXIT green `#6bd47a` is not reserved. The signs are static (no `d.anim`).
- Occupancy-drive the audience: fill the raked seat-heads in seed order up to a count from `visibleOccupants(u)`; an empty screening reads empty. Keep `geoVariant(u, 4, ...)` for the audience arrangement (`food.ts:333`) and add `geoVariant(u, 5, ...)` for the marquee color seed (art bible axis map), still combined into the anim phase as today.

### Party hall (`sprites/facilities.ts` `drawPartyHall`, port `party`)

- Change the signature `drawPartyHall(ctx, x, y, w, h)` (`facilities.ts:7`) to `drawPartyHall(d: DrawCtx, u: Unit, x, y, w, h)`, mirroring `drawParking` / `drawRecycling`; update the dispatch call at `sprites.ts:94` to pass `(d, u, x, y, w, h)`.
- Target the two-floor 88px rect (catalog `floors: 2`, already engine truth). Port the build-script `party` (page-03 lines 99-116): tall draped arched windows in the upper band, chandeliers and a string-light banner, a stage with a mirror ball, colored spotlights and a DJ, a checker dance floor, and a long banquet table with a light cloth.
- No new `d.anim`: the string lights and spotlights are static fills (the build script draws them static).
- No ghost people: replace `scatterPeople` (`facilities.ts:25`) with occupancy-gated figures. Gate the dancers (standing build), the DJ and the seated banquet guests (seated build) on the hall occupancy (`u.occupants`, already in the bake signature); an empty hall draws none. Completing the honest party-hall occupancy signal, if events do not yet populate `u.occupants`, is the backlog follow-up the art bible already tracks; do not leave a constant crowd.
- If `facilities.ts` crosses 500 after enrichment (currently 375), extract the entertainment interior (`drawPartyHall` plus its local helpers) into `src/render/sprites/entertainment.ts`, re-exported so the `sprites.ts` import stays stable; the new file ships under 500 with no ratchet entry.

### Tests and bookkeeping

- `src/tests/integration/subtypeVisuals.integration.test.ts`: keep green. The enriched tables must preserve the canon names and order, keep every entry pairwise-distinct (the test JSON-compares the whole look object), and round-trip through TDT.
- `src/tests/barrelSurface.test.ts`: `FASTFOOD_LOOKS`, `RESTAURANT_LOOKS`, `FastFoodLook`, `RestaurantLook` still exported from the `pixelSprites` barrel after the `food.looks.ts` extraction.
- `src/render/sprites.test.ts`: the party-hall (line 88) and cinema no-throw cases stay; extend to exercise `drawPartyHall`'s new `(d, u)` signature at the two-floor rect with hall occupancy 0 (empty, no figures) and > 0 (figures present), and to assert the cinema draws EXIT signage without throw.
- `src/tests/fileSize.guard.test.ts`: `food.ts`, `food.looks.ts`, any `food.interiors.ts`, `facilities.ts`, and any `entertainment.ts` all stay at or under 500 lines; add no new entry to `fileSize.ratchet.txt`.
- `_bmad-output/implementation-artifacts/backlog.md`: record that the party-hall `scatterPeople` is retired here; leave the metro-platform `scatterPeople` follow-up and the party-hall honest-occupancy follow-up open.
- `package.json`: bump minor (a new player-facing visual capability).

## Tasks & Acceptance

**Execution (dependency order: extract, then enrich per kind, then tests):**
- [ ] Extract `FASTFOOD_LOOKS` / `RESTAURANT_LOOKS` and their types into `pixelSprites/food.looks.ts`; repoint the `pixelSprites.ts:96` barrel re-export. Verify `subtypeVisuals` and `barrelSurface` stay green.
- [ ] Enrich the look tables (values, and any new field such as fast-food `floor` / `floorStyle`), keeping names and order untouched and every entry pairwise-distinct.
- [ ] Port the five fast-food interiors (burger, soba, teaCafe, parlor, cafe) with the `visibleOccupants(u)` seed-order fill and the burger `#C24A3A` substitution.
- [ ] Port the five restaurant interiors (french, pub, chinese, sushi, steak) with the occupancy fill and the French candle `#E8A030` fix.
- [ ] Enrich cinema: two-floor auditorium, green EXIT on both floors, occupancy-driven audience, geo axis 5 marquee color; keep the marquee `d.anim` and add no other.
- [ ] Enrich the party hall: `(d, u)` signature plus dispatch update, the two-floor composition, retire `scatterPeople`, occupancy-gated figures.
- [ ] Extract `food.interiors.ts` and/or `sprites/entertainment.ts` if a file would cross 500 lines.
- [ ] Tests: extend `sprites.test.ts` coverage; re-verify `subtypeVisuals`, `barrelSurface`, and `fileSize.guard`.
- [ ] `backlog.md` notes; `package.json` minor bump.

**Acceptance Criteria:**
- Given a `fastFood` unit for each of the five canon subtypes, when it bakes, then it draws its own distinct room (not a recolor) under the shared sign band, and an undefined or unknown subtype falls back to the Hamburger look with no throw.
- Given a `restaurant` unit for each of the five canon subtypes, when it bakes, then the dining room draws with dressed tables and seated diners as occupants, and no candle or decoration uses a reserved color (the French candle is `#E8C14A` / `#F8E2B4`, not `#E8A030`).
- Given any fast-food room, when it bakes, then no pixel is `#C24A3A` (the build-script burger's stress-red menu and tray are substituted with a non-reserved patty red).
- Given a cinema on its 31x2 rect, when it bakes, then green EXIT signs draw on BOTH floors, the marquee and screen still animate (the accepted `d.anim` exception), and no other `d.anim` read is added; two cinemas on different footprints differ in audience (axis 4) and marquee color (axis 5).
- Given a `fastFood`, `restaurant`, or `cinema` with `visibleOccupants(u) === n`, when it bakes, then exactly the first `n` seats or heads fill in seed order and `n === 0` draws an empty venue.
- Given a party hall on its two-floor rect, when it draws, then the composition fills the full 88px, the dancers, DJ, and banquet guests gate on the hall's occupancy so an empty hall draws none, and `scatterPeople` is retired.
- Given `u.subtype` or `u.occupants` changes, when the room re-bakes, then it resignatures on the existing inputs and repaints, with no new signature input and no per-frame scan over `tower.units` or `crowd.people`.
- Given the guards, when they run, then `subtypeVisuals` (names and order untouched, entries pairwise-distinct, TDT round-trip), `barrelSurface` (look tables and types re-exported from the barrel), and `fileSize.guard` (every touched file at or under 500 lines, no new ratchet entry) are all green.
- Given all four quality gates (`typecheck`, `lint`, `test`, `build`), then all are green; the e2e visual churn is limited to food and entertainment pixels, and any non-art pixel move is treated as a bug.

## Design Notes

**Distinct rooms, not recolors, come from the build script.** The reference draw code already composes five different fast-food rooms and five different dining rooms with the exact prop counts and positions the art bible calls for; porting it (arch section 7) is mechanical and keeps the shipped art pixel-faithful to the board without re-deriving anything from prose. The look table stays a small color-and-discriminant record; the room lives in the interior draw body, which is why the file-size extraction (look table first, interior bodies next) is the right seam.

**Two reserved-color traps the port must dodge.** The build-script burger paints the reserved stress red `#C24A3A` on the menu board and a tray dot, and the current French dining room paints the reserved notice amber `#E8A030` on its candle (`food.ts:316`). Both are hue-family collisions the art bible bans: a stress-red burger reads like a fed-up sim's shirt at 16px, and a notice-amber candle reads like an on-notice ribbon. Substitute a non-reserved patty red and the `#E8C14A` / `#F8E2B4` candle so state cues keep winning.

**Occupancy is the honesty fix.** The old `hash(u.id + tx)` predicate seeded the crowd off the unit id, which TDT import renumbers, so the same restaurant showed a different, population-independent crowd after a round-trip. Filling seats in seed order up to `visibleOccupants(u)` ties the visible crowd to the real occupant census, which is already in the bake signature (`occupants`, `outForMeal`), so the room repaints correctly with no signature change and no ghost diners. The party hall follows the same rule against `u.occupants`; retiring its `scatterPeople` is what removes the last constant crowd on this page.

**People geometry is inherited, not redefined.** This spec chooses builds and counts only. Diners and behind-counter staff are the seated 15px occupant; party-hall dancers are the standing 18px occupant. The finalized geometry, the head detail, the torso shading, and `moodTint` all come from the people-system spec, which is why this work sequences after that spec's `person()` redesign lands.

**Cinema keeps its one animation.** The marquee and screen are the single sanctioned `d.anim` read in a room; the new EXIT signs, balcony rail, and raked seats are static and read only signature inputs, so the cinema does not gain any new per-frame work beyond what it already does.

## Verification

**Commands:**
- `npm run typecheck`: expected clean.
- `npm run lint`: expected clean.
- `npm test`: expected all green, including `subtypeVisuals.integration.test.ts`, `barrelSurface.test.ts`, `fileSize.guard.test.ts`, and the extended `sprites.test.ts` food and entertainment coverage.
- `npm run build`: expected succeeds.
- Visual regression (`e2e/visual.spec.ts-snapshots`) and screenshots (`docs/screenshots/**`): regenerate only via the pinned Playwright image per CLAUDE.md; the food and entertainment churn is expected, any other pixel move is a bug. This is a player-facing change, so include the `[update-screenshots]` marker.
- Deep review: `/gds-code-review` in-session (gameplay-facing render), per CLAUDE.md and arch section 9.
