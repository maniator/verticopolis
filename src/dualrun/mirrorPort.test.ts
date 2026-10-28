import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import type { ShadowCommand } from "./commands";
import { attachMirror } from "./mirror";

/**
 * On the Rust path the app's `TsEngine` sits over the host's read model, and
 * a command reaches Rust only through a `Simulation` method the relay wraps.
 * The caller moves of slice 7, PR 4 run their commands through the port, so
 * each one is held here to the relay command the shadow engine receives.
 */

function relayed(): { engine: TsEngine; codes: PortCodes; sim: Simulation; ops: () => ShadowCommand[] } {
  const sim = Simulation.newGame(5, "modern");
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
  expect(sim.build("office", 2, 180).ok).toBe(true);
  const cmds: ShadowCommand[] = [];
  attachMirror(sim, (c) => cmds.push(c));
  const engine = new TsEngine(sim);
  return { engine, codes: new PortCodes(engine), sim, ops: () => cmds.splice(0) };
}

describe("port commands on the hosted read model", () => {
  it("relay each moved command as the Simulation call the shadow replays", () => {
    const { engine, codes, sim, ops } = relayed();
    engine.flipAutoBridge();
    expect(ops()).toEqual([{ op: "toggleAutoBridge" }]);
    expect(engine.logLine("Meal rush", codes.code("logKinds", "info"))[0]).toBe(1);
    expect(ops()).toEqual([{ op: "emit", text: "Meal rush", kind: "info" }]);
    engine.bookExterminator();
    expect(ops().map((c) => c.op)).toEqual(["callExterminator"]);
    sim.events.pending = { kind: "fireRescue", cost: 1000, message: "" };
    expect(engine.answerChoice(false)[0]).toBe(1);
    expect(ops()).toEqual([{ op: "resolveChoice", accept: false }]);
  });

  it("relay the building commands as the Simulation calls the shadow replays", () => {
    const { engine, codes, sim, ops } = relayed();
    expect(engine.buildAt(codes.kind("office"), 2, 190)[0]).toBe(1);
    expect(ops()).toEqual([{ op: "build", kind: "office", floor: 2, x: 190 }]);
    expect(engine.paintTiles(codes.kind("floor"), 3, Float64Array.of(185, 186))[0]).toBe(1);
    expect(ops()).toEqual([{ op: "paintBrush", kind: "floor", floor: 3, tiles: [185, 186] }]);
    expect(engine.buildShaft(codes.kind("elevatorStandard"), 172, 1, 2)[0]).toBe(1);
    expect(ops()).toEqual([{ op: "buildTransport", kind: "elevatorStandard", x: 172, bottom: 1, top: 2 }]);
    const id = sim.tower.units.find((u) => u.kind === "office")!.id;
    expect(engine.demolish(id, true)[0]).toBe(1);
    expect(ops()).toEqual([{ op: "removeFacility", id, method: "bulldoze" }]);
  });

  it("relay nothing for a quote, which asks the tower and changes nothing", () => {
    const { engine, codes, ops } = relayed();
    expect(engine.quoteBuild(codes.kind("office"), 2, 190)[0]).toBe(1);
    expect(engine.quoteShaft(codes.kind("elevatorStandard"), 172, 1, 2)[0]).toBe(1);
    expect(ops()).toEqual([]);
  });

  it("relay nothing for a command the port refuses before the tower", () => {
    const { engine, ops } = relayed();
    expect(engine.answerChoice(true)[0]).toBe(0);
    expect(engine.logLine("x", Number.NaN)[0]).toBe(0);
    expect(ops()).toEqual([]);
  });
});
