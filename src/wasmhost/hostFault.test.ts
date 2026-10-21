import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { EngineBootError } from "./engineBoot";
import { FaultLatch, RestorePoints, carryLiveState, hostFault, isEngineTrap, isHostFault, type FaultContext } from "./hostFault";

/** A save told apart by its clock. */
const save = (minutes: number) => {
  const sim = Simulation.newGame(1, "classic");
  sim.clock.minutes += minutes;
  return JSON.stringify(sim.serialize());
};
const minutesOf = (minutes: number) => Simulation.newGame(1, "classic").clock.minutes + minutes;

describe("restore points (#874)", () => {
  it("keeps the newest save the host read, and a merge's supersedes it and the attach save", () => {
    const points = new RestorePoints(save(1));
    expect(points.restore().point).toBe("attach");
    points.note(save(2));
    expect(points.restore()).toMatchObject({ point: "latest" });
    expect(points.restore().sim.clock.minutes).toBe(minutesOf(2));
    points.note(save(3)); // a newer read replaces it
    expect(points.restore().sim.clock.minutes).toBe(minutesOf(3));
    points.noteMerge(save(4));
    expect(points.restore()).toMatchObject({ point: "merge" });
    points.note(save(5));
    expect(points.restore()).toMatchObject({ point: "latest" });
  });

  it("answers a save with the same point the recovery goes back to", () => {
    const points = new RestorePoints(save(1));
    points.noteMerge(save(2));
    points.note("{not a save");
    // The latest point does not load, so both skip it for the merge's.
    expect(points.restore()).toMatchObject({ point: "merge" });
    expect((points.newestSave() as { minutes: number }).minutes).toBe(minutesOf(2));
    // A save that parses but does not load is skipped too.
    points.note("null");
    expect((points.newestSave() as { minutes: number }).minutes).toBe(minutesOf(2));
    expect(points.restore()).toMatchObject({ point: "merge" });
    // A newer point that loads is answered at once.
    points.note(save(6));
    expect((points.newestSave() as { minutes: number }).minutes).toBe(minutesOf(6));
  });

  it("counts the newer points that did not load before the one that did (#1126)", () => {
    const points = new RestorePoints(save(1));
    expect(points.restore()).toMatchObject({ point: "attach", skipped: 0 });
    points.note("null");
    expect(points.restore()).toMatchObject({ point: "attach", skipped: 1 });
    points.noteMerge(save(2));
    expect(points.restore()).toMatchObject({ point: "merge", skipped: 0 });
    points.note("{not a save");
    expect(points.restore()).toMatchObject({ point: "merge", skipped: 1 });
    points.note(save(3));
    expect(points.restore()).toMatchObject({ point: "latest", skipped: 0 });
  });

  it("drops the attach save once a merge's loads in its place", () => {
    const points = new RestorePoints(save(1));
    points.noteMerge("{merged but broken");
    // A merge's save always loaded (the merge loads it first), so nothing
    // older is kept behind it.
    expect(() => points.restore()).toThrow(SyntaxError);
  });

  it("throws the first point's error when none loads, for a save too", () => {
    const points = new RestorePoints("{");
    expect(() => points.restore()).toThrow(SyntaxError);
    expect(() => points.newestSave()).toThrow(SyntaxError);
  });
});

