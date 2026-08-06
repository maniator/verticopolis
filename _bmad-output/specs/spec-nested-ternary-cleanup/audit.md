# Nested-ternary audit

Companion to [SPEC.md](./SPEC.md). Source list: `npx eslint src api --rule '{"no-nested-ternary": "error"}'` on this branch (84 occurrences across 46 files; eslint flags each nesting point, so one expression can count several times). Grouped below by distinct expression: 17 expressions fixed in round one (28 occurrences), 52 expressions initially kept as sanctioned ladders (56 occurrences; a few rows fold sibling expressions from the same lines together).

**Round two (2026-08-06): the owner opted for the full ban.** `no-nested-ternary` is now an error in `eslint.config.js`, and every row in the "Stay" table below was swept in round two with the same behavior-preserving treatment (if/else chains, small named helpers, lookup tables). The table and its reasons are preserved as the record of the round-one judgment; zero nested-ternary occurrences remain.

Rubric (from SPEC Constraints, clauses referenced per row):

- (a) dispatch shape: same tag/enum compared across branches, mapping to fields, objects, or functions; wants a switch, lookup map, or named helper.
- (b) middle-position nesting: a ternary nested in the condition or a non-tail branch; reads inside-out.
- (c) heavy prose ladder: four or more branches of sentence-long strings or templates; wants a named helper with early returns.
- (d) so many branches or lines the ladder form obscures the bands.
- Stay rule: tail-chained 2-3 band ladders with short branches are the sanctioned idiom.

## Fixed (17 expressions, 28 occurrences)

| Site | Clause | Reason and fix |
| --- | --- | --- |
| `src/audio/ToneAudioEngine.ts:359` | a | `v === "arp" ? this.arp : v === "bass" ? ...`: tag dispatch to synth fields; now a switch. |
| `src/audio/toneCrowd.ts:164` | b | Nested ternary inside the attendance (true) branch; now an if/else. |
| `src/audio/toneCrowd.ts:233` | a | `programFor` maps a name tag to program fields; now a switch. |
| `src/engine/EconomySystem.ts:220` | b | Cap-fill fraction nested inside the true branch; now an if/else chain. |
| `src/engine/sim/churn.ts:35` (3 occ.) | a, d | Five-band dispatch from `CongestionBindingClass` to nouns over nine lines; now a total lookup map. |
| `src/engine/sim/serialization.ts:233` (2 occ.) | b | Three-level ternary with the deepest nesting in a middle branch; now an if/else chain (net shorter; the file sits at the 500-line ceiling). |
| `src/game/appModals.ts:61` (2 occ.) | a, d | Four-band dispatch from the exterminator refusal reason to sentences; now a switch. |
| `src/game/buildPreview.ts:137` | b | Refusal reason nested inside the true branch; now a guarded if. |
| `src/game/facilityDiagnostics.ts:221` (2 occ.) | c | Four sentence-long access-diagnostic templates in one push; now the `accessLine` helper with early returns. |
| `src/game/facilityDiagnostics.ts:357` (2 occ.) | c | Four sentence-long sky-lobby fix strings; now a named helper with early returns. |
| `src/game/facilityDiagnostics.ts:370` (2 occ.) | c | Same shape, gentler variant; same helper treatment. |
| `src/render/excalibur/overlayPalette.ts:57` | b | Clamp written with nesting in the true branch; now a guarded if (NaN fold preserved). |
| `src/render/excalibur/towerReconcile.ts:112` | b | Open/closed signature bit nested in the true branch; now a guarded if. |
| `src/render/sprites/structure/lobby.ts:66` (2 occ.) | a | Four-band dispatch from `EntranceKind` to sentinel variants; now a lookup map (service fallback preserved). |
| `src/ui/crashScreen.ts:46` (2 occ.) | c, d | Four save-outcome sentences with inner ternaries in two branches; now the `saveLineFor` helper with early returns. |
| `src/ui/templates/inspector.ts:35` (3 occ.) | b, d | Five-band status ladder with nesting in its first branch; now a switch helper. |
| `src/ui/templates/stats.ts:85` | b | VIP text nested in the true branch; now an if/else. |

## Stay (52 expressions, 56 occurrences); all swept in round two per the owner's full-ban decision

