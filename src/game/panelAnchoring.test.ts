import { describe, it, expect, vi } from "vitest";
import { positionPanels, selectedScreenRect } from "./panelAnchoring";
import { facilityFloors } from "../engine/facilities";
import type { GameApp } from "../main";

/**
 * Unit coverage for the world-anchoring of the DOM panels. Both functions are
 * free functions over the app, so we hand-build a fake `GameApp` with vi.fn
 * stubs for the `ui` façade and a linear `engine` projection, then assert which
 * anchor calls fire and the exact screen rect that comes back.
 */

/** Linear world->screen projection so expected coordinates are easy to derive:
 *  x doubles, floor triples. */
const worldToScreenX = (x: number): number => x * 2;
const worldToScreenY = (f: number): number => f * 3;

interface FakeParts {
  matches?: boolean;
  panelsAnchored?: boolean;
  selected?: GameApp["selected"];
  inspectAnchor?: { x: number; floor: number } | null;
  isEditorOpen?: boolean;
  isInspectorOpen?: boolean;
  buildRefusalShowing?: boolean;
  unit?: { x: number; width: number; floor: number; kind: string } | null;
  transport?: { x: number; width: number; top: number } | null;
}

function makeApp(parts: FakeParts = {}) {
  const ui = {
    clearPanelAnchors: vi.fn(),
    anchorEditor: vi.fn(),
    anchorInspector: vi.fn(),
    isEditorOpen: vi.fn(() => parts.isEditorOpen ?? false),
    isInspectorOpen: vi.fn(() => parts.isInspectorOpen ?? false),
  };
  const app = {
    mobileMq: { matches: parts.matches ?? false },
    panelsAnchored: parts.panelsAnchored ?? false,
    ui,
    engine: { viewWidth: 800, viewHeight: 600, worldToScreenX, worldToScreenY },
    selected: parts.selected ?? null,
    inspectAnchor: parts.inspectAnchor ?? null,
    buildRefusalShowing: parts.buildRefusalShowing ?? false,
    selectedUnit: () => parts.unit ?? null,
    selectedTransport: () => parts.transport ?? null,
  };
  return { app: app as unknown as GameApp, ui };
}

