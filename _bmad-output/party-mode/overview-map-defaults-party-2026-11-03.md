# Party transcript: overview Map defaults, extent and phone placement (#343, 2026-11-03)

> **Snapshot, 2026-11-03.** Decisions as approved on this date. The live contract is `_bmad-output/specs/spec-overview-map/SPEC.md` (CAP-1, CAP-3, CAP-5, Constraints, Decision log). Mockups referred to here are project files (`release-3.0/overview-map-mockups/`), not part of this repository.

Room: Overview Map Design Review. John (PM), Samus Shepard (game designer), Sally (UX), Amelia (dev), Tess (performance QA), Grumbal (adversary), Boundary (edge cases). Session mode, run on Opus at the owner's request.

On the table: the owner reversed "closed by default" for desktop. After hearing "open by default on desktop but closable, closed on phone" he said, "Ya. I think it makes sense." Four calls were left: what the remembered choice does, the first tower, the Modern extent, and phone placement. The owner then approved the room's calls, "unless a party roundtable disagrees". Decision 3 was re-run after a factual correction (below) and its outcome replaces the first round's.

## 1. Desktop default and the remembered choice

**John:** The owner has made the default call. What's left for us is memory. If a player closes the Map, does it stay closed?

**Sally:** Yes. It stays closed on the next tower and on the next visit. Closing it is a choice the player made, and if we reopen it every load we're nagging them.

**Grumbal:** Then don't write the default into storage. Store only an explicit open or close click. If we persist "open" on first load, we can't tell a player who chose it from one who never touched it, and we lose the chance to change the default later.

**Boundary:** Store it per layout class too. If someone closes it on a phone and then plays on desktop in the same browser profile, desktop shouldn't come up closed. Use two keys, desktop and phone. If storage is unreadable, use that layout's default and never throw.

**Amelia:** Two keys and an absent-means-default read. It's a small module, and none of it touches `main.ts`.

## 2. The onboarding tower and narrow windows

**Samus:** On the onboarding tower the Map opens like it does everywhere else. A brand-new player gains the most from seeing the lot's shape, so a hint card on top of the onboarding steps would just compete with them.

**Sally:** I still want one line. A small caption inside the window, "Click to move the view", shown until the first map click. It's not a popup.

**Grumbal:** Every caption has to be maintained and translated, and it pushes CAP-5's text summary around. The title bar says Map, and the help entry lands in S5.

**John:** Sally's caption costs one string and it stays inside the window. It goes to the owner as optional, and we ship without it unless he wants it.

**Boundary:** What does it cover? Top-left of the world view on a new tower is sky, since the tower grows from the bottom center. But I want proof that it never covers the sidebar, the Floor heatmap control or its legend, or the tool palette.

**Tess:** That goes in S4 as a bounding-box non-overlap check at the smallest desktop size we support and at 1280 by 720. Nobody gets to eyeball it.

**Boundary:** Then the narrow desktop window. Which width rule do we use?

**Amelia:** The one we already have, `mobileMq`: phone layout is anything 767 px wide or less, or 1023 px or less and under 600 px tall. The tablet tier stays desktop. A second breakpoint just for the Map would drift away from the CSS.

**Boundary:** And when a resize crosses it?

**Amelia:** The Map takes on the stored choice for the new layout class, or that class's default if nothing is stored. It never auto-opens over a class where the player closed it.

## 3. Modern extent (re-run with the corrected camera fact)

The first round voted for a tight crop to the built tower on the claim that the crop would equal the camera clamp, so the rectangle could never leave the map. That claim was wrong: the main camera clamps to the whole world (`viewWorld()`, floors -9 to 100 plus sky headroom, `towerInputCamera.ts`), not to the built tower, and changing that clamp is a non-goal. The room re-ran the call.

**Amelia:** I was wrong last round. The camera can't leave the map only if the map covers the whole world. Any crop means the main view can sit somewhere the map doesn't show.

**Grumbal:** Then take A. Classic's geometry with Modern styling. The rectangle is always on the map, nothing ever rescales, and the code path is the same in both themes. "Modern freedom" can be colors and patterns.

**Samus:** A on a 15-floor starter tower is a thumbnail of sky with a sliver at the bottom. Classic keeps that because it's canon. Modern exists to read better.

**Boundary:** Then look at a tight crop's real failure. The main reason anyone pans above the top floor is to build upward. With a tight crop, the rectangle pins to the top edge exactly when the player is growing the tower. And when the view is entirely above the crop, there's nothing honest to draw.

**Sally:** So we show it. When the view is fully above the crop, draw a clipped band on the top edge with an upward chevron, and have the text summary say where the view is. The player can always pan the main view freely. The map just isn't the tool for empty sky.

