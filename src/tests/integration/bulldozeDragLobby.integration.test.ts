import { describe, expect, it } from "vitest";
import * as ex from "excalibur";
import type { GameApp } from "../../main";
import type { GameMode } from "../../shared/types";
import { BuildActions } from "../../game/buildActions";
import { BulldozeDragChoice } from "../../game/bulldozeDrag";
import { wireEngine } from "../../game/engineWiring";
import { NO_GESTURE } from "../../game/appHistory";
import { catalogOf, isUnlocked, newRenderSim, newViewReader } from "../../game/portAccess";
import { PortCodes } from "../../simport/portCodes";
import { pickEntityAt } from "../../render/excalibur/towerInputCamera";
import type { TowerEngine } from "../../render/excalibur/TowerEngine";
import { FLOOR, TILE } from "../../render/scale";
import { look, must, newEngine, noEngine } from "../portKit/rustEngine";

/**
 * A bulldoze drag across a sky lobby, on the Rust engine the game ships, and
 * through the game's own press and move wiring. Modern lets the bulldozer
 * take a sky lobby out (3.10.5), and one drag clears every tile it crosses;
 * the tiles a shaft stops on stay, and so does the shaft unless the Bulldoze
 * card says a drag clears everything. Classic keeps every lobby, as in 1994.
 */

const LEFT = 100;
const RIGHT = 130; // exclusive
const SHAFT_X = 120;

/** A tower with a lobby, floors 2 to 14 and a sky lobby on the catalog's
 *  sky-lobby floor across x 100 to 129, and a standard elevator from 14 up to
 *  the sky lobby at x 120. */
function skyLobbyTower(mode: GameMode) {
  const port = newEngine(3, mode);
  const sim = look(port);
  sim.money = 1e9;
  const reader = newViewReader(port);
  reader.update();
  const sky = catalogOf({ enginePort: port, reader }).world.lobbyInterval;
  for (let x = LEFT; x < RIGHT; x++) {
    must(sim.tower.place("lobby", 1, x), `lobby at ${x}`);
    for (let f = 2; f < sky; f++) must(sim.tower.place("floor", f, x), `floor ${f} at ${x}`);
    must(sim.tower.place("lobby", sky, x), `sky lobby at ${x}`);
  }
  must(sim.tower.placeTransport("elevatorStandard", SHAFT_X, sky - 1, sky), "elevator");
  reader.update();
  return { port, sim, reader, sky };
}

type Tower = ReturnType<typeof skyLobbyTower>;

/** The game's wiring over `t`, with the real build actions, and a pointer
 *  that picks what the renderer would at a tile. */
function wired(t: Tower) {
  const codes = new PortCodes(t.port);
  const renderSim = newRenderSim(t.port, t.reader);
  const undo = { gesture: NO_GESTURE };
  const build = new BuildActions({
    enginePort: () => t.port,
    portCodes: () => codes,
    reader: () => t.reader,
    catalog: () => catalogOf({ enginePort: t.port, reader: t.reader }),
    isUnlocked: (k) => isUnlocked({ reader: t.reader }, k),
    ui: { toast: () => {} },
    audio: { sfx: () => {} },
    selectedId: () => null,
    clearSelection: () => {},
    lobbyHeight: () => 1,
  });
  const hooks = {} as {
    onActionDown: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
    onActionMove: (tile: number, floor: number, picked: unknown) => void;
    onActionUp: () => void;
  };
  const app = {
    engine: hooks,
    enginePort: t.port,
    reader: t.reader,
    canvas: document.createElement("canvas"),
    audio: { start: () => {} },
    keyboard: { pointerDrew: () => {}, followTower: () => {} },
    tool: { type: "bulldoze" },
    bulldozeDrag: new BulldozeDragChoice(),
    build,
    ui: { toast: () => {} },
    captureUndo: () => (undo.gesture += 1),
    commitUndo: () => (undo.gesture = NO_GESTURE),
    discardUndo: () => {},
    undoGesture: () => undo.gesture,
    paintAnchor: null,
    buildAnchor: null,
    transportStart: null,
  };
  wireEngine(app as unknown as GameApp);
  const pick = (tile: number, floor: number) => {
    t.reader.update(); // a frame passes between pointer moves
    // The renderer picks a shaft by its actor; this stand-in covers exactly
    // the cells the engine says the shaft stands in.
    const actors = new Map(
      shafts(t).map((s) => [
        s.id,
        {
          z: 1,
          contains: (wx: number, wy: number) => t.sim.tower.transportAt(Math.ceil(-wy / FLOOR), Math.floor(wx / TILE))?.id === s.id,
        },
      ]),
    );
    const e = { transportActors: actors, sim: renderSim } as unknown as TowerEngine;
    return pickEntityAt(e, ex.vec((tile + 0.5) * TILE, -(floor - 0.5) * FLOOR));
  };
  /** Press on `from` and drag tile by tile to `to` along `floor`. */
  const drag = (floor: number, from: number, to: number) => {
    hooks.onActionDown(from, floor, false, pick(from, floor));
    for (let x = from + 1; x <= to; x++) hooks.onActionMove(x, floor, pick(x, floor));
    hooks.onActionUp();
    t.reader.update();
  };
  return { app, drag };
}

