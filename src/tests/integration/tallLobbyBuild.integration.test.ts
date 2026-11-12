import { afterEach, describe, expect, it, vi } from "vitest";
import type { WasmEngine } from "../../dualrun/binding";
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

/** The Lobby brush preview at `(tile, floor)` with `amount` to spend and the
 *  card's picked `height`. */
function preview(t: Tower, tile: number, floor: number, amount: number, height: number): { valid: boolean; stories?: number } {
  const engine = { preview: null as unknown, transportPreview: null as unknown };
  const app = {
    enginePort: t.port,
    portCodes: t.codes,
    reader: t.reader,
    tool: { type: "build", kind: "lobby" },
    engine,
    ui: { showInspector: vi.fn() },
    build: {},
    inspectAnchor: null,
    buildRefusalShowing: false,
    lobbyHeight: { height },
  } as unknown as GameApp;
  t.setMoney(amount);
  updateBuildPreview(app, tile, floor);
  return engine.preview as { valid: boolean; stories?: number };
}

/** The frontend's build actions on `t`, laying lobbies `height` stories tall. */
const buildActions = (t: Tower, height: number) =>
  new BuildActions({
    enginePort: () => t.port,
    portCodes: () => t.codes,
    reader: () => t.reader,
    catalog: t.catalog,
    isUnlocked: (k) => isUnlocked({ reader: t.reader }, k),
    ui: { toast: () => {} },
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
      expect(Array.from(t.port.lobbyHeights()), mode).toEqual([1, 3]);
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
      expect(t.port.lobbyRise(1), mode).toBe(3);
      expect(t.port.lobbyRise(sky), mode).toBe(t.catalog().rules.tallSkyLobbies ? 3 : 1);
      expect(t.catalog().rules.tallSkyLobbies, mode).toBe(mode === "modern");
    }
  });
});
