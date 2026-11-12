import { afterEach, describe, expect, it, vi } from "vitest";
import { useTowerCatalogSource } from "../catalog/towerCatalog";
import type { GameMode } from "../shared/types";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { code, mockPort, record } from "../tests/portKit/mockPort";
import { brushTiles, snapX } from "../ui/placement";
import type { GameApp } from "../main";
import {
  clearBuildRefusal,
  isPaintTool,
  isTransportTool,
  pickedAt,
  placeSimpleBuild,
  touchBuildLiftFloors,
  updateBuildPreview,
  updateBuildRefusal,
} from "./buildPreview";

/**
 * The build preview, placement and pick resolution over a mock port and a
 * hand-built view: the quotes it asks for, the reads it makes, and the ghost
 * it draws from the answers. The same paths on the Rust engine's own geometry
 * and quotes are in `src/tests/integration/buildPreview.integration.test.ts`.
 */

const CAT = catalogFor("classic");
const price = (key: string, mode: GameMode = "classic") => catalogFor(mode).facilities.find((f) => f.key === key)!.cost;
/** One bare ground-floor tile of the Floor tool: a lobby with the floor it lays. */
const BARE_LOBBY = price("lobby") + price("floor");

/** A view of a tower: built structure by `floor:x`, rooms by the cells they
 *  cover, and shafts with their stored width. */
interface Tower {
  structure?: Record<string, string>;
  rooms?: Record<string, { id: number; kind: string }>;
  transports?: { id: number; kind: string; x: number; width: number; bottom: number; top: number }[];
  money?: number;
  mode?: GameMode;
  unlocked?: boolean;
}

/** `floor:x` keys for a run of tiles on one floor. */
const run = (floor: number, from: number, to: number, kind: string): Record<string, string> =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`${floor}:${from + i}`, kind]));

function viewOf(t: Tower) {
  const structure = t.structure ?? {};
  const at = (floor: number, x: number) => structure[`${floor}:${x}`];
  return {
    header: { mode: t.mode ?? "classic", money: t.money ?? 1e9 },
    unlocked: vi.fn(() => t.unlocked ?? true),
    roomAt: vi.fn((floor: number, x: number) => t.rooms?.[`${floor}:${x}`]),
    structureBeside: vi.fn((floor: number, x: number, dir: -1 | 1) => {
      for (let tx = x + dir; tx >= 0 && tx < 400; tx += dir) if (at(floor, tx)) return { kind: at(floor, tx), x: tx };
      return undefined;
    }),
    tower: {
      unitAt: vi.fn((floor: number, x: number) => t.rooms?.[`${floor}:${x}`]),
      transports: t.transports ?? [],
      structureKindAt: vi.fn(at),
    },
  };
}

/** The app over a mock port whose quotes answer `quote` (by tile) and `shaftOk`. */
function makeApp(
  tool: GameApp["tool"],
  tower: Tower = {},
  answers: { quote?: (x: number) => { ok: boolean; cost: number }; shaftOk?: boolean; reason?: string; height?: number; rise?: number } = {},
  build: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const enginePort = mockPort({
    quoteBuild: vi.fn((_kind: number, _floor: number, x: number) => {
      const q = answers.quote?.(x) ?? { ok: true, cost: 0 };
      return record("quoteBuild", { ok: q.ok ? 1 : 0, cost: q.cost });
    }),
    quoteShaft: () => record("quoteShaft", { ok: answers.shaftOk === false ? 0 : 1 }),
    lastReason: () => answers.reason,
    setLobbyHeight: vi.fn(),
    lobbyRise: vi.fn(() => answers.rise ?? 1),
  });
  const showInspector = vi.fn();
  const app = {
    enginePort,
    portCodes: new PortCodes(mockPort()),
    reader: viewOf(tower),
    tool,
    engine: { preview: null as unknown, transportPreview: null as unknown },
    ui: { showInspector },
    build,
    inspectAnchor: null as unknown,
    buildRefusalShowing: false,
    lobbyHeight: { height: answers.height ?? 1 },
  };
  return { app: app as unknown as GameApp, raw: app, showInspector, enginePort };
}

const buildTool = (kind: string): GameApp["tool"] => ({ type: "build", kind }) as unknown as GameApp["tool"];
const inspectTool = { type: "inspect" } as unknown as GameApp["tool"];

