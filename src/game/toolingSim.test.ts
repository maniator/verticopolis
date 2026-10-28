import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import type { EnginePort } from "../simport/enginePort";
import type { HudSource } from "../ui/uiStatus";
import { adoptToolingSim, syncToolingSim, toolingSim } from "./toolingSim";

/** The app the harness's tower follows, on `port`. */
function appOn(port: EnginePort) {
  const update = vi.fn<() => void>();
  const reader = Object.assign({ header: { logSeq: 0 }, tower: {} } as unknown as HudSource["reader"], { update });
  const portCodes = { kind: () => 4, code: () => 0, slot: () => 0 };
  return { enginePort: port, reader, portCodes, ui: { lastLogSeq: 0, resetLog: vi.fn(), update: vi.fn() }, followSwap: vi.fn(), followEdit: vi.fn() };
}

/** A stand-in for the Rust engine: it holds a save, restores one, and is not
 *  the TypeScript engine. */
function rustLike(seed = 5) {
  let text = JSON.stringify(Simulation.newGame(seed).serialize());
  const port = {
    serialize: vi.fn(() => text),
    stateDigest: () => text,
    restore: vi.fn((next: string) => {
      text = next;
      return Float64Array.of(1, 2);
    }),
    tick: vi.fn((dt: number) => {
      const save = JSON.parse(text) as { minutes: number };
      save.minutes += dt;
      text = JSON.stringify(save);
    }),
    buildAt: vi.fn((_kind: number, _floor: number, _x: number) => Float64Array.of(1, 0)),
    lastReason: () => "refused",
  };
  const app = appOn(port as unknown as EnginePort);
  return { app, port, saved: () => JSON.parse(text) as { money: number } };
}

