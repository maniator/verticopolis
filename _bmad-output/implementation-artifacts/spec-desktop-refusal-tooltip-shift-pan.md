# Story: Desktop build-refusal tooltip visibility + Shift-drag panning

Status: ready-for-dev

Ships as one PR on branch `claude/desktop-visibility-navigation-btty71`.
Review skill: `/gds-code-review` (input routing and build-preview legibility are
gameplay-feel concerns, even though the surfaces are DOM/CSS).

## Story

As a desktop Verticopolis player in Modern mode,
I want the "Can't build here" card to stop covering the red invalid-placement
strip, and a one-hand mouse gesture to pan while a build tool is armed,
so that the refusal hover actually teaches me where the placement fails and I
can move around the tower without reaching for the spacebar or middle button.

### Background (why now)

Owner report with screenshot (2026-07-22): hovering an invalid spot with manual
structure on shows the refusal card ("Lay the floor under it first") anchored
directly ON the invalid preview row, hiding the exact pixels that explain the
refusal. Separately, with any build tool armed the mouse has no plain pan:
`classifyGesture` routes left-drag to the tool, so desktop panning needs
space-hold or middle/right-drag, neither of which is documented in Help.

## Party-ratified design (party mode, 2026-07-22)

Sally (UX), Samus (game design), Rex (desktop player advocate). Recorded in the
party memlog.

1. **Caption-below placement is the primary fix.** The refusal card's top edge
   anchors one floor-row BELOW the preview strip (below the anchor floor's
   bottom edge), keeping the existing +12px horizontal nudge and viewport
   clamping. The red strip stays fully visible; the card reads as a caption
   under the thing it explains. Because room ghosts extend upward from their
   anchor floor, "below the anchor floor" clears the ghost at every facility
   height.
2. **Mild translucency is the clamp insurance, not the fix.** On hover-capable
   devices only, the refusal card renders at **opacity 0.85**, so when edge
   clamping forces it back over the world (bottom-of-screen, basement digs) the
   strip still bleeds through. 0.85 was chosen to keep the retro dialog grammar
   (gray face, navy title) legible; Rex's "60% glass" was rejected as trading
   one illegibility for another. The mobile pinned card (coarse pointer, has ✕)
   stays fully opaque, and the inspect-tool hover card is NOT made translucent.
3. **Shift+left-drag classifies as pan for every tool.** It must win over the
   two gestures that own left-drag today (elevator drag-sizing, floor/lobby/
   parking run painting); that override is the entire point, matching the
   existing space-hold gate. Pan classification means the action path never
   fires, so no tile is ever painted while Shift is held. A shift-click that
   never moves stays a dead tap on mouse (existing `onTap` guard).
4. **Help copy tells the truth about mouse panning.** The Help lede's mouse
   line currently says "drag to pan" flat, which is wrong whenever a build tool
   is armed (and space-drag was never documented). Rewrite it in plain words;
   the Keyboard-play section's Shift ×10 line stays untouched so the two Shift
   meanings live in separate paragraphs.
5. **Deferred (backlog + GH issue):** grab-hand cursor while Shift is held.
   Polish, not part of this fix.

## Acceptance Criteria

1. Hovering an invalid placement in Modern mode (any tool that shows a preview
   reason: rooms, floor/lobby brush) shows the refusal card with its top edge
   at or below the bottom edge of the anchor floor's row (one floor-row below
   `inspectAnchor.floor`), horizontal behavior unchanged. The invalid preview
   strip is not covered by the card in the common case (preview away from the
   bottom viewport edge).
2. On hover-capable pointers (`hover: hover` and `pointer: fine`), the card is
   rendered at 0.85 opacity while showing a build refusal. The inspect-tool
   hover card and the mobile docked card keep full opacity. No change to the
   card's pointer-events or dismiss behavior on either tier.
3. With any build or bulldoze tool armed, Shift+left-drag pans the camera on
   mouse: no paint strip is laid, no shaft is anchored or sized, no bulldoze
   fires, on down, move, or up. Works identically over empty sky and over
   built tiles. Inspect tool with Shift+drag still pans (unchanged).
4. Without Shift, every existing left-drag behavior is byte-identical:
   elevator drag-sizing, floor/lobby/parking painting, bulldoze drag, inspect
   pan, space-hold pan, middle/right-button pan, touch routing (touch is
   unaffected by the modifier).
5. Gesture classification reads the modifier at pointer-down, matching the
   space-hold behavior (releasing Shift mid-drag keeps the pan until
   pointer-up).
