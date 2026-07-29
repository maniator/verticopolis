import type { GameApp } from "../main";
import { facilityFloors } from "../engine/facilities";

/**
 * World-anchoring for the DOM panels (selected-facility editor, hover
 * inspector), split out of the `GameApp` class. Free functions taking the app;
 * they read `app.engine`/`app.selected` live so an `adoptSim` swap and camera
 * moves stay correct. Behavior unchanged from the former methods.
 */

/** Keep the world-attached DOM panels pinned to their facility's on-screen
 *  position. The big editor panel anchors beside its facility on desktop but
 *  keeps the docked CSS layout on mobile (bottom strip + drawer) to clear the
 *  palette. The small inspector card (desktop hover AND the touch long-press
 *  peek) anchors to its facility on EVERY tier, so a peek tracks the room like
 *  a hover instead of docking in a corner. */
export function positionPanels(app: GameApp): void {
  const mobile = app.mobileMq.matches;
  const vw = app.engine.viewWidth;
  const vh = app.engine.viewHeight;
  let editorAnchored = false;
  if (!mobile && app.selected && app.ui.isEditorOpen()) {
    const r = selectedScreenRect(app);
    if (r) {
      app.ui.anchorEditor(r, vw, vh);
      editorAnchored = true;
    }
  }
  const inspectorAnchored = !!app.inspectAnchor && app.ui.isInspectorOpen();
  if (inspectorAnchored && app.inspectAnchor) {
    const sxLeft = app.engine.worldToScreenX(app.inspectAnchor.left);
    const sxRight = app.engine.worldToScreenX(app.inspectAnchor.x);
    // The build-refusal card is a caption UNDER the invalid preview strip: its
    // top edge anchors at the anchored row's bottom edge (floor - 1's top,
    // worldToScreenY(floor) being a row's TOP edge) so the red strip that
    // explains the refusal stays visible. Room ghosts extend upward from their
    // anchor floor, so one row down clears the ghost at every facility height.
    // The inspect-tool hover card and the touch peek keep the row-top anchor.
    const floor = app.buildRefusalShowing ? app.inspectAnchor.floor - 1 : app.inspectAnchor.floor;
    // The full facility rect (not just the right edge) so the card can flip to
    // the facility's left at the viewport edge instead of clamping back over
    // the room and the finger holding a touch peek.
    app.ui.anchorInspector({ x: sxLeft, y: app.engine.worldToScreenY(floor), w: sxRight - sxLeft }, vw, vh);
  }
  // Release stale inline coords the moment a panel stops being anchored, each
  // panel on its own (a shared flag would let an anchored card pin the OTHER
  // panel's stale coords): the mobile editor falls back to its docked CSS
  // layout even while the peek card stays anchored beside its room. The clears
  // no-op when a panel carries no anchor, so per-frame calls cost nothing.
  if (!editorAnchored) app.ui.clearEditorAnchor();
  if (!inspectorAnchored) app.ui.clearInspectorAnchor();
}

/** Screen-space rect (top edge) of the currently selected unit/transport,
 *  for the editor card to anchor beside. */
export function selectedScreenRect(app: GameApp): { x: number; y: number; w: number } | null {
  if (!app.selected) return null;
  let left: number, right: number, topFloor: number;
  if (app.selected.type === "unit") {
    const u = app.selectedUnit();
    if (!u) return null;
    left = u.x;
    right = u.x + u.width;
    topFloor = u.floor + facilityFloors(u.kind) - 1;
  } else {
    const t = app.selectedTransport();
    if (!t) return null;
    left = t.x;
    right = t.x + t.width;
    topFloor = t.top;
  }
  const sx = app.engine.worldToScreenX(left);
  return { x: sx, y: app.engine.worldToScreenY(topFloor), w: app.engine.worldToScreenX(right) - sx };
}
