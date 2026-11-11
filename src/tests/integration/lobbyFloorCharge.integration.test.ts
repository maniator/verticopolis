import { afterEach, describe, expect, it, vi } from "vitest";
import type { WasmEngine } from "../../dualrun/binding";
import type { GameApp } from "../../main";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import { ViewReader } from "../../simport/viewReader";
import { floorsOfPort } from "../../game/portAccess";
import type { FacilityKind, GameMode } from "../../shared/types";
import { catalogFacility, catalogTileCost, type Catalog } from "../../catalog/catalogTypes";
import { catalogOf, isUnlocked, quoteBuild } from "../../game/portAccess";
import { BuildActions } from "../../game/buildActions";
import { updateBuildPreview } from "../../game/buildPreview";
import { brushTiles } from "../../ui/placement";
import { toolInfoFor } from "../../ui/templates/toolInfo";
import { renderToFragment } from "../../ui/testing/litTestUtils";
import { groupDigits } from "../../ui/format";
import { decodeVctower } from "../../storage/vctowerContainer";
import { kind, money, must, slot } from "../../simport/engineSubject.fixture";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

/**
 * A lobby placed where there is no floor yet pays for that floor too, as the
 * original charges a floor tile with each lobby tile; a lobby over a floor
 * tile pays the lobby price alone. These tests run the Rust engine the game
 * ships and hold the frontend's prices to its quotes and charges: the tile
 * price the frontend reads from the catalog, the whole-strip price behind the
 * brush preview, the Lobby and Floor tool cards and the toast after the Floor
 * tool lays a lobby on the ground floor.
 */


const MODES: readonly GameMode[] = ["classic", "modern"];
/** Where the cases lay the ground lobby, in the middle of the lot. */
const LOBBY_LEFT = 170;
const LOBBY_RIGHT = 190;

const made: WasmEngine[] = [];
afterEach(() => {
  for (const e of made.splice(0)) e.free();
});

/** A founded tower on the Rust engine with a ground lobby over [LOBBY_LEFT,
 *  LOBBY_RIGHT), or the tower a `save` holds, with money to spare, read as the app reads it. */
function tower(mode: GameMode, save?: string) {
  const engine = save === undefined ? wasm().Engine.newGame(7, mode) : wasm().Engine.fromSave(save);
  made.push(engine);
  const port = engine as unknown as EnginePort;
  const reader = new ViewReader(port, floorsOfPort(port));
  const s = { port, reader };
  engine.setMoney(100_000_000);
  for (let x = LOBBY_LEFT; x < LOBBY_RIGHT && save === undefined; x++) {
    if (reader.tower.structureKindAt(1, x) !== "lobby") must(s, (p) => p.buildAt(kind("lobby"), 1, x), `lobby at ${x}`);
  }
  reader.update();
  const codes = new PortCodes(port);
  const catalog = (): Catalog => catalogOf({ enginePort: port, reader });
  const setMoney = (amount: number) => {
    engine.setMoney(amount);
    reader.update();
  };
  return { s, engine, port, reader, codes, catalog, setMoney };
}

type Tower = ReturnType<typeof tower>;

/** The engine's quote for one tile, which must be buildable. */
function quote(t: Tower, k: FacilityKind, floor: number, x: number): number {
  const q = quoteBuild(t.port, t.codes, k, floor, x);
  expect(q.ok, `${k} on ${floor} at ${x}: ${q.reason}`).toBe(true);
  return q.cost;
}

const prices = (t: Tower) => ({
  lobby: catalogFacility(t.catalog(), "lobby").cost,
  floor: catalogFacility(t.catalog(), "floor").cost,
});

/** The `tool` brush preview at `(tile, floor)` with `amount` to spend. */
function previewWith(t: Tower, tool: string, tile: number, floor: number, amount: number): { valid: boolean; reason?: string } {
  const engine = { preview: null as unknown, transportPreview: null as unknown };
  const app = {
    enginePort: t.port,
    portCodes: t.codes,
    reader: t.reader,
    tool: { type: "build", kind: tool },
    engine,
    ui: { showInspector: vi.fn() },
    build: {},
    inspectAnchor: null,
    buildRefusalShowing: false,
  } as unknown as GameApp;
  t.setMoney(amount);
  updateBuildPreview(app, tile, floor);
  return engine.preview as { valid: boolean; reason?: string };
}