6. Help lede mouse line documents the truth: drag pans with Inspect; with a
   build tool hold Shift and drag (middle/right drag and Space also pan).
   Plain wording, no em-dashes, no new section. Keyboard-play section's
   Shift ×10 line unchanged.
7. `package.json` version bumped **minor** with lockfile in lockstep
   (`npm version minor`): both changes are player-noticeable.
8. Regression tests pin the new routing and placement:
   - `src/game/gesture.test.ts`: pan-modifier cases (shift pans for build
     paint kinds, drag-sized transports, bulldoze; absence of shift keeps the
     current matrix).
   - `src/render/excalibur/towerInputCameraInput.test.ts`: pointer-down with
     `shiftKey` reaches `classifyDown` as a pan modifier.
   - `src/game/panelAnchoring.test.ts`: refusal card anchors one floor below
     the anchor floor; the inspect-tool card anchoring is unchanged.
   - Help copy assertions updated if `help.test.ts`/`helpPage.test.ts` pin the
     lede text.

## Technical guidance (files and seams)

- **`src/game/gesture.ts` (`classifyGesture`)**: the pure routing matrix. The
  `space` parameter is really "pan modifier held"; either rename it to a
  modifier flag fed with `space || shift`, or add the shift flag explicitly.
  Keep the function pure and DOM-free.
- **`src/render/excalibur/towerInputCamera.ts` (`pointerDown`)**: reads
  `keyboard.isHeld(ex.Keys.Space)` today and passes it to
  `engine.classifyDown(button, touch, space)`. Source Shift from the DOM event
  (`ev.nativeEvent` is a PointerEvent; its `shiftKey` reflects state at the
  press) or from Excalibur's keyboard (ShiftLeft/ShiftRight); prefer the
  native event so a press landing before a keydown focus quirk still routes
  right. Update `TowerEngine.classifyDown`'s signature comment accordingly.
- **`src/game/engineWiring.ts`**: the `classifyDown` wiring passes the flag
  through to `classifyGesture`.
- **`src/game/panelAnchoring.ts` (`positionPanels`)**: the refusal path is
  distinguishable via `app.buildRefusalShowing`; when true, anchor at
  `worldToScreenY(app.inspectAnchor.floor - 1)` (the anchor row's bottom edge)
  instead of the row top. Do NOT change `updateBuildRefusal`'s stored anchor
  semantics (`{x, floor}` = the refused cell) or the inspect-card path.
  `worldToScreenY(floor)` is the TOP of `floor`'s row; `floor - 1`'s top is the
  anchor row's bottom edge.
- **`src/styles.css`**: scope translucency with
  `@media (hover: hover) and (pointer: fine)` and select the refusal state via
  `#inspector:has(.preview-refuse)` (the `:has()` pattern is already
  established in this stylesheet), so no JS class management is needed. Keep
  the design-system discipline: edit rules, never out-specify them.
- **`src/ui/templates/helpContent.ts` (`helpLede`)**: one rewritten sentence in
  the muted mouse line. American English, no em-dashes.
- **Backlog**: add the deferred grab-cursor row to
  `_bmad-output/implementation-artifacts/backlog.md` with a matching GH issue
  per the mirror rule (`backlogIssueMirror.test.ts` enforces the row shape).

### Current behavior to preserve (read before editing)

- `updateBuildRefusal` / `clearBuildRefusal` ownership protocol
  (`buildRefusalShowing`) that keeps the build-preview path from stomping a
  live inspect-tool card.
- `anchorInspector`'s clamping (8px gaps) and `placePanel` mechanics.
- Touch routing in `classifyGesture`: one finger pans EXCEPT paint tools and
  drag-sized transports; nothing about touch changes in this story.
- Right-click inspect (`onSecondary`), space-hold pan, middle-button pan.
- Mobile (`pointer: coarse`) refusal card: docked, opaque, dismissed via ✕.
- `keyboardPlay` Shift ×10 cursor step (different input stream, no collision,
  but keep the help copy from conflating them).

### Testing notes

- `classifyGesture` is pure: extend the existing matrix table tests.
- `towerInputCameraInput.test.ts` already fakes pointer events and asserts
  `classifyDown` wiring; follow its fixture pattern for the shiftKey case.
- `panelAnchoring.test.ts` exists; add refusal-offset coverage there.
- Quality gates before push: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build`. Then `/gds-code-review` in the same session; fix `patch`
  findings, backlog `defer` findings.
- Screenshot note: if any committed gallery screenshot shows the refusal card,
  the pr-drift-check will flag it; refresh via the pinned-container flow only.
