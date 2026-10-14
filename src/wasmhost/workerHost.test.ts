import { afterEach, describe, expect, it } from "vitest";
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

  it("refuses a reply older than a command, asks again at once, and holds the steps until a current one", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(1);
    r.gate().flush();
    r.sim.money = 1; // after the request: the reply cannot include it
    r.mod.engines[0].revision++; // the reply would carry a merge
    r.mod.engines[0].pending = JSON.stringify({ kind: "fire", message: "stale", cost: 1 });
    const replies = r.host.stats.replies;
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    // The stale reply is in, refused: nothing of it applied, and a new
    // request is already out (no steps in it), so the gate stays shut.
    expect(r.host.stats.staleReplies).toBe(1);
    expect(r.host.stats.replies).toBe(replies + 1);
    expect(r.sim.money).toBe(1);
    expect(r.sim.events.pending).toBeNull();
    expect(r.gate().canStep()).toBe(false);
    const again = last(r.toWorker) as Extract<ToWorker, { type: "ops" }>;
    expect(again.request?.merge).toBe(true);
    expect(again.ops, "no new steps (the command went out on its own)").toEqual([]);
    await r.settleTasks();
    expect(r.host.stats.merges).toBe(1);
    expect(r.sim.money).toBe(1);
    expect(r.sim.events.pending).toMatchObject({ message: "stale" });
    expect(r.gate().canStep()).toBe(true);
    r.host.detach();
  });

  it("takes a pending choice that replaced another between replies", async () => {
    const r = rig();
    await r.settleTasks();
    r.engine().pending = JSON.stringify({ kind: "fire", message: "first", cost: 1 });
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.sim.events.pending).toMatchObject({ message: "first" });
    r.engine().pending = JSON.stringify({ kind: "bomb", message: "second", cost: 2 });
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.sim.events.pending).toMatchObject({ message: "second" });
    r.host.detach();
  });

  it("is fatal when a message cannot be posted, when the worker stops answering, and on a fatal error with a seq", async () => {
    const throwing = rig();
    await throwing.settleTasks();
    throwing.sim.tick(1);
    const send = throwing.toWorker.push.bind(throwing.toWorker);
    throwing.toWorker.push = () => { throw new Error("DataCloneError"); };
    throwing.gate().flush();
    throwing.toWorker.push = send;
    expect(throwing.fatal.join()).toMatch(/could not post to the worker: DataCloneError/);
    throwing.host.detach();

    const mod = fakeModule();
    const fatal: string[] = [];
    const core = new EngineWorkerCore(mod, () => {}); // answers nothing
    const silent = attachWorkerHost(Simulation.newGame(2, "classic"), { gen: 1, catalogs: core.catalogs(), send: () => {}, onFatal: (m) => fatal.push(m), onError: () => {}, replyTimeoutMs: 5 });
    await new Promise((res) => setTimeout(res, 20));
    expect(fatal.join()).toMatch(/did not answer the load within 5 ms/);
    silent.detach();

    const r = rig();
    await r.settleTasks();
    r.host.receive({ type: "error", gen: 1, seq: 4, fatal: true, message: "op 4 arrived after 2; the sequence has a gap" });
    expect(r.fatal.join()).toMatch(/gap/);
    r.host.detach();
  });

  it("hands back the events of commands no reply included, and the clock of steps the engine never confirmed", async () => {
    const r = rig();
    await r.settleTasks();
    const t0 = r.sim.clock.minutes;
    r.sim.tick(5);
    r.gate().flush();
    expect(r.sim.build("lobby", 1, 170).ok).toBe(true);
    // Detach before any reply: the build's event is the instance's own copy.
    r.host.detach();
    expect(r.sim.clock.minutes, "the unconfirmed step is given back").toBe(t0);
    const events = r.sim.drainGameplayEvents();
    expect(events.filter((e) => e.name === "facility_placed")).toHaveLength(1);
  });

  it("keeps the exact save across a camera stamp and counts the saves it could not make exact", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(1);
    await r.host.settle();
    const exact = r.sim.serialize() as { money: number; view?: unknown };
    r.sim.view = { x: 1, y: 2, zoom: 3 } as never;
    const stamped = r.sim.serialize() as { money: number; view?: unknown };
    expect(stamped.money).toBe(exact.money);
    expect(stamped.view).toEqual({ x: 1, y: 2, zoom: 3 });
    expect(r.host.stats.approximateSaves).toBe(0);
    r.sim.tick(1);
    r.sim.serialize();
    expect(r.host.stats.approximateSaves).toBe(1);
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
    r.host.receive({ type: "error", gen: 99, seq: 1, fatal: false, message: "not mine" });
    expect(r.host.stats.messagesReceived).toBe(received);
    r.host.receive({ type: "error", fatal: true, message: "the worker died" });
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

describe("worker host round 2 (fake engine)", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("takes the engine's minute only from a fresh reply, and after a stale one drops (and counts) the copies at detach", async () => {
    const r = rig();
    await r.settleTasks();
    const t0 = r.sim.clock.minutes;
    expect(r.sim.build("lobby", 1, 170).ok).toBe(true);
    await r.settleTasks();
    r.sim.drainGameplayEvents();
    r.sim.tick(5);
    r.gate().flush();
    expect(r.sim.build("lobby", 1, 171).ok).toBe(true); // after the request: its reply is stale
    r.engine().owed = [{ name: "facility_placed", payload: { kind: "lobby", floor: 1, count: 1 } }];
    // Let the stale reply in, and detach before the next one.
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(r.host.stats.staleReplies).toBe(1);
    r.host.detach();
    expect(r.sim.clock.minutes, "back to the last fresh reply's minute").toBe(t0);
    const events = r.sim.drainGameplayEvents();
    expect(events.filter((e) => e.name === "facility_placed")).toHaveLength(1); // the engine's, never twice
    expect(r.sim.gameplayEventsDropped).toBeGreaterThanOrEqual(1);
  });

  it("is fatal on a reply to a request that is not in flight, and a camera stamp leaves the reply in flight fresh", async () => {
    const r = rig();
    await r.settleTasks();
    r.host.receive({ type: "frame", gen: 1, req: 42, seq: 0, view: new Float64Array(26), events: "[]", dropped: 0, log: null, pending: null, merge: null, workMs: { ops: 0, reply: 0 }, memoryBytes: null });
    expect(r.fatal.join()).toMatch(/a reply to request 42 while no request was in flight/);
    r.host.detach();

    const v = rig();
    await v.settleTasks();
    v.sim.tick(1);
    v.gate().flush();
    v.sim.view = { x: 1, y: 1, zoom: 1 } as never;
    await v.settleTasks();
    expect(v.host.stats.staleReplies).toBe(0);
    v.host.detach();
  });

  it("waits for a visible page before giving up on a reply, and opens the gate after a streak of stale replies", async () => {
    (globalThis as { document?: unknown }).document = { hidden: true };
    const mod = fakeModule();
    const fatal: string[] = [];
    const core = new EngineWorkerCore(mod, () => {});
    const silent = attachWorkerHost(Simulation.newGame(2, "classic"), { gen: 1, catalogs: core.catalogs(), send: () => {}, onFatal: (m) => fatal.push(m), onError: () => {}, replyTimeoutMs: 5 });
    await new Promise((res) => setTimeout(res, 25));
    expect(fatal).toEqual([]);
    (globalThis as { document?: unknown }).document = { hidden: false };
    await new Promise((res) => setTimeout(res, 25));
    expect(fatal.join()).toMatch(/did not answer the load/);
    silent.detach();

    const r = rig();
    await r.settleTasks();
    // A command lands after every request: each reply is stale.
    const sim = r.sim;
    for (let i = 0; i < 5; i++) {
      sim.tick(1);
      r.gate().flush();
      sim.money = 1000 + i;
      await new Promise((res) => setTimeout(res, 0));
      await new Promise((res) => setTimeout(res, 0));
    }
    expect(r.host.stats.staleReplies).toBeGreaterThanOrEqual(4);
    await r.settleTasks();
    expect(r.gate().canStep()).toBe(true);
    r.host.detach();
  });

  it("is fatal on a malformed frame view that answers the request in flight", () => {
    const mod = fakeModule();
    const core = new EngineWorkerCore(mod, () => {});
    const sim = Simulation.newGame(4, "classic");
    const sent: ToWorker[] = [];
    const fatal: string[] = [];
    const h = attachWorkerHost(sim, { gen: 1, catalogs: core.catalogs(), send: (m) => sent.push(m), onFatal: (m) => fatal.push(m), onError: () => {} });
    const view = new Float64Array(26);
    view[0] = sim.clock.minutes;
    h.receive({ type: "loaded", gen: 1, view });
    sim.tick(1);
    h.flush();
    const req = (last(sent) as Extract<ToWorker, { type: "ops" }>).request!.req;
    h.receive({ type: "frame", gen: 1, req, seq: 1, view: new Float64Array(3), events: "[]", dropped: 0, log: null, pending: null, merge: null, workMs: { ops: 0, reply: 0 }, memoryBytes: null });
    expect(fatal.join()).toMatch(/frame view: 3 numbers/);
    h.detach();
  });

  it("drops a timed-out settle's waiter", async () => {
    const mod = fakeModule();
    const sent: ToWorker[] = [];
    const core = new EngineWorkerCore(mod, () => {});
    const h = attachWorkerHost(Simulation.newGame(3, "classic"), { gen: 1, catalogs: core.catalogs(), send: (m) => sent.push(m), onFatal: () => {}, onError: () => {} });
    const t0 = Date.now();
    await h.settle(); // nothing ever answers: the host's own cap lets it go
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
    h.detach();
  }, 10_000);
});

