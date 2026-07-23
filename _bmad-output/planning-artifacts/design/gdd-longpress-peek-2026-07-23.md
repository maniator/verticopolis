# GDD: Long-Press to Peek (mobile hover-inspect)

**Date:** 2026-07-23 · **Facilitator convergence of:** Samus Shepard (UX), Cloud Dragonborn (Architect), Skeptic PM/QA
**Status:** Build-ready v1 · **Feature:** hold a facility on touch to read its inspector card without opening the editor, the touch equivalent of desktop hover-inspect.
**Mode:** Express (headless). Open questions are recorded inline, not resolved by asking.

---

## 1. The one job

On desktop, hovering a facility raises a floating inspector card (status, census, diagnostics) without committing to anything: it is a *glance*. Touch has no hover, so today the only way to read a room on a phone is a full TAP into the editor, which is heavy for a look and loses your place in the tower.

**Long-press to peek** gives that glance back on touch: hold a facility for a moment and its inspector card appears transiently; lift to dismiss. A quick tap still opens the full editor. This is the inspect half of "the drag is the hover" (the build half shipped in v1.99.0/1.99.1 as the offset ghost). Part of the party-ratified mobile-play plan.

This is a **touch-only, feel-first** affordance. It changes no engine state, no economy, no save bytes. Its whole quality bar is that the hold reads as a peek, not as lag, and that it never steals a tap, a pan, a pinch, or the offset-ghost build drag.

---

## 2. Design pillars (what every decision answers to)

1. **A peek is lighter than an edit.** Reading a room must cost less than opening it. Long-press raises a card and nothing else: no selection, no editor, no camera move, no state change. Lifting returns you exactly where you were.
2. **The gesture vocabulary stays honest.** Tap = act (open editor / place). Drag = the tool's drag (pan for inspect, offset ghost for a room build). Two fingers = pan/pinch. Long-press is the one new verb: *hold still to peek*. It must be unmistakable from all four, and it must never fire when the player meant one of them.
3. **The hold is legible.** A delay with no feedback reads as a broken tap. A growing affordance during the hold tells the player "keep holding, something is coming," so the ~450ms never feels like the app hung.

---

## 3. v1 scope (agreed)

### The mechanic

- **Trigger:** one finger presses a facility (a unit or a transport shaft) and stays within tap slop for the hold duration. At the knee, the inspector **peek card** for that facility appears. This is the same content the desktop hover raises (`unitInspectorTemplate` / `transportInspectorTemplate`).
- **Dismiss:** lifting the finger dismisses the peek. It is transient by nature, tied to the press.
- **Tap is preserved:** a quick down/up (released before the hold knee, within slop) still selects and opens the editor exactly as today. Long-press is purely additive: it occupies the "held past the knee" window that a tap never used.
- **Empty space peeks nothing:** a hold over a cell with no facility raises no card (and does nothing else).
- **Holding affordance:** from press start, a progress affordance grows toward the knee (a ring/arc filling around the touch point, or the card easing in) so the delay reads as deliberate. It is engine-drawn (world overlay) to stay diegetic, consistent with the offset ghost being `engine.preview`.

### Hold duration

- **~450ms** (`LONG_PRESS_MS`), inside the tap-slop radius already used for tap-vs-drag. Rationale: long enough that a normal tap (typically < 200ms) never crosses it, short enough that the peek feels responsive. Recorded as an open question for on-device tuning (see §8).

### Per-tool behavior (the gesture-precedence ruling)

Long-press peek works with **any tool armed**, so a player can glance at a neighbor while mid-build. The precedence is resolved by **motion, not by tool**:

| Tool armed | One finger, held STILL past knee | One finger, MOVED past slop before knee |
| --- | --- | --- |
| Inspect | **peek** the facility | pan (as today); release = tap-select |
| Bulldoze | **peek** the facility | pan; release = tap-bulldoze |
| Stairs / escalator (fixed transport) | **peek** the facility | pan; release = tap-place flight |
| Room build (offset ghost) | **peek** the facility | the tool's drag (offset-ghost lift), as v1.99.0 |
| Paint (floor/lobby/parking) | **peek** the facility | the tool's paint drag |
| Elevator (drag-sized shaft) | **peek** the facility | the tool's shaft drag |

