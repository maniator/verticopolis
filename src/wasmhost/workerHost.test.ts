import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachWorkerHost, type WorkerHost } from "./workerHost";
import { EngineWorkerCore, MAX_ERRORS_PER_TOWER } from "./workerCore";
import { stepGate } from "./stepGate";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { fakeModule, type FakeEngine } from "./fakeEngine.fixture";

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/** A loopback between the host and a core on the fake engine: every
 *  message is structured-cloned and delivered in a later task. */
function rig(sim = Simulation.newGame(7, "classic")) {
  const mod = fakeModule();
  const toHost: FromWorker[] = [];
  const toWorker: ToWorker[] = [];
  const fatal: string[] = [];
  const errors: string[] = [];
  let host: WorkerHost | null = null;
  const core = new EngineWorkerCore(mod, (msg) => {
    toHost.push(msg);
    const copy = structuredClone(msg);
    setTimeout(() => host?.receive(copy), 0);
  });
  host = attachWorkerHost(sim, {
    gen: 1,
    catalogs: core.catalogs(),
    send: (msg) => {
      toWorker.push(msg);
      const copy = structuredClone(msg);
      setTimeout(() => core.handle(copy), 0);
    },
    onFatal: (m) => fatal.push(m),
    onError: (m) => errors.push(m),
  });
  const engine = (): FakeEngine => last(mod.engines)!;
  const settleTasks = async (n = 8) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { sim, host, core, mod, engine, toHost, toWorker, fatal, errors, settleTasks, gate: () => stepGate(sim)! };
}

