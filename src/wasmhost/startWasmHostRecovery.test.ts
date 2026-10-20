import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { fakeModule } from "./fakeEngine.fixture";
import { startWasmHost, type WasmHostApp, type WasmHostOptions } from "./startWasmHost";

/**
 * The recovery after a fault (#874), on the fake engine: what the player is
 * told on every path, and what the app is asked to do.
 */

function app(): WasmHostApp & { adopted: Simulation[]; dropped: number; steps: number; holds: boolean[] } {
  const a = {
    sim: Simulation.newGame(3, "classic"),
    adopted: [] as Simulation[],
    /** Tidies asked for. */
    dropped: 0,
    /** The steps each tidy answers it dropped. */
    steps: 0,
    holds: [] as boolean[],
    adoptSim(next: Simulation) {
      next.gameplayEvents.inherit(a.sim.gameplayEvents);
      a.sim = next;
      a.adopted.push(next);
    },
    dropEmptyUndo() {
      a.dropped++;
      return a.steps;
    },
    holdClearedRedo(on: boolean) {
      a.holds.push(on);
    },
  };
  return a;
}

function start(a: WasmHostApp, opts: WasmHostOptions = {}) {
  const mod = fakeModule();
  const log = { info: vi.fn(), error: vi.fn() };
  const handle = startWasmHost(a, mod, log, opts);
  return { handle, engine: () => mod.engines[mod.engines.length - 1], log };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const lastLine = (sim: Simulation) => sim.log[sim.log.length - 1];

describe("the recovery after a fault (#874)", () => {
  it("says only that the engine stopped when no edit is lost, and tidies the undo trail", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      engine().failOn = "tick";
      a.sim.tick(1);
      await settle();
      expect(a.adopted).toHaveLength(1);
      expect(lastLine(a.sim)).toEqual(expect.objectContaining({ text: "The WASM engine stopped, so the tower went back to its last good state and runs on the TypeScript engine.", kind: "bad" }));
      expect(a.dropped).toBe(1);
    } finally {
      handle.stop();
    }
  });

  const UNDONE = "The WASM engine stopped, so the tower went back to its last good state and your recent changes were undone. It runs on the TypeScript engine now.";
  const RESTORED = "The WASM engine stopped, so the tower went back to its last good state and runs on the TypeScript engine.";

  it("says the player's recent changes were undone when the point is from before an edit", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      a.sim.money = 1e9;
      a.sim.serialize(); // the edit's undo capture: the newest point
      expect(a.sim.build("lobby", 1, 180).ok).toBe(true); // an edit after it
      engine().failOn = "tick";
      a.sim.tick(1);
      await settle();
      expect(lastLine(a.sim)).toEqual(expect.objectContaining({ text: UNDONE, kind: "bad" }));
    } finally {
      handle.stop();
    }
  });

  it("counts a change to money alone, as an exterminator call or a ransom is", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      a.sim.serialize();
      a.sim.money -= 5_000;
      engine().failOn = "tick";
      a.sim.tick(1);
      await settle();
      expect(lastLine(a.sim).text).toBe(UNDONE);
    } finally {
      handle.stop();
    }
  });

  it("does not blame the player for changes no command of theirs made", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      a.sim.money = 1e9;
      a.sim.serialize();
      // The clock's own change since the point (a fire, a bomb), seen on the
      // read model, with no command.
      engine().money -= 777;
      a.sim.tick(1);
      expect(a.sim.money).toBe(1e9 - 777);
      engine().failOn = "tick";
      a.sim.tick(1);
      await settle();
      expect(lastLine(a.sim).text).toBe(RESTORED);
    } finally {
      handle.stop();
    }
  });

  it("does not count a refused command as a change", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      a.sim.money = 0;
      a.sim.serialize();
      expect(a.sim.build("office", 9, 180).ok).toBe(false); // nothing to stand on
      engine().failOn = "tick";
      a.sim.tick(1);
      await settle();
      expect(lastLine(a.sim).text).toBe(RESTORED);
    } finally {
      handle.stop();
    }
  });

  it("tidies the undo trail when an undo or redo replaced the faulted tower", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      engine().failOn = "tick";
      a.sim.tick(1);
      // Before the recovery runs, an undo restores its own snapshot.
      a.adoptSim(Simulation.newGame(3, "classic"), true);
      await settle();
      expect(a.dropped).toBe(1);
      expect(lastLine(a.sim)).toEqual(expect.objectContaining({ text: "The WASM engine stopped, so the game runs on the TypeScript engine now.", kind: "bad" }));
    } finally {
      handle.stop();
    }
  });

  const LOST = "The WASM engine stopped, so some of your recent changes were lost. The game runs on the TypeScript engine now.";

  it("says changes were lost when an undo replaced the faulted tower after a command no point covers", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      a.sim.money = 5; // a command after the newest point
      engine().failOn = "tick";
      a.sim.tick(1);
      a.adoptSim(Simulation.newGame(3, "classic"), true);
      await settle();
      expect(lastLine(a.sim)).toEqual(expect.objectContaining({ text: LOST, kind: "bad" }));
    } finally {
      handle.stop();
    }
  });

  it("says changes were lost when an undo replaced the faulted tower and the tidy dropped a step", async () => {
    const a = app();
    a.steps = 1;
    const { handle, engine } = start(a);
    try {
      engine().failOn = "tick";
      a.sim.tick(1);
      a.adoptSim(Simulation.newGame(3, "classic"), true);
      await settle();
      expect(lastLine(a.sim)).toEqual(expect.objectContaining({ text: LOST, kind: "bad" }));
    } finally {
      handle.stop();
    }
  });

  it("says only that the engine stopped when a load or a new game replaced the faulted tower", async () => {
    const a = app();
    a.steps = 1;
    const { handle, engine } = start(a);
    try {
      a.sim.money = 5; // a command after the newest point
      engine().failOn = "tick";
      a.sim.tick(1);
      a.adoptSim(Simulation.newGame(3, "classic")); // a load drops the old tower's changes itself
      await settle();
      expect(lastLine(a.sim)).toEqual(expect.objectContaining({ text: "The WASM engine stopped, so the game runs on the TypeScript engine now.", kind: "bad" }));
    } finally {
      handle.stop();
    }
  });

  it("has the history hold cleared redo steps while hosting, until a recovery or a stop", async () => {
    const a = app();
    const { handle, engine } = start(a);
    expect(a.holds).toEqual([true]);
    engine().failOn = "tick";
    a.sim.tick(1);
    expect(a.holds).toEqual([true]); // the tidy has not run yet
    await settle();
    expect(a.holds).toEqual([true, false]);
    handle.stop();
    expect(a.holds).toEqual([true, false, false]);
  });

  it("has the history hold no redo steps in a wasm-only build, which stops instead of falling back", () => {
    const a = app();
    const { handle, engine } = start(a, { strict: true, onFatal: vi.fn() });
    expect(handle.status.hosted).toBe(true);
    engine().failOn = "tick";
    a.sim.tick(1);
    handle.stop();
    expect(a.holds).not.toContain(true);
  });

  it("lets the held redo steps go for a tower left on TypeScript, and holds them again for a hosted one", () => {
    const a = app();
    const mod = fakeModule();
    const handle = startWasmHost(a, mod, { info: vi.fn(), error: vi.fn() });
    try {
      const fromSave = mod.Engine.fromSave;
      mod.Engine.fromSave = () => {
        throw new Error("refused");
      };
      a.adoptSim(Simulation.newGame(4, "classic"));
      expect(handle.status.hosted).toBe(false);
      expect(a.holds).toEqual([true, false]);
      mod.Engine.fromSave = fromSave;
      a.adoptSim(Simulation.newGame(5, "classic"));
      expect(handle.status.hosted).toBe(true);
      expect(a.holds).toEqual([true, false, true]);
    } finally {
      handle.stop();
    }
  });

  it("restores the faulted tower when a swap let its host go and then threw before swapping", async () => {
    const a = app();
    const adopt = a.adoptSim.bind(a);
    let refuse = false;
    a.adoptSim = (next: Simulation, keep?: boolean) => {
      if (refuse) {
        refuse = false;
        throw new Error("the load broke");
      }
      adopt(next, keep);
    };
    const { handle, engine } = start(a);
    try {
      const sim = a.sim;
      engine().failOn = "tick";
      sim.tick(1);
      refuse = true;
      expect(() => a.adoptSim(Simulation.newGame(4, "classic"))).toThrow("the load broke");
      expect(a.sim).toBe(sim);
      await settle();
      expect(a.sim).not.toBe(sim);
      expect(lastLine(a.sim).text).toBe(RESTORED);
    } finally {
      handle.stop();
    }
  });

  it("still restores and speaks when the player-state check throws", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      const sim = a.sim;
      sim.serialize();
      sim.money -= 1;
      Object.defineProperty(sim.tower, "units", {
        get() {
          throw new Error("a broken read model");
        },
        configurable: true,
      });
      engine().failOn = "tick";
      sim.tick(1);
      await settle();
      expect(a.sim).not.toBe(sim);
      expect(lastLine(a.sim).text).toBe(UNDONE); // the command count answers
    } finally {
      handle.stop();
    }
  });

  it("tells the player when no restore point loads, and leaves the tower frozen", async () => {
    const a = app();
    const { handle, engine } = start(a);
    try {
      const sim = a.sim;
      handle.current()!.restore = () => {
        throw new Error("no point loads");
      };
      engine().failOn = "tick";
      sim.tick(1);
      await settle();
      expect(a.adopted).toHaveLength(0);
      expect(handle.status.lastError).toBe("no restore point loads, so the tower stays stopped: no point loads");
      expect(lastLine(sim)).toEqual(expect.objectContaining({ text: "The WASM engine stopped, and the tower could not go back to a good state. Load a save or start a new tower to keep playing.", kind: "bad" }));
      const minutes = sim.clock.minutes;
      sim.tick(30);
      expect(sim.clock.minutes).toBe(minutes);
    } finally {
      handle.stop();
    }
  });

  it("reports an adopt that throws instead of letting it escape the recovery", async () => {
    const a = app();
    const adopt = a.adoptSim.bind(a);
    // Set before the host starts: the host wraps the app's adopt at start.
    a.adoptSim = (next: Simulation, keep?: boolean) => {
      if (keep) throw new Error("the app broke");
      adopt(next, keep);
    };
    const { handle, engine } = start(a);
    try {
      const sim = a.sim;
      engine().failOn = "tick";
      sim.tick(1);
      await settle();
      expect(handle.status.errors).toContain("adopting the restored tower: the app broke");
      expect(a.sim).toBe(sim);
      expect(a.dropped).toBe(0);
      expect(lastLine(sim)).toEqual(expect.objectContaining({ text: expect.stringMatching(/could not go back to a good state/), kind: "bad" }));
    } finally {
      handle.stop();
    }
  });

  it("recovers once when the owner's callbacks call back into the host", async () => {
    const a = app();
    let reentered = 0;
    const { handle, engine } = start(a, {
      onFallback: () => {
        reentered++;
        a.sim.tick(1);
        a.sim.serialize();
        a.sim.drainGameplayEvents();
        void a.sim.gameplayEventsDropped;
        handle.current()?.flush();
        handle.current()?.syncStructure();
      },
    });
    try {
      engine().failOn = "tick";
      a.sim.tick(1);
      a.sim.tick(1);
      await settle();
      await settle();
      expect(reentered).toBe(1);
      expect(handle.status.fallbacks).toBe(1);
      expect(a.adopted).toHaveLength(1);
    } finally {
      handle.stop();
    }
  });
});
