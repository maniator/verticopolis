import { describe, expect, it, vi } from "vitest";
import type { EnginePort } from "../simport/enginePort";
import type { HudSource } from "../ui/uiStatus";
import { hasWasmPackage, wasm } from "../tests/conformance/wasmEngine";
import { adoptToolingSim, syncToolingSim, toolingSim } from "./toolingSim";
import type { ToolingEngine, ToolingTowerClass } from "./toolingTower";

// The tower drives the real Rust engine, so this is an integration suite: a
// unit test mocks the engine instead of running it. It runs where the engine
// package is built (a local build, `test:wasm:host` on the test-engine (host)
// shards) and skips without one.

interface Unit {
  id: number;
  kind: string;
  state?: string;
  everOccupied?: boolean;
}

/** The app the harness's tower follows, on a real engine. */
function app(seed = 5) {
  const engine = wasm().Engine.newGame(seed, "classic") as unknown as ToolingEngine;
  engine.setMoney(1e9);
  const restore = vi.spyOn(engine, "restore");
  const update = vi.fn<() => void>();
  const reader = Object.assign({ header: { logSeq: 0 }, tower: {} } as unknown as HudSource["reader"], { update });
  const events: string[] = [];
  const ui = {
    lastLogSeq: 0,
    resetLog: vi.fn(),
    update: vi.fn(() => events.push("bulletin")),
  };
  const a = {
    enginePort: engine as unknown as EnginePort,
    reader,
    portCodes: { kind: () => 4, code: () => 0, slot: () => 0 } as unknown as HudSource["codes"],
    ui,
    followSwap: vi.fn(),
    followEdit: vi.fn(() => events.push("followEdit")),
  };
  const saved = () => JSON.parse(engine.serialize()) as { money: number; star: number; minutes: number; units: Unit[] };
  return { app: a, engine, restore, events, saved };
}

/** The bulletin's text, as resetLog reads it from a port. */
function bulletin(port: HudSource["port"]): (string | undefined)[] {
  const rec = port.logAfter(0);
  const out: (string | undefined)[] = [];
  for (let i = 0; i + 2 < rec.length; i += 3) out.push(port.logText(rec[i]));
  return out;
}

/** A ground lobby and one floor, through the tower's bare edits. */
function floorOn(sim: NonNullable<ReturnType<typeof toolingSim>>): void {
  for (let x = 150; x < 200; x++) {
    expect(sim.tower.place("lobby", 1, x), `lobby at ${x}`).toMatchObject({ ok: true });
    expect(sim.tower.place("floor", 2, x), `floor at ${x}`).toMatchObject({ ok: true });
  }
}