describe("an engine trap (#1113)", () => {
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  it("is a RuntimeError, from this realm or another, the borrow error after one, or a stack overflow", () => {
    expect(isEngineTrap(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    expect(isEngineTrap(named("RuntimeError", "unreachable executed"))).toBe(true);
    expect(isEngineTrap(new Error("recursive use of an object detected which would lead to unsafe aliasing in rust"))).toBe(true);
    expect(isEngineTrap(new RangeError("Maximum call stack size exceeded"))).toBe(true);
    expect(isEngineTrap(named("InternalError", "too much recursion"))).toBe(true);
    // Another realm's error is no `Error` here, and a wrapper keeps the trap
    // as its cause (the catalog read).
    expect(isEngineTrap({ name: "RuntimeError", message: "unreachable" })).toBe(true);
    expect(isEngineTrap(Object.assign(new Error("the engine returned no classic catalog: unreachable"), { cause: new WebAssembly.RuntimeError("unreachable") }))).toBe(true);
  });

  it("is not the engine's clean refusal, the host's own check, or a value that is no error", () => {
    expect(isEngineTrap(new Error("unknown mode: tower"))).toBe(false); // a JsError
    expect(isEngineTrap(new Error("the tower already has a crowd"))).toBe(false);
    expect(isEngineTrap(new RangeError("Invalid array length"))).toBe(false);
    expect(isEngineTrap(new TypeError("cannot read properties of undefined"))).toBe(false);
    expect(isEngineTrap(new EngineBootError("package-mismatch", "no catalog"))).toBe(false);
    expect(isEngineTrap("unreachable")).toBe(false);
    expect(isEngineTrap(null)).toBe(false);
    expect(isEngineTrap(Object.assign(new Error("the engine returned no classic catalog: mode must be"), { cause: new Error("mode must be") }))).toBe(false);
  });
});

describe("the fault latch (#874)", () => {
  it("freezes once, codes the app's context, and swallows the owner's throw", () => {
    let context: FaultContext = null;
    const onFault = vi.fn(() => {
      throw new Error("owner broke");
    });
    const onFreeze = vi.fn();
    const latch = new FaultLatch({ onFault, context: () => context }, onFreeze);
    expect(latch.guard("trap-tick", () => 7, 0)).toBe(7);
    context = "undo";
    expect(latch.guard("other", () => { throw new Error("unreachable"); }, -1)).toBe(-1);
    expect(latch.fault).toEqual({ reason: "trap-undo", message: "the WASM engine failed during a save: unreachable" });
    const later = vi.fn(() => 1);
    expect(latch.guard("trap-command", later, 0)).toBe(0); // frozen: the engine is not asked
    latch.freeze("trap-tick", new Error("again"));
    expect(later).not.toHaveBeenCalled();
    expect(onFault).toHaveBeenCalledTimes(1);
    expect(onFreeze).toHaveBeenCalledTimes(1);
  });

  it("codes an undo capture's save as a command, and names each path", () => {
    expect(hostFault("other", "capture", "x").reason).toBe("trap-command");
    expect(hostFault("trap-tick", "capture", "x").reason).toBe("trap-tick");
    expect(hostFault("trap-tick", "undo", "x").reason).toBe("trap-undo");
    expect(hostFault("trap-command", null, "x").message).toBe("the WASM engine failed during a command: x");
    expect(hostFault("trap-tick", null, new Error("y")).message).toBe("the WASM engine failed during a tick: y");
    expect(hostFault("other", null, "z", "while letting a tower go").message).toBe("the WASM engine failed while letting a tower go: z");
    expect(["trap-command", "trap-tick", "trap-undo", "other"].every(isHostFault)).toBe(true);
    expect(["attach-refused", "package-mismatch", "none", "boot-error"].some(isHostFault)).toBe(false);
  });
});

describe("live state carried to the fresh tower (#874)", () => {
  it("copies the telemetry for the fresh tower's shafts, the housekeeping report and the commute averages", () => {
    const from = Simulation.newGame(5, "classic");
    from.money = 1e9;
    for (let x = 170; x < 200; x++) from.build("lobby", 1, x);
    for (let x = 170; x < 200; x++) from.build("floor", 2, x);
    expect(from.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
    const shaft = from.tower.transportAt(1, 172)!.id;
    const to = Simulation.deserialize(from.serialize());
    from.elevatorUtil.set(shaft, 0.5).set(9999, 0.9);
    from.economy.adoptHousekeepingReport({ cleaned: 3, leftover: 1 });
    from.crowd.adoptCommuteStress([[2, 40]]);
    from.gameplayEvents.discardOnHandOff = true;
    carryLiveState(from, to);
    expect([...to.elevatorUtil]).toEqual([[shaft, 0.5]]);
    expect(to.economy.housekeepingReport()).toEqual({ cleaned: 3, leftover: 1 });
    expect([...to.crowd.commuteStressByFloor]).toEqual([[2, 40]]);
    // The title screen's backdrop stays one, so its events stay behind.
    expect(to.gameplayEvents.discardOnHandOff).toBe(true);
  });

  it("carries each part on its own, so one that throws costs only itself", () => {
    const from = Simulation.newGame(6, "classic");
    const to = Simulation.deserialize(from.serialize());
    from.crowd.adoptCommuteStress([[3, 12]]);
    from.economy.housekeepingReport = () => {
      throw new Error("bad read model");
    };
    expect(() => carryLiveState(from, to)).not.toThrow();
    expect([...to.crowd.commuteStressByFloor]).toEqual([[3, 12]]);
  });
});