| Site | Reason |
| --- | --- |
| `src/audio/toneCrowd.ts:294` | Tail-chained 3-band over heterogeneous booleans; short draw-call branches. |
| `src/engine/EconomySystem.ts:479` | 3-band tag ladder with one-word branches; tail-chained and short. |
| `src/engine/crowd/motion.ts:326` | Tail-chained 3-band fallback over distinct guards; short branches. |
| `src/engine/crowd/spawn.ts:463` | Classic banded rate ladder (night/weekend/weekday). |
| `src/engine/economy/housekeeping.ts:274` | Comparator idiom; banded and tail-chained. |
| `src/engine/sim/build.ts:289` | Numeric threshold bands to weather kinds. |
| `src/engine/sim/churn.ts:134` | Tail-chained 3-band note picker, one short sentence per branch. |
| `src/engine/sim/congestion.ts:329` | Severity bands; short numeric branches. |
| `src/engine/sim/demand.ts:96` | Tail-chained capability-fallback chain; documented as deliberate. |
| `src/engine/sim/gripe.ts:354` | 3-band erosion-tier ladder with compound second guard; short constant branches. |
| `src/engine/sim/satisfactionStep.ts:90` | Tail-chained 3-band; short branches. |
| `src/engine/tower/transport.ts:486` | Gap-geometry bands; short arithmetic branches. |
| `src/gallery.ts:314` | Width threshold bands to column counts. |
| `src/game/editorActions.ts:295` | 3-band label picker; short string branches. |
| `src/game/facilityDiagnostics.ts:117` (3 occ.) | The tier-verdict ladder the brief names as the sanctioned idiom (plus its short yRatio guard). |
| `src/game/facilityDiagnostics.ts:425` | 3-band countdown phrasing; tail-chained, short branches. |
| `src/game/trafficHud.ts:40` | 3-band floor-tag ladder; short branches. |
| `src/render/carIndicator.ts:33` | Sign-to-arrow bands. |
| `src/render/excalibur/towerInputCamera.ts:93` | Tail-chained 3-band wheel-delta fallback. |
| `src/render/excalibur/towerInputCamera.ts:164` | 3-band hit-test ladder; short branches. |
| `src/render/excalibur/towerReconcile.ts:122` | 3-band kind ladder to short cache-key strings; tail-chained. |
| `src/render/excalibur/towerScenery.ts:428` | Hash bands to grass shades. |
| `src/render/sprites/facilities/service.ts:287` | Fill bands to gauge colors. |
| `src/render/sprites/transport.ts:342` | 3-band livery color ladder. |
| `src/storage/tdtEncoder.ts:402` | Stair-type bands to story counts (canon table shape). |
| `src/storage/tdtEncoder.ts:432` | Same story-count bands in the emit path. |
| `src/storage/tdtExportGather.ts:199` (2 occ.) | Tail-chained skip-reason ladder; one word per branch. |
| `src/storage/tdtExportGather.ts:210` + `:211` | Tail-chained clamp fallbacks; short branches. |
| `src/storage/tdtTransports.ts:134` | Same canonical story-count bands on import. |
| `src/tests/integration/calendar.integration.test.ts:465` | Test fixture day-name bands. |
| `src/tests/integration/mealCadence.integration.test.ts:287` | Test fixture kind-per-floor bands. |
| `src/tests/integration/paintPersistence.integration.test.ts:79` + `:150` | Test fixture width bands. |
| `src/tests/integration/personRoundTrip.integration.test.ts:217` | Test fixture kind-per-floor bands. |
| `src/tests/integration/tdtImport.integration.test.ts:52` | Test fixture floor-index bands. |
| `src/ui/Onboarding.ts:432` + `:433` | Step-state and marker bands; short branches. |
| `src/ui/crashScreen.ts:58` | Tail-chained 3-band (two advice sentences plus empty); under the 4-branch prose bar. |
| `src/ui/placement.ts:102` (2 occ.) | The message picker the brief names as sanctioned; symmetric what/ok table. |
| `src/ui/templates/editor.ts:100` | 3-band access text; one word per branch. |
| `src/ui/templates/editor.ts:114` (2 occ.) | Label ladder to short strings on one line; bands stay legible. |
| `src/ui/templates/editor.ts:156` | 3-band aria-label picker; short strings. |
| `src/ui/templates/elevatorSchedule.ts:308` | lit conditional-render ladder (express/endpoint/checkbox); structural, not prose. |
| `src/ui/templates/inspector.ts:65` | lit conditional-render ladder; tail-chained 3-band. |
| `src/ui/templates/saves.ts:179` | lit conditional-render ladder; short branches. |
| `src/ui/templates/stats.ts:136` | lit conditional-render ladder (row/button/nothing); structural. |
| `src/ui/templates/stats.ts:196` | Utilization bands to colors. |
| `src/ui/uiDialogs.ts:207` | 3-band reason phrases; short branches. |
| `src/ui/uiElevatorSchedule.ts:206` | Symmetric two-axis table: same inner shape in both day bands. |
| `src/ui/uiElevatorSchedule.ts:422` | 3-band preset-name capitalization; trivial branches. |
