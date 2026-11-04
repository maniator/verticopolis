import { describe, it, expect } from "vitest";
import { UNDO_CAP, UndoHistory, UndoSteps } from "../../engine/UndoHistory";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { createAppHistory } from "../../game/appHistory";
import { TsEngine } from "../../engine/port/tsEngine";

// The reference engine's copy of the Rust engine's undo stacks. The cases
// mirror `engine-rs/src/undo_tests.rs`: keep the two tables identical.

const step = (snap: string, label: string) => ({ snap, label });

describe("UndoHistory: stack semantics", () => {
  it("a gesture that changed the tower leaves a step", () => {
    const h = new UndoHistory();
    h.capture("before", "a", "Bulldoze");
    expect(h.commit("b")).toBe(true);
    expect(h.popUndo()).toEqual(step("before", "Bulldoze"));
    expect(h.popUndo()).toBeUndefined();
  });

  it("a gesture that changed nothing leaves no step", () => {
    const h = new UndoHistory();
    h.capture("before", "a", "Bulldoze");
    expect(h.commit("a")).toBe(false);
    expect(h.depths()).toEqual({ undo: 0, redo: 0 });
  });

  it("a commit with no capture keeps nothing, and a capture is committed once", () => {
    const h = new UndoHistory();
    expect(h.commit("a")).toBe(false);
    h.capture("before", "a", "Build");
    expect(h.commit("b")).toBe(true);
    expect(h.commit("c")).toBe(false);
  });

  it("a new step ends the redo trail, and a commit that changed nothing keeps it", () => {
    const h = new UndoHistory();
    h.pushRedo(step("later", "Build"));
    h.capture("before", "a", "Bulldoze");
    h.commit("a");
    expect(h.depths()).toEqual({ undo: 0, redo: 1 });
    h.capture("before", "a", "Bulldoze");
    h.commit("b");
    expect(h.depths()).toEqual({ undo: 1, redo: 0 });
  });

  it("a second capture replaces the first", () => {
    const h = new UndoHistory();
    h.capture("stale", "a", "Build");
    h.capture("fresh", "b", "Bulldoze");
    expect(h.commit("c")).toBe(true);
    expect(h.popUndo()).toEqual(step("fresh", "Bulldoze"));
  });

  it("a discarded capture leaves no step", () => {
    const h = new UndoHistory();
    h.capture("before", "a", "Build");
    h.discard();
    expect(h.commit("b")).toBe(false);
  });

  it("the oldest step goes past the cap", () => {
    const h = new UndoHistory();
    for (let i = 0; i < UNDO_CAP + 3; i++) {
      h.capture(`s${i}`, "a", `L${i}`);
      expect(h.commit("b")).toBe(true);
    }
    expect(h.depths().undo).toBe(UNDO_CAP);
    let oldest;
    for (let s = h.popUndo(); s; s = h.popUndo()) oldest = s;
    expect(oldest).toEqual(step("s3", "L3"));
  });

  it("clear() forgets both stacks and the gesture", () => {
    const h = new UndoHistory();
    h.pushUndo(step("a", "A"));
    h.pushRedo(step("b", "B"));
    h.capture("c", "x", "C");
    h.clear();
    expect(h.depths()).toEqual({ undo: 0, redo: 0 });
    expect(h.commit("y")).toBe(false);
  });
});

describe("the app's history through the port", () => {
  it("steps through the engine and follows the restore, keeping the trail", async () => {
    const enginePort = new TsEngine(Simulation.newGame(1));
    const toasts: string[] = [];
    const followed: boolean[] = [];
    const hist = createAppHistory({ enginePort, ui: { toast: (m) => toasts.push(m) }, followSwap: (keep) => followed.push(keep) });
    await hist.undo();
    expect(toasts).toEqual(["Nothing to undo."]);
    expect(followed, "nothing was swapped").toEqual([]);

    hist.capture("build");
    enginePort.sim.build("lobby", 1, 160);
    hist.commit();
    await hist.undo();
    expect(followed).toEqual([true]);
    expect(toasts[toasts.length - 1]).toBe("Undid: build");
    await hist.redo();
    expect(toasts[toasts.length - 1]).toBe("Redid: build");
  });

  it("tells the player the engine's reason when it refuses a step", async () => {
    const enginePort = Object.assign(new TsEngine(Simulation.newGame(1)), {
      undo: () => Float64Array.of(0, 0),
      lastReason: () => "no load",
    });
    const toasts: string[] = [];
    const followed: boolean[] = [];
    const hist = createAppHistory({
      enginePort,
      ui: { toast: (m: string) => void toasts.push(m) },
      followSwap: (keep: boolean) => void followed.push(keep),
    });
    await expect(hist.undo()).resolves.toBeUndefined();
    expect(toasts).toEqual(["no load"]);
    expect(followed).toEqual([]);
  });

  it("undo of a build restores the exact tower and keeps a bridging toggle changed afterward", async () => {
    // `restore` carries the live autoBridge across, so undoing a BUILD never
    // silently flips a Settings toggle the player changed after that build.
    const enginePort = new TsEngine(Simulation.newGame(3, "modern", "realWorld"));
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {} });
    const cx = Math.floor(GRID.width / 2);
    const before = enginePort.sim.serialize();
    hist.capture("Build"); // snapshot taken while bridging is on
    expect(enginePort.sim.tower.place("lobby", 1, cx).ok).toBe(true);
    hist.commit();
    enginePort.sim.autoBridge = false; // the player turns bridging off AFTER the build
    await hist.undo();
    expect(enginePort.sim.tower.unitAt(1, cx)).toBeUndefined();
    expect(enginePort.sim.autoBridge).toBe(false);
    expect({ ...enginePort.sim.serialize(), autoBridge: true }).toEqual({ ...before, autoBridge: true });
  });
});

describe("UndoSteps: a release with nothing captured", () => {
  it("does not fingerprint the tower", () => {
    let reads = 0;
    const steps = new UndoSteps({
      serialize: () => "save",
      undoSignature: () => String(++reads),
      restore: () => Float64Array.of(1, 1),
      generation: () => 1,
      clearReason: () => {},
    });
    expect(steps.commit()).toBe(false);
    expect(reads).toBe(0);
    steps.capture("Build");
    expect(steps.commit()).toBe(true);
    expect(reads).toBe(2);
  });
});