describe("the tooling harnesses' tower", () => {
  it("is the TypeScript engine's own tower on that engine", () => {
    const sim = Simulation.newGame(3);
    const app = appOn(new TsEngine(sim));
    expect(toolingSim(app)).toBe(sim);
    syncToolingSim(app);
    expect(app.followSwap).not.toHaveBeenCalled();
  });

  it("is a copy of the Rust engine's save that hands a field write to the engine at once", () => {
    const { app, port, saved } = rustLike();
    const sim = toolingSim(app)!;
    expect(toolingSim(app)).toBe(sim); // kept while the engine is unchanged
    sim.vipFavorable = true;
    expect((saved() as unknown as { vipFavorable: boolean }).vipFavorable).toBe(true);
    expect(port.restore).toHaveBeenCalledTimes(1);
    expect(app.followEdit).toHaveBeenCalledOnce();
    expect(app.ui.update).toHaveBeenCalledOnce(); // before the load, so no line is lost to it
    expect(app.followSwap).not.toHaveBeenCalled();
    expect(toolingSim(app)).toBe(sim);
  });

  it("hands the lines the copy logged on to the bulletin with the edit, and only those", () => {
    const { app } = rustLike();
    const sim = toolingSim(app)!;
    sim.vipFavorable = true;
    expect(app.followEdit).toHaveBeenLastCalledWith(undefined);
    sim.emit("Congratulations! Your tower reached 2 stars.", "good");
    expect(app.followEdit).toHaveBeenCalledTimes(2);
    const shown = app.followEdit.mock.lastCall![0] as Simulation;
    expect(shown.log[shown.log.length - 1]?.text).toBe("Congratulations! Your tower reached 2 stars.");
    // The bulletin reads the whole log from nothing: the saved tail and the new line.
    expect(new TsEngine(shown).logAfter(0)).toHaveLength(2 * 3);
    sim.vipFavorable = false;
    expect(app.followEdit).toHaveBeenLastCalledWith(undefined);
  });

  it("sends a build and a money write to the engine as its own commands, beside the copy's", () => {
    const { app, port } = rustLike();
    const setMoney = vi.fn();
    Object.assign(port, { setMoney });
    const sim = toolingSim(app)!;
    sim.money = 1e9;
    expect(setMoney).toHaveBeenCalledExactlyOnceWith(1e9);
    expect(sim.build("lobby", 1, 160).ok).toBe(true);
    expect(port.buildAt).toHaveBeenCalledExactlyOnceWith(4, 1, 160);
    expect(sim.tower.unitAt(1, 160)?.kind).toBe("lobby");
    // Neither is a restore, which would start the crowd empty.
    expect(port.restore).not.toHaveBeenCalled();
    port.buildAt.mockReturnValueOnce(Float64Array.of(0, 0));
    expect(() => sim.build("lobby", 1, 161)).toThrow(/the engines disagree on build: the Rust engine refused it \(refused\)/);
  });

  it("runs a string of builds without reading the copy's whole state", () => {
    const { app, port } = rustLike();
    const sim = toolingSim(app)!;
    const serialize = vi.spyOn(Simulation.prototype, "serialize");
    for (let x = 150; x < 160; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(serialize).not.toHaveBeenCalled();
    expect(port.buildAt).toHaveBeenCalledTimes(10);
    serialize.mockRestore();
  });

  it("still hands on a write to a part a method handed out before a build", async () => {
    const { app, saved } = rustLike();
    const sim = toolingSim(app)!;
    sim.tower.place("lobby", 1, 160);
    syncToolingSim(app);
    const unit = sim.tower.unitAt(1, 160) as unknown as { x: number };
    expect(sim.build("lobby", 1, 161).ok).toBe(true);
    unit.x = 170;
    await Promise.resolve();
    const units = (saved() as unknown as { units: { x: number }[] }).units;
    expect(units.some((u) => u.x === 170)).toBe(true);
  });

  it("hands a deeper edit on at the end of the task, or at once when synced", async () => {
    const { app, port, saved } = rustLike();
    const units = () => (saved() as unknown as { units: unknown[] }).units.length;
    const before = units();
    toolingSim(app)!.tower.place("lobby", 1, 160);
    expect(units()).toBe(before);
    await Promise.resolve();
    expect(units()).toBe(before + 1);
    toolingSim(app)!.tower.place("lobby", 1, 161);
    syncToolingSim(app);
    expect(units()).toBe(before + 2);
    expect(port.restore).toHaveBeenCalledTimes(2);
  });

  it("drops a copy nobody changed without a restore", async () => {
    const { app, port } = rustLike();
    void toolingSim(app)!.money;
    void toolingSim(app)!.serialize();
    syncToolingSim(app);
    await Promise.resolve();
    expect(port.restore).not.toHaveBeenCalled();
    expect(app.followEdit).not.toHaveBeenCalled();
  });

  it("ticks the engine itself, and reads a fresh copy after", () => {
    const { app, port, saved } = rustLike();
    const sim = toolingSim(app)!;
    const minutes = sim.clock.minutes;
    sim.tick(30);
    expect(port.tick).toHaveBeenCalledExactlyOnceWith(30);
    expect(app.reader.update).toHaveBeenCalled();
    expect((saved() as unknown as { minutes: number }).minutes).toBe(minutes + 30);
    expect(toolingSim(app)!.clock.minutes).toBe(minutes + 30);
  });

  it("keeps one view that reads the engine's tower as it is now", async () => {
    const { app, port } = rustLike();
    const sim = toolingSim(app)!;
    const minutes = sim.clock.minutes;
    port.tick(60); // the frame loop runs between tasks
    await Promise.resolve();
    expect(toolingSim(app)).toBe(sim);
    expect(sim.clock.minutes).toBe(minutes + 60);
    expect(sim).toBeInstanceOf(Simulation);
    expect("tower" in sim).toBe(true);
    expect(Object.keys(sim)).toContain("money");
  });

  it("keeps a held part of the tower reading the engine's tower as it is now", async () => {
    const { app, port, saved } = rustLike();
    const sim = toolingSim(app)!;
    const tower = sim.tower;
    expect(sim.tower).toBe(tower);
    expect(tower.unitAt(1, 160)).toBeUndefined();
    // The engine takes a lobby the copy never saw, as a build through the game does.
    const save = saved() as unknown as Record<string, unknown>;
    const built = Simulation.deserialize(save as never);
    built.tower.place("lobby", 1, 160);
    port.restore(JSON.stringify(built.serialize()));
    syncToolingSim(app);
    expect(tower.unitAt(1, 160)?.kind).toBe("lobby");
    // An edit through the held part reaches the engine.
    const units = () => (saved() as unknown as { units: unknown[] }).units.length;
    const before = units();
    tower.place("lobby", 1, 161);
    await Promise.resolve();
    expect(units()).toBe(before + 1);
    expect(Array.isArray(sim.crowd.people)).toBe(true);
  });

  it("drops loudly an edit the engine moved on from before it got it", () => {
    const { app, port } = rustLike();
    const sim = toolingSim(app)!;
    sim.tower.place("lobby", 1, 160);
    port.tick(60);
    expect(() => syncToolingSim(app)).toThrow(/game.sim has an edit the engine never got/);
    expect(port.restore).not.toHaveBeenCalled();
    expect(sim.tower.unitAt(1, 160)).toBeUndefined();
  });

  it("checks the copy against the engine once a task, and again after a sync", async () => {
    const { app } = rustLike();
    const digest = vi.fn(() => (app.enginePort as unknown as { serialize(): string }).serialize());
    Object.assign(app.enginePort, { stateDigest: digest });
    const sim = toolingSim(app)!;
    for (let i = 0; i < 5; i++) void sim.tower.units.length;
    expect(digest).toHaveBeenCalledOnce();
    syncToolingSim(app);
    void sim.money;
    expect(digest).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    void sim.money;
    expect(digest).toHaveBeenCalledTimes(3);
  });

  it("carries the telemetry and the loop memos, which the save does not, both ways", () => {
    const { app, port } = rustLike();
    const doc = { util: [[3, 0.5]], hourly: [], origins: [] };
    let memos = Float64Array.of(7, 1, 0, 0);
    const tooling = Object.assign(port, {
      elevatorTelemetry: () => JSON.stringify(doc),
      loopMemos: () => memos,
      seedElevatorTelemetry: vi.fn(),
      seedLoopMemos: vi.fn((...m: number[]) => {
        memos = Float64Array.from(m);
      }),
    });
    const sim = toolingSim(app)!;
    expect([...sim.elevatorUtil]).toEqual([[3, 0.5]]);
    expect(sim.lastHour).toBe(7);
    sim.lastHour = 8;
    expect(tooling.seedLoopMemos).toHaveBeenCalledExactlyOnceWith(8, 1, 0, 0);
    expect(JSON.parse(tooling.seedElevatorTelemetry.mock.calls[0][0] as string)).toEqual(doc);
  });

  it("swaps in a hand-built tower on either engine", () => {
    const { app, saved } = rustLike();
    const built = Simulation.newGame(9);
    built.money = 4242;
    adoptToolingSim(app, built, false);
    expect(saved().money).toBe(4242);
    // A view handed back is read as its copy.
    adoptToolingSim(app, toolingSim(app)!, true);
    expect(saved().money).toBe(4242);
    expect(app.followSwap.mock.calls).toEqual([[false], [true]]);
    // The bulletin reads the swapped-in tower's own log, which a load numbers from nothing.
    expect(app.ui.resetLog).toHaveBeenCalledTimes(2);
    const ts = appOn(new TsEngine(Simulation.newGame(1)));
    adoptToolingSim(ts, built, true);
    expect((ts.enginePort as TsEngine).sim).toBe(built);
    expect(ts.followSwap).toHaveBeenCalledExactlyOnceWith(true);
    expect(ts.ui.resetLog).not.toHaveBeenCalled();
  });
});