/** Whether the brush preview at `(tile, floor)` shows valid with exactly
 *  `amount`, and with a dollar less. */
function validAtAndBelow(t: Tower, tool: string, tile: number, floor: number, amount: number): [boolean, boolean] {
  const below = previewWith(t, tool, tile, floor, amount - 1).valid;
  return [previewWith(t, tool, tile, floor, amount).valid, below];
}

/** How many of the brush's columns at `tile` hold structure on `floor`. */
const builtIn = (t: Tower, floor: number, tile: number) =>
  brushTiles(tile).filter((x) => t.reader.tower.structureKindAt(floor, x) !== undefined).length;

/** Lay `tool` on `floor` at each of `xs`, one build at a time. */
function lay(t: Tower, tool: "floor" | "lobby", floor: number, xs: Iterable<number>): void {
  for (const x of xs) must(t.s, (p) => p.buildAt(kind(tool), floor, x), `${tool} on ${floor} at ${x}`);
  t.reader.update();
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** The frontend's build actions on `t`, with its toasts kept in `toasts`. */
const buildActions = (t: Tower, toasts: string[] = []) =>
  new BuildActions({
    enginePort: () => t.port,
    portCodes: () => t.codes,
    reader: () => t.reader,
    catalog: t.catalog,
    isUnlocked: (k) => isUnlocked({ reader: t.reader }, k),
    ui: { toast: (text: string) => toasts.push(text) },
    audio: { sfx: () => {} },
    selectedId: () => null,
    clearSelection: () => {},
  });

/** Paint the `tool` brush at `(tile, floor)` with exactly `amount`, and answer
 *  how many tiles it laid. */
function paintWith(t: Tower, tool: "floor" | "lobby", tile: number, floor: number, amount: number): number {
  t.setMoney(amount);
  const rec = must(t.s, (p) => p.paintTiles(kind(tool), floor, Float64Array.from(brushTiles(tile))), `the ${tool} brush`);
  t.reader.update();
  return slot("paintTiles", rec, "placed");
}

describe.skipIf(!hasWasmPackage())("the lobby floor charge on the Rust engine", () => {
  it("prices a tile from the catalog as the engine quotes it", () => {
    for (const mode of MODES) {
      const t = tower(mode);
      const { lobby, floor } = prices(t);
      const sky = t.catalog().world.lobbyInterval;
      for (let fl = 2; fl <= sky; fl++) lay(t, "floor", fl, [LOBBY_LEFT]);
      // Each tile sits beside the tower, so no quote carries a bridge.
      const bare = quote(t, "lobby", 1, LOBBY_RIGHT);
      expect(bare, mode).toBe(lobby + floor);
      expect(catalogTileCost(t.catalog(), "lobby", "no floor yet"), mode).toBe(bare);
      expect(catalogTileCost(t.catalog(), "lobby", "a floor tile"), mode).toBe(quote(t, "lobby", sky, LOBBY_LEFT));
      expect(catalogTileCost(t.catalog(), "floor", "no floor yet"), mode).toBe(quote(t, "floor", 2, LOBBY_LEFT + 1));
    }
  });

  it("previews the ground brush at the engine's charge: four bare tiles past the lobby's edge", () => {
    for (const mode of MODES) {
      const t = tower(mode);
      const { lobby, floor } = prices(t);
      // The brush at LOBBY_RIGHT spans four lobby tiles and four bare ones.
      const strip = 4 * (lobby + floor);
      expect(validAtAndBelow(t, "floor", LOBBY_RIGHT, 1, strip), mode).toEqual([true, false]);
      expect(paintWith(t, "floor", LOBBY_RIGHT, 1, strip), mode).toBe(4);
      expect(money(t.s), mode).toBe(0);
    }
  });

  it("previews a sky lobby brush at the engine's charge: floor tiles at the lobby price, bare tiles with their floor", () => {
    for (const mode of MODES) {
      const t = tower(mode);
      const { lobby, floor } = prices(t);
      const sky = t.catalog().world.lobbyInterval;
      const edge = LOBBY_LEFT + 8;
      for (let fl = 2; fl < sky; fl++) lay(t, "floor", fl, range(LOBBY_LEFT, LOBBY_RIGHT));
      lay(t, "floor", sky, range(LOBBY_LEFT, edge));
      // The brush at `edge` spans four floor tiles and four bare ones.
      const strip = 4 * lobby + 4 * (lobby + floor);
      expect(validAtAndBelow(t, "lobby", edge, sky, strip), mode).toEqual([true, false]);
      expect(paintWith(t, "lobby", edge, sky, strip), mode).toBe(8);
      expect(money(t.s), mode).toBe(0);
    }
  });

  it("prices a brush beside the lobby from the tile touching it, with bridging on and off", () => {
    // At the lobby's left end the brush skips its anchor; past the right end
    // its anchor stands clear of the lobby, where a bridge from it would cross
    // tiles the brush lays anyway, or with bridging off nothing holds it yet.
    for (const mode of MODES) {
      for (const tool of ["floor", "lobby"] as const) {
        for (const bridging of mode === "modern" ? [true, false] : [true]) {
          for (const [at, bare] of [[LOBBY_LEFT, 4], [LOBBY_RIGHT + 2, 6], [LOBBY_RIGHT + 3, 7]] as const) {
            const label = `${mode} ${tool} at ${at}, bridging ${bridging}`;
            const t = tower(mode);
            if (t.engine.autoBridge() !== bridging) t.engine.toggleAutoBridge();
            const { lobby, floor } = prices(t);
            const strip = bare * (lobby + floor);
            expect(validAtAndBelow(t, tool, at, 1, strip), label).toEqual([true, false]);
            // A bridge can lay several tiles in one build, so count the tiles.
            const before = builtIn(t, 1, at);
            paintWith(t, tool, at, 1, strip);
            expect(money(t.s), label).toBe(0);
            expect(builtIn(t, 1, at) - before, label).toBe(bare);
          }
        }
      }
    }
  });

  it("prices widening the ground lobby left across a gap with the bridge its first tile lays", () => {
    // The brush at 160 (156..163) stands clear of the lobby at 170; its first
    // tile bridges 157..169, so the click lays 14 lobby tiles with their floor.
    for (const mode of MODES) {
      const t = tower(mode);
      if (!t.engine.autoBridge()) t.engine.toggleAutoBridge();
      const strip = 14 * (prices(t).lobby + prices(t).floor);
      expect(validAtAndBelow(t, "floor", LOBBY_LEFT - 10, 1, strip), mode).toEqual([true, false]);
      paintWith(t, "floor", LOBBY_LEFT - 10, 1, strip);
      expect(money(t.s), mode).toBe(0);
    }
  });

  it("prices a basement brush under the lobby's edge from a tile the lobby holds up", () => {
    for (const mode of MODES) {
      for (const bridging of mode === "modern" ? [true, false] : [true]) {
        const label = `${mode}, bridging ${bridging}`;
        const t = tower(mode);
        if (t.engine.autoBridge() !== bridging) t.engine.toggleAutoBridge();
        // The brush spans four tiles under the lobby and four past its end.
        const strip = 8 * prices(t).floor;
        expect(validAtAndBelow(t, "floor", LOBBY_RIGHT, 0, strip), label).toEqual([true, false]);
        expect(paintWith(t, "floor", LOBBY_RIGHT, 0, strip), label).toBe(8);
        expect(money(t.s), label).toBe(0);
      }
    }
  });

  it("prices an upper floor's brush from the first tile it lays, and a gap its bridge fills once", () => {
    for (const mode of MODES) {
      for (const bridging of mode === "modern" ? [true, false] : [true]) {
        const label = `${mode}, bridging ${bridging}`;
        // Floor 3 has one tile at 170 over a floor 2 that ends at 176. The
        // brush at 176 lays 172..175, bridged to 170 when bridging is on.
        const t = tower(mode);
        if (t.engine.autoBridge() !== bridging) t.engine.toggleAutoBridge();
        lay(t, "floor", 2, range(LOBBY_LEFT, LOBBY_LEFT + 6));
        lay(t, "floor", 3, [LOBBY_LEFT]);
        const bare = bridging ? 5 : 4;
        const strip = bare * prices(t).floor;
        expect(validAtAndBelow(t, "floor", LOBBY_LEFT + 6, 3, strip), label).toEqual([true, false]);
        paintWith(t, "floor", LOBBY_LEFT + 6, 3, strip);
        expect(money(t.s), label).toBe(0);
        const floor3 = range(LOBBY_LEFT + 1, LOBBY_LEFT + 6).filter((x) => t.reader.tower.structureKindAt(3, x) !== undefined);
        expect(floor3.length, label).toBe(bare);
      }
      if (mode !== "modern") continue;
      for (const bridging of [true, false]) {
        // Laid with bridging off, floor 3 leaves a gap at 176..178 that the
        // brush at 178 fills: the first tile's bridge lays the other two.
        const label = `gap, bridging ${bridging}`;
        const t = tower(mode);
        if (t.engine.autoBridge()) t.engine.toggleAutoBridge();
        lay(t, "floor", 2, range(LOBBY_LEFT, LOBBY_RIGHT));
        lay(t, "floor", 3, [...range(LOBBY_LEFT, LOBBY_LEFT + 6), ...range(LOBBY_LEFT + 9, LOBBY_LEFT + 16)]);
        if (t.engine.autoBridge() !== bridging) t.engine.toggleAutoBridge();
        const strip = 3 * prices(t).floor;
        expect(validAtAndBelow(t, "floor", LOBBY_LEFT + 8, 3, strip), label).toEqual([true, false]);
        paintWith(t, "floor", LOBBY_LEFT + 8, 3, strip);
        expect(money(t.s), label).toBe(0);
        expect(builtIn(t, 3, LOBBY_LEFT + 8), label).toBe(8);
      }
    }
  });

  it("prices a brush split by a built tile with the bridge its far end lays", () => {
    // Laid with bridging off, then painted with bridging on and off. On floor
    // 3, tiles at 170, 178 and 189: the brush at 178 lays 174..177 with a
    // bridge to 170 and 179..181 with one to 189. On the ground floor over a
    // basement, lobbies end at 189 and stand at 200 and 220: the brush at 200
    // lays 196..199 with a bridge to 189 and 201..203 with one to 220.
    const cases = [
      { floor: 3, at: LOBBY_LEFT + 8, built: [LOBBY_LEFT, LOBBY_LEFT + 8, LOBBY_LEFT + 19], bridged: 17, alone: 7 },
      { floor: 1, at: LOBBY_LEFT + 30, built: [LOBBY_LEFT + 30, LOBBY_LEFT + 50], bridged: 29, alone: 7 },
    ];
    for (const { floor, at, built, bridged, alone } of cases) {
      for (const bridging of [true, false]) {
        const label = `floor ${floor}, bridging ${bridging}`;
        const t = tower("modern");
        if (t.engine.autoBridge()) t.engine.toggleAutoBridge();
        if (floor === 1) {
          lay(t, "floor", 0, range(LOBBY_LEFT, LOBBY_LEFT + 70));
          lay(t, "lobby", 1, built);
        } else {
          lay(t, "floor", 2, range(LOBBY_LEFT, LOBBY_RIGHT));
          lay(t, "floor", 3, built);
        }
        if (bridging) t.engine.toggleAutoBridge();
        const tilePrice = floor === 1 ? prices(t).lobby + prices(t).floor : prices(t).floor;
        const strip = (bridging ? bridged : alone) * tilePrice;
        expect(validAtAndBelow(t, "floor", at, floor, strip), label).toEqual([true, false]);
        if (bridging) {
          // Short of the far end's price, that quote is refused for money and
          // still prices its bridge, so the ghost stays red (the floor 1 case
          // is the one a dropped bridge would turn green).
          const far = quote(t, floor === 1 ? "lobby" : "floor", floor, at + 1);
          expect(previewWith(t, "floor", at, floor, far - 1).valid, label).toBe(false);
        }
        paintWith(t, "floor", at, floor, strip);
        expect(money(t.s), label).toBe(0);
      }
    }
  });

  it("prices a brush whose first run's bridge passes its left end", () => {
    // Floor 2 over 170..189 but 176, and floor 3 at 170 and 177, laid with
    // bridging off. The brush at 178 is quoted at 178, beside 177; its first
    // tile, 174, bridges 171..173 to 170 and 175 to 177 (176 has no floor
    // under it).
    const t = tower("modern");
    if (t.engine.autoBridge()) t.engine.toggleAutoBridge();
    lay(t, "floor", 2, range(LOBBY_LEFT, LOBBY_RIGHT).filter((x) => x !== LOBBY_LEFT + 6));
    lay(t, "floor", 3, [LOBBY_LEFT, LOBBY_LEFT + 7]);
    t.engine.toggleAutoBridge();
    const strip = 9 * prices(t).floor;
    expect(validAtAndBelow(t, "floor", LOBBY_LEFT + 8, 3, strip)).toEqual([true, false]);
    paintWith(t, "floor", LOBBY_LEFT + 8, 3, strip);
    expect(money(t.s)).toBe(0);
  });

  it("prices a floor 3 brush from where its quoted tile's scans stop, in the brush or past it", () => {
    // Over a full floor 2, laid with bridging off and painted with it on. The
    // brush at 180 (176..183) touching floor 3 just past one end bridges the
    // brush to the far tile for 13 tiles. With floor 3 at 170 and 189 the
    // first tile bridges both ways (18 tiles); with floor 3 at 184..189 only,
    // the brush at 179 bridges right alone (9 tiles). With floor 3 at 170 and
    // 181, the brush at 178 is quoted at 180, beside 181, and bridges back to
    // 170 (10 tiles).
    const cases = [
      { built: [...range(LOBBY_LEFT, LOBBY_LEFT + 6), LOBBY_RIGHT - 1], at: LOBBY_LEFT + 10, charged: 13 },
      { built: [LOBBY_LEFT, ...range(LOBBY_LEFT + 14, LOBBY_RIGHT)], at: LOBBY_LEFT + 10, charged: 13 },
      { built: [LOBBY_LEFT, LOBBY_RIGHT - 1], at: LOBBY_LEFT + 10, charged: 18 },
      { built: range(LOBBY_LEFT + 14, LOBBY_RIGHT), at: LOBBY_LEFT + 9, charged: 9 },
      { built: [LOBBY_LEFT, LOBBY_LEFT + 11], at: LOBBY_LEFT + 8, charged: 10 },
    ];
    for (const { built, at, charged } of cases) {
      const label = `floor 3 at ${built.join(",")}`;
      const t = tower("modern");
      if (t.engine.autoBridge()) t.engine.toggleAutoBridge();
      lay(t, "floor", 2, range(LOBBY_LEFT, LOBBY_RIGHT));
      lay(t, "floor", 3, built);
      t.engine.toggleAutoBridge();
      expect(validAtAndBelow(t, "floor", at, 3, charged * prices(t).floor), label).toEqual([true, false]);
      paintWith(t, "floor", at, 3, charged * prices(t).floor);
      expect(money(t.s), label).toBe(0);
    }
  });

  it("prices a ground floor Lobby brush past plain floor that holds a room, from an old save", () => {
    // Only an old save holds a room on the ground floor: lobby at 170..181 and
    // plain floor under an office at 182..190. The click turns none of that
    // floor into lobby and lays the empty tiles past it, each with its floor.
    const json = decodeVctower(tower("modern").port.exportVctower("2.66.0", 0) ?? "") as { units: Record<string, unknown>[]; nextId: number };
    const tiles = range(LOBBY_LEFT + 12, LOBBY_RIGHT + 1).map((x, i) => ({ id: json.nextId + i, kind: "floor", floor: 1, x }));
    const office = { id: json.nextId + tiles.length, kind: "office", floor: 1, x: LOBBY_LEFT + 12, width: 9 };
    const units = [...json.units.filter((u) => !(u.floor === 1 && (u.x as number) >= LOBBY_LEFT + 12)), ...tiles, office];
    const save = JSON.stringify({ ...json, units, nextId: office.id + 1 });
    for (const [at, laid, bridging] of [[LOBBY_RIGHT, 3, true], [LOBBY_RIGHT + 1, 4, true], [LOBBY_RIGHT + 1, 4, false]] as const) {
      const label = `brush at ${at}, bridging ${bridging}`;
      const t = tower("modern", save);
      expect(t.reader.roomAt(1, LOBBY_RIGHT)?.kind, label).toBe("office");
      if (t.engine.autoBridge() !== bridging) t.engine.toggleAutoBridge();
      const strip = laid * (prices(t).lobby + prices(t).floor);
      expect(validAtAndBelow(t, "lobby", at, 1, strip), label).toEqual([true, false]);
      expect(paintWith(t, "lobby", at, 1, strip), label).toBe(laid);
      expect(money(t.s), label).toBe(0);
    }
  });

  it("prices a sky lobby brush laid over plain floor at either end with one scan each way", () => {
    // A sky lobby floor over full floors, laid with bridging off, then the
    // Lobby brush at 178 (174..181) with bridging on. With a lobby at 170 and
    // plain floor at 174, 174 turns into lobby and bridges 171..173. With
    // lobbies at 170 and 189, 174 bridges 171..173 and the last plain floor
    // tile bridges the rest of the row to 188. Plain floor at 181 alone is
    // quoted once, at 181, whose scans cover both.
    const both = [LOBBY_LEFT, LOBBY_RIGHT - 1];
    const cases = [
      { plains: [LOBBY_LEFT + 4], lobbies: [LOBBY_LEFT], bare: 10, quotes: 1 },
      { plains: [LOBBY_LEFT + 11], lobbies: both, bare: 17, quotes: 1 },
      { plains: [LOBBY_LEFT + 8], lobbies: both, bare: 17, quotes: 2 },
      { plains: [LOBBY_LEFT + 4, LOBBY_LEFT + 11], lobbies: both, bare: 16, quotes: 2 },
    ];
    for (const { plains, lobbies, bare, quotes } of cases) {
      const label = `plain floor at ${plains.join(",")}`;
      const t = tower("modern");
      if (t.engine.autoBridge()) t.engine.toggleAutoBridge();
      const sky = t.catalog().world.lobbyInterval;
      for (let fl = 2; fl < sky; fl++) lay(t, "floor", fl, range(LOBBY_LEFT, LOBBY_RIGHT));
      lay(t, "floor", sky, plains);
      lay(t, "lobby", sky, lobbies);
      t.engine.toggleAutoBridge();
      const { lobby, floor } = prices(t);
      const strip = plains.length * lobby + bare * (lobby + floor);
      const spy = vi.spyOn(t.engine, "quoteBuild");
      expect(validAtAndBelow(t, "lobby", LOBBY_LEFT + 8, sky, strip), label).toEqual([true, false]);
      // The quotes of each of the two previews.
      expect(spy.mock.calls.length, label).toBe(2 * quotes);
      spy.mockRestore();
      paintWith(t, "lobby", LOBBY_LEFT + 8, sky, strip);
      expect(money(t.s), label).toBe(0);
    }
  });

  it("prices a sky lobby brush over plain floor with the bridge its last tile lays", () => {
    // Plain floor on 170..185 and a sky lobby at 189: the brush at 182 turns
    // 178..185 into lobby, and with bridging on 185 bridges 186..188 to it.
    for (const mode of MODES) {
      for (const bridging of mode === "modern" ? [true, false] : [true]) {
        const label = `${mode}, bridging ${bridging}`;
        const t = tower(mode);
        const sky = t.catalog().world.lobbyInterval;
        for (let fl = 2; fl < sky; fl++) lay(t, "floor", fl, range(LOBBY_LEFT, LOBBY_RIGHT));
        lay(t, "floor", sky, range(LOBBY_LEFT, LOBBY_LEFT + 16));
        lay(t, "lobby", sky, [LOBBY_RIGHT - 1]);
        if (t.engine.autoBridge() !== bridging) t.engine.toggleAutoBridge();
        const { lobby, floor } = prices(t);
        const strip = 8 * lobby + (bridging ? 3 * (lobby + floor) : 0);
        expect(validAtAndBelow(t, "lobby", LOBBY_LEFT + 12, sky, strip), label).toEqual([true, false]);
        paintWith(t, "lobby", LOBBY_LEFT + 12, sky, strip);
        expect(money(t.s), label).toBe(0);
      }
    }
  });

  it("names the refusal a click reports when the brush lays nothing", () => {
    for (const mode of MODES) {
      // Floors 2 and 3 hold one tile each, so every other tile of the brush
      // at that tile hangs over open air.
      const t = tower(mode);
      lay(t, "floor", 2, [LOBBY_LEFT + 10]);
      lay(t, "floor", 3, [LOBBY_LEFT + 10]);
      const shown = previewWith(t, "floor", LOBBY_LEFT + 10, 3, 1e9);
      const click = buildActions(t).paintBrush("floor", LOBBY_LEFT + 10, 3);
      expect(click.placed, mode).toBe(0);
      expect(shown.valid, mode).toBe(false);
      expect(shown.reason, mode).toBe(t.catalog().rules.previewNamesRefusal ? click.reason : undefined);
    }
  });

  it("leaves out the brush tiles over open air above the ground floor, the anchor too", () => {
    for (const mode of MODES) {
      // Floor 2 spans six tiles. On floor 3 the brush at +4 lays six of its
      // tiles; at +6 its anchor is over open air and four lay.
      for (const [offset, laid] of [[4, 6], [6, 4]] as const) {
        const t = tower(mode);
        lay(t, "floor", 2, range(LOBBY_LEFT, LOBBY_LEFT + 6));
        const strip = laid * prices(t).floor;
        const at = LOBBY_LEFT + offset;
        expect(validAtAndBelow(t, "floor", at, 3, strip), `${mode} at ${at}`).toEqual([true, false]);
        expect(paintWith(t, "floor", at, 3, strip), `${mode} at ${at}`).toBe(laid);
        expect(money(t.s), `${mode} at ${at}`).toBe(0);
        t.setMoney(1e9);
        expect(buildActions(t).paintBrush("floor", at, 3).placed, `${mode} at ${at}, money to spare`).toBe(0);
      }
    }
  });

  it("quotes the ground floor's lobby with its floor on the Floor tool card", () => {
    for (const mode of MODES) {
      const t = tower(mode);
      const card = renderToFragment(toolInfoFor(t.catalog(), "floor")).textContent ?? "";
      expect(card, mode).toContain(`a lobby, $${groupDigits(quote(t, "lobby", 1, LOBBY_RIGHT))} per tile`);
      expect(card, mode).not.toContain("Where there is no floor yet");
    }
  });

  it("gives both lobby prices on the Lobby tool card", () => {
    for (const mode of MODES) {
      const t = tower(mode);
      const sky = t.catalog().world.lobbyInterval;
      for (let fl = 2; fl <= sky; fl++) lay(t, "floor", fl, [LOBBY_LEFT]);
      const card = renderToFragment(toolInfoFor(t.catalog(), "lobby")).textContent ?? "";
      expect(card, mode).toContain(`Cost: $${groupDigits(quote(t, "lobby", sky, LOBBY_LEFT))}`);
      const bare = groupDigits(quote(t, "lobby", 1, LOBBY_RIGHT));
      expect(card, mode).toContain(`Where there is no floor yet: $${bare} per tile, floor included`);
    }
  });

  it("says in the toast what the engine charged each tile when the Floor tool lays a lobby", () => {
    for (const mode of MODES) {
      const t = tower(mode);
      const { lobby, floor } = prices(t);
      t.setMoney(1_000_000);
      const toasts: string[] = [];
      const build = buildActions(t, toasts);
      expect(build.paintBrush("floor", LOBBY_RIGHT, 1).placed, mode).toBe(4);
      expect(money(t.s), mode).toBe(1_000_000 - 4 * (lobby + floor));
      expect(toasts, mode).toEqual([`The ground floor is a lobby, so a lobby ($${groupDigits(lobby + floor)}/tile) went here.`]);
    }
  });
});