The rule in one line: **a stationary hold past the knee is always a peek; the first movement past slop hands the gesture to whatever that tool does with a one-finger drag.** Because the offset-ghost build and the paint/elevator drags all begin with *movement*, a hold that stays still never competes with them: the peek fires only in the window they never use (finger down, not yet moving). Once movement latches the tool's drag, the peek is off the table for that gesture. Conversely once the peek knee fires, that gesture is a peek to its release and does not fall through to build/place.

Two-finger anything (pan/pinch) is unaffected: the second finger down before the knee cancels the pending peek and the gesture becomes a camera move, exactly as a second finger cancels a pending tap/drag today.

### Card placement on mobile (the integration wrinkle)

The desktop card is positioned by `panelAnchoring.positionPanels`. It used to **bail on mobile** entirely (a rule meant for the big editor panel, which docks to clear the palette), which left the peek card at its CSS default (top-left). Owner feedback: the top-left dock reads as disconnected; the peek should track the room the way desktop hover does.

- **Anchored to the facility on every tier.** `positionPanels` now anchors the small inspector card (desktop hover AND the touch peek) beside its facility on mobile too; only the big editor panel keeps the docked mobile layout. So the peek pins to the room's top-right, exactly like a desktop hover, following the camera.
- It reuses the existing `UI.showInspector(template)` + `anchorInspector` surface (the same one the desktop hover and the Modern build-refusal card use), so no new DOM element and no new positioning engine. `anchorInspector` clamps to the canvas viewport (which excludes the bottom palette bar), so the card stays on-screen above the palette.
- Dismissal is lifting the finger (`onLongPressEnd` -> `inspector.hide()`). The peek is marked with a `.peek` class (`UI.setInspectorPeek`) that hides the coarse-pointer ✕ close, so the card is exactly the desktop hover tooltip: no manual close, because lifting dismisses it just as mouse-away does on desktop. (Owner feedback: the ✕ "makes no sense" on a lift-to-dismiss peek.)

---

## 4. Edge-case matrix

