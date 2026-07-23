import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { FACILITIES } from "../engine/facilities";
import { snapX, brushTiles } from "../ui/placement";
import type { GameMode } from "../engine/types";
import type { GameApp } from "../main";
import {
  pickedAt,
  placeSimpleBuild,
  isTransportTool,
  isPaintTool,
  updateBuildPreview,
  updateBuildRefusal,
  clearBuildRefusal,
  touchBuildLiftFloors,
} from "./buildPreview";

/**
 * Colocated unit tests for the build-preview / placement / pick-resolution
 * friend functions. `pickedAt`, `placeSimpleBuild`, and `isTransportTool` run
 * against the real (headless) Simulation so the tower geometry is real; the
 * ui/engine/build ports are minimal fakes. Mirrors the fixture idiom in
 * src/tests/integration/gameControllers.integration.test.ts.
 */

/** A tower with a lobby strip, a floor strip above it, one office, and one
 *  standard elevator, asserting every placement so a silent fixture failure
 *  can't make an assertion below pass for the wrong reason. */
function fixture(mode: GameMode = "classic") {
  const sim = new Simulation(12345, mode);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 12);
  expect(r.ok).toBe(true);
  const office = sim.tower.units.find((u) => u.id === r.unitId)!;
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  const lift = sim.tower.transports[sim.tower.transports.length - 1];
  return { sim, office, lift };
}

/** A recording `app.ui`/`app.engine` and a hand-built `app.build`; only the
 *  fields the module under test reads are present. */
function makeApp(
  sim: Simulation,
  tool: GameApp["tool"],
  overrides: Partial<{
    build: Record<string, ReturnType<typeof vi.fn>>;
    buildRefusalShowing: boolean;
  }> = {},
) {
  const showInspector = vi.fn();
  const engine = {
    preview: null as unknown,
    transportPreview: null as unknown,
  };
  const app = {
    sim,
    tool,
    engine,
    ui: { showInspector },
    build: overrides.build ?? {},
    inspectAnchor: null as unknown,
    buildRefusalShowing: overrides.buildRefusalShowing ?? false,
  };
  return { app: app as unknown as GameApp, raw: app, showInspector, engine };
}

const buildTool = (kind: string): GameApp["tool"] =>
  ({ type: "build", kind }) as unknown as GameApp["tool"];

describe("pickedAt", () => {
  it("resolves a room unit at its cell", () => {
    const { sim, office } = fixture();
    const { app } = makeApp(sim, buildTool("office"));
    expect(pickedAt(app, office.floor, office.x)).toEqual({
      type: "unit",
      id: office.id,
      kind: "office",
    });
  });

  it("resolves a transport by its stored width and span", () => {
    const { sim, lift } = fixture();
    const { app } = makeApp(sim, buildTool("office"));
    // A cell inside the shaft's stored footprint resolves the transport.
    const got = pickedAt(app, lift.bottom, lift.x + lift.width - 1);
    expect(got).toEqual({ type: "transport", id: lift.id, kind: lift.kind });
    // One column past the stored width is outside the pick zone.
    expect(pickedAt(app, lift.bottom, lift.x + lift.width)).toBeNull();
  });

  it("returns null for empty cells and for floor/lobby structure", () => {
    const { sim } = fixture();
    const { app } = makeApp(sim, buildTool("office"));
    expect(pickedAt(app, 8, 0)).toBeNull(); // empty air
    expect(pickedAt(app, 1, 25)).toBeNull(); // a bare lobby cell is not pickable
  });
});

describe("placeSimpleBuild", () => {
  it("paint: reports ok from paintBrush placed count and passes the reason through", () => {
    const { sim } = fixture();
    const paintBrush = vi.fn(() => ({ placed: 3, reason: undefined }));
    const { app } = makeApp(sim, buildTool("floor"), { build: { paintBrush } });
    expect(placeSimpleBuild(app, "floor", 14, 2)).toEqual({ what: "paint", ok: true, reason: undefined });
    expect(paintBrush).toHaveBeenCalledWith("floor", 14, 2);

    const paintBrush0 = vi.fn(() => ({ placed: 0, reason: "Floor already built here" }));
    const { app: app2 } = makeApp(sim, buildTool("floor"), { build: { paintBrush: paintBrush0 } });
    expect(placeSimpleBuild(app2, "floor", 14, 2)).toEqual({
      what: "paint",
      ok: false,
      reason: "Floor already built here",
    });
  });

  it("flight: routes a fixed-span transport through tryBuildTransport across two floors", () => {
    const { sim } = fixture();
    const tryBuildTransport = vi.fn(() => ({ ok: true, reason: "" }));
    const { app } = makeApp(sim, buildTool("stairs"), { build: { tryBuildTransport } });
    expect(placeSimpleBuild(app, "stairs", 14, 3)).toEqual({ what: "flight", ok: true, reason: "" });
    expect(tryBuildTransport).toHaveBeenCalledWith("stairs", snapX("stairs", 14), 3, 4);
  });

  it("room: reports ok from the tower unit-count delta", () => {
    const { sim } = fixture();
    const before0 = sim.tower.units.length;
    const tryBuild = vi.fn((kind: string, floor: number, x: number) => {
      sim.build(kind as never, floor, x);
    });
    const { app } = makeApp(sim, buildTool("office"), { build: { tryBuild } });
    const out = placeSimpleBuild(app, "office", 21, 2);
    expect(out).toEqual({ what: "room", ok: true });
    expect(sim.tower.units.length).toBe(before0 + 1);
    expect(tryBuild).toHaveBeenCalledWith("office", 2, snapX("office", 21));
  });

  it("null: a drag-sized shaft is left to the caller's anchor gesture", () => {
    const { sim } = fixture();
    const { app } = makeApp(sim, buildTool("elevatorStandard"), { build: {} });
    expect(placeSimpleBuild(app, "elevatorStandard", 14, 2)).toBeNull();
  });
});

