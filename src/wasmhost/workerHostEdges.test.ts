import { afterEach, describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { attachWorkerHost } from "./workerHost";
import { EngineWorkerCore } from "./workerCore";
import type { ToWorker } from "./workerProtocol";
import { fakeModule } from "./fakeEngine.fixture";
import { rig } from "./workerRig.fixture";

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/** The worker host's edge cases from the review rounds: stale replies and
 *  detach, the reply checks, the watchdog, camera stamps, settle. */
describe("worker host round 2 (fake engine)", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("after a stale reply, a detach gives back the unconfirmed steps and hands each command's event out once", async () => {
    const r = rig();
    await r.settleTasks();
    const t0 = r.sim.clock.minutes;
    expect(r.sim.build("lobby", 1, 170).ok).toBe(true);
    r.gate().flush(); // a fresh reply confirms the first build
    await r.settleTasks();
    r.sim.drainGameplayEvents();
    r.sim.tick(5);
    r.gate().flush();
    const second = r.sim.build("lobby", 1, 190); expect(second.ok, JSON.stringify(second)).toBe(true); // after the request: its reply is stale
    // The stale reply brings a tick event of the unconfirmed steps.
    r.engine().owed = [{ name: "star_reached", payload: { star: 2 } }];
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(r.host.stats.staleReplies).toBe(1);
    expect(r.sim.drainGameplayEvents(), "held until a fresh reply").toEqual([]);
    r.host.detach();
    expect(r.sim.clock.minutes, "back to the last fresh reply's minute").toBe(t0);
    const events = r.sim.drainGameplayEvents();
    // The build's event once (the read model's copy); the star is not handed
    // out, since its steps run again on TypeScript.
    expect(events.filter((e) => e.name === "facility_placed")).toHaveLength(1);
    expect(events.some((e) => e.name === "star_reached")).toBe(false);
  });

  it("delivers held events with the next fresh reply, in order", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.drainGameplayEvents();
    r.sim.tick(1);
    r.gate().flush();
    r.sim.money = 5;
    r.engine().owed = [{ name: "star_reached", payload: { star: 2 } }];
    // Two task turns: the stale reply is in, the next request is out.
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(r.host.stats.staleReplies).toBe(1);
    expect(r.sim.drainGameplayEvents(), "held while stale").toEqual([]);
    await r.settleTasks();
    const events = r.sim.drainGameplayEvents();
    expect(events.map((e) => e.name)).toEqual(["star_reached"]);
    r.host.detach();
  });

  it("opens the gate after a streak of stale replies, so steps go on while commands stream", async () => {
    const r = rig();
    await r.settleTasks();
    let steppedWhileStale = false;
    for (let f = 0; f < 40; f++) {
      const gate = r.gate();
      if (gate.canStep()) {
        // Stepping on an open gate whose last reply was stale: the streak.
        if (f > 0 && r.host.stats.staleReplies > 0 && r.host.stats.ackedSeq < r.host.stats.lastCommandSeq) steppedWhileStale = true;
        r.sim.tick(1);
      }
      gate.flush();
      r.sim.money = 1000 + f; // a command every frame, after the request
      await new Promise((res) => setTimeout(res, 0));
      await new Promise((res) => setTimeout(res, 0));
    }
    expect(r.host.stats.staleReplies).toBeGreaterThanOrEqual(4);
    expect(steppedWhileStale).toBe(true);
    await r.settleTasks();
    expect(r.engine().minutes).toBe(r.sim.clock.minutes);
    r.host.detach();
  });

  it("a fresh reply sent before a camera stamp is still exact (view patched in) and keeps the page's view", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.view = { tile: 1, floor: 1, zoom: 1 };
    r.sim.tick(1);
    r.engine().revision++; // the reply carries a merge
    r.gate().flush();
    r.sim.view = { tile: 9, floor: 9, zoom: 2 }; // after the request
    await r.settleTasks();
    expect(r.host.stats.staleReplies).toBe(0);
    expect(r.sim.view).toEqual({ tile: 9, floor: 9, zoom: 2 });
    const before = r.host.stats.approximateSaves;
    expect((r.sim.serialize() as { view?: unknown }).view).toEqual({ tile: 9, floor: 9, zoom: 2 });
    expect(r.host.stats.approximateSaves).toBe(before);
    r.host.detach();
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
    v.sim.view = { tile: 1, floor: 1, zoom: 1 };
    await v.settleTasks();
    expect(v.host.stats.staleReplies).toBe(0);
    v.host.detach();
  });

  it("waits for a visible page before giving up on a reply", async () => {
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

  it("leaves the read model untouched by a fresh reply it cannot read, so the fallback sees the last applied state", () => {
    const mod = fakeModule();
    const core = new EngineWorkerCore(mod, () => {});
    const sim = Simulation.newGame(4, "classic");
    const sent: ToWorker[] = [];
    const fatal: string[] = [];
    const h = attachWorkerHost(sim, { gen: 1, catalogs: core.catalogs(), send: (m) => sent.push(m), onFatal: (m) => fatal.push(m), onError: () => {} });
    const loaded = new Float64Array(26);
    loaded[0] = sim.clock.minutes;
    loaded[4] = sim.money;
    h.receive({ type: "loaded", gen: 1, view: loaded });
    const minutes = sim.clock.minutes;
    const money = sim.money;
    sim.tick(1);
    h.flush();
    const req = (last(sent) as Extract<ToWorker, { type: "ops" }>).request!.req;
    // A well-formed frame view that moves the money, with a log that is not
    // JSON: nothing of it may land before the failure.
    const view = new Float64Array(26);
    view[0] = minutes + 1;
    view[4] = money + 12_345;
    h.receive({ type: "frame", gen: 1, req, seq: 1, view, events: "[]", dropped: 0, log: "{not json", pending: null, merge: null, workMs: { ops: 0, reply: 0 }, memoryBytes: null });
    expect(fatal.length).toBe(1);
    expect(sim.money).toBe(money);
    h.detach();
    // The fallback rolls the clock back to the last applied minute.
    expect(sim.clock.minutes).toBe(minutes);
    expect(sim.money).toBe(money);

    // An event batch that parses but is no list: the same.
    const shaped = Simulation.newGame(4, "classic");
    const sent3: ToWorker[] = [];
    const fatal3: string[] = [];
    const h3 = attachWorkerHost(shaped, { gen: 3, catalogs: core.catalogs(), send: (m) => sent3.push(m), onFatal: (m) => fatal3.push(m), onError: () => {} });
    h3.receive({ type: "loaded", gen: 3, view: loaded });
    shaped.tick(1);
    h3.flush();
    const req3 = (last(sent3) as Extract<ToWorker, { type: "ops" }>).request!.req;
    h3.receive({ type: "frame", gen: 3, req: req3, seq: 1, view, events: "{}", dropped: 0, log: null, pending: null, merge: null, workMs: { ops: 0, reply: 0 }, memoryBytes: null });
    expect(fatal3.join()).toMatch(/the event batch is not a list/);
    expect(shaped.money).toBe(money);
    h3.detach();
    expect(shaped.clock.minutes).toBe(minutes);

    // The same for a merge whose save reads but whose telemetry does not:
    // the save's structure must not land either.
    const merged = Simulation.newGame(4, "classic");
    const sent2: ToWorker[] = [];
    const fatal2: string[] = [];
    const h2 = attachWorkerHost(merged, { gen: 2, catalogs: core.catalogs(), send: (m) => sent2.push(m), onFatal: (m) => fatal2.push(m), onError: () => {} });
    h2.receive({ type: "loaded", gen: 2, view: loaded });
    merged.tick(1);
    h2.flush();
    const req2 = (last(sent2) as Extract<ToWorker, { type: "ops" }>).request!.req;
    const other = Simulation.newGame(4, "classic");
    other.tower.towerName = "From the bad merge";
    h2.receive({ type: "frame", gen: 2, req: req2, seq: 1, view, events: "[]", dropped: 0, log: null, pending: null, merge: { save: JSON.stringify(other.serialize()), telemetry: "{not json", housekeeping: null, commute: "[]" }, workMs: { ops: 0, reply: 0 }, memoryBytes: null });
    expect(fatal2.length).toBe(1);
    expect(merged.tower.towerName).not.toBe("From the bad merge");
    expect(merged.money).toBe(money);
    h2.detach();
  });

  it("refuses a fresh reply whose items parse but are not the engine's shape, before any write", () => {
    const mod = fakeModule();
    const core = new EngineWorkerCore(mod, () => {});
    const other = Simulation.newGame(4, "classic");
    other.tower.towerName = "From the bad reply";
    const otherSave = JSON.stringify(other.serialize());
    const cases: { name: string; pending?: boolean; reply: Record<string, unknown>; error: RegExp }[] = [
      { name: "a log entry that is no entry", reply: { log: "[null]" }, error: /an item in the log/ },
      { name: "an event that is no event", reply: { events: "[1]" }, error: /an item in the event batch/ },
      { name: "a drop count that is no count", reply: { dropped: "x" }, error: /dropped-event count/ },
      { name: "a pending choice that is no choice", pending: true, reply: { pending: "5" }, error: /pending choice/ },
      { name: "telemetry rows of the wrong shape", reply: { merge: { save: otherSave, telemetry: '{"util":[5],"hourly":[],"origins":[]}', housekeeping: null, commute: "[]" } }, error: /telemetry/ },
      { name: "a save that parses but is no save", reply: { merge: { save: "{}", telemetry: '{"util":[],"hourly":[],"origins":[]}', housekeeping: null, commute: "[]" } }, error: /the save is not/ },
      { name: "commute-stress rows of the wrong shape", reply: { merge: { save: otherSave, telemetry: '{"util":[],"hourly":[],"origins":[]}', housekeeping: null, commute: '[[3,"x"]]' } }, error: /commute stress/ },
      { name: "a floor listed twice in the commute stress", reply: { merge: { save: otherSave, telemetry: '{"util":[],"hourly":[],"origins":[]}', housekeeping: null, commute: "[[3,1],[3,2]]" } }, error: /commute stress/ },
      { name: "a merge with no commute stress", reply: { merge: { save: otherSave, telemetry: '{"util":[],"hourly":[],"origins":[]}', housekeeping: null } }, error: /commute stress/ },
    ];
    for (const [i, c] of cases.entries()) {
      const sim = Simulation.newGame(4, "classic");
      const sent: ToWorker[] = [];
      const fatal: string[] = [];
      const gen = 10 + i;
      const h = attachWorkerHost(sim, { gen, catalogs: core.catalogs(), send: (m) => sent.push(m), onFatal: (m) => fatal.push(m), onError: () => {} });
      const loaded = new Float64Array(26);
      loaded[0] = sim.clock.minutes;
      loaded[4] = sim.money;
      h.receive({ type: "loaded", gen, view: loaded });
      const minutes = sim.clock.minutes;
      const money = sim.money;
      const name = sim.tower.towerName;
      sim.tick(1);
      h.flush();
      const req = (last(sent) as Extract<ToWorker, { type: "ops" }>).request!.req;
      const view = new Float64Array(26);
      view[0] = minutes + 1;
      view[4] = money + 12_345;
      if (c.pending) view[21] = 1;
      h.receive({ type: "frame", gen, req, seq: 1, view, events: "[]", dropped: 0, log: null, pending: null, merge: null, workMs: { ops: 0, reply: 0 }, memoryBytes: null, ...c.reply } as never);
      expect(fatal.join(), c.name).toMatch(c.error);
      expect(sim.money, c.name).toBe(money);
      expect(sim.tower.towerName, c.name).toBe(name);
      h.detach();
      expect(sim.clock.minutes, c.name).toBe(minutes);
    }
  });

  it("ends a settle that never gets an answer at the host's own cap", async () => {
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