describe("worker core (fake engine)", () => {
  it("refuses a bad load and a gap as fatal, caps the refused ops it reports, and frees on free", () => {
    const mod = fakeModule();
    const out: FromWorker[] = [];
    const core = new EngineWorkerCore(mod, (m) => out.push(m));
    const markers = { lastHour: 0, lastDay: 0, lastQuarter: 0, lastMonth: 0 };
    core.handle({ type: "init", url: "x" });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, dt: 1 }] }); // before any load: ignored
    expect(out).toEqual([]);
    core.handle({ type: "load", gen: 1, save: "refuse", markers });
    expect(last(out)).toMatchObject({ type: "error", gen: 1, fatal: true, message: "load: bad save" });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, dt: 1 }], request: { req: 1, logSeq: 0, merge: false } });
    expect(out).toHaveLength(1); // nothing applies after a refused load
    const save = JSON.stringify(Simulation.newGame(1, "classic").serialize());
    core.handle({ type: "load", gen: 2, save, markers });
    expect(last(out)).toMatchObject({ type: "loaded", gen: 2 });
    core.handle({ type: "ops", gen: 1, ops: [{ seq: 1, dt: 1 }] }); // another tower's: ignored
    const engine = last(mod.engines)!;
    for (let i = 1; i <= MAX_ERRORS_PER_TOWER + 5; i++) {
      engine.failOn = "setMoney";
      core.handle({ type: "ops", gen: 2, ops: [{ seq: i, cmd: { op: "setMoney", amount: i } }] });
    }
    const refused = out.filter((m) => m.type === "error" && m.gen === 2);
    expect(refused).toHaveLength(MAX_ERRORS_PER_TOWER);
    expect(refused.every((m) => m.type === "error" && !m.fatal)).toBe(true);
    // A step that fails is fatal, past the cap too, and frees the engine.
    const save2 = JSON.stringify(Simulation.newGame(2, "classic").serialize());
    core.handle({ type: "load", gen: 30, save: save2, markers });
    const stepping = last(mod.engines)!;
    stepping.failOn = "tick";
    core.handle({ type: "ops", gen: 30, ops: [{ seq: 1, dt: 1 }] });
    expect(last(out)).toMatchObject({ type: "error", gen: 30, seq: 1, fatal: true, message: "tick: tick failed" });
    expect(stepping.freed).toBe(true);
    core.handle({ type: "load", gen: 2, save, markers });
    // Past the cap, a fatal error still goes out, and the engine is freed.
    core.handle({ type: "ops", gen: 2, ops: [{ seq: MAX_ERRORS_PER_TOWER + 9, dt: 1 }] });
    expect(last(out)).toMatchObject({ type: "error", gen: 2, fatal: true, message: expect.stringMatching(/gap/) });
    expect(engine.freed).toBe(true);
    // Twenty-five towers in one core: every engine it let go is freed.
    for (let g = 3; g < 28; g++) {
      core.handle({ type: "load", gen: g, save, markers });
      core.handle({ type: "free", gen: g });
    }
    core.handle({ type: "free", gen: 1 }); // not the current tower: nothing to free
    expect(mod.engines.slice(1).every((e) => e.freed)).toBe(true);
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
