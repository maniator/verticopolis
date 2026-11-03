---
id: SPEC-overview-map
companions: []
sources:
  - _bmad-output/planning-artifacts/overview-map-343-plan-2026-11-03.md
---

> **Canonical contract.** This SPEC is the complete contract for what to build, test, and validate for the overview MAP window (#343). The plan and the owner decisions live in the companion plan file; this file does not repeat them.

# Overview MAP Window

## Why

Original Windows SimTower had a small MAP window that shows the whole tower and where the main view sits, so a player can find their way around a tall tower and see its shape. Players used it for navigation and also as a canvas for deliberately shaped towers. Verticopolis has pan, pinch and zoom but no overview. Owner priority P2 (#343), reprioritized 2026-11-03 on player feedback.

## Capabilities

- **CAP-1: find the Map.**
  - **intent:** A player on desktop or phone can discover, open and close a Map window without it interfering with building.
  - **success:** The window is closed by default and a visible Map button opens it; Escape or the button closes it and focus returns to the button. The last open or closed choice is remembered per browser (storage failures never break the page). With the window open, building, inspecting, panning and pinching on the world canvas behave exactly as with it closed (Playwright, desktop and phone-sized touch).
- **CAP-2: read the whole tower.**
  - **intent:** The map shows the tower's real horizontal silhouette across the full lot, every floor and basement, rooms and facilities, lobbies, and transport shafts, so the tower is recognizable and not only a height bar.
  - **success:** Every unit in `SimView.rooms`, every run in `SimView.structure` and every shaft or stairway in `tower.transports` appears at its true tile and floor in map space (unit-tested draw list). Kinds fall into groups that are distinguishable by color and by pattern, so the map reads without color vision: each room group has its own pattern, the three elevator kinds have one each, and the plain solid groups differ in lightness (table tests pin all three). Patterns are an accessibility addition to the original's plain look and show in both themes in v1.
- **CAP-3: navigate by the map.**
  - **intent:** The map shows the area the main view currently covers, and a click, tap or drag moves the camera.
  - **success:** A camera rectangle matches the visible area in map space and stays in sync after zoom, pan, resize and loading another tower. A click or tap centers the camera on that point; dragging the rectangle pans without the rectangle jumping to the pointer. All camera moves go through the existing clamp, so any point on the map is safe to click on very tall, wide or imported (TDT) towers.
- **CAP-4: Classic and Modern.**
  - **intent:** Classic follows the original MAP window's behavior and styling as closely as the evidence allows; Modern may use richer facility colors and presentation.
  - **success:** The style table maps every `FacilityKind` to a group (an exhaustive record, so a new kind is a compile error), and each group has a pattern and a fill per theme. Classic uses a gray tower with elevators colored by kind (express blue, standard gray, service red per the manual) and its schematic layout, refined by the retail capture. Modern uses the facility colors from `FACILITY_PRESENTATION` for rooms and its own shaft colors, kept apart from the room colors. A kind unknown at run time paints as a placeholder and never throws. The manual's tutorial also shows the elevator as a black line; v1 draws a shaft-width mark colored by kind until the capture settles which Classic should do.
- **CAP-5: accessible.**
  - **intent:** Keyboard and assistive-technology users can open and use the map.
  - **success:** The map is focusable; arrow keys move the camera by a step, Enter or Space centers on the focused point; the canvas has an accessible name and a text summary (floors above ground, basements, where the camera is); targets are at least 44 CSS px on touch; the map does not cover the build controls on a phone.
- **CAP-6: cheap.**
  - **intent:** The map costs nothing when closed and little when open, even on the largest tower.
  - **success:** The draw list is rebuilt and repainted only when the identity of `SimView.rooms`, `SimView.structure` or `tower.transports`, or the layout, changes (not on `tower.revision` alone: a host can repeat a revision over other units, #1296), and a resize repaints at most once per animation frame; the camera rectangle updates from a dirty check on camera position, zoom and viewport size with no tower scan. On the `large` fixture (about 43,000 units, about 2,900 rooms) a rebuild of the draw list stays under a documented budget in CI and the paired map-open versus map-closed frame-time and long-task measurement shows no regression beyond noise (ten or more repetitions through the existing perf harness). Hardware claims come only from a real PC run.
- **CAP-7: read-only.**
  - **intent:** Rust stays authoritative. The map invents no gameplay rule and changes no save.
  - **success:** The map code reads `SimView` and `src/presentation/` only, imports nothing from `src/engine/` at run time (type-only imports of shared types follow wherever those types move), calls no engine command, and adds no engine export, no catalog change and no save-format change (no crate bump). A kind's height in floors comes from the catalog the view already binds, `findViewKind(kind)?.floors` in `src/presentation/viewKinds.ts`, passed to the draw list as `floorsOf`.
- **CAP-8: player-facing text.**
  - **intent:** Players learn the map exists.
  - **success:** A Help entry, a changelog line in plain player language, a minor version bump with the lockfile, and the sidebar control formerly labeled "Map overlay" renamed "Floor heatmap".

## Constraints

- Closed by default. Nothing user-visible ships until S0 to S5 are all merged (owner decision 2026-11-03).
- Geometry is pure and testable without a canvas (S1). World constants come from `src/render/scale.ts`; the lot and floor range come from the bound view world; the vertical extent matches `clampCameraY` (`SKY_HEADROOM_FLOORS` of sky above the top floor, one floor of ground below the lowest floor's bottom edge) so a clamped camera rectangle never leaves the map.
- Coordinates: tile `t` spans world x `[t * TILE, (t + 1) * TILE]`; floor `f` spans world y `[-f * FLOOR, -f * FLOOR + FLOOR]`; the camera's center is stored as `{ tile: pos.x / TILE, floor: -pos.y / FLOOR }`. A click maps to exactly that pair.
- Named facts and predicates, never bit masks or positional shorthand (CLAUDE.md). A per-kind style table is an exhaustive `Record<FacilityKind, ...>` so a new kind is a compile error.
- Map pixels are device pixels: the window sizes the canvas backing store to the layout (CSS size times `devicePixelRatio`) and applies no context scale. One pattern source per canvas.
- While the viewport rectangle is dragged the window reads the camera again for each move, since the renderer clamps the camera and the rectangle may stop short of the pointer at an edge.
- The window is a DOM element with its own canvas inside `#stage` (plan, Architecture), outside the Excalibur render layer. New code lives in `src/render/overviewMap/` and `src/ui/`; wiring into `src/main.ts`, `src/ui/UI.ts`, `towerInputCamera.ts` and `TowerEngine.ts` (all near the 500-line ceiling) is kept to a minimal seam and agreed with the other threads that edit them.
- Visual baselines and the gallery regenerate only through the pinned image or the `pr-drift-check` approval; compare locally against main first.
- No copied SimTower art or text. The original is described in our own words with sources cited.
- Hot-path checklist (`docs/performance/hot-path-review.md`) and its section 6 record on every PR that touches `src/render/` or `src/ui/`; `/bmad-code-review` per PR.

## Non-goals

- The Hotel, Eval and Pricing views (3.1.0: #1617, #1618, #1619). Pricing needs a new engine export and its own spec.
- Showing people, cars or live crowd on the map.
- Resizable or draggable window in v1 (a fixed placement per layout, decided in S3 from phone screenshots).
- Any change to camera clamps, zoom range or save contents.

## Success signal

A player with a 100-floor tower and a phone opens the Map, sees the tower's shape, taps the top and lands there in one move, and the game still builds and pans exactly as before.

## Assumptions

- The original window's drawing was measured from a retail capture (see Retail capture findings). The style table's Classic column still follows the manual and wiki description until slice S2b applies those findings.
- The map's drawing box proportions are chosen in S3 from phone and desktop layouts; the geometry (S1) takes any box, so the choice changes no tested logic.

## Retail capture findings (2026-11-03)

Measured in the real game on the PC harness with five saves (TOWER1, TOWER2, TOWER5, TOWER7, MYTOWER), all four tabs each. Own-words notes only: no game bytes, screenshots or third-party text are committed. Screenshots stay in the gitignored harness folders.

- **Window.** A small fixed window at the top-left of the game desktop, about 202 by 316 px, identical at 1024x768 and 1600x1000. It cannot be resized. A thin strip about 9 px tall sits on top (no real title bar), then a row of four equal beveled buttons (Edit, Eval, Pricing, Hotel, Edit active on load), then the map body, 200 by 288 px with a 1 px gray border and no scrollbars. The body background is the same sky and ground as the main view and follows the time of day.
- **Scale.** The whole lot is always visible: 375 tiles map to 200 px (8/15 px per tile) and 120 floor slots to 288 px (exactly 2.4 px per slot). The scale is fixed and never fits the tower, so a 40-slot tower is a small stub at the bottom under empty sky and a 110-slot tower nearly fills the body. Ground sits about 10 slots above the bottom, and the silhouette runs down through the ground strip to the bottom edge.
- **Edit tab.** A flat light-gray silhouette of each floor row's built extent (setbacks and steps show). No rooms and no facility kinds are drawn; lobbies, offices, hotels and condos are all the same gray. Elevators are 1 px vertical lines over the shaft's height: black for most, red for a few (probably express, unconfirmed). Long blue 1 px lines line up with stair and escalator columns (inferred, unconfirmed). Wide structures such as parking ramps show as thin horizontal bars.
- **Eval tab.** A three-swatch legend (Excellent cyan, Good olive-yellow, Terrible red) over the top of the body without shifting the map. Rooms are solid rectangles colored by score, one per room, kinds not told apart. Shafts and stairs keep their lines; lobbies and structure stay gray.
- **Pricing tab.** A four-swatch legend (High red, Average olive, Low green, Very Low cyan). Rooms are rectangles colored by rent tier. Default-priced towers are almost all olive.
- **Hotel tab.** One swatch for dirty rooms under the buttons. With no dirty rooms the map equals the Edit silhouette.
- **Camera rectangle.** A 1 px dotted outline (an inverting pen: black on light, red over red rooms, pale on a dark night sky), about 53 by 33 px, matching the main view of about 99 tiles by 14 floors. It is clipped at the map's right edge.
- **Open items.** What the black, red and blue lines mean is unconfirmed (a short live session clicking a line would settle it). Dirty-room coloring was seen only in TOWER1.

### What changes for Classic (applied in slice S2b, before S3)

1. Classic's Edit view is a single light-gray silhouette: every structure run and room paints the same flat gray, no patterns and no per-kind groups. The per-kind groups and patterns stay as the Modern theme.
2. Classic shafts are 1 px lines (black for standard and service, red for express, blue for stairs and escalators) until the live session settles the meanings. The manual's blue/gray/red-by-kind description and the capture disagree, and the capture wins for pixels; the choice is recorded here when confirmed.
3. Classic layout is the fixed scale (8/15 px per tile, 2.4 px per slot) in a fixed 200 by 288 body, not fit-to-extent. Modern keeps fit-to-extent. `fitLayout` already takes any box, so this is a layout choice in S3, not new geometry.
4. The camera rectangle is a 1 px dotted outline in Classic (a solid theme-colored outline in Modern is a free choice).
5. Eval, Pricing and Hotel tab colors above are the Classic palette for #1618, #1619 and #1617.

## Decision log

- 2026-11-03: placement approved (3.0.0 train with automatic deferral to 3.1.0 if v1 is not complete before the freeze), closed by default, "Map overlay" renamed "Floor heatmap", Hotel/Eval/Pricing tracked as separate 3.1.0 items. See the plan file.
- 2026-11-03: DOM canvas window chosen over an Excalibur layer: the world canvas's gesture arbiter and the map never compete for pointers, and a closed window costs nothing in the frame.
- 2026-11-03: retail capture measured the original window (fixed 200 by 288 body, fixed scale, flat gray silhouette in Edit, no rooms). Classic adopts that look in slice S2b; Modern keeps the per-kind groups. See Retail capture findings.