/** The columns along the sky lobby that still hold a lobby tile. */
const lobbyLeft = (t: Tower) => {
  const left: number[] = [];
  for (let x = LEFT; x < RIGHT; x++) if (t.sim.tower.structureKindAt(t.sky, x) === "lobby") left.push(x);
  return left;
};

/** The tower's shafts as the engine has them now (a fresh look, since the
 *  tooling tower's records predate the drag's own commands). */
const shafts = (t: Tower) => look(t.port).tower.transports;

/** The columns the elevator covers on the sky lobby, which no drag may take
 *  out from under it. */
const shaftCols = (t: Tower) => {
  const cols: number[] = [];
  for (let x = LEFT; x < RIGHT; x++) if (t.sim.tower.transportAt(t.sky, x)) cols.push(x);
  return cols;
};

describe.skipIf(noEngine)("a bulldoze drag across a sky lobby", () => {
  it("clears every Modern sky lobby tile it crosses, and leaves the elevator and the tiles it stands on", () => {
    const t = skyLobbyTower("modern");
    const { drag } = wired(t);
    const cols = shaftCols(t);
    expect(cols.length).toBeGreaterThan(0);
    const money = t.sim.money;
    drag(t.sky, LEFT, RIGHT - 1);
    expect(lobbyLeft(t), "only the tiles the shaft stands on stay").toEqual(cols);
    expect(shafts(t), "the elevator the drag crossed stays").toHaveLength(1);
    expect(t.sim.money, "every tile sold for a refund").toBeGreaterThan(money);
    // The floors under the hall are untouched.
    for (let x = LEFT; x < RIGHT; x++) expect(t.sim.tower.structureKindAt(t.sky - 1, x), `floor at ${x}`).toBe("floor");
  });

  it("clears the elevator too, and then the tiles it stood on, once the card says Everything", () => {
    const t = skyLobbyTower("modern");
    const { app, drag } = wired(t);
    app.bulldozeDrag.pick("everything");
    drag(t.sky, LEFT, RIGHT - 1);
    expect(shafts(t), "the drag sold the elevator").toHaveLength(0);
    // The press over the shaft sold it; every later tile the drag reached
    // was free to go, so at most the shaft's first column is left.
    expect(lobbyLeft(t).length).toBeLessThanOrEqual(1);
  });

  it("keeps every Classic lobby tile, as in 1994", () => {
    const t = skyLobbyTower("classic");
    const { drag } = wired(t);
    const money = t.sim.money;
    drag(t.sky, LEFT, RIGHT - 1);
    expect(lobbyLeft(t)).toHaveLength(RIGHT - LEFT);
    expect(t.sim.money).toBe(money);
  });

  it("keeps the ground lobby in Modern: it is the tower's front door", () => {
    const t = skyLobbyTower("modern");
    const { drag } = wired(t);
    drag(1, LEFT, RIGHT - 1);
    for (let x = LEFT; x < RIGHT; x++) expect(t.sim.tower.structureKindAt(1, x), `ground lobby at ${x}`).toBe("lobby");
  });
});