describe("isTransportTool / isPaintTool", () => {
  it("isTransportTool is true for a transport build tool, false otherwise", () => {
    const { sim } = fixture();
    expect(isTransportTool(makeApp(sim, buildTool("elevatorStandard")).app)).toBe(true);
    expect(isTransportTool(makeApp(sim, buildTool("stairs")).app)).toBe(true);
    expect(isTransportTool(makeApp(sim, buildTool("office")).app)).toBe(false);
    expect(isTransportTool(makeApp(sim, { type: "inspect" } as unknown as GameApp["tool"]).app)).toBe(false);
  });

  it("isPaintTool is true only for the drag-paint kinds", () => {
    const { sim } = fixture();
    for (const k of ["floor", "lobby", "parking"]) {
      expect(isPaintTool(makeApp(sim, buildTool(k)).app)).toBe(true);
    }
    expect(isPaintTool(makeApp(sim, buildTool("office")).app)).toBe(false);
    expect(isPaintTool(makeApp(sim, buildTool("elevatorStandard")).app)).toBe(false);
    expect(isPaintTool(makeApp(sim, { type: "bulldoze" } as unknown as GameApp["tool"]).app)).toBe(false);
  });
});

describe("updateBuildPreview", () => {
  it("clears both previews and any refusal when the tool is not a build tool", () => {
    const { sim } = fixture();
    const { app, raw, showInspector } = makeApp(sim, { type: "inspect" } as unknown as GameApp["tool"], {
      buildRefusalShowing: true,
    });
    raw.engine.preview = { anything: true };
    raw.engine.transportPreview = { anything: true };
    updateBuildPreview(app, 12, 2);
    expect(raw.engine.preview).toBeNull();
    expect(raw.engine.transportPreview).toBeNull();
    expect(raw.buildRefusalShowing).toBe(false);
    expect(showInspector).toHaveBeenLastCalledWith(null);
  });

  it("fixed-span transport: sets the two-floor transportPreview with real validity, clears preview", () => {
    const { sim } = fixture();
    const { app, raw } = makeApp(sim, buildTool("stairs"));
    const x = snapX("stairs", 14);
    const expectedValid = sim.isUnlocked("stairs") && sim.tower.placeTransportDryRun("stairs", x, 3, 4);
    updateBuildPreview(app, 14, 3);
    expect(raw.engine.transportPreview).toEqual({ kind: "stairs", x, bottom: 3, top: 4, valid: expectedValid });
    expect(raw.engine.preview).toBeNull();
  });

  it("drag-sized transport: sets a single-floor preview keyed to unlock, clears transportPreview", () => {
    const { sim } = fixture();
    const { app, raw } = makeApp(sim, buildTool("elevatorStandard"));
    const x = snapX("elevatorStandard", 14);
    updateBuildPreview(app, 14, 2);
    expect(raw.engine.preview).toEqual({ kind: "elevatorStandard", floor: 2, x, valid: sim.isUnlocked("elevatorStandard") });
    expect(raw.engine.transportPreview).toBeNull();
  });

  it("floor brush: previews the centered strip span and never a transportPreview", () => {
    const { sim } = fixture();
    const { app, raw, showInspector } = makeApp(sim, buildTool("floor"));
    const tiles = brushTiles(14);
    const left = tiles[0];
    const span = tiles[tiles.length - 1] - left + 1;
    updateBuildPreview(app, 14, 3);
    const preview = raw.engine.preview as { kind: string; floor: number; x: number; span: number };
    expect(preview.kind).toBe("floor");
    expect(preview.floor).toBe(3);
    expect(preview.x).toBe(left);
    expect(preview.span).toBe(span);
    expect(raw.engine.transportPreview).toBeNull();
    // Classic never surfaces the refusal reason, so no inspector card is shown.
    expect(showInspector).not.toHaveBeenCalledWith(expect.anything());
  });

  it("room (Classic): a valid cell previews valid with no reason and no refusal card", () => {
    const { sim } = fixture("classic");
    const { app, raw, showInspector } = makeApp(sim, buildTool("office"));
    const x = snapX("office", 21);
    updateBuildPreview(app, 21, 2); // floor-2 strip supports an office here
    expect(raw.engine.preview).toEqual({ kind: "office", floor: 2, x, valid: true, reason: undefined });
    expect(raw.buildRefusalShowing).toBe(false);
    expect(showInspector).not.toHaveBeenCalledWith(expect.anything());
  });

  it("room (Modern): an invalid cell surfaces the refusal reason and pins the inspector card", () => {
    const { sim } = fixture("modern");
    const { app, raw, showInspector } = makeApp(sim, buildTool("office"));
    // Floor 6 has no structure, so canBuild refuses and Modern shows why.
    const can = sim.canBuild("office", 6, snapX("office", 21));
    expect(can.ok).toBe(false);
    updateBuildPreview(app, 21, 6);
    const preview = raw.engine.preview as { valid: boolean; reason?: string };
    expect(preview.valid).toBe(false);
    expect(preview.reason).toBe(can.reason);
    expect(raw.buildRefusalShowing).toBe(true);
    expect(raw.inspectAnchor).toEqual({
      x: snapX("office", 21) + Math.floor(FACILITIES.office.width / 2),
      floor: 6,
    });
    expect(showInspector).toHaveBeenCalledWith(expect.anything());
  });

  it("room (Classic): an invalid cell previews invalid but withholds the reason and the card", () => {
    const { sim } = fixture("classic");
    const { app, raw, showInspector } = makeApp(sim, buildTool("office"));
    updateBuildPreview(app, 21, 6);
    const preview = raw.engine.preview as { valid: boolean; reason?: string };
    expect(preview.valid).toBe(false);
    expect(preview.reason).toBeUndefined();
    expect(raw.buildRefusalShowing).toBe(false);
    expect(showInspector).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe("updateBuildRefusal / clearBuildRefusal", () => {
  it("updateBuildRefusal with a reason anchors and pins the inspector card", () => {
    const { sim } = fixture();
    const { app, raw, showInspector } = makeApp(sim, buildTool("office"));
    updateBuildRefusal(app, "Not enough money.", 4, 17);
    expect(raw.inspectAnchor).toEqual({ x: 17, floor: 4 });
    expect(raw.buildRefusalShowing).toBe(true);
    expect(showInspector).toHaveBeenCalledWith(expect.anything());
  });

  it("updateBuildRefusal with no reason falls through to clearBuildRefusal", () => {
    const { sim } = fixture();
    const { app, raw, showInspector } = makeApp(sim, buildTool("office"), { buildRefusalShowing: true });
    raw.inspectAnchor = { x: 1, floor: 1 };
    updateBuildRefusal(app, undefined, 4, 17);
    expect(raw.buildRefusalShowing).toBe(false);
    expect(raw.inspectAnchor).toBeNull();
    expect(showInspector).toHaveBeenLastCalledWith(null);
  });

  it("clearBuildRefusal only clears when the build path owns the card", () => {
    const { sim } = fixture();
    // Not showing: a live inspect-tool card must not be stomped.
    const notShowing = makeApp(sim, buildTool("office"), { buildRefusalShowing: false });
    notShowing.raw.inspectAnchor = { x: 9, floor: 9 };
    clearBuildRefusal(notShowing.app);
    expect(notShowing.showInspector).not.toHaveBeenCalled();
    expect(notShowing.raw.inspectAnchor).toEqual({ x: 9, floor: 9 });

    // Showing: the build path clears its own card.
    const showing = makeApp(sim, buildTool("office"), { buildRefusalShowing: true });
    showing.raw.inspectAnchor = { x: 9, floor: 9 };
    clearBuildRefusal(showing.app);
    expect(showing.showInspector).toHaveBeenCalledWith(null);
    expect(showing.raw.inspectAnchor).toBeNull();
    expect(showing.raw.buildRefusalShowing).toBe(false);
  });
});

describe("touchBuildLiftFloors — a capped, zoom-aware lift", () => {
  const liftAt = (zoom: number) =>
    touchBuildLiftFloors({ engine: { cam: { zoom } } } as unknown as GameApp);

  it("lifts at least one floor when zoomed in (a fingertip is under a floor tall there)", () => {
    expect(liftAt(5)).toBe(1);
    expect(liftAt(1)).toBe(1);
  });

  it("caps the lift when zoomed out, so the ghost never drifts far up the tower", () => {
    // Uncapped, a fingertip of screen distance is many floors at whole-tower zoom.
    expect(liftAt(0.06)).toBe(2);
    expect(liftAt(0.1)).toBe(2);
  });

  it("stays within [1, 2] floors across the whole zoom range", () => {
    for (const z of [0.06, 0.1, 0.3, 0.5, 1, 2, 3]) {
      const n = liftAt(z);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
  });
});