**Grumbal:** And a click on the map can never reach above the crop. Is that acceptable?

**Samus:** Yes. The map's job is jumping to floors that exist. Nobody needs to teleport into empty sky.

**Tess:** Rescaling is my worry. If the extent follows every new top floor, the draw list rebuilds and the scale shifts under the player on every floor they add.

**Amelia:** Then band it. The bottom is the lowest built floor (basements included) with one floor of ground. The top is the top built floor plus `SKY_HEADROOM_FLOORS`, rounded up to the next 10-floor band. The extent is at least 30 floors tall and never past the world's maximum. Building upward inside a band never rescales, and the headroom means a player building one or two floors up stays inside the map.

**Tess:** It rebuilds only when a band is crossed, and that check already sits inside the structure-identity rebuild. There's still no per-frame cost.

**Boundary:** At 100 floors the banded crop converges on the whole lot anyway.

**Grumbal:** I still say A is simpler and has no edge cases. But I accept the banded crop if the above-the-map indicator and the band rule are both tested.

## 4. Phone placement

**Sally:** I want the small card top-left: about 150 px wide, with a 44 px close button. A full-width bottom sheet covers either the tool palette or the lower world view, and the lower world view is where the lobby and the building happen.

**Grumbal:** The card covers part of the world view too.

**Sally:** It covers a corner, and most of the time that corner is sky. A bottom sheet covers the part you're actually working on.

**Boundary:** Landscape phones fall in phone layout through the height clause. At 360 to 430 px tall, a card at the 200:288 ratio would fill the height.

**Amelia:** Cap the card height at about half the world view's height and let the width follow the ratio. Keep it top-left, inside the safe-area insets.

**Tess:** The world view has to stay pannable and pinchable with the card open, and that's CAP-1's existing promise. It's a DOM window outside the Excalibur canvas, so gestures that start outside the card go to the world. S4 proves it in portrait and landscape.

**Boundary:** Every target on the card has to be at least 44 CSS px: close, the Map pill, and any tab. A tap on the map needs a 44 px tolerance, not single-pixel accuracy.

**Grumbal:** My dissent stands. A sheet would give a bigger, more legible map on a 100-floor tower. But I accept that it costs the palette.

## Outcome

1. **Desktop default and memory.** Open by default on desktop, closed on phone, closable everywhere. Only an explicit player choice is stored, with separate keys for desktop and phone; a closed Map stays closed on the next tower and the next visit; failed storage falls back to the layout default. Dissent (Grumbal, adopted): never persist the default.
2. **First tower and narrow windows.** The Map opens on the onboarding tower with no extra hint card. The phone and desktop switch uses `mobileMq`; the tablet tier counts as desktop; crossing the breakpoint adopts that layout's stored choice or default. Dissent (Sally): a one-line in-window caption until the first map click, offered to the owner as optional.
3. **Modern extent.** Modern uses the banded crop (lowest built floor with one ground floor, to the top built floor plus `SKY_HEADROOM_FLOORS` rounded up to the next 10-floor band, at least 30 floors, capped at the world maximum). Above the crop the rectangle clips, a view wholly outside shows as an edge band with a chevron, the summary names the camera's floor, and map clicks stay within the crop. Classic stays the retail fixed whole-lot map. Dissent (Grumbal): the whole lot with Modern styling, which never clips and never rescales.
4. **Phone placement.** A top-left card, about 150 px wide, capped at about half the world view's height, inside the safe-area insets, every target at least 44 CSS px; the world view stays pannable and pinchable. Dissent (Grumbal): a full-width bottom sheet for legibility on tall towers.

### Tests the outcome adds

- S3 (unit and DOM): the preference module (absent key gives the layout default, explicit close persists, independent desktop and phone keys, a throwing storage call falls back without an error); crossing the breakpoint adopts the other class's choice; band math (growth inside a band never changes the extent, crossing a band does, the 30-floor minimum, the world-maximum cap, basements included); the rectangle clips at the edge and a view wholly above the crop gives the edge band and chevron state; map clicks map only into the crop and the summary reports the camera's floor when it is above the map; Classic's extent never changes.
- S4 (Playwright and Performance): desktop first load shows the Map open, the onboarding tower included, and phone first load shows only the pill; close, reload and a new tower all stay closed; bounding-box non-overlap with the sidebar, the Floor heatmap control and legend, and the tool palette at the minimum desktop size and 1280 by 720; a narrow desktop width switches to phone behavior; phone portrait and landscape: the card size cap, 44 px targets, world pan and pinch with the card open; a visual snapshot of the above-the-map state and a check that panning the main view to floor 100 on a 40-floor tower still works with the map open; the paired open-versus-closed measurement on the `large` fixture now covers the desktop default state.
