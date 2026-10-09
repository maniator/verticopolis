import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachMirror, loadCommand } from "./mirror";
import type { ShadowCommand } from "./commands";

function record(sim: Simulation): { cmds: ShadowCommand[]; detach: () => void } {
  const cmds: ShadowCommand[] = [];
  const detach = attachMirror(sim, (c) => cmds.push(c));
  return { cmds, detach };
}

describe("attachMirror", () => {
  it("reports each outside command once, with the engine's own nested calls folded in", () => {
    const sim = Simulation.newGame(1, "classic");
    sim.money = 1e9;
    const { cmds } = record(sim);
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.build("office", 2, 180).ok).toBe(true);
    // sellAt removes the unit through tower.removeUnit and refunds money,
    // and all of that is a single command.
    expect(sim.sellAt(2, 180)).toBe(true);
    expect(cmds.map((c) => c.op)).toEqual([...Array<string>(30).fill("build"), "build", "sellAt"]);
    expect(cmds[0]).toEqual({ op: "build", kind: "lobby", floor: 1, x: 170 });
  });

  it("reports the host's direct writes and not the engine's", () => {
    const sim = Simulation.newGame(1, "modern");
    const { cmds } = record(sim);
    sim.money -= 50;
    sim.view = { tile: 3, floor: 1 };
    sim.autoBridge = false;
    sim.tower.towerName = "Mirror";
    expect(cmds).toEqual([
      { op: "setMoney", amount: sim.money },
      { op: "setView", view: { tile: 3, floor: 1 } },
      { op: "setAutoBridge", value: false },
      { op: "setTowerName", name: "Mirror" },
    ]);
    cmds.length = 0;
    sim.build("lobby", 1, 180);
    sim.tick(60); // rent and wages move money inside the engine
    expect(cmds.filter((c) => c.op === "setMoney")).toEqual([]);
    // A new game's first tick runs the hour-0 pass, so it checkpoints too.
    expect(cmds.map((c) => c.op)).toEqual(["build", "tick", "checkpoint"]);
  });

  it("emits a checkpoint with both views after a tick that crosses an hour", () => {
    const sim = Simulation.newGame(9, "classic");
    sim.tick(1); // the first step of a new game (founded at 7:00) runs its hour pass
    const { cmds } = record(sim);
    sim.tick(29);
    sim.tick(30); // 8:00
    const checkpoints = cmds.filter((c) => c.op === "checkpoint");
    expect(checkpoints).toHaveLength(1);
    const cp = checkpoints[0] as Extract<ShadowCommand, { op: "checkpoint" }>;
    expect(cp.label).toBe("day 0 08:00");
    expect(JSON.parse(cp.state)).toMatchObject({ minutes: 480 });
    expect(JSON.parse(cp.crowd)).toHaveProperty("people");
  });

  it("mirrors the tower edits and the editor's rename", () => {
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    const { cmds } = record(sim);
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
    expect(sim.build("office", 2, 180).ok).toBe(true);
    expect(sim.buildTransport("elevatorStandard", 190, 1, 2).ok).toBe(true);
    const u = sim.tower.unitAt(2, 180)!;
    const t = sim.tower.transportAt(1, 190)!;
    cmds.length = 0;
    sim.tower.setLabel(u.id, " Desk ");
    sim.tower.setCars(t.id, 2);
    sim.tower.setStop(t.id, 2, false);
    sim.tower.clearStops(t.id);
    sim.tower.setSchedule(t.id, { weekday: [] });
    sim.tower.resizeTransport(t.id, 1, 3);
    sim.tower.removeTransport(t.id);
    sim.tower.removeUnit(u.id);
    expect(cmds).toEqual([
      { op: "setLabel", id: u.id, label: "Desk" },
      { op: "setCars", id: t.id, cars: 2 },
      { op: "setStop", id: t.id, floor: 2, stop: false },
      { op: "clearStops", id: t.id },
      { op: "setSchedule", id: t.id, schedule: { weekday: [] } },
      { op: "resizeTransport", id: t.id, bottom: 1, top: 3 },
      { op: "removeTransport", id: t.id },
      { op: "removeUnit", id: u.id },
    ]);
    expect(u.label).toBe("Desk");
  });

  it("detaches cleanly: the instance is the plain object again and reports nothing", () => {
    const sim = Simulation.newGame(1, "classic");
    const { cmds, detach } = record(sim);
    detach();
    sim.money = 5;
    sim.build("lobby", 1, 180);
    expect(cmds).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(sim, "money")).toMatchObject({ value: 5, writable: true });
    expect(Object.prototype.hasOwnProperty.call(sim, "build")).toBe(false);
  });

  it("refuses a second attach and leaves the first one whole", () => {
    const sim = Simulation.newGame(1, "classic");
    sim.money = 1e9;
    const first: ShadowCommand[] = [];
    const detach = attachMirror(sim, (c) => first.push(c));
    expect(() => attachMirror(sim, () => {})).toThrow(/already attached/);
    sim.build("lobby", 1, 180);
    expect(first.map((c) => c.op)).toEqual(["build"]);
    detach();
    expect(Object.prototype.hasOwnProperty.call(sim, "build")).toBe(false);
  });

  it("rolls back everything it wrapped when the attach fails partway", () => {
    const sim = Simulation.newGame(1, "classic");
    // A tower whose towerName is already an accessor makes the last watch throw.
    Object.defineProperty(sim.tower, "towerName", { get: () => "x", set: () => {}, configurable: true });
    expect(() => attachMirror(sim, () => {})).toThrow(/already an accessor/);
    expect(Object.prototype.hasOwnProperty.call(sim, "tick")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(sim, "money")).toHaveProperty("value");
  });

  it("stamps checkpoints with the generation and loads the boundary markers", () => {
    const sim = Simulation.newGame(2, "classic");
    const load = loadCommand(sim, 3);
    expect(load.gen).toBe(3);
    expect(load.markers).toEqual({ lastHour: -1, lastDay: 0, lastQuarter: -1, lastMonth: -1 });
    const cmds: ShadowCommand[] = [];
    const detach = attachMirror(sim, (c) => cmds.push(c), 3);
    sim.tick(1);
    expect(cmds.find((c) => c.op === "checkpoint")).toMatchObject({ gen: 3 });
    detach();
    expect(loadCommand(sim, 4).markers.lastHour).toBe(7);
  });

  it("refuses to start a shadow once the tower has a crowd", () => {
    const sim = Simulation.newGame(4, "classic");
    expect(loadCommand(sim, 1).op).toBe("load");
    // The guard reads only the crowd's size; a person stands in for a tower
    // that has ticked long enough to spawn one.
    (sim.crowd.people as unknown[]).push({ id: 1 });
    expect(() => loadCommand(sim, 1)).toThrow(/crowd exists/);
  });

  it("reports the label as stored and a cleared tower name as null", () => {
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) sim.build("lobby", 1, x);
    sim.build("office", 2, 180);
    const u = sim.tower.unitAt(2, 180)!;
    const cmds: ShadowCommand[] = [];
    const detach = attachMirror(sim, (c) => cmds.push(c));
    sim.tower.setLabel(u.id, "  \u00a0Loft\u2003 ");
    sim.tower.setLabel(u.id, " ");
    sim.tower.setLabel(999999, "nobody");
    sim.tower.towerName = "Named";
    (sim.tower as { towerName?: string }).towerName = undefined;
    expect(cmds).toEqual([
      { op: "setLabel", id: u.id, label: "Loft" },
      { op: "setLabel", id: u.id, label: "Office" },
      { op: "setTowerName", name: "Named" },
      { op: "setTowerName", name: null },
    ]);
    detach();
  });
});