| Situation | Ruling |
| --- | --- |
| Quick tap on a facility | Opens editor (unchanged). No peek. |
| Hold facility past knee, then lift | Peek shows on knee, dismisses on lift. No editor, no selection. |
| Hold, then move past slop before knee | Peek never fires; becomes the tool's drag (pan or offset-ghost/paint/shaft). |
| Hold past knee, THEN move finger | Already a peek; stays a peek to release (does not convert to a drag mid-peek). Card may track to the new facility under the finger, or hold the first, chosen for least surprise (open question §8: recommend hold-the-first, simplest and matches "the press is the peek"). |
| Second finger lands before knee | Pending peek cancels; gesture becomes two-finger pan/pinch. |
| Second finger lands after peek showing | Peek dismisses; two-finger camera takes over (same as any second-finger interrupt). |
| Hold over empty cell | Nothing. No card, no affordance beyond the ring fading if drawn, no state change. |
| Hold with a room-build tool armed, still | Peek (glance while building). Release without moving does NOT place a room (a still hold is a peek, and the offset-ghost build commits only on a drag+release per v1.99.0). |
| Hold with a room-build tool, then drag | Offset-ghost build (v1.99.0), peek never armed. |
| Hold on a transport shaft | Peek the transport (`transportInspectorTemplate`), same as desktop hover over a shaft. |
| Desktop (fine pointer) | Unchanged. Long-press logic is gated to coarse/touch; mouse still hovers for the card and clicks to edit. |
| Peek showing, sim tick changes the facility | Card content is a snapshot at peek time; it does not need live re-render for a transient glance (matches the desktop hover card's behavior). |

---

## 5. Code-touch map

All in the game/render/ui layers. **`src/engine/` is not touched** (stays DOM-free; this is presentation and input).

- **`src/render/excalibur/towerInputCamera.ts`**: the hold timer. On `pointerDown` (touch, ~line 138), start a `LONG_PRESS_MS` timer anchored at the press cell, only when a peek is eligible (coarse pointer). Cancel the timer on: movement past tap slop (in `pointerMove`), a second pointer, `pointerUp` before the knee, or `pointerCancel`. On timer fire, invoke the long-press callback with the pressed cell. On `pointerUp` (~line 229) after a peek fired, dismiss (and swallow the tap so it does not also open the editor). Timer is a plain `setTimeout` handle on the input controller; deterministic in that it draws no rng.
- **`src/game/engineWiring.ts`**: the `onLongPress(floor, tile)` callback (sibling to `onTap`/`onHover`/`onActionDown`). Resolve the facility with `pickedAt(app, floor, tile)`; if a facility exists, raise the peek via the inspector (below); if not, no-op. Add `onLongPressEnd()` (lift) to dismiss. Gate to `app.mobileMq.matches` (touch tier) so desktop is untouched. Must sit alongside the existing touch routing so it does not disturb `onActionDown`/`onActionMove`/`onActionUp` (the offset-ghost build) or the inspect pan+tap.
- **`src/game/inspector.ts`**: a peek variant of `inspectPicked(p)`. The existing method already builds the template and shows the card with a ✕ latch; the peek path reuses it but marks the card as *peek-owned* (a `peekShowing` flag paralleling `buildRefusalShowing`) so lift can clear only a peek card and never stomp a real inspect-tool card or a build-refusal card. Content is unchanged from desktop hover.
- **Mobile card placement (CSS + the showInspector surface)**: give the inspector card a fixed docked position under the stat bar when `mobileMq.matches`, since `panelAnchoring.positionPanels` bails on mobile and will not anchor it. No new DOM node: reuse `UI.showInspector`. Dismiss via `UI.showInspector(null)`.
- **`src/game/gesture.ts`**: document the precedence (a still hold = peek; movement hands off to the tool's one-finger drag). The classifier already routes movement; the hold is a pre-movement window, so this is mainly ensuring the peek timer and the drag/pan classification do not double-fire. No change to the existing action/pan split; the peek lives in the "down, not yet moved" gap.
- **`src/game/engineWiring.test.ts` / a new `towerInputCamera` hold test**: unit coverage for the timer and precedence (below).
- **`src/ui/templates/helpContent.ts`**: extend the existing "Playing on a phone" HelpSection with a line for long-press to peek (hold a room to read it, lift to close; tap still opens it). Shared by the help modal and the /help page.
- **The holding affordance**: drawn on the Excalibur overlay (`towerOverlay.ts`) as a progress ring/arc at the press point, growing from press start to the knee, consistent with the ghost being engine-drawn. Cleared on peek fire, cancel, or lift.

---

## 6. Acceptance criteria

1. A hold of `LONG_PRESS_MS` on a facility, finger within tap slop, raises the correct inspector card (unit or transport) and no editor opens.
2. Lifting the finger dismisses the peek card; the player's selection/editor state is unchanged from before the press.
3. A quick tap on a facility still opens the editor (no regression to `onTap` → `selectPicked`).
4. A press that moves past slop before the knee never peeks and becomes the tool's one-finger drag (pan for inspect/bulldoze/fixed-transport; offset-ghost for a room build; paint/shaft for those tools). The offset-ghost build (v1.99.0) is byte-for-byte unregressed.
5. A hold over empty space raises no card and changes nothing.
6. A second finger before the knee cancels the pending peek and yields two-finger pan/pinch; a second finger after the peek dismisses it and yields the camera gesture.
7. The holding affordance is visible during the hold and clears on fire/cancel/lift, so the delay never reads as a frozen tap.
8. Desktop (fine pointer) behavior is identical to today: hover raises the card, click opens the editor, no long-press path runs.
9. The peek card is placed in a fixed, thumb-clear docked position on mobile (not the panelAnchoring hover anchor, which bails on mobile).
10. No engine state, economy, or save bytes change. `src/engine/` has no new DOM/render dependency. No new rng. American English, no em-dashes.

---

## 7. Faithfulness check

- **Diegesis (project rule):** the card is DOM (chrome/text), the holding affordance is engine-drawn world graphics (the overlay owns world-anchored visuals). Matches `ui-layer-diegesis` and the offset-ghost precedent.
- **Canon feel:** peek adds no new information the desktop player did not already have; it just returns the hover glance to touch. The toolbar-grows-with-stars canon and all build caps are untouched.
- **Modern vs Classic:** the card content already respects `sim.rules` (e.g. Modern surfaces preview reasons). Peek raises the same template on either mode; no new mode-string branching.
- **TDT:** touch-only presentation, zero save impact. No ordinal, no subtype, nothing exportable. Consistent with `modern-not-tdt-exportable`.

---

## 8. Open questions (recorded, not resolved)

- **Hold duration.** `LONG_PRESS_MS` ~450ms is the proposed start. Tune on-device: too short steals slow taps, too long reads as lag. Feel call.
- **Card placement.** Top dock under the stat bar (proposed) vs a bottom sheet above the palette. Top dock is the default; confirm on-device it does not collide with the stat bar or the offset ghost.
- **Any-tool vs inspect-only.** Spec rules **any tool** (glance while building). If on-device the still-hold-with-build-tool proves confusing (players expecting the hold to place), fall back to inspect-only. Default: any tool, because motion cleanly separates peek from the build drag.
- **Move-after-peek.** Whether the card tracks the facility under a moving finger or holds the first pressed facility. Default: **hold the first** (simplest, matches "the press is the peek"). Revisit if on-device a slide-to-compare feels wanted.

---

## 9. Verification plan

- **Unit: hold timer (`towerInputCamera`):** press → knee fires callback; press → move past slop before knee → no callback (becomes drag/pan); press → up before knee → no callback (tap preserved); second pointer before knee → callback cancelled. Timer is a mockable `setTimeout`; assert set/clear on each path.
- **Unit: gesture precedence (`engineWiring`):** `onLongPress` over a facility raises the peek and does NOT open the editor; over empty space is a no-op; `onLongPressEnd` clears only a peek-owned card (never a build-refusal or a real inspect card); desktop (`mobileMq` false) never arms the peek.
- **Unit: offset-ghost regression:** the existing v1.99.0/1.99.1 touch-build tests (tap-at-finger, jitter-doesn't-lift, drag-lifts-and-commits) stay green, proving the peek did not disturb `onActionDown/Move/Up`.
- **Help content test:** the "Playing on a phone" section documents long-press peek (extend the existing helpContent assertion).
- **On-device preview test (feel, gated):** implemented behind the standing "hold for on-device preview test" discipline. Before merge, the owner tests on the Vercel preview (`https://verticopolis-git-claude-longpress-peek-maniator.vercel.app`): the hold reads as a peek not lag, the card sits clear of the thumb, a tap still edits, a pan still pans, the offset-ghost build still works. No merge until that device feedback lands.

---

## 10. Cut list (explicitly OUT of v1)

- **Live-updating peek card.** The card is a snapshot at peek time (matches desktop hover). No per-tick re-render while held.
- **Slide-to-compare.** Sliding the held finger across neighbors to compare cards. Default holds the first facility; deferred.
- **Pinned/sticky peek.** A peek that survives lift and must be dismissed with ✕. Out: peek is transient by design; the ✕ is only a secondary dismiss.
- **Refusal-reason text on touch build.** Separate fast-follow (surface the "can't build here" reason on touch, which also needs a mobile-friendly placement). Related but its own slice.
- **Haptics.** A vibration on the knee would reinforce the peek but is a separate platform concern; not in v1.

---

## 11. Review outcome (bmad-code-review, 2026-07-23)

Deep adversarial review ran in-session (Blind Hunter + Edge Case Hunter + Acceptance Auditor, then a confirming Edge Case pass) because both outside bots were down. All four confirmed patch findings share one root cause (a fired or pending peek was not treated as an absorbing gesture state) and are fixed with regression tests:

- **patch (fixed):** after the peek fired, a move panned the camera (inspect) or painted real tiles with no undo capture (paint). Fix: the timer surrenders `engine.gesture` on fire, and `pointerMove` returns early while `longPressFired`.
- **patch (fixed):** a second finger after the peek was showing never dismissed it and stranded the pinch survivor. Fix: the pinch-start branch dismisses the peek and resets the latch, so the later release still seeds the survivor pan.
- **patch (fixed):** a hold over empty/floor/lobby latched the peek and swallowed the release (stealing a slow tap-place). Fix: `armLongPress` only arms over a real inspectable facility (mirrors `pickedAt`).
- **patch (fixed):** during the pending hold, a within-slop jitter drove the tool (TILE 11 < slop 14, so a paint tool could seed a stray strip). Fix: `pointerMove` returns while the hold timer is still pending.
- **hardening (fixed):** `onLongPress` clears build-refusal ownership before borrowing the inspector surface; `rebuildEngine` dismisses a peek card the severed touch can no longer close.
- **defer (backlog #634):** the holding progress-ring affordance (AC7 / section 3) ships absent, deferred as a feel item for on-device tuning.
- **dismissed:** "pointerCancel leaks a stuck card" (false positive: `cancel` routes through `pointerUp`, which clears the timer and dismisses a fired peek).

Confirming pass verdict: all fixes RESOLVED, no new defect, comment trims logic-neutral, no per-frame scan / no `src/engine` DOM dependency / no rng.
