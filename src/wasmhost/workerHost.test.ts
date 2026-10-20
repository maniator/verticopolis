import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachWorkerHost } from "./workerHost";
import { EngineWorkerCore, MAX_ERRORS_PER_TOWER } from "./workerCore";
import { stepGate } from "./stepGate";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { fakeModule } from "./fakeEngine.fixture";
import { rig } from "./workerRig.fixture";

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

describe("worker host (fake engine)", () => {
  it.each([true, false])("holds stale commute samples until a fresh reply (detach: %s)", async (detach) => {
    const r = rig();
    await r.settleTasks();
    r.sim.crowd.adoptCommuteStress([[2, 10]]);
    r.engine().commuteRows = "[[2,25]]";
    r.engine().commuteRevision++;
    r.sim.tick(1);
    r.gate().flush();
    r.sim.money = 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.host.stats.staleReplies).toBe(1);
    expect([...r.sim.crowd.commuteStressByFloor]).toEqual([[2, 10]]);
    if (!detach) {
      await r.settleTasks();
      expect([...r.sim.crowd.commuteStressByFloor]).toEqual([[2, 25]]);
      expect(r.fatal).toEqual([]);
    }
    r.host.detach();
    expect([...r.sim.crowd.commuteStressByFloor]).toEqual([[2, detach ? 10 : 25]]);
    await r.settleTasks();
  });
  it("retains changed commute rows from a frame without an hourly merge through detach", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.crowd.adoptCommuteStress([[2, 10], [7, 80]]);
    r.engine().commuteRows = "[[2,25]]";
    r.engine().commuteRevision++;
    r.engine().owed = [{ name: "star_reached", payload: { star: 2 } }];
    const merges = r.host.stats.merges;
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(r.host.stats.merges).toBe(merges);
    expect([...r.sim.crowd.commuteStressByFloor]).toEqual([[2, 25]]);
    const save = r.engine().serialize();
    r.host.detach();
    expect([...r.sim.crowd.commuteStressByFloor]).toEqual([[2, 25]]);
    expect(r.engine().serialize()).toBe(save);
    expect(r.sim.drainGameplayEvents().filter((e) => e.name === "star_reached")).toHaveLength(1);
    expect(r.sim.drainGameplayEvents()).toEqual([]);
  });
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
    const atReply = r.sim.clock.minutes;
    r.sim.tick(1);
    const approx = r.sim.serialize() as { minutes: number };
    expect(r.host.stats.approximateSaves).toBe(1);
    // Its clock is the state's own, the last fresh reply's: the frame loop's
    // already counts the step not yet answered (#1018).
    expect(r.sim.clock.minutes).toBe(atReply + 1);
    expect(approx.minutes).toBe(atReply);
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

  it("refuses a tower whose crowd exists, a catalog for another world and one with other kinds", () => {
    const sim = Simulation.newGame(1, "classic");
    sim.crowd.people.push({ id: 1 } as never);
    const mod = fakeModule();
    const core = new EngineWorkerCore(mod, () => {});
    expect(() => attachWorkerHost(sim, { gen: 1, catalogs: core.catalogs(), send: () => {}, onFatal: () => {}, onError: () => {} })).toThrow(/crowd/);
    const odd = JSON.parse(core.catalogs().classic) as { world: { lotWidth: number } };
    odd.world.lotWidth += 1;
    expect(() => attachWorkerHost(Simulation.newGame(1, "classic"), { gen: 1, catalogs: { classic: JSON.stringify(odd), modern: core.catalogs().modern }, send: () => {}, onFatal: () => {}, onError: () => {} })).toThrow(/classic catalog states a different world from this build's tables \(lotWidth\)/);
    const extra = JSON.parse(core.catalogs().modern) as { facilities: { key: string }[] };
    extra.facilities.push({ ...extra.facilities[0], key: "zeppelinDock" });
    expect(() => attachWorkerHost(Simulation.newGame(1, "modern"), { gen: 1, catalogs: { classic: core.catalogs().classic, modern: JSON.stringify(extra) }, send: () => {}, onFatal: () => {}, onError: () => {} })).toThrow(/modern catalog lists other facility kinds than this build draws \(unknown zeppelinDock\)/);
  });
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

describe("EngineWorkerCore.identity (#963)", () => {
  it("reads the engine's record, and answers undefined without the call or when it throws", () => {
    const mod = fakeModule();
    expect(new EngineWorkerCore(mod, () => {}).identity()).toBeUndefined();
    expect(new EngineWorkerCore({ ...mod, engineIdentity: () => '{"schema":1}' }, () => {}).identity()).toBe('{"schema":1}');
    const trap = { ...mod, engineIdentity: () => { throw new Error("trap"); } };
    expect(new EngineWorkerCore(trap, () => {}).identity()).toBeUndefined();
  });
});
