import { describe, it, expect, vi } from "vitest";
import { catalogFor } from "../catalogFixture";
import { useTowerCatalogSource } from "../../catalog/towerCatalog";
import { snapX } from "../../ui/placement";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import type { GameMode } from "../../shared/types";
import type { GameApp } from "../../main";
import { newViewReader, quoteShaft } from "../../game/portAccess";
import { LOT_WIDTH } from "../portKit/draftFixtures";
import { look, newEngine, noEngine } from "../portKit/rustEngine";
import { pickedAt, placeSimpleBuild, updateBuildPreview } from "../../game/buildPreview";

const CAT = catalogFor("classic");
/** A kind's price and width in the engine's catalog for `mode`. */
const facility = (key: string, mode: GameMode = "classic") => catalogFor(mode).facilities.find((f) => f.key === key)!;
const price = (key: string, mode: GameMode = "classic") => facility(key, mode).cost;

/**
 * The build preview on the Rust engine: the picks it resolves from the
 * engine's geometry, the ghost's price and refusal from the engine's quotes,
 * and a room build. The reads and the calls alone, on a mock port, are in
 * `src/game/buildPreview.test.ts`.
 */

interface Placed {
  readonly id: number;
  readonly kind: string;
  readonly floor: number;
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
}

/** A tower with a lobby strip, a floor strip above it, one office, and one
 *  standard elevator, asserting every placement so a silent fixture failure
 *  can't make an assertion below pass for the wrong reason. */
function fixture(mode: GameMode = "classic") {
  const engine = newEngine(12345, mode);
  const sim = look(engine);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 12);
  expect(r.ok).toBe(true);
  const office = sim.tower.units.find((u) => u.id === r.unitId) as unknown as Placed;
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  const lift = sim.tower.transports[sim.tower.transports.length - 1] as unknown as Placed;
  return { engine, sim, office, lift };
}

/** A recording `app.ui`/`app.engine` and a hand-built `app.build` over the
 *  engine's own port, reader and codes; only the fields the module under test
 *  reads are present. */
function makeApp(
  engine: EnginePort,
  tool: GameApp["tool"],
  overrides: Partial<{ build: Record<string, ReturnType<typeof vi.fn>>; buildRefusalShowing: boolean }> = {},
) {
  const showInspector = vi.fn();
  const view = { preview: null as unknown, transportPreview: null as unknown };
  const reader = newViewReader(engine);
  reader.update();
  const app = {
    enginePort: engine,
    portCodes: new PortCodes(engine),
    reader,
    tool,
    engine: view,
    ui: { showInspector },
    build: overrides.build ?? {},
    inspectAnchor: null as unknown,
    buildRefusalShowing: overrides.buildRefusalShowing ?? false,
  };
  return { app: app as unknown as GameApp, raw: app, showInspector, engine: view };
}

const buildTool = (kind: string): GameApp["tool"] => ({ type: "build", kind }) as unknown as GameApp["tool"];

