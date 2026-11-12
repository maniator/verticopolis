import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncMotion } from "./towerCrowd";
import { syncFacade, syncScene } from "./towerReconcile";
import { followStep, setSim } from "./towerScene";
import { runSceneSync } from "./towerSyncSchedule";
import { NOT_BAKED } from "./sceneBake";
import { bindViewWorld, viewWorld } from "../../presentation/viewWorld";
import type { RenderSim } from "../renderSim";
import type { TowerEngine } from "./TowerEngine";

// The next frame's sync calls these directly; spy on them so no canvas bakes.
vi.mock("./towerReconcile", async (original) => ({ ...(await original<object>()), syncScene: vi.fn(), syncFacade: vi.fn() }));
vi.mock("./towerCrowd", async (original) => ({ ...(await original<object>()), syncMotion: vi.fn() }));
// A swap binds the new tower's world and kinds; these stand-ins hold none.
vi.mock("../../catalog/towerCatalog", () => ({ towerCatalog: () => ({}) }));
vi.mock("../../presentation/viewWorld", async (original) => ({ ...(await original<object>()), bindViewWorld: vi.fn() }));
vi.mock("../../presentation/viewKinds", async (original) => ({ ...(await original<object>()), bindViewKinds: vi.fn() }));

/**
 * An undo or redo step changes the tower the scene draws, so the renderer
 * keeps its scene and lets the next sync follow the change (towerScene
 * `followStep`), where a swap to another tower tears the scene down
 * (`setSim`). The input and the previews reset, and an effect left over
 * empty space ends.
 */
function sceneUnderStep() {
  const kept = {
    sim: {
      tower: {
        revision: 42,
        mealOverlayRevision: 5,
        // The stepped tower: floors 1 to 3, with a room at (2, 10) and floor at (1, 4).
        highestFloor: 3,
        lowestFloor: 1,
        unitAt: (floor: number, x: number) => (floor === 2 && x === 10 ? { id: 7 } : undefined),
        hasStructure: (floor: number, x: number) => floor === 1 && x === 4,
      },
      clock: { hour: 9 },
    },
    structTiles: new Set(["cell"]),
    animatedRooms: new Map([[7, { kill: vi.fn() }]]),
    transportActors: new Map([[3, { kill: vi.fn() }]]),
    crowdActors: new Map([[11, { actor: { kill: vi.fn() } }]]),
    builtRev: 42,
    mealOverlayRev: 5,
    santaStart: 1234,
    vipStart: 1200,
  };
  const engine = {
    ...kept,
    tracker: { reset: vi.fn() },
    gesture: { kind: "drag" },
    arrowDrag: { from: 1 },
    longPressTimer: setTimeout(() => {}, 1e6),
    longPressFired: true,
    preview: { kind: "office", floor: 2, x: 10, valid: true } as unknown,
    transportPreview: { kind: "elevator", x: 3, bottom: 1, top: 3, valid: true } as unknown,
    explosions: [
      { x: 10, floor: 2, start: 1 },
      { x: 30, floor: 5, start: 1 },
    ],
    treasures: [
      { x: 4, floor: 1, start: 1 },
      { x: 4, floor: -2, start: 1 },
    ],
    thiefStart: 1 as number | null,
    thiefFloor: 6,
    d: { lit: false, hour: 9 },
    litState: false,
    lastSyncHour: 9,
    hourSyncPending: false,
  };
  return { engine, kept };
}

/** The scene of {@link sceneUnderStep} with what a swap tears down, and a
 *  tower for it to swap in, at `revision`. */
function sceneUnderSwap() {
  const { engine, kept } = sceneUnderStep();
  const scene = Object.assign(engine, {
    structTiles: new Set<{ clearGraphics(): void }>(),
    regions: new Map<string, { cv: { flagDirty(): void }; actor?: { kill(): void } }>(),
    regionUnits: new Map(),
    regionDirty: new Set<string>(),
    deadParking: new Set(),
    escapeActors: new Map(),
    craneActor: null,
    roomSig: new Map(),
    transportSig: new Map(),
    floorLive: new Map(),
    carActors: [],
    trainActors: [],
    tunnelActors: [],
    truckActors: [],
    garageCars: [],
    walkers: [],
    adoptCamera: vi.fn(),
  });
  const tower = (revision: number) =>
    ({
      ...kept.sim,
      tower: { ...kept.sim.tower, revision },
      santaFxSeq: 0,
      vipFxSeq: 0,
      explosionFx: { seq: 0 },
      thiefFx: { seq: 0 },
      treasureFx: { seq: 0 },
      view: null,
    }) as unknown as RenderSim;
  return { scene, tower };
}