describe.skipIf(!hasWasmPackage())("the tooling harnesses' tower", () => {
  it("places bare on the engine and loads the tower when the task ends", async () => {
    const { app: a, engine, restore, events, saved } = app();
    const sim = toolingSim(a)!;
    expect(toolingSim(a)).toBe(sim);
    floorOn(sim);
    const money = sim.money;
    const r = sim.tower.place("office", 2, 160);
    expect(r).toMatchObject({ ok: true });
    // Bare: no charge, and no load yet.
    expect(sim.money).toBe(money);
    expect(restore).not.toHaveBeenCalled();
    const u = sim.tower.getUnit(r.unitId!)!;
    u.state = "occupied";
    u.everOccupied = true;
    // The write reads back before the engine has it.
    expect(sim.tower.getUnit(r.unitId!)).toMatchObject({ state: "occupied", everOccupied: true });
    expect(sim.tower.units.find((x) => x.id === r.unitId)).toMatchObject({ state: "occupied" });
    expect(JSON.parse(engine.unitRecord(r.unitId!)!)).not.toMatchObject({ state: "occupied" });
    await Promise.resolve();
    expect(restore).toHaveBeenCalledOnce();
    expect(saved().units.find((x) => x.id === r.unitId)).toMatchObject({ state: "occupied", everOccupied: true });
    // The bulletin reads the engine's lines before the load drops them.
    expect(events).toEqual(["bulletin", "followEdit"]);
  });

  it("runs a command, a tick and a money write on the engine, with no load", () => {
    const { app: a, restore, saved } = app();
    const sim = toolingSim(a)!;
    sim.money = 424_242;
    expect(saved().money).toBe(424_242);
    expect(sim.build("lobby", 1, 150)).toEqual({ ok: true });
    expect(sim.money).toBeLessThan(424_242);
    const minutes = sim.clock.minutes;
    sim.tick(5);
    expect(sim.clock.minutes).toBe(minutes + 5);
    expect(restore).not.toHaveBeenCalled();
    expect(a.reader.update).toHaveBeenCalledTimes(3);
  });

  it("loads pending edits before a command, so the command reads them", () => {
    const { app: a, restore, saved } = app();
    const sim = toolingSim(a)!;
    floorOn(sim);
    sim.star = 3;
    sim.evaluateStar();
    expect(restore).toHaveBeenCalledOnce();
    expect(saved().star).toBeGreaterThanOrEqual(1);
  });

  it("loads a patch that moves a room before the next placement", () => {
    const { app: a, restore } = app();
    const sim = toolingSim(a)!;
    floorOn(sim);
    const r = sim.tower.place("office", 2, 160);
    sim.tower.getUnit(r.unitId!)!.state = "occupied";
    sim.tower.place("office", 2, 170);
    expect(restore).not.toHaveBeenCalled();
    (sim.tower.getUnit(r.unitId!) as unknown as { x: number }).x = 180;
    sim.tower.place("office", 2, 160);
    expect(restore).toHaveBeenCalledOnce();
  });

  it("hands its edits on at once through syncSim, and writes the clock and the pending choice", () => {
    const { app: a, saved } = app();
    const sim = toolingSim(a)!;
    sim.clock.minutes = 3 * 1440 + 600;
    expect([sim.clock.day, sim.clock.minuteOfDay]).toEqual([3, 600]);
    sim.events.pending = { kind: "bombThreat", cost: 5, message: "m" };
    expect(sim.pendingChoice).toEqual({ kind: "bombThreat", cost: 5, message: "m" });
    syncToolingSim(a);
    expect(saved().minutes).toBe(3 * 1440 + 600);
    expect(sim.pendingChoice).toMatchObject({ kind: "bombThreat", cost: 5 });
    // An edit in place on the loaded choice is a patch too.
    (sim.events.pending as { cost: number }).cost = 10;
    syncToolingSim(a);
    expect(sim.pendingChoice).toMatchObject({ kind: "bombThreat", cost: 10 });
  });

  it("loads its patches over what the engine holds now, and loads nothing after a refused edit", async () => {
    const { app: a, engine, restore, saved } = app();
    const sim = toolingSim(a)!;
    sim.star = 2;
    const minutes = sim.serialize().minutes;
    // The engine moves under the tower's read, in the same task.
    engine.tick(60);
    syncToolingSim(a);
    expect(saved()).toMatchObject({ star: 2, minutes: minutes + 60 });
    restore.mockClear();
    expect(sim.tower.place("castle", 1, 150)).toMatchObject({ ok: false });
    expect(sim.tower.place("office", 9, 150)).toMatchObject({ ok: false });
    expect(sim.tower.removeUnit(-1)).toBeUndefined();
    await Promise.resolve();
    expect(restore).not.toHaveBeenCalled();
  });

  it("finds a moved room where its record says, and keeps a setter's write over an earlier patch", () => {
    const { app: a, saved } = app();
    const sim = toolingSim(a)!;
    floorOn(sim);
    const r = sim.tower.place("office", 2, 160);
    expect(r).toMatchObject({ ok: true });
    (sim.tower.getUnit(r.unitId!) as unknown as { x: number }).x = 180;
    expect(sim.tower.roomAt(2, 181)).toMatchObject({ id: r.unitId, x: 180 });
    expect(sim.tower.roomAt(2, 161)).toBeUndefined();
    const shaft = sim.tower.placeTransport("elevatorStandard", 152, 1, 2);
    expect(shaft).toMatchObject({ ok: true });
    (sim.tower.getTransport(shaft.transportId!) as unknown as { cars: number }).cars = 2;
    expect(sim.tower.setCars(shaft.transportId!, 3)).toBe(true);
    syncToolingSim(a);
    expect((saved() as unknown as { transports: { id: number; cars: number }[] }).transports.find((t) => t.id === shaft.transportId)?.cars).toBe(3);
  });

  it("keeps the edits two views of the same shaft make, whichever was read first", () => {
    const { app: a, saved } = app();
    const sim = toolingSim(a)!;
    floorOn(sim);
    const shaft = sim.tower.placeTransport("elevatorStandard", 152, 1, 2);
    expect(shaft).toMatchObject({ ok: true });
    expect(sim.tower.setSchedule(shaft.transportId!, { waitingCarResponse: 2, standardFloorDeparture: 10 })).toBe(true);
    syncToolingSim(a);
    type View = { cars: number; schedule: { waitingCarResponse: number; standardFloorDeparture: number } };
    const first = sim.tower.getTransport(shaft.transportId!) as unknown as View;
    const second = sim.tower.getTransport(shaft.transportId!) as unknown as View;
    first.cars = 2;
    expect(second.cars).toBe(2);
    first.schedule.waitingCarResponse = 3;
    second.schedule.standardFloorDeparture = 20;
    syncToolingSim(a);
    const t = (saved() as unknown as { transports: ({ id: number } & View)[] }).transports.find((x) => x.id === shaft.transportId);
    expect(t).toMatchObject({ cars: 2, schedule: { waitingCarResponse: 3, standardFloorDeparture: 20 } });
  });

  it("carries the telemetry and the loop memos across its loads", () => {
    const { app: a, engine } = app();
    const sim = toolingSim(a)!;
    floorOn(sim);
    const shaft = sim.tower.placeTransport("elevatorStandard", 152, 1, 2);
    sim.elevatorHourly.set(shaft.transportId!, { weekday: Array<number>(24).fill(0.5), weekend: Array<number>(24).fill(0.25) });
    engine.seedLoopMemos(7, 1, 0, 0);
    const telemetry = engine.elevatorTelemetry();
    syncToolingSim(a);
    expect(engine.elevatorTelemetry()).toBe(telemetry);
    expect([...engine.loopMemos()]).toEqual([7, 1, 0, 0]);
  });

  it("swaps in a tower built off the app, with the lines it logged", () => {
    const { app: a, saved } = app();
    const live = toolingSim(a)!;
    const built = (live.constructor as unknown as ToolingTowerClass).newGame(9, "classic");
    built.money = 4242;
    for (let x = 150; x < 160; x++) built.tower.place("lobby", 1, x);
    const lines = bulletin(built.port as unknown as HudSource["port"]);
    adoptToolingSim(a, built, false);
    expect(saved().money).toBe(4242);
    expect(saved().units).toHaveLength(10);
    expect(a.followSwap).toHaveBeenCalledExactlyOnceWith("swap");
    // The bulletin reads the lines the built tower's own engine logged.
    expect(bulletin(a.ui.resetLog.mock.calls[0][0].port)).toEqual(lines);
    // A copy of the save, and the live tower handed back, load as themselves.
    const copy = (live.constructor as unknown as ToolingTowerClass).deserialize(live.serialize());
    copy.star = 2;
    adoptToolingSim(a, copy, true);
    expect(saved().star).toBe(2);
    adoptToolingSim(a, live, true);
    expect(saved().star).toBe(2);
    expect(a.followSwap.mock.calls).toEqual([["swap"], ["restore"], ["restore"]]);
    expect(() => adoptToolingSim(a, {} as typeof live, true)).toThrow("adoptSim takes a tower");
  });

  it("keeps the lines a swapped-in tower logged before the load of its own pending edits", () => {
    const { app: a } = app();
    const live = toolingSim(a)!;
    const built = (live.constructor as unknown as ToolingTowerClass).newGame(9, "classic");
    for (let x = 150; x < 160; x++) expect(built.build("lobby", 1, x)).toMatchObject({ ok: true });
    const lines = bulletin(built.port as unknown as HudSource["port"]);
    expect(lines.length).toBeGreaterThan(0);
    // A bare edit is pending, so the swap loads it into the built tower's own
    // engine first, which numbers that engine's log from nothing.
    expect(built.tower.place("floor", 2, 150)).toMatchObject({ ok: true });
    adoptToolingSim(a, built, false);
    expect(bulletin(a.ui.resetLog.mock.calls[0][0].port)).toEqual(lines);
  });

  it("keeps the bulletin when the app's own tower is handed back to it", () => {
    const { app: a } = app();
    const live = toolingSim(a)!;
    const held = bulletin(a.enginePort as unknown as HudSource["port"]);
    expect(held.length).toBeGreaterThan(0);
    // The load numbers the engine's log from nothing; the lines read before it stay.
    adoptToolingSim(a, live, true);
    expect(bulletin(a.enginePort as unknown as HudSource["port"])).toEqual([]);
    expect(bulletin(a.ui.resetLog.mock.calls[0][0].port)).toEqual(held);
  });

  it("keeps the lines an earlier load dropped when the app's own tower is handed back to it", async () => {
    const { app: a } = app();
    const live = toolingSim(a)!;
    const held = bulletin(a.enginePort as unknown as HudSource["port"]);
    expect(held.length).toBeGreaterThan(0);
    // An edit loads at the end of the task, which numbers the engine's log from nothing.
    live.star = 2;
    await Promise.resolve();
    expect(bulletin(a.enginePort as unknown as HudSource["port"])).toEqual([]);
    adoptToolingSim(a, live, true);
    expect(bulletin(a.ui.resetLog.mock.calls[0][0].port)).toEqual(held);
    // A second hand-back still shows them.
    adoptToolingSim(a, live, true);
    expect(bulletin(a.ui.resetLog.mock.calls[1][0].port)).toEqual(held);
  });

  it("reads the engine again at syncSim with nothing pending", () => {
    const { app: a, engine } = app();
    const sim = toolingSim(a)!;
    const minutes = sim.clock.minutes;
    engine.tick(60);
    syncToolingSim(a);
    expect(sim.clock.minutes).toBe(minutes + 60);
  });

  it("keeps a swapped-in tower's edits on its own engine, and drops what the app's tower had pending", async () => {
    const { app: a, saved } = app();
    const live = toolingSim(a)!;
    live.star = 4;
    expect(live.serialize().star).toBe(4);
    const built = (live.constructor as unknown as ToolingTowerClass).newGame(9, "classic");
    built.star = 2;
    adoptToolingSim(a, built, false);
    expect(saved().star).toBe(2);
    // The built tower reads its own edit after the swap.
    expect(built.star).toBe(2);
    expect(built.serialize().star).toBe(2);
    // The app's tower forgot its edit: the end of the task loads nothing over the swap.
    await Promise.resolve();
    expect(saved().star).toBe(2);
    expect(live.star).toBe(2);
  });
});