describe("worker host (fake engine)", () => {
  it("holds steps until the tower is loaded, then steps, batches and applies the reply", async () => {
    const r = rig();
    expect(r.gate().canStep()).toBe(false);
    expect(r.toWorker[0]).toMatchObject({ type: "load", gen: 1 });
    await r.settleTasks();
    expect(r.host.loaded()).toBe(true);
    const t0 = r.sim.clock.minutes;
    r.sim.tick(2);
    r.sim.tick(3);
    expect(r.sim.clock.minutes).toBe(t0 + 5);
    r.gate().flush();
    expect(r.gate().canStep()).toBe(false);
    const ops = last(r.toWorker) as Extract<ToWorker, { type: "ops" }>;
    expect(ops.ops).toEqual([{ seq: 1, dt: 2 }, { seq: 2, dt: 3 }]);
    expect(ops.request).toMatchObject({ req: 1, merge: false });
    await r.settleTasks();
    expect(r.gate().canStep()).toBe(true);
    expect(r.engine().minutes).toBe(t0 + 5);
    expect(r.host.stats.replies).toBe(1);
    expect(r.fatal).toEqual([]);
    r.host.detach();
  });

  it("answers commands on the instance, relays them in order, and takes the engine's money once it has them", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.money = 4242;
    expect(r.sim.money).toBe(4242);
    await r.settleTasks();
    expect(r.engine().money).toBe(4242);
    r.engine().money = 5000; // the engine's own change (rent, say)
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.sim.money).toBe(5000);
    expect(r.host.stats.commandAckMs.length).toBe(1);
    expect(r.host.stats.commandVisibleMs[0]).toBeGreaterThanOrEqual(r.host.stats.commandAckMs[0]);
    r.host.detach();
  });

  it("applies a reply older than a command as motion only and asks again for the full save", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(1);
    r.gate().flush();

    r.sim.money = 1; // after the request: the reply cannot include it
    r.mod.engines[0].revision++; // the reply would carry a merge
    await r.settleTasks();
    expect(r.host.stats.staleReplies).toBe(1);
    expect(r.host.stats.merges).toBe(0);
    expect(r.sim.money).toBe(1);
    r.gate().flush();
    const again = last(r.toWorker) as Extract<ToWorker, { type: "ops" }>;
    expect(again.request?.merge).toBe(true);
    await r.settleTasks();
    expect(r.host.stats.merges).toBe(1);
    expect(r.sim.money).toBe(1);
    r.host.detach();
  });

  it("drains the engine's events once and keeps its drop count", async () => {
    const r = rig();
    const founding = Simulation.newGame(7, "classic").drainGameplayEvents().length;
    await r.settleTasks();
    r.engine().owed = [{ name: "star_reached", payload: { star: 2 } }];
    r.engine().dropped = 3;
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    const events = r.sim.drainGameplayEvents();
    expect(events.length).toBe(founding + 1);
    expect(last(events)).toEqual({ name: "star_reached", payload: { star: 2 } });
    expect(r.sim.drainGameplayEvents()).toEqual([]);
    expect(r.sim.gameplayEventsDropped).toBe(3);
    r.engine().owed = [{ name: "x", payload: {} }];
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    r.host.detach();
    // The events handed over before the detach stay with the instance.
    expect(r.sim.drainGameplayEvents()).toEqual([{ name: "x", payload: {} }]);
    expect(r.sim.gameplayEventsDropped).toBe(3);
  });

  it("keeps one log line per command and takes the pending choice from a current reply", async () => {
    const r = rig();
    await r.settleTasks();
    const seq0 = r.sim.logSeq;
    r.sim.emit("hello", "info");
    r.engine().pending = JSON.stringify({ kind: "fire", message: "Fire!", cost: 10 });
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.sim.logSeq).toBe(seq0 + 1);
    expect(last(r.sim.log)?.text).toBe("line 1"); // the engine's line in place of the instance's
    expect(r.sim.events.pending).toMatchObject({ message: "Fire!" });
    r.engine().pending = undefined;
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.sim.events.pending).toBeNull();
    r.host.detach();
  });

  it("serializes the exact save only while caught up, and settle fetches one", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(5);
    r.gate().flush();
    await r.settleTasks();
    r.engine().money = 999; // the engine moved; the read model's money is older
    const own = r.sim.serialize() as { money: number };
    expect(own.money).not.toBe(999);
    await r.host.settle();
    expect((r.sim.serialize() as { money: number }).money).toBe(999);
    // Settled and nothing sent since: settle answers at once.
    await r.host.settle();
    r.sim.tick(1);
    expect((r.sim.serialize() as { money: number }).money).toBe(999); // the read model's own now
    r.host.detach();
    await r.host.settle();
  });

  it("is fatal when the engine's clock disagrees with the frame loop's", async () => {
    const r = rig();
    await r.settleTasks();
    r.engine().minutes += 7;
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.fatal.join()).toMatch(/clock reads/);
    r.host.detach();
  });

  it("reports a failed op without letting go, ignores another tower's replies, and frees on detach", async () => {
    const r = rig();
    await r.settleTasks();
    r.engine().failOn = "setMoney";
    r.sim.money = 3;
    await r.settleTasks();
    expect(r.errors.join()).toMatch(/op 1: setMoney: setMoney failed/);
    expect(r.fatal).toEqual([]);
    const received = r.host.stats.messagesReceived;
    r.host.receive({ type: "error", gen: 99, seq: 1, message: "not mine" });
    expect(r.host.stats.messagesReceived).toBe(received);
    r.host.receive({ type: "error", message: "the worker died" });
    expect(r.fatal).toEqual(["the worker died"]);
    r.host.detach();
    r.host.detach();
    expect(last(r.toWorker)).toEqual({ type: "free", gen: 1 });
    await r.settleTasks();
    expect(r.engine().freed).toBe(true);
    expect(stepGate(r.sim)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(r.sim, "serialize")).toBeUndefined();
  });

  it("refuses a tower whose crowd exists, and a catalog for another world", () => {
    const sim = Simulation.newGame(1, "classic");
    sim.crowd.people.push({ id: 1 } as never);
    const mod = fakeModule();
    const core = new EngineWorkerCore(mod, () => {});
    expect(() => attachWorkerHost(sim, { gen: 1, catalogs: core.catalogs(), send: () => {}, onFatal: () => {}, onError: () => {} })).toThrow(/crowd/);
    const odd = JSON.parse(core.catalogs().classic) as { world: { lotWidth: number } };
    odd.world.lotWidth += 1;
    expect(() => attachWorkerHost(Simulation.newGame(1, "classic"), { gen: 1, catalogs: { classic: JSON.stringify(odd), modern: core.catalogs().modern }, send: () => {}, onFatal: () => {}, onError: () => {} })).toThrow(/different world|catalog/);
  });
});