describe("following an undo or redo step", () => {
  // The fixture arms a long-press timer; no real one outlives a test.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the scene, its caches and the drawn sim", () => {
    const { engine, kept } = sceneUnderStep();
    followStep(engine as unknown as TowerEngine);
    expect(engine.sim).toBe(kept.sim);
    expect([...engine.structTiles]).toEqual(["cell"]);
    expect(engine.animatedRooms.get(7)?.kill).not.toHaveBeenCalled();
    expect(engine.transportActors.get(3)?.kill).not.toHaveBeenCalled();
    expect(engine.crowdActors.get(11)?.actor.kill).not.toHaveBeenCalled();
    expect(engine.builtRev, "the step moved the revision, so the next sync is structural").toBe(42);
    expect(engine.mealOverlayRev).toBe(5);
    expect(engine.santaStart, "an effect in flight keeps flying").toBe(1234);
  });

  it("ends an effect the step left over empty space, and the ghosts judged against the old tower", () => {
    const { engine, kept } = sceneUnderStep();
    followStep(engine as unknown as TowerEngine);
    expect(engine.explosions, "the blast in the room the step kept").toEqual([{ x: 10, floor: 2, start: 1 }]);
    expect(engine.treasures, "the dig on the floor the step kept").toEqual([{ x: 4, floor: 1, start: 1 }]);
    expect(engine.thiefStart, "the thief's floor is above the tower now").toBeNull();
    expect([engine.santaStart, engine.vipStart], "Santa and the limo belong to the whole tower").toEqual([
      kept.santaStart,
      kept.vipStart,
    ]);
    expect([engine.preview, engine.transportPreview]).toEqual([null, null]);
  });

  it("keeps a thief on a floor still in the tower, and ends one below the tower", () => {
    const runs = [2, 0].map((thiefFloor) => {
      const { engine } = sceneUnderStep();
      engine.thiefFloor = thiefFloor;
      followStep(engine as unknown as TowerEngine);
      return engine.thiefStart;
    });
    expect(runs, "floor 2 is in the tower; floor 0 is below its lowest floor").toEqual([1, null]);
  });

  it("drops a half-finished gesture and any pending long press", () => {
    const { engine } = sceneUnderStep();
    followStep(engine as unknown as TowerEngine);
    expect(engine.tracker.reset).toHaveBeenCalledOnce();
    expect(engine.gesture).toBeNull();
    expect(engine.arrowDrag).toBeNull();
    expect(engine.longPressTimer).toBeNull();
    expect(engine.longPressFired).toBe(false);
  });

  it("finds the change on the next frame by the revision the step raised", () => {
    const { engine } = sceneUnderStep();
    followStep(engine as unknown as TowerEngine);
    // The Rust engine raises the tower revision on every done step (enginePort
    // `undo`), and the scene's view reads it through the reader.
    engine.sim.tower.revision = 43;
    runSceneSync(engine as unknown as TowerEngine);
    expect([syncScene, syncMotion, syncFacade].map((sync) => vi.mocked(sync).mock.calls.length)).toEqual([1, 1, 1]);
    expect(engine.builtRev, "the scene now draws the stepped tower").toBe(43);
  });

  it("syncs a step against the revision it drew, and a swap against the initial-bake mark", () => {
    // syncScene reads builtRev to tell a room an undo puts back (bake it this
    // frame) from the initial bake (leave it to the drain), so builtRev must
    // move only after syncScene has run.
    const seen: number[] = [];
    const note = (e: TowerEngine): void => void seen.push(e.builtRev);
    vi.mocked(syncScene).mockImplementationOnce(note).mockImplementationOnce(note);
    const step = sceneUnderStep().engine;
    followStep(step as unknown as TowerEngine);
    step.sim.tower.revision = 43;
    runSceneSync(step as unknown as TowerEngine);
    const swap = { ...sceneUnderStep().engine, builtRev: NOT_BAKED, regionDirty: new Set(), regions: new Map() };
    runSceneSync(swap as unknown as TowerEngine);
    expect(seen, "the step, then the swap").toEqual([42, NOT_BAKED]);
    expect([step.builtRev, swap.builtRev], "each moves after its sync").toEqual([43, 42]);
  });

  it("would leave the scene as it was if a step did not raise the revision", () => {
    const { engine } = sceneUnderStep();
    followStep(engine as unknown as TowerEngine);
    runSceneSync(engine as unknown as TowerEngine);
    expect([syncScene, syncMotion, syncFacade].map((sync) => vi.mocked(sync).mock.calls.length)).toEqual([0, 0, 0]);
  });
});

