import { afterEach, describe, expect, it, vi } from "vitest";
import type { WasmEngine } from "../../engineBinding/binding";
import type { GameApp } from "../../main";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import { ViewReader } from "../../simport/viewReader";
import { catalogOf, floorsOfPort, isUnlocked } from "../../game/portAccess";
import type { GameMode } from "../../shared/types";
import { catalogFacility, type Catalog } from "../../catalog/catalogTypes";
import { BuildActions } from "../../game/buildActions";
import { updateBuildPreview } from "../../game/buildPreview";
import { brushTiles } from "../../ui/placement";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

/**
 * Tall lobbies (#308) on the Rust engine the game ships: the height the Lobby
 * card or Ctrl / Ctrl+Shift picks reaches the engine before a preview or a
 * build, the ghost and the charge are the engine's price per story, and a
 * floor's first lobby keeps its height. Which floors may rise is the engine's
 * mode rule (the catalog's `tallSkyLobbies`), read back through `lobbyRise`.
 */

const MODES: readonly GameMode[] = ["classic", "modern"];

const made: WasmEngine[] = [];
afterEach(() => {
  for (const e of made.splice(0)) e.free();
});

/** A bare tower (no lobby yet) on the Rust engine, read as the app reads it. */
function bareTower(mode: GameMode) {
  const engine = wasm().Engine.newGame(7, mode);
  made.push(engine);
  const port = engine as unknown as EnginePort;
  const reader = new ViewReader(port, floorsOfPort(port));
  reader.update();
  const codes = new PortCodes(port);
  const catalog = (): Catalog => catalogOf({ enginePort: port, reader });
  const setMoney = (amount: number) => {
    engine.setMoney(amount);
    reader.update();
  };
  return { engine, port, reader, codes, catalog, setMoney };
}

type Tower = ReturnType<typeof bareTower>;

/** The `kind` tool's preview at `(tile, floor)` with `amount` to spend and the
 *  Lobby card's picked `height`, as the engine object the renderer reads. */
function previewOf(t: Tower, kind: string, tile: number, floor: number, amount: number, height: number) {
  const engine = { preview: null as unknown, transportPreview: null as unknown };
  const app = {
    enginePort: t.port,
    portCodes: t.codes,
    reader: t.reader,
    tool: { type: "build", kind },
    engine,
    ui: { showInspector: vi.fn() },
    build: {},
    inspectAnchor: null,
    buildRefusalShowing: false,
    lobbyHeight: { height },
  } as unknown as GameApp;
  t.setMoney(amount);
  updateBuildPreview(app, tile, floor);
  return engine as { preview: { valid: boolean; stories?: number } | null; transportPreview: { bottom: number; top: number; valid: boolean } | null };
}

/** The Lobby brush preview at `(tile, floor)` with `amount` to spend and the
 *  card's picked `height`. */
function preview(t: Tower, tile: number, floor: number, amount: number, height: number): { valid: boolean; stories?: number } {
  return previewOf(t, "lobby", tile, floor, amount, height).preview as { valid: boolean; stories?: number };
}

/** The frontend's build actions on `t`, laying lobbies `height` stories tall. */
const buildActions = (t: Tower, height: number, toast: (text: string, tone?: string) => void = () => {}) =>
  new BuildActions({
    enginePort: () => t.port,
    portCodes: () => t.codes,
    reader: () => t.reader,
    catalog: t.catalog,
    isUnlocked: (k) => isUnlocked({ reader: t.reader }, k),
    ui: { toast },
    audio: { sfx: () => {} },
    selectedId: () => null,
    clearSelection: () => {},
    lobbyHeight: () => height,
  });