/** Run `body` with the engine's catalog for `app` swapped for one with `previewNamesRefusal` set. */
function withRefusalRule(app: GameApp, previewNamesRefusal: boolean, body: () => void): void {
  useTowerCatalogSource(app.enginePort, (m) => {
    const base = catalogFor(m);
    return { ...base, rules: { ...base.rules, previewNamesRefusal } };
  });
  try {
    body();
  } finally {
    useTowerCatalogSource(app.enginePort, null);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("pickedAt", () => {
  it("resolves the room the view answers at a cell, and no structure tile", () => {
    const { app, raw } = makeApp(buildTool("office"), { rooms: { "2:12": { id: 5, kind: "office" }, "1:25": { id: 0, kind: "lobby" } } });
    expect(pickedAt(app, 2, 12)).toEqual({ type: "unit", id: 5, kind: "office" });
    expect(raw.reader.tower.unitAt).toHaveBeenLastCalledWith(2, 12);
    expect(pickedAt(app, 1, 25), "a lobby tile is not pickable").toBeNull();
    expect(pickedAt(app, 8, 0)).toBeNull();
  });

  it("resolves a transport by its stored width and span", () => {
    const lift = { id: 9, kind: "elevatorStandard", x: 10, width: 4, bottom: 1, top: 3 };
    const { app } = makeApp(buildTool("office"), { transports: [lift] });
    expect(pickedAt(app, 3, 13)).toEqual({ type: "transport", id: 9, kind: "elevatorStandard" });
    expect(pickedAt(app, 3, 14), "one column past the stored width").toBeNull();
    expect(pickedAt(app, 4, 10), "one floor past the top").toBeNull();
  });
});

describe("placeSimpleBuild", () => {
  it("paint: reports ok from the brush's placed count and passes the reason through", () => {
    const paintBrush = vi.fn().mockReturnValueOnce({ placed: 3 }).mockReturnValueOnce({ placed: 0, reason: "Floor already built here" });
    const { app } = makeApp(buildTool("floor"), {}, {}, { paintBrush });
    expect(placeSimpleBuild(app, "floor", 14, 2)).toEqual({ what: "paint", ok: true, reason: undefined });
    expect(paintBrush).toHaveBeenCalledWith("floor", 14, 2);
    expect(placeSimpleBuild(app, "floor", 14, 2)).toEqual({ what: "paint", ok: false, reason: "Floor already built here" });
  });

  it("flight: routes a fixed-span transport through tryBuildTransport across two floors", () => {
    const tryBuildTransport = vi.fn(() => ({ ok: true, reason: "" }));
    const { app } = makeApp(buildTool("stairs"), {}, {}, { tryBuildTransport });
    expect(placeSimpleBuild(app, "stairs", 14, 3)).toEqual({ what: "flight", ok: true, reason: "" });
    expect(tryBuildTransport).toHaveBeenCalledExactlyOnceWith("stairs", snapX(CAT, "stairs", 14), 3, 4);
  });

  it("room: builds at the snapped column and reports the engine's answer", () => {
    const tryBuild = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const { app } = makeApp(buildTool("office"), {}, {}, { tryBuild });
    expect(placeSimpleBuild(app, "office", 21, 2)).toEqual({ what: "room", ok: true });
    expect(tryBuild).toHaveBeenCalledWith("office", 2, snapX(CAT, "office", 21));
    expect(placeSimpleBuild(app, "office", 21, 2)).toEqual({ what: "room", ok: false });
  });

  it("null: a drag-sized shaft is left to the caller's anchor gesture", () => {
    const { app } = makeApp(buildTool("elevatorStandard"));
    expect(placeSimpleBuild(app, "elevatorStandard", 14, 2)).toBeNull();
  });
});

describe("isTransportTool / isPaintTool", () => {
  it("isTransportTool is true for a transport build tool, false otherwise", () => {
    expect(isTransportTool(makeApp(buildTool("elevatorStandard")).app)).toBe(true);
    expect(isTransportTool(makeApp(buildTool("stairs")).app)).toBe(true);
    expect(isTransportTool(makeApp(buildTool("office")).app)).toBe(false);
    expect(isTransportTool(makeApp(inspectTool).app)).toBe(false);
  });

  it("isPaintTool is true only for the drag-paint kinds", () => {
    for (const k of ["floor", "lobby", "parking"]) expect(isPaintTool(makeApp(buildTool(k)).app)).toBe(true);
    expect(isPaintTool(makeApp(buildTool("office")).app)).toBe(false);
    expect(isPaintTool(makeApp(buildTool("elevatorStandard")).app)).toBe(false);
    expect(isPaintTool(makeApp({ type: "bulldoze" } as unknown as GameApp["tool"]).app)).toBe(false);
  });
});

describe("updateBuildPreview", () => {
  it("clears both previews and any refusal when the tool is not a build tool", () => {
    const { app, raw, showInspector, enginePort } = makeApp(inspectTool);
    raw.buildRefusalShowing = true;
    raw.engine.preview = { anything: true };
    raw.engine.transportPreview = { anything: true };
    updateBuildPreview(app, 12, 2);
    expect([raw.engine.preview, raw.engine.transportPreview, raw.buildRefusalShowing]).toEqual([null, null, false]);
    expect(showInspector).toHaveBeenLastCalledWith(null);
    expect(enginePort.quoteBuild).not.toHaveBeenCalled();
  });

  it("fixed-span transport: quotes the two-floor span and needs the unlock too", () => {
    const x = snapX(CAT, "stairs", 14);
    for (const [shaftOk, unlocked, valid] of [
      [true, true, true],
      [false, true, false],
      [true, false, false],
    ] as const) {
      const { app, raw, enginePort } = makeApp(buildTool("stairs"), { unlocked }, { shaftOk });
      updateBuildPreview(app, 14, 3);
      expect(raw.engine.transportPreview).toEqual({ kind: "stairs", x, bottom: 3, top: 4, valid });
      expect(raw.engine.preview).toBeNull();
      if (unlocked) expect(enginePort.quoteShaft).toHaveBeenCalledExactlyOnceWith(code("kinds", "stairs"), x, 3, 4);
    }
  });

  it("drag-sized transport: a single-floor ghost keyed to the unlock, with no quote", () => {
    const { app, raw, enginePort } = makeApp(buildTool("elevatorStandard"), { unlocked: false });
    updateBuildPreview(app, 14, 2);
    expect(raw.engine.preview).toEqual({ kind: "elevatorStandard", floor: 2, x: snapX(CAT, "elevatorStandard", 14), valid: false });
    expect(raw.engine.transportPreview).toBeNull();
    expect(enginePort.quoteShaft).not.toHaveBeenCalled();
  });

  it("snaps to the engine's catalog when the engine installed one", () => {
    const { app, raw } = makeApp(buildTool("office"));
    updateBuildPreview(app, 399, 2);
    const own = (raw.engine.preview as { x: number }).x;
    expect(own).toBe(snapX(CAT, "office", 399));
    useTowerCatalogSource(app.enginePort, (mode) => {
      const base = catalogFor(mode);
      return { ...base, facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, width: f.width + 2 } : f)) };
    });
    try {
      updateBuildPreview(app, 399, 2);
      expect((raw.engine.preview as { x: number }).x).toBe(own - 2);
    } finally {
      useTowerCatalogSource(app.enginePort, null);
    }
  });

  it("room: the quote decides the ghost, and the catalog's rule whether the reason and card show", () => {
    const x = snapX(CAT, "office", 21);
    const width = CAT.facilities.find((f) => f.key === "office")!.width;
    for (const previewNamesRefusal of [true, false]) {
      const { app, raw, showInspector, enginePort } = makeApp(
        buildTool("office"),
        {},
        { quote: () => ({ ok: false, cost: 0 }), reason: "No floor here." },
      );
      withRefusalRule(app, previewNamesRefusal, () => updateBuildPreview(app, 21, 6));
      expect(enginePort.quoteBuild).toHaveBeenCalledExactlyOnceWith(code("kinds", "office"), 6, x);
      const reason = previewNamesRefusal ? "No floor here." : undefined;
      expect(raw.engine.preview, `rule ${previewNamesRefusal}`).toEqual({ kind: "office", floor: 6, x, valid: false, reason });
      expect(raw.buildRefusalShowing).toBe(previewNamesRefusal);
      expect(raw.inspectAnchor).toEqual(
        previewNamesRefusal ? { x: x + Math.floor(width / 2), left: x + Math.floor(width / 2), floor: 6 } : null,
      );
      expect(showInspector).toHaveBeenCalledTimes(previewNamesRefusal ? 1 : 0);
    }
    const { app, raw } = makeApp(buildTool("office"));
    updateBuildPreview(app, 21, 2);
    expect(raw.engine.preview).toEqual({ kind: "office", floor: 2, x, valid: true, reason: undefined });
  });

  it("floor brush: previews the centered strip and quotes the tile against the tower", () => {
    const tiles = brushTiles(14);
    const { app, raw, enginePort } = makeApp(buildTool("floor"), { structure: { ...run(1, 0, 40, "lobby"), ...run(2, 12, 13, "floor") } });
    updateBuildPreview(app, 14, 2);
    expect(raw.engine.preview).toMatchObject({
      kind: "floor",
      floor: 2,
      x: tiles[0],
      span: tiles[tiles.length - 1] - tiles[0] + 1,
      valid: true,
    });
    expect(raw.engine.transportPreview).toBeNull();
    // The brush lays 10..17 over built floor at 12..13: the tile laid beside
    // it on the left (11) is quoted, then the run past it (from 14), since the
    // built floor stops the first quote's scan right.
    expect(vi.mocked(enginePort.quoteBuild).mock.calls).toEqual([
      [code("kinds", "floor"), 2, 11],
      [code("kinds", "floor"), 2, 14],
    ]);
  });

  it("the ground-floor ghost is a lobby, green only when the money covers every tile the brush lays", () => {
    // Lobby on 10..29; the brush at 30 lays 30..33, four bare tiles.
    const tower = { structure: run(1, 10, 29, "lobby") };
    const validWith = (money: number) => {
      const { app, raw, enginePort } = makeApp(buildTool("floor"), { ...tower, money }, { quote: () => ({ ok: true, cost: BARE_LOBBY }) });
      updateBuildPreview(app, 30, 1);
      expect(enginePort.quoteBuild).toHaveBeenCalledExactlyOnceWith(code("kinds", "lobby"), 1, 30);
      return raw.engine.preview as { kind: string; valid: boolean };
    };
    expect(validWith(4 * BARE_LOBBY)).toMatchObject({ kind: "lobby", valid: true });
    expect(validWith(4 * BARE_LOBBY - 1)).toMatchObject({ kind: "lobby", valid: false });
  });

  it("a tall lobby's ghost covers every story it rises and prices the lobby per story (#308)", () => {
    // Lobby on 10..29; the brush at 30 lays 30..33, four bare tiles, each
    // the lobby price twice over and its floor once.
    const tower = { structure: run(1, 10, 29, "lobby") };
    const tall = BARE_LOBBY + price("lobby");
    const ghostWith = (money: number) => {
      const { app, raw, enginePort } = makeApp(buildTool("lobby"), { ...tower, money }, { quote: () => ({ ok: true, cost: tall }), height: 2, rise: 2 });
      updateBuildPreview(app, 30, 1);
      expect(enginePort.setLobbyHeight).toHaveBeenCalledExactlyOnceWith(2);
      const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
      expect(order(enginePort.setLobbyHeight)).toBeLessThan(order(enginePort.quoteBuild));
      expect(enginePort.lobbyRise).toHaveBeenCalledExactlyOnceWith(1);
      return raw.engine.preview as { valid: boolean; stories: number };
    };
    expect(ghostWith(4 * tall)).toMatchObject({ valid: true, stories: 2 });
    expect(ghostWith(4 * tall - 1)).toMatchObject({ valid: false, stories: 2 });
  });

  it("the Floor tool's ground ghost asks one story, whatever the Lobby card holds (#308)", () => {
    const tower = { structure: run(1, 10, 29, "lobby"), money: 1e9 };
    const { app, raw, enginePort } = makeApp(buildTool("floor"), tower, { height: 3, rise: 1 });
    updateBuildPreview(app, 30, 1);
    expect(enginePort.setLobbyHeight).toHaveBeenCalledExactlyOnceWith(1);
    expect(raw.engine.preview).toMatchObject({ kind: "lobby", stories: 1 });
  });

  it("counts a quoted bridge past the brush's end in the strip's price", () => {
    // Lobby on 10..29; the brush at 35 lays 31..38, detached, and its quote
    // bridges tile 30 back to the lobby: one more bare tile than the brush.
    const tower = { structure: run(1, 10, 29, "lobby") };
    const quote = () => ({ ok: true, cost: 2 * BARE_LOBBY });
    const validWith = (money: number) => {
      const { app, raw } = makeApp(buildTool("floor"), { ...tower, money }, { quote });
      updateBuildPreview(app, 35, 1);
      expect(raw.reader.structureBeside).toHaveBeenCalledWith(1, 31, -1);
      return (raw.engine.preview as { valid: boolean }).valid;
    };
    expect([validWith(9 * BARE_LOBBY), validWith(9 * BARE_LOBBY - 1)]).toEqual([true, false]);
  });

  it("names the refusal on a refused strip as the catalog's rule says: money short, or the engine's reason", () => {
    const tower = { structure: run(1, 10, 29, "lobby"), money: 1 };
    for (const previewNamesRefusal of [true, false]) {
      const short = makeApp(buildTool("floor"), tower, { quote: () => ({ ok: true, cost: BARE_LOBBY }) });
      withRefusalRule(short.app, previewNamesRefusal, () => updateBuildPreview(short.app, 30, 1));
      expect((short.raw.engine.preview as { reason?: string }).reason).toBe(previewNamesRefusal ? "Not enough money." : undefined);
      // A structural refusal wins over money short: the engine's reason.
      const refused = makeApp(buildTool("floor"), tower, { quote: () => ({ ok: false, cost: 0 }), reason: "Build floors below first." });
      withRefusalRule(refused.app, previewNamesRefusal, () => updateBuildPreview(refused.app, 21, 6));
      expect(refused.raw.engine.preview).toMatchObject({
        kind: "floor",
        valid: false,
        reason: previewNamesRefusal ? "Build floors below first." : undefined,
      });
    }
  });

  it("a brush that lays nothing is never green", () => {
    const { app, raw } = makeApp(buildTool("floor"), { structure: run(1, 0, 60, "lobby") });
    updateBuildPreview(app, 30, 1);
    expect((raw.engine.preview as { valid: boolean }).valid).toBe(false);
  });
});