describe.skipIf(noEngine)("pickedAt on the engine's geometry", () => {
  it("resolves a room unit at its cell", () => {
    const { engine, office } = fixture();
    const { app } = makeApp(engine, buildTool("office"));
    expect(pickedAt(app, office.floor, office.x)).toEqual({ type: "unit", id: office.id, kind: "office" });
  });

  it("resolves a transport by its stored width and span", () => {
    const { engine, lift } = fixture();
    const { app } = makeApp(engine, buildTool("office"));
    // A cell inside the shaft's stored footprint resolves the transport.
    const got = pickedAt(app, lift.bottom, lift.x + lift.width - 1);
    expect(got).toEqual({ type: "transport", id: lift.id, kind: lift.kind });
    // One column past the stored width is outside the pick zone.
    expect(pickedAt(app, lift.bottom, lift.x + lift.width)).toBeNull();
  });

  it("resolves every story of a room taller than one floor, as the tower does", () => {
    const { engine, sim } = fixture();
    for (let x = 30; x < 80; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (const floor of [2, 3]) for (let x = 30; x < 80; x++) expect(sim.tower.place("floor", floor, x).ok).toBe(true);
    const r = sim.tower.place("cinema", 2, 40);
    expect(r.reason).toBeUndefined();
    const cinema = sim.tower.units.find((u) => u.id === r.unitId) as unknown as Placed;
    const { app } = makeApp(engine, buildTool("office"));
    const want = { type: "unit", id: cinema.id, kind: "cinema" };
    for (let floor = 2; floor <= 3; floor++) {
      expect(sim.tower.unitAt(floor, cinema.x)?.id).toBe(cinema.id);
      expect(pickedAt(app, floor, cinema.x), `floor ${floor}`).toEqual(want);
      expect(pickedAt(app, floor, cinema.x + cinema.width - 1), `floor ${floor}`).toEqual(want);
    }
    expect(pickedAt(app, 4, cinema.x)).toBeNull();
  });

  it("returns null for empty cells and for floor/lobby structure", () => {
    const { engine } = fixture();
    const { app } = makeApp(engine, buildTool("office"));
    expect(pickedAt(app, 8, 0)).toBeNull(); // empty air
    expect(pickedAt(app, 1, 25)).toBeNull(); // a bare lobby cell is not pickable
  });
});

describe.skipIf(noEngine)("placeSimpleBuild on the engine", () => {
  it("room: reports ok from the engine's answer to the build", () => {
    const { engine, sim } = fixture();
    const before0 = sim.tower.units.length;
    const tryBuild = vi.fn((kind: string, floor: number, x: number) => sim.build(kind as never, floor, x).ok);
    const { app } = makeApp(engine, buildTool("office"), { build: { tryBuild } });
    expect(placeSimpleBuild(app, "office", 21, 2)).toEqual({ what: "room", ok: true });
    expect(sim.tower.units.length).toBe(before0 + 1);
    expect(tryBuild).toHaveBeenCalledWith("office", 2, snapX(CAT, "office", 21));
    // A refused build (the same spot again) reports not placed.
    expect(placeSimpleBuild(app, "office", 21, 2)).toEqual({ what: "room", ok: false });
  });
});

describe.skipIf(noEngine)("updateBuildPreview on the engine's quotes", () => {
  it("snaps to the engine's catalog when the engine installed one", () => {
    const { engine } = fixture();
    const { app, raw } = makeApp(engine, buildTool("office"));
    const tile = LOT_WIDTH - 1;
    updateBuildPreview(app, tile, 2);
    const own = (raw.engine.preview as { x: number }).x;
    expect(own).toBe(snapX(CAT, "office", tile));
    useTowerCatalogSource(app.enginePort, (mode) => {
      const base = catalogFor(mode);
      return { ...base, facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, width: f.width + 2 } : f)) };
    });
    updateBuildPreview(app, tile, 2);
    expect((raw.engine.preview as { x: number }).x).toBe(own - 2);
  });

  it("fixed-span transport: sets the two-floor transportPreview with real validity, clears preview", () => {
    const { engine } = fixture();
    const { app, raw } = makeApp(engine, buildTool("stairs"));
    const x = snapX(CAT, "stairs", 14);
    const expectedValid = app.reader.unlocked("stairs") && quoteShaft(engine, app.portCodes, "stairs", x, 3, 4).ok;
    updateBuildPreview(app, 14, 3);
    expect(raw.engine.transportPreview).toEqual({ kind: "stairs", x, bottom: 3, top: 4, valid: expectedValid });
    expect(raw.engine.preview).toBeNull();
  });

  it("drag-sized transport: sets a single-floor preview keyed to unlock, clears transportPreview", () => {
    const { engine } = fixture();
    const { app, raw } = makeApp(engine, buildTool("elevatorStandard"));
    const x = snapX(CAT, "elevatorStandard", 14);
    updateBuildPreview(app, 14, 2);
    expect(raw.engine.preview).toEqual({ kind: "elevatorStandard", floor: 2, x, valid: app.reader.unlocked("elevatorStandard") });
    expect(raw.engine.transportPreview).toBeNull();
  });

  it("floor tool on the ground floor previews a LOBBY ghost (floor 1 is lobby-only)", () => {
    const { engine, sim } = fixture(); // lobby spans x=10..29 on floor 1
    sim.money = 10_000_000;
    const { app, raw } = makeApp(engine, buildTool("floor"));
    updateBuildPreview(app, 20, 1);
    const preview = raw.engine.preview as { kind: string; floor: number };
    expect(preview.kind).toBe("lobby"); // the Floor tool auto-converts on floor 1
    expect(preview.floor).toBe(1);
  });

  it("the ground-floor ghost goes invalid when the whole brush of lobby tiles is unaffordable", () => {
    const { engine, sim } = fixture(); // lobby spans x=10..29 on floor 1
    const { app, raw } = makeApp(engine, buildTool("floor"));
    // Tile 30 sits at the lobby's edge, so the anchor tile alone IS affordable (a
    // lobby with its floor). But the 8-wide brush would lay ~4 empty tiles past the
    // edge; a single-tile check would show green, the whole-brush guard must not.
    for (const [money, valid] of [
      [price("lobby") + price("floor"), false],
      [10_000_000, true],
    ] as const) {
      sim.money = money;
      app.reader.update();
      updateBuildPreview(app, 30, 1);
      const preview = raw.engine.preview as { kind: string; valid: boolean };
      expect([preview.kind, preview.valid], `with $${money}`).toEqual(["lobby", valid]);
    }
  });

  it("the ground-floor ghost prices only the tiles the Floor tool lays, skipping plain floor", () => {
    const { engine, sim } = fixture(); // lobby spans x=10..29 on floor 1
    expect(sim.tower.place("floor", 1, 30).ok).toBe(true); // plain floor, as an old save can hold: the Floor brush skips it
    const { app, raw } = makeApp(engine, buildTool("floor"));
    const validWith = (money: number, hover: number) => {
      sim.money = money;
      app.reader.update();
      updateBuildPreview(app, hover, 1);
      return (raw.engine.preview as { valid: boolean }).valid;
    };
    // At 31 the brush spans 27..34 (the plain floor, four bare tiles); at 30, 26..33 (its anchor on it, three bare).
    for (const [hover, bare] of [
      [31, 4],
      [30, 3],
    ]) {
      const strip = bare * (price("lobby") + price("floor"));
      expect([validWith(strip, hover), validWith(strip - 1, hover)], `at ${hover}`).toEqual([true, false]);
    }
    for (const x of [31, 32, 33]) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    expect(validWith(1e9, 30), "with those built too, a brush that lays nothing is never green").toBe(false);
  });

  it("floor brush: the catalog's previewNamesRefusal rule decides whether a refused strip says why, whatever the mode's name", () => {
    // Each mode with the rule on and off, so neither mode's name can stand in.
    // Three strips: one the player cannot afford, one they can, and one whose
    // anchor the engine refuses, which names the engine's own reason.
    for (const mode of ["classic", "modern"] as const) {
      for (const previewNamesRefusal of [true, false]) {
        const label = `${mode}, previewNamesRefusal ${previewNamesRefusal}`;
        const { engine, sim } = fixture(mode); // lobby spans x=10..29 on floor 1
        const { app, raw } = makeApp(engine, buildTool("floor"));
        useTowerCatalogSource(app.enginePort, (m) => {
          const base = catalogFor(m);
          return { ...base, rules: { ...base.rules, previewNamesRefusal } };
        });
        try {
          const price = (key: string) => catalogFor(mode).facilities.find((f) => f.key === key)!.cost;
          sim.money = price("lobby") + price("floor"); // one bare tile's price, short of the strip
          app.reader.update();
          updateBuildPreview(app, 30, 1);
          const preview = raw.engine.preview as { kind: string; valid: boolean; reason?: string };
          expect(preview.kind, label).toBe("lobby");
          expect(preview.valid, label).toBe(false);
          expect(preview.reason, label).toBe(previewNamesRefusal ? "Not enough money." : undefined);
          sim.money = 1_000_000_000;
          app.reader.update();
          updateBuildPreview(app, 30, 1);
          const affordable = raw.engine.preview as { valid: boolean; reason?: string };
          expect(affordable.valid, label).toBe(true);
          expect(affordable.reason, label).toBeUndefined();
          // Floor 6 has no structure, so the engine refuses the anchor for a
          // reason of its own, with money to spare.
          const can = sim.canBuild("floor", 6, snapX(CAT, "floor", 21));
          expect(typeof can.reason, label).toBe("string");
          expect(can.reason, label).not.toBe("Not enough money.");
          updateBuildPreview(app, 21, 6);
          const refused = raw.engine.preview as { kind: string; valid: boolean; reason?: string };
          expect(refused.kind, label).toBe("floor");
          expect(refused.valid, label).toBe(false);
          expect(refused.reason, label).toBe(previewNamesRefusal ? can.reason : undefined);
          // Structural rejection wins over insufficient money: a broke player
          // still needs the engine's explanation for an unsupported floor.
          sim.money = 1;
          app.reader.update();
          updateBuildPreview(app, 21, 6);
          const brokeAndUnsupported = raw.engine.preview as { valid: boolean; reason?: string };
          expect(brokeAndUnsupported.valid, label).toBe(false);
          expect(brokeAndUnsupported.reason, label).toBe(previewNamesRefusal ? can.reason : undefined);
        } finally {
          useTowerCatalogSource(app.enginePort, null);
        }
      }
    }
  });

  it("counts the auto-bridge gap-fill in the ground-floor ghost affordability (detached click)", () => {
    const { engine, sim } = fixture(); // lobby spans x=10..29 on floor 1; autoBridge on (classic)
    const { app, raw } = makeApp(engine, buildTool("floor"));
    // Hover past the lobby edge so the placement auto-bridges the gap with extra
    // lobby tiles. A naive estimate of 8 tiles, each a lobby with its floor, would
    // greenlight, but the real cost including the bridge run is higher, so the
    // ghost must be red rather than promise a run that only partial-builds.
    sim.money = 8 * (price("lobby") + price("floor"));
    app.reader.update();
    updateBuildPreview(app, 35, 1);
    expect((raw.engine.preview as { valid: boolean }).valid).toBe(false);
    // Ample money clears it.
    sim.money = 1_000_000;
    app.reader.update();
    updateBuildPreview(app, 35, 1);
    expect((raw.engine.preview as { valid: boolean }).valid).toBe(true);
  });

  it("room (Classic): a valid cell previews valid with no reason and no refusal card", () => {
    const { engine } = fixture("classic");
    const { app, raw, showInspector } = makeApp(engine, buildTool("office"));
    const x = snapX(CAT, "office", 21);
    updateBuildPreview(app, 21, 2); // floor-2 strip supports an office here
    expect(raw.engine.preview).toEqual({ kind: "office", floor: 2, x, valid: true, reason: undefined });
    expect(raw.buildRefusalShowing).toBe(false);
    expect(showInspector).not.toHaveBeenCalledWith(expect.anything());
  });

  it("room (Modern): an invalid cell surfaces the refusal reason and pins the inspector card", () => {
    const { engine, sim } = fixture("modern");
    const { app, raw, showInspector } = makeApp(engine, buildTool("office"));
    // Floor 6 has no structure, so canBuild refuses and Modern shows why.
    const can = sim.canBuild("office", 6, snapX(CAT, "office", 21));
    expect(can.ok).toBe(false);
    updateBuildPreview(app, 21, 6);
    const preview = raw.engine.preview as { valid: boolean; reason?: string };
    expect(preview.valid).toBe(false);
    expect(preview.reason).toBe(can.reason);
    expect(raw.buildRefusalShowing).toBe(true);
    expect(raw.inspectAnchor).toEqual({
      x: snapX(CAT, "office", 21) + Math.floor(facility("office").width / 2),
      left: snapX(CAT, "office", 21) + Math.floor(facility("office").width / 2),
      floor: 6,
    });
    expect(showInspector).toHaveBeenCalledWith(expect.anything());
  });

  it("room: the catalog's previewNamesRefusal rule decides whether the reason shows, whatever the mode's name", () => {
    // Each mode with the rule on and off, so neither mode's name can stand in.
    for (const mode of ["classic", "modern"] as const) {
      for (const previewNamesRefusal of [true, false]) {
        const label = `${mode}, previewNamesRefusal ${previewNamesRefusal}`;
        const { engine, sim } = fixture(mode);
        const { app, raw } = makeApp(engine, buildTool("office"));
        useTowerCatalogSource(app.enginePort, (m) => {
          const base = catalogFor(m);
          return { ...base, rules: { ...base.rules, previewNamesRefusal } };
        });
        try {
          const can = sim.canBuild("office", 6, snapX(CAT, "office", 21));
          // A refusal with a reason, so the rule-on case cannot pass on two
          // undefined values.
          expect(typeof can.reason, label).toBe("string");
          updateBuildPreview(app, 21, 6);
          const preview = raw.engine.preview as { valid: boolean; reason?: string };
          expect(preview.valid, label).toBe(false);
          expect(preview.reason, label).toBe(previewNamesRefusal ? can.reason : undefined);
        } finally {
          useTowerCatalogSource(app.enginePort, null);
        }
      }
    }
  });

  it("room (Classic): an invalid cell previews invalid but withholds the reason and the card", () => {
    const { engine } = fixture("classic");
    const { app, raw, showInspector } = makeApp(engine, buildTool("office"));
    updateBuildPreview(app, 21, 6);
    const preview = raw.engine.preview as { valid: boolean; reason?: string };
    expect(preview.valid).toBe(false);
    expect(preview.reason).toBeUndefined();
    expect(raw.buildRefusalShowing).toBe(false);
    expect(showInspector).not.toHaveBeenCalledWith(expect.anything());
  });
});