describe.skipIf(!hasWasmPackage())("tall lobbies on the Rust engine (#308)", () => {
  it("lays and previews a tall ground lobby at the engine's price per story", () => {
    for (const mode of MODES) {
      const t = bareTower(mode);
      const lobby = catalogFacility(t.catalog(), "lobby").cost;
      const floor = catalogFacility(t.catalog(), "floor").cost;
      // Where nothing stands yet, a three-story lobby pays the lobby three
      // times and its floor once, per tile.
      const tile = 3 * lobby + floor;
      const at = 174;
      const tiles = new Set(brushTiles(at)).size;
      expect(preview(t, at, 1, tiles * tile, 3), mode).toMatchObject({ valid: true, stories: 3 });
      expect(preview(t, at, 1, tiles * tile - 1, 3).valid, mode).toBe(false);
      t.setMoney(tiles * tile);
      expect(buildActions(t, 3).paintBrush("lobby", at, 1).placed, mode).toBe(tiles);
      // One hall, `[floor, x0, x1, height]`, over the brush's own columns.
      const cols = brushTiles(at);
      expect(Array.from(t.port.lobbyHeights()), mode).toEqual([1, Math.min(...cols), Math.max(...cols), 3]);
      expect(t.engine.money(), mode).toBe(0);
      // The floor keeps its height: a later section asked at one story rises three.
      expect(preview(t, at + 8, 1, 1e9, 1).stories, mode).toBe(3);
    }
  });

  it("raises a sky lobby only where the catalog says sky lobbies rise", () => {
    for (const mode of MODES) {
      const t = bareTower(mode);
      const sky = t.catalog().world.lobbyInterval;
      t.port.setLobbyHeight(3);
      expect(t.port.lobbyRise(1, 174), mode).toBe(3);
      expect(t.port.lobbyRise(sky, 174), mode).toBe(t.catalog().rules.tallSkyLobbies ? 3 : 1);
      expect(t.catalog().rules.tallSkyLobbies, mode).toBe(mode === "modern");
    }
  });

  // A Classic player on a phone picked 3 stories and painted a sky lobby: the
  // engine used to lay a permanent one-story lobby without a word. It refuses
  // now, preview and brush alike, and says how to build one.
  it("refuses a taller Classic sky lobby with a reason, and lays nothing", () => {
    const t = bareTower("classic");
    const sky = t.catalog().world.lobbyInterval;
    const at = 174;
    t.setMoney(1e9);
    expect(buildActions(t, 1).paintBrush("lobby", at, 1).placed).toBeGreaterThan(0);
    for (let floor = 2; floor < sky; floor++) expect(buildActions(t, 1).paintBrush("floor", at, floor).placed, `floor ${floor}`).toBeGreaterThan(0);
    expect(preview(t, at, sky, 1e9, 3).valid).toBe(false);
    const toasts: [string, string | undefined][] = [];
    const money = t.engine.money();
    // The phone's tap stamps the brush through seedPaint, which has no hover
    // ghost to carry the reason, so it must say it.
    buildActions(t, 3, (text, tone) => void toasts.push([text, tone])).seedPaint("lobby", at, sky);
    expect(toasts).toEqual([[expect.stringMatching(/^In Classic, only the ground lobby can be taller than one story\. Pick 1 story/), "bad"]]);
    expect(t.engine.money()).toBe(money);
    t.reader.update();
    expect(brushTiles(at).some((x) => t.reader.tower.structureKindAt(sky, x) === "lobby")).toBe(false);
    // One story still builds there, as in the original.
    expect(preview(t, at, sky, 1e9, 1)).toMatchObject({ valid: true, stories: 1 });
    expect(buildActions(t, 1).paintBrush("lobby", at, sky).placed).toBeGreaterThan(0);
  });

  // Review of #2054: the view's runs sit on a lobby's own floor, so the
  // preview has to learn from the engine that a tall lobby holds up the story
  // over it and that a flight out of it climbs the whole lobby.
  // #2068: in Modern each hall keeps its own height. The ghost has to show the
  // height and price the click then lays, for a strip laid against a hall
  // (whatever the card holds) and for a strip that closes the gap between two
  // halls of different heights (the left one's).
  describe("split halls in Modern (#2068)", () => {
    /** Lays `kind` over `from..to` on `floor` straight through the engine, a
     *  brush's worth at a time: the tower the test stands on. */
    function lay(t: Tower, kind: "lobby" | "floor", floor: number, from: number, to: number) {
      for (let x = from; x <= to; x += 8) {
        const tiles = Float64Array.from({ length: Math.min(8, to - x + 1) }, (_, i) => x + i);
        t.port.paintTiles(t.codes.kind(kind), floor, tiles);
      }
    }

    /** A tower up to its first sky lobby floor, and there a three-story hall
     *  over 96..103 and a two-story hall over 112..119, with bridging off so
     *  the gap between them stays. */
    function splitHalls() {
      const t = bareTower("modern");
      const sky = t.catalog().world.lobbyInterval;
      t.engine.chooseAutoBridge(false);
      t.setMoney(1e9);
      lay(t, "lobby", 1, 88, 127);
      for (let floor = 2; floor < sky; floor++) lay(t, "floor", floor, 88, 127);
      t.port.setLobbyHeight(3);
      lay(t, "lobby", sky, 96, 103);
      t.port.setLobbyHeight(2);
      lay(t, "lobby", sky, 112, 119);
      t.reader.update();
      expect(Array.from(t.port.lobbyHeights())).toEqual([sky, 96, 103, 3, sky, 112, 119, 2]);
      return { t, sky };
    }

    it("lays a strip that closes the gap at the left hall's height, at the price its ghost showed", () => {
      const { t, sky } = splitHalls();
      const lobby = catalogFacility(t.catalog(), "lobby").cost;
      const floor = catalogFacility(t.catalog(), "floor").cost;
      // Bare tiles: the lobby price per story and the floor's once.
      const tile = 3 * lobby + floor;
      // The card asks one story; the strip joins the three-story hall on its left.
      expect(t.port.lobbyRise(sky, 104)).toBe(3);
      expect(preview(t, 108, sky, 8 * tile, 1)).toMatchObject({ valid: true, stories: 3 });
      expect(preview(t, 108, sky, 8 * tile - 1, 1).valid).toBe(false);
      t.setMoney(8 * tile);
      expect(buildActions(t, 1).paintBrush("lobby", 108, sky).placed).toBe(8);
      expect(t.engine.money()).toBe(0);
      expect(Array.from(t.port.lobbyHeights())).toEqual([sky, 96, 111, 3, sky, 112, 119, 2]);
    });

    it("prices a strip laid apart from a hall, which bridges back to it, at that hall's height", () => {
      const { t, sky } = splitHalls();
      t.engine.chooseAutoBridge(true);
      // 120..127 lies apart from the two-story hall; the brush bridges 120 back
      // to it, and the whole strip rises with it, whatever the card asks.
      expect(preview(t, 124, sky, 1e9, 1)).toMatchObject({ valid: true, stories: 2 });
      const before = t.engine.money();
      expect(buildActions(t, 1).paintBrush("lobby", 124, sky).placed).toBeGreaterThan(0);
      expect(Array.from(t.port.lobbyHeights())).toEqual([sky, 96, 103, 3, sky, 112, 127, 2]);
      const spent = before - t.engine.money();
      // On the same tower before the stroke, the ghost asks exactly what the stroke spent.
      const { t: again } = splitHalls();
      again.engine.chooseAutoBridge(true);
      expect(preview(again, 124, sky, spent, 1).valid).toBe(true);
      expect(preview(again, 124, sky, spent - 1, 1).valid).toBe(false);
    });

    it("previews and builds over each hall to that hall's own height", () => {
      const { t, sky } = splitHalls();
      // Two stories up is the three-story hall's raised story and the story over the two-story hall.
      const up = sky + 2;
      expect(previewOf(t, "floor", 100, up, 1e9, 1).preview?.valid).toBe(false);
      expect(previewOf(t, "floor", 116, up, 1e9, 1).preview?.valid).toBe(true);
      expect(buildActions(t, 1).paintBrush("floor", 116, up).placed).toBe(8);
      expect(buildActions(t, 1).paintBrush("floor", 100, up).placed).toBe(0);
      // A flight out of each hall climbs that hall, ghost and click alike.
      const stairs = t.codes.kind("stairs");
      expect(t.port.walkwayTop(stairs, 98, sky, sky + 1)).toBe(sky + 3);
      expect(t.port.walkwayTop(stairs, 114, sky, sky + 1)).toBe(sky + 2);
      const ghost = previewOf(t, "stairs", 114, sky, 1e9, 1).transportPreview;
      expect(ghost).toMatchObject({ bottom: sky, top: sky + 2, valid: true });
      expect(buildActions(t, 1).tryBuildTransport("stairs", 114, sky, sky + 1).ok).toBe(true);
      t.reader.update();
      expect(t.reader.tower.transports.filter((x) => x.kind === "stairs").map((x) => [x.bottom, x.top])).toEqual([[sky, sky + 2]]);
    });
  });

  it("previews a floor over a tall lobby and a flight out of it as the engine builds them", () => {
    for (const height of [2, 3]) {
      const t = bareTower("classic");
      const at = 174;
      t.setMoney(1e9);
      expect(buildActions(t, height).paintBrush("lobby", at, 1).placed, `${height}`).toBeGreaterThan(0);
      const over = 1 + height;
      // The engine counts the raised stories as structure; the view does not.
      const cols = brushTiles(at);
      expect(t.port.lobbyHeights()).toEqual(new Float64Array([1, Math.min(...cols), Math.max(...cols), height]));
      expect(t.reader.tower.structureKindAt(height, at)).toBeUndefined();
      // A floor on the story over the hall: the ghost is green, and the brush lays it.
      expect(previewOf(t, "floor", at, over, 1e9, 1).preview?.valid, `${height}`).toBe(true);
      expect(buildActions(t, 1).paintBrush("floor", at, over).placed, `${height}`).toBeGreaterThan(0);
      // A stairway from the hall's floor: the ghost climbs the whole lobby,
      // and the click lays the same flight.
      const stairs = t.codes.kind("stairs");
      expect(t.port.walkwayTop(stairs, at - 10, 1, 2)).toBe(over);
      expect(t.port.walkwayTop(stairs, at - 10, over, over + 1)).toBe(over + 1);
      const ghost = previewOf(t, "stairs", at - 10, 1, 1e9, 1).transportPreview;
      expect(ghost, `${height}`).toMatchObject({ bottom: 1, top: over, valid: true });
      expect(buildActions(t, 1).tryBuildTransport("stairs", at - 10, 1, 2).ok, `${height}`).toBe(true);
      t.reader.update();
      const built = t.reader.tower.transports.filter((x) => x.kind === "stairs");
      expect(built.map((x) => [x.bottom, x.top]), `${height}`).toEqual([[1, over]]);
    }
  });
});