describe("positionPanels", () => {
  it("on mobile with nothing open, clears anchors once when panels were anchored, then stops", () => {
    const { app, ui } = makeApp({ matches: true, panelsAnchored: true });
    positionPanels(app);

    expect(ui.clearPanelAnchors).toHaveBeenCalledTimes(1);
    expect(app.panelsAnchored).toBe(false);
    // Nothing open, so no editor/inspector anchoring is attempted.
    expect(ui.anchorEditor).not.toHaveBeenCalled();
    expect(ui.anchorInspector).not.toHaveBeenCalled();
  });

  it("on mobile with nothing anchored, does not touch clearPanelAnchors", () => {
    const { app, ui } = makeApp({ matches: true, panelsAnchored: false });
    positionPanels(app);

    expect(ui.clearPanelAnchors).not.toHaveBeenCalled();
    expect(app.panelsAnchored).toBe(false);
  });

  it("on mobile, anchors the inspector peek card to its facility (tracks the room like a hover)", () => {
    const { app, ui } = makeApp({
      matches: true,
      inspectAnchor: { x: 20, floor: 9 },
      isInspectorOpen: true,
    });
    positionPanels(app);

    expect(ui.anchorInspector).toHaveBeenCalledWith(worldToScreenX(20), worldToScreenY(9), 800, 600);
    expect(app.panelsAnchored).toBe(true);
  });

  it("on mobile, keeps the editor docked (never anchors it) even when open with a selection", () => {
    const { app, ui } = makeApp({
      matches: true,
      selected: { type: "unit" } as GameApp["selected"],
      isEditorOpen: true,
      unit: { x: 1, width: 2, floor: 3, kind: "office" },
    });
    positionPanels(app);

    expect(ui.anchorEditor).not.toHaveBeenCalled();
  });

  it("on desktop, anchors the editor beside the selected unit when the editor is open", () => {
    const unit = { x: 15, width: 31, floor: 10, kind: "cinema" };
    const { app, ui } = makeApp({
      selected: { type: "unit" } as GameApp["selected"],
      isEditorOpen: true,
      unit,
    });
    positionPanels(app);

    const topFloor = unit.floor + facilityFloors("cinema") - 1;
    const expectedRect = {
      x: worldToScreenX(unit.x),
      y: worldToScreenY(topFloor),
      w: worldToScreenX(unit.x + unit.width) - worldToScreenX(unit.x),
    };
    expect(ui.anchorEditor).toHaveBeenCalledWith(expectedRect, 800, 600);
    expect(app.panelsAnchored).toBe(true);
    expect(ui.anchorInspector).not.toHaveBeenCalled();
  });

  it("on desktop, does NOT anchor the editor when the selection resolves to nothing", () => {
    const { app, ui } = makeApp({
      selected: { type: "unit" } as GameApp["selected"],
      isEditorOpen: true,
      unit: null, // selectedUnit() returns null -> rect is null -> no anchor
    });
    positionPanels(app);

    expect(ui.anchorEditor).not.toHaveBeenCalled();
    expect(app.panelsAnchored).toBe(false);
  });

  it("on desktop, does NOT anchor the editor when it is closed even with a selection", () => {
    const { app, ui } = makeApp({
      selected: { type: "unit" } as GameApp["selected"],
      isEditorOpen: false,
      unit: { x: 1, width: 2, floor: 3, kind: "office" },
    });
    positionPanels(app);

    expect(ui.anchorEditor).not.toHaveBeenCalled();
  });

  it("on desktop, anchors the inspector at the projected anchor when the inspector is open", () => {
    const { app, ui } = makeApp({
      inspectAnchor: { x: 20, floor: 9 },
      isInspectorOpen: true,
    });
    positionPanels(app);

    expect(ui.anchorInspector).toHaveBeenCalledWith(worldToScreenX(20), worldToScreenY(9), 800, 600);
    expect(app.panelsAnchored).toBe(true);
    expect(ui.anchorEditor).not.toHaveBeenCalled();
  });

  it("anchors the build-refusal card one floor BELOW its cell so the invalid preview strip stays visible", () => {
    const { app, ui } = makeApp({
      inspectAnchor: { x: 20, floor: 9 },
      isInspectorOpen: true,
      buildRefusalShowing: true,
    });
    positionPanels(app);

    // worldToScreenY(floor) is a row's TOP edge, so floor - 1's top is the
    // anchored row's bottom edge: the card hangs under the strip as a caption.
    expect(ui.anchorInspector).toHaveBeenCalledWith(worldToScreenX(20), worldToScreenY(8), 800, 600);
    expect(app.panelsAnchored).toBe(true);
  });

  it("on desktop, does NOT anchor the inspector when it is closed", () => {
    const { app, ui } = makeApp({
      inspectAnchor: { x: 20, floor: 9 },
      isInspectorOpen: false,
    });
    positionPanels(app);

    expect(ui.anchorInspector).not.toHaveBeenCalled();
  });
});

describe("selectedScreenRect", () => {
  it("returns null when nothing is selected", () => {
    const { app } = makeApp({ selected: null });
    expect(selectedScreenRect(app)).toBeNull();
  });

  it("returns null for a unit selection that resolves to no unit", () => {
    const { app } = makeApp({ selected: { type: "unit" } as GameApp["selected"], unit: null });
    expect(selectedScreenRect(app)).toBeNull();
  });

  it("computes the rect for a selected unit using facilityFloors for the top edge", () => {
    const unit = { x: 15, width: 31, floor: 10, kind: "cinema" };
    const { app } = makeApp({ selected: { type: "unit" } as GameApp["selected"], unit });

    const topFloor = unit.floor + facilityFloors("cinema") - 1; // 10 + 2 - 1 = 11
    expect(selectedScreenRect(app)).toEqual({
      x: worldToScreenX(15), // 30
      y: worldToScreenY(topFloor), // 33
      w: worldToScreenX(15 + 31) - worldToScreenX(15), // 92 - 30 = 62
    });
  });

  it("returns null for a transport selection that resolves to no transport", () => {
    const { app } = makeApp({ selected: { type: "transport" } as GameApp["selected"], transport: null });
    expect(selectedScreenRect(app)).toBeNull();
  });

  it("computes the rect for a selected transport using its top floor", () => {
    const transport = { x: 8, width: 4, top: 25 };
    const { app } = makeApp({ selected: { type: "transport" } as GameApp["selected"], transport });

    expect(selectedScreenRect(app)).toEqual({
      x: worldToScreenX(8), // 16
      y: worldToScreenY(25), // 75
      w: worldToScreenX(8 + 4) - worldToScreenX(8), // 24 - 16 = 8
    });
  });
});