describe("updateBuildRefusal / clearBuildRefusal", () => {
  it("updateBuildRefusal with a reason anchors and pins the inspector card", () => {
    const { app, raw, showInspector } = makeApp(buildTool("office"));
    updateBuildRefusal(app, "Not enough money.", 4, 17);
    expect(raw.inspectAnchor).toEqual({ x: 17, left: 17, floor: 4 });
    expect(raw.buildRefusalShowing).toBe(true);
    expect(showInspector).toHaveBeenCalledWith(expect.anything());
  });

  it("updateBuildRefusal with no reason falls through to clearBuildRefusal", () => {
    const { app, raw, showInspector } = makeApp(buildTool("office"));
    raw.buildRefusalShowing = true;
    raw.inspectAnchor = { x: 1, left: 1, floor: 1 };
    updateBuildRefusal(app, undefined, 4, 17);
    expect(raw.buildRefusalShowing).toBe(false);
    expect(raw.inspectAnchor).toBeNull();
    expect(showInspector).toHaveBeenLastCalledWith(null);
  });

  it("clearBuildRefusal only clears when the build path owns the card", () => {
    const notShowing = makeApp(buildTool("office"));
    notShowing.raw.inspectAnchor = { x: 9, floor: 9 };
    clearBuildRefusal(notShowing.app);
    expect(notShowing.showInspector).not.toHaveBeenCalled();
    expect(notShowing.raw.inspectAnchor).toEqual({ x: 9, floor: 9 });

    const showing = makeApp(buildTool("office"));
    showing.raw.buildRefusalShowing = true;
    showing.raw.inspectAnchor = { x: 9, floor: 9 };
    clearBuildRefusal(showing.app);
    expect(showing.showInspector).toHaveBeenCalledWith(null);
    expect(showing.raw.inspectAnchor).toBeNull();
    expect(showing.raw.buildRefusalShowing).toBe(false);
  });
});

describe("touchBuildLiftFloors: a capped, zoom-aware lift", () => {
  const liftAt = (zoom: number) => touchBuildLiftFloors({ engine: { cam: { zoom } } } as unknown as GameApp);

  it("lifts at least one floor when zoomed in (a fingertip is under a floor tall there)", () => {
    expect(liftAt(5)).toBe(1);
    expect(liftAt(1)).toBe(1);
  });

  it("caps the lift when zoomed out, so the ghost never drifts far up the tower", () => {
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
