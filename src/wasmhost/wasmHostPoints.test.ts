import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachWasmHost } from "./wasmHost";
import { fakeModule, type FakeEngine } from "./fakeEngine.fixture";

/**
 * When the host reads the engine's save for a restore point (#874). Every
 * save the host reads anyway is a point (a merge's, and every save the game
 * asks for: undo captures, autosaves, exports). A point beyond them costs a
 * full save on the frame, so the host takes one only to keep a fallback from
 * emitting a tick's events twice.
 */

const STAR = { name: "star_reached", payload: { star: 2 } };

function hosted(sync: "step" | "frame" = "step") {
  const sim = Simulation.newGame(9, "classic");
  const mod = fakeModule();
  const host = attachWasmHost(sim, mod, { sync });
  const engine = mod.engines[0];
  // The first sync merges; the founding event comes out at the first drain.
  host.syncStructure();
  sim.drainGameplayEvents();
  let saves = 0;
  const save = engine.serialize.bind(engine);
  engine.serialize = () => {
    saves++;
    return save();
  };
  const merges = host.merges;
  /** The engine's saves since, that were not a merge's. */
  const extra = () => saves - (host.merges - merges);
  return { sim, host, engine, extra };
}

/** Make the engine's next tick emit `event`, as a tick that starts a fire
 *  or passes a milestone does, without a merge. */
function tickEmits(engine: FakeEngine, event: unknown): void {
  const tick = engine.tick.bind(engine);
  engine.tick = (dt: number) => {
    tick(dt);
    engine.owed.push(event);
    engine.tick = tick;
  };
}