describe("a swap to another tower", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("marks the torn-down scene unbaked, so a tower at the old tower's revision still bakes", () => {
    const { scene, tower } = sceneUnderSwap();
    setSim(scene as unknown as TowerEngine, tower(42));
    expect(scene.builtRev, "the old tower drew revision 42 too").toBe(NOT_BAKED);
    runSceneSync(scene as unknown as TowerEngine);
    expect(syncScene).toHaveBeenCalledOnce();
    expect(scene.builtRev).toBe(42);
  });

  it("clears the regions the initial bake queued, and leaves a step's to the budgeted drain", () => {
    const queued = (follow: "swap" | "step") => {
      const { scene, tower } = sceneUnderSwap();
      if (follow === "swap") setSim(scene as unknown as TowerEngine, tower(42));
      else {
        followStep(scene as unknown as TowerEngine);
        scene.sim.tower.revision = 43;
      }
      const flagDirty = vi.fn();
      scene.regions.set("r", { cv: { flagDirty } });
      scene.regionDirty.add("r");
      runSceneSync(scene as unknown as TowerEngine);
      return [[...scene.regionDirty], flagDirty.mock.calls.length];
    };
    expect(queued("swap"), "flagged at once, nothing left queued").toEqual([[], 1]);
    expect(queued("step"), "still queued for the drain").toEqual([["r"], 0]);
  });
});

/** The scene of {@link sceneUnderSwap} with a structure map whose row 0 is
 *  `topFloor`, and an Excalibur engine that records what enters and leaves. */
function sceneWithStructMap(topFloor: number) {
  const { scene, tower } = sceneUnderSwap();
  const oldMap = { kind: "the map built for the old tower" };
  const withMap = Object.assign(scene, {
    structTileMap: oldMap,
    structTopFloor: topFloor,
    engine: { add: vi.fn(), remove: vi.fn() },
    worldYTop: (floor: number) => -floor * 10,
  });
  return { scene: withMap, tower, oldMap };
}

describe("a swap to a tower with another top floor (#1985)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("builds a structure map of the new tower's height and drops the old one", () => {
    const world = viewWorld();
    const { scene, tower, oldMap } = sceneWithStructMap(world.maxFloor - 20);
    setSim(scene as unknown as TowerEngine, tower(42));
    const map = scene.structTileMap as unknown as { rows: number; columns: number };
    expect(scene.engine.remove, "the old map leaves the scene").toHaveBeenCalledWith(oldMap);
    expect(scene.engine.add, "the new one enters it").toHaveBeenCalledWith(map);
    expect(map).not.toBe(oldMap);
    expect([map.rows, map.columns], "one row per floor of the bound world").toEqual([world.maxFloor - world.minFloor + 1, world.lotWidth]);
    expect(scene.structTopFloor, "the tile pass now maps floors against this map").toBe(world.maxFloor);
  });

  it("keeps the structure map for a tower with the same top floor", () => {
    const { scene, tower, oldMap } = sceneWithStructMap(viewWorld().maxFloor);
    setSim(scene as unknown as TowerEngine, tower(42));
    expect(scene.structTileMap).toBe(oldMap);
    expect([scene.engine.remove, scene.engine.add].map((f) => f.mock.calls.length)).toEqual([0, 0]);
  });

  it("leaves the scene as it was when the swapped-in tower's lot is refused", () => {
    const { scene, tower, oldMap } = sceneWithStructMap(viewWorld().maxFloor - 20);
    const cell = { clearGraphics: vi.fn() };
    scene.structTiles.add(cell);
    vi.mocked(bindViewWorld).mockImplementationOnce(() => {
      throw new Error("the catalog's lot differs from the one the view was built for");
    });
    expect(() => setSim(scene as unknown as TowerEngine, tower(42))).toThrow(/differs/);
    expect(scene.structTileMap, "no map was rebuilt").toBe(oldMap);
    expect(cell.clearGraphics, "no cell was cleared").not.toHaveBeenCalled();
    expect(scene.builtRev, "the old tower's bake stands").toBe(42);
  });
});