describe("worker core (fake engine)", () => {
  it("refuses a bad load, a gap in the sequence, and caps the errors it reports", () => {
    const mod = fakeModule();
    const out: FromWorker[] = [];
    const core = new EngineWorkerCore(mod, (m) => out.push(m));
    core.handle({ type: "init", url: "x" });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, dt: 1 }] }); // before any load: ignored
    expect(out).toEqual([]);
    core.handle({ type: "load", gen: 1, save: "refuse", markers: { lastHour: 0, lastDay: 0, lastQuarter: 0, lastMonth: 0 } });
    expect(last(out)).toMatchObject({ type: "error", gen: 1, message: "load: bad save" });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, dt: 1 }], request: { req: 1, logSeq: 0, merge: false } });
    expect(out).toHaveLength(1); // nothing applies after a refused load
    const save = JSON.stringify(Simulation.newGame(1, "classic").serialize());
    core.handle({ type: "load", gen: 2, save, markers: { lastHour: 0, lastDay: 0, lastQuarter: 0, lastMonth: 0 } });
    expect(last(out)).toMatchObject({ type: "loaded", gen: 2 });
    core.handle({ type: "ops", gen: 2, ops: [{ seq: 2, dt: 1 }] });
    expect(last(out)).toMatchObject({ type: "error", seq: 2, message: expect.stringMatching(/gap/) });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, dt: 1 }] }); // another tower's: ignored
    last(mod.engines)!.failOn = null;
    const engine = last(mod.engines)!;
    for (let i = 1; i <= MAX_ERRORS_PER_TOWER + 5; i++) {
      engine.failOn = "tick";
      core.handle({ type: "ops", gen: 2, ops: [{ seq: i, dt: 1 }] });
    }
    const errors = out.filter((m) => m.type === "error" && m.gen === 2);
    expect(errors).toHaveLength(MAX_ERRORS_PER_TOWER);
    core.handle({ type: "free", gen: 1 }); // not the current tower
    expect(engine.freed).toBe(false);
    core.handle({ type: "free", gen: 2 });
    expect(engine.freed).toBe(true);
  });

  it("answers a request with the log after the cursor and a full save only when it moved", () => {
    const mod = fakeModule();
    const out: FromWorker[] = [];
    const core = new EngineWorkerCore(mod, (m) => out.push(m));
    const save = JSON.stringify(Simulation.newGame(1, "classic").serialize());
    core.handle({ type: "load", gen: 1, save, markers: { lastHour: 0, lastDay: 0, lastQuarter: 0, lastMonth: 0 } });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, cmd: { op: "emit", text: "a", kind: "info" } }], request: { req: 1, logSeq: 0, merge: false } });
    const a = last(out) as Extract<FromWorker, { type: "frame" }>;
    expect(a).toMatchObject({ type: "frame", req: 1, seq: 1, merge: null });
    expect(JSON.parse(a.log!)).toHaveLength(1);
    core.handle({ type: "ops", gen: 1, ops: [], request: { req: 2, logSeq: 1, merge: false } });
    expect(last(out)).toMatchObject({ req: 2, log: null, merge: null });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 2, cmd: { op: "startFire" } }], request: { req: 3, logSeq: 1, merge: false } });
    expect((last(out) as Extract<FromWorker, { type: "frame" }>).merge?.save).toBeTypeOf("string");
    core.handle({ type: "ops", gen: 1, ops: [], request: { req: 4, logSeq: 1, merge: true } });
    expect((last(out) as Extract<FromWorker, { type: "frame" }>).merge).not.toBeNull();
  });
});
