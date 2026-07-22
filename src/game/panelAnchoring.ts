import type { GameApp } from "../main";
import { facilityFloors } from "../engine/facilities";

/**
 * World-anchoring for the DOM panels (selected-facility editor, hover
 * inspector), split out of the `GameApp` class. Free functions taking the app;
 * they read `app.engine`/`app.selected` live so an `adoptSim` swap and camera
 * moves stay correct. Behavior unchanged from the former methods.
 */

/** Keep the world-attached DOM panels (selected-facility editor, hover
 *  inspector) pinned to their facility's on-screen position. On mobile they
 *  keep the docked CSS layout instead, to avoid the bottom palette strip. */
export function positionPanels(app: GameApp): void {
  if (app.mobileMq.matches) {
    if (app.panelsAnchored) {
      app.ui.clearPanelAnchors();
      app.panelsAnchored = false;
    }
    return;
  }
  const vw = app.engine.viewWidth;
  const vh = app.engine.viewHeight;
  if (app.selected && app.ui.isEditorOpen()) {
    const r = selectedScreenRect(app);
    if (r) {
      app.ui.anchorEditor(r, vw, vh);
      app.panelsAnchored = true;
    }
  }
  if (app.inspectAnchor && app.ui.isInspectorOpen()) {
    const sx = app.engine.worldToScreenX(app.inspectAnchor.x);
    // The build-refusal card is a caption UNDER the invalid preview strip: its
    // top edge anchors at the anchored row's bottom edge (floor - 1's top,
    // worldToScreenY(floor) being a row's TOP edge) so the red strip that
    // explains the refusal stays visible. Room ghosts extend upward from their
    // anchor floor, so one row down clears the ghost at every facility height.
    // The inspect-tool hover card keeps the row-top anchor it always had.
    const floor = app.buildRefusalShowing ? app.inspectAnchor.floor - 1 : app.inspectAnchor.floor;
    const sy = app.engine.worldToScreenY(floor);
    app.ui.anchorInspector(sx, sy, vw, vh);
    app.panelsAnchored = true;
  }
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