describe("restore points on the main-thread host (#874)", () => {
  it.each(["step", "frame"] as const)("reads no save beyond the merges' on ticks and commands (%s)", (sync) => {
    const { sim, host, engine, extra } = hosted(sync);
    sim.money = 1e9;
    for (let i = 0; i < 20; i++) {
      // A drag: a structural command each frame, a merge at the next sync.
      engine.revision++;
      sim.tick(1);
      host.flush();
      sim.money -= 1; // a plain command
      sim.tick(1);
      host.flush();
      expect(sim.drainGameplayEvents()).toEqual([]);
    }
    expect(host.merges).toBeGreaterThan(0);
    expect(extra()).toBe(0);
    host.detach();
  });

  /** Make every `setMoney` the engine runs emit a pricing change, as an
   *  edit's command does. */
  function commandEmits(engine: FakeEngine): void {
    const setMoney = engine.setMoney.bind(engine);
    engine.setMoney = (amount: number) => {
      setMoney(amount);
      engine.owed.push({ name: "pricing_changed", payload: {} });
    };
  }
  const PRICING = { name: "pricing_changed", payload: {} };

  it("holds a command's own events until a merge covers the command, and takes no point for them", () => {
    const { sim, host, engine, extra } = hosted();
    commandEmits(engine);
    sim.money = 5;
    expect(host.lostEdits).toBe(1);
    sim.tick(1); // no merge: the hour pass has not run, and the tower did not move
    expect(sim.drainGameplayEvents()).toEqual([]);
    engine.revision++;
    sim.tick(1); // the merge's save covers the command
    expect(host.lostEdits).toBe(0);
    expect(sim.drainGameplayEvents()).toEqual([PRICING]);
    expect(extra()).toBe(0);
    host.detach();
  });

  it("lets a held command's events go at the next save the game reads", () => {
    const { sim, host, engine, extra } = hosted();
    commandEmits(engine);
    sim.money = 5; // paused: no tick, so no merge
    sim.money = 6;
    expect(host.lostEdits).toBe(2);
    expect(sim.drainGameplayEvents()).toEqual([]);
    sim.serialize(); // the next edit's undo capture
    expect(host.lostEdits).toBe(0);
    expect(sim.drainGameplayEvents()).toEqual([PRICING, PRICING]);
    expect(extra()).toBe(1); // the game's own save, and no other
    host.detach();
  });

  it("drops a held command's events when the engine faults, since the fallback undoes the command", () => {
    const { sim, host, engine } = hosted();
    commandEmits(engine);
    sim.money = 5; // a completed edit no point covers yet
    engine.failOn = "tick";
    sim.tick(1);
    expect(host.fault?.reason).toBe("trap-tick");
    expect(host.lostEdits).toBe(1);
    expect(host.restore().money).not.toBe(5);
    expect(sim.drainGameplayEvents()).toEqual([]);
    sim.money = 7; // the frozen read model counts it and relays nothing
    expect(host.lostEdits).toBe(2);
    host.detach();
    expect(sim.drainGameplayEvents()).toEqual([]); // nor handed over
  });

  it("does not count log lines or the camera as edits", () => {
    const { sim, host } = hosted();
    sim.emit("Lunch rush", "info");
    sim.view = { tile: 1, floor: 2 };
    expect(host.lostEdits).toBe(0);
    host.detach();
  });

  it("lets held events go at the analytics session's own flush, so a closing page keeps them", () => {
    const { sim, host, engine, extra } = hosted();
    commandEmits(engine);
    sim.money = 5;
    expect(sim.drainGameplayEvents()).toEqual([]); // the frame loop's drain
    const release = sim.drainGameplayEvents as (opts?: { release?: boolean }) => unknown[];
    expect(release({ release: true })).toEqual([PRICING]);
    expect(host.lostEdits).toBe(1); // a fallback still undoes the command
    expect(extra()).toBe(0);
    host.detach();
  });

  it("keeps the held events from a flush whose own drain faults, since the fallback undoes their command", () => {
    const { sim, host, engine } = hosted();
    commandEmits(engine);
    sim.money = 5;
    engine.drainGameplayEvents = () => {
      throw new Error("unreachable executed");
    };
    const release = sim.drainGameplayEvents as (opts?: { release?: boolean }) => unknown[];
    expect(release({ release: true })).toEqual([]);
    expect(host.fault?.reason).toBe("trap-tick");
    expect(release({ release: true })).toEqual([]);
    host.detach();
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("hands a healthy host's held events to the instance when it lets go", () => {
    const { sim, host, engine } = hosted();
    commandEmits(engine);
    sim.money = 5;
    host.detach();
    expect(sim.drainGameplayEvents()).toEqual([PRICING]);
  });

  it("takes a point when a tick's events leave the engine, before the game gets them", () => {
    const { sim, host, engine, extra } = hosted();
    tickEmits(engine, STAR);
    sim.tick(1);
    expect(extra()).toBe(0);
    const pointAt = sim.clock.minutes;
    expect(sim.drainGameplayEvents()).toEqual([STAR]);
    expect(extra()).toBe(1);
    sim.tick(1); // that point is behind the star already
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(extra()).toBe(1);
    // A fallback goes back to it, so the star is not emitted again.
    engine.failOn = "tick";
    sim.tick(1);
    expect(host.fault?.reason).toBe("trap-tick");
    expect(host.restore().clock.minutes).toBe(pointAt);
    host.detach();
  });

  it("takes a point before a command when a tick's events are still in the engine", () => {
    const { sim, host, engine, extra } = hosted();
    tickEmits(engine, STAR);
    sim.tick(1);
    sim.money = 5; // the star leaves the engine ahead of the command's events
    expect(extra()).toBe(1);
    expect(sim.drainGameplayEvents()).toEqual([STAR]);
    sim.tick(1);
    expect(extra()).toBe(1);
    host.detach();
  });

  it("drops the events read with a point whose save throws, so the replay emits them once", () => {
    const { sim, host, engine } = hosted();
    tickEmits(engine, STAR);
    sim.tick(1);
    engine.serialize = () => {
      throw new Error("unreachable executed");
    };
    // The star never reaches the game: the fallback replays its hour on the
    // TypeScript engine, which emits it then.
    expect(sim.drainGameplayEvents()).toEqual([]);
    expect(host.fault?.reason).toBe("trap-tick");
    host.detach();
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("makes every save the game reads a point, so a paused edit session keeps every edit but the last", () => {
    const { sim, host, engine } = hosted();
    // Paused: no tick, so no merge. Each edit's undo capture reads a save.
    sim.serialize();
    sim.money = 100; // the first edit
    sim.serialize(); // the next edit's capture
    const setMoney = engine.setMoney.bind(engine);
    engine.setMoney = (amount: number) => {
      setMoney(amount);
      throw new Error("unreachable executed");
    };
    sim.money = 200; // the second edit traps
    expect(host.fault?.reason).toBe("trap-command");
    // The point is the second capture: the first edit stays, the second goes.
    expect(host.restore().money).toBe(100);
    expect((sim.serialize() as { money: number }).money).toBe(100);
    host.detach();
  });
});
