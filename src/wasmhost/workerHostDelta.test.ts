import { describe, expect, it } from "vitest";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { rig } from "./workerRig.fixture";
import { Simulation } from "../engine/Simulation";
import { parseDelta } from "./workerApply";
import { sameJson } from "./workerCore";
import { fakeModule } from "./fakeEngine.fixture";
import { mergeSimulationDelta } from "./merge";

/**
 * The hourly delta on the worker host (#1045), on the fake engine: an hour
 * pass on an unchanged layout goes out as a delta, a layout change or an
 * engine that cannot describe the change as a full save, and a delta taken
 * against a save the read model does not hold is refused for a full one.
 */

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const frames = (xs: readonly FromWorker[]) => xs.filter((m): m is Extract<FromWorker, { type: "frame" }> => m.type === "frame");

describe("the worker host's hourly delta", () => {
  it("sends an hour pass on an unchanged layout as a delta, numbered after the load", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    const reply = last(frames(r.toHost))!;
    expect(reply.merge).toBeNull();
    expect(reply.delta).toMatchObject({ base: 0, sync: 1 });
    expect(r.host.stats).toMatchObject({ deltas: 1, merges: 0, deltasRefused: 0 });
    expect(r.engine().calls).toContain("saveDelta");
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.delta).toMatchObject({ base: 1, sync: 2 });
    expect(r.host.stats.deltas).toBe(2);
    r.host.detach();
  });

  it("sends a full save when the layout moved or the engine has no delta", async () => {
    const r = rig();
    await r.settleTasks();
    r.engine().revision++;
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.merge).toMatchObject({ sync: 1 });
    expect(last(frames(r.toHost))!.delta).toBeNull();
    r.engine().noDelta = true;
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.merge).toMatchObject({ sync: 2 });
    expect(r.host.stats).toMatchObject({ merges: 2, deltas: 0 });
    // The full save resets the base: the next delta applies on top of it.
    r.engine().noDelta = false;
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.delta).toMatchObject({ base: 2, sync: 3 });
    expect(r.host.stats.deltas).toBe(1);
    r.host.detach();
  });

  it("sends the hour pass after a command as a full save, and after a camera stamp or a log line as a delta", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.view = { tile: 1, floor: 2, zoom: 1 };
    r.sim.emit("Lunch rush", "info");
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.delta).not.toBeNull();
    r.sim.money = r.sim.money + 1000;
    r.sim.tick(1);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.merge, "no hour pass yet: nothing sent").toBeNull();
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.merge).not.toBeNull();
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.delta, "the hour after is a delta again").not.toBeNull();
    r.host.detach();
  });

  it("sends a full save first when the engine read the loaded save into something else", async () => {
    // A repair or migration the read model did not make: the engine's save
    // is not the one the main thread sent, so no delta may be taken against
    // it, and the read model takes the engine's state.
    const r = rig(undefined, fakeModule({ readsAs: { towerName: "Repaired" } }));
    await r.settleTasks();
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    const reply = last(frames(r.toHost))!;
    expect(reply.delta).toBeNull();
    expect(reply.merge).toMatchObject({ sync: 1 });
    expect(r.host.stats).toMatchObject({ merges: 1, deltas: 0 });
    expect(r.sim.tower.towerName).toBe("Repaired");
    // The hour after that is a delta on top of the full save.
    r.sim.tick(60);
    r.gate().flush();
    await r.settleTasks();
    expect(last(frames(r.toHost))!.delta).toMatchObject({ base: 1, sync: 2 });
    r.host.detach();
  });

  it("refuses a delta taken against another save and asks for a full one", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(1);
    r.gate().flush();
    const req = (last(r.toWorker) as Extract<ToWorker, { type: "ops" }>).request!.req;
    // Answer the request in place of the worker, with a delta on a base the
    // read model never applied.
    const view = r.engine().frameView();
    view[0] = r.sim.clock.minutes;
    const rest = { ...JSON.parse(r.engine().serialize()), minutes: r.sim.clock.minutes };
    delete rest.units;
    view[4] = 777; // the header's money: not written by a refused reply
    const money = r.sim.money;
    const minutes = r.sim.clock.minutes;
    const owed = { name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } };
    r.host.receive({ type: "frame", gen: 1, req, seq: 1, view, events: JSON.stringify([owed]), dropped: 0, log: null, pending: null, merge: null, delta: { delta: JSON.stringify({ units: [], rest }), telemetry: '{"util":[],"hourly":[],"origins":[]}', housekeeping: null, base: 7, sync: 8 }, workMs: { ops: 0, reply: 0, save: 0 }, memoryBytes: null });
    expect(r.fatal).toEqual([]);
    expect(r.host.stats).toMatchObject({ deltas: 0, deltasRefused: 1 });
    // Held like a stale reply: nothing of it is written, and the full save
    // is asked for at once, not at the next frame.
    expect(r.sim.money).toBe(money);
    expect(r.sim.clock.minutes).toBe(minutes);
    expect((last(r.toWorker) as Extract<ToWorker, { type: "ops" }>).request?.merge).toBe(true);
    // The refused reply's events are kept, and surface once the full save lands.
    expect(r.sim.drainGameplayEvents()).not.toContainEqual(owed);
    await r.settleTasks();
    expect(r.host.stats.merges).toBe(1);
    expect(r.sim.drainGameplayEvents()).toEqual([owed]);
    r.host.detach();
  });

  it("asks for a full save after a stale reply that carried a delta", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(60);
    r.gate().flush();
    r.sim.money = 5; // after the request: the reply cannot include it
    await r.settleTasks();
    expect(r.host.stats.staleReplies).toBe(1);
    expect(frames(r.toHost).some((f) => f.delta)).toBe(true);
    expect(r.host.stats.deltas).toBe(0);
    const asked = r.toWorker.filter((m): m is Extract<ToWorker, { type: "ops" }> => m.type === "ops" && !!m.request?.merge);
    expect(asked.length).toBe(1);
    expect(r.host.stats.merges).toBe(1);
    r.host.detach();
  });

  it("is fatal on a delta that is not the engine's shape, with the read model untouched", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(1);
    r.gate().flush();
    const req = (last(r.toWorker) as Extract<ToWorker, { type: "ops" }>).request!.req;
    const saveOf = () => JSON.stringify(Simulation.prototype.serialize.call(r.sim));
    const before = saveOf();
    const view = r.engine().frameView();
    view[0] = r.sim.clock.minutes;
    r.host.receive({ type: "frame", gen: 1, req, seq: 1, view, events: "[]", dropped: 0, log: null, pending: null, merge: null, delta: { delta: JSON.stringify({ units: "no", rest: {} }), telemetry: "{}", housekeeping: null, base: 0, sync: 1 }, workMs: { ops: 0, reply: 0, save: 0 }, memoryBytes: null });
    expect(r.fatal.length).toBe(1);
    expect(saveOf(), "the read model as the last reply left it").toBe(before);
    r.host.detach();
  });

  it("is fatal on a sync number that is not an integer", async () => {
    const r = rig();
    await r.settleTasks();
    r.sim.tick(1);
    r.gate().flush();
    const req = (last(r.toWorker) as Extract<ToWorker, { type: "ops" }>).request!.req;
    const view = r.engine().frameView();
    view[0] = r.sim.clock.minutes;
    const delta = JSON.stringify({ units: [], rest: JSON.parse(r.engine().serialize()) as unknown });
    r.host.receive({ type: "frame", gen: 1, req, seq: 1, view, events: "[]", dropped: 0, log: null, pending: null, merge: null, delta: { delta, telemetry: "{}", housekeeping: null, base: 0, sync: Number.NaN }, workMs: { ops: 0, reply: 0, save: 0 }, memoryBytes: null });
    expect(r.fatal).toEqual([expect.stringMatching(/bad sequence number NaN/)]);
    r.host.detach();
  });

  it("reads a delta that names a unit or transports the read model does not hold as not fitting", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.money = 1e9;
    expect(sim.tower.place("lobby", 1, 100).ok).toBe(true);
    const save = sim.serialize() as unknown as Record<string, unknown>;
    const { units, ...rest } = save as { units: { id: number; kind: string; x: number; floor: number }[] };
    const payload = (u: unknown[], r: Record<string, unknown>) => ({ delta: JSON.stringify({ units: u, rest: r }), telemetry: '{"util":[],"hourly":[],"origins":[]}', housekeeping: null, base: 0, sync: 1 });
    expect(parseDelta(sim, payload([units[0]], rest))?.records.units.length).toBe(1);
    expect(parseDelta(sim, payload([{ ...units[0], id: 99_999 }], rest))).toBeNull();
    expect(parseDelta(sim, payload([{ ...units[0], kind: "office" }], rest))).toBeNull();
    expect(parseDelta(sim, payload([{ ...units[0], kind: "spaceport" }], rest)), "a kind this build does not know").toBeNull();
    expect(parseDelta(sim, payload([{ ...units[0], x: units[0].x + 5 }], rest)), "a unit moved in place").toBeNull();
    expect(parseDelta(sim, payload([{ ...units[0], floor: units[0].floor + 1 }], rest)), "a unit on another floor").toBeNull();
    expect(parseDelta(sim, payload([], { ...rest, transports: [{ id: 5, kind: "stairs" }] }))).toBeNull();
    expect(() => parseDelta(sim, payload([], { ...rest, units: [] }))).toThrow(/remainder/);
    expect(() => parseDelta(sim, payload([{ id: "x" }], rest))).toThrow(/record/);
  });
});

describe("mergeSimulationDelta", () => {
  it("checks every unit it names before the first write", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.money = 1e9;
    expect(sim.tower.place("lobby", 1, 100).ok).toBe(true);
    const rest = Simulation.newGame(7, "classic");
    rest.money = 12345;
    const held = sim.tower.units[0];
    const records = { rest, units: [{ ...held }, { ...held, id: 99_999 }], transports: [] };
    const before = JSON.stringify(Simulation.prototype.serialize.call(sim));
    expect(() => mergeSimulationDelta(sim, records, { revision: 5, mealOverlayRevision: 0 })).toThrow(/unit 99999/);
    expect(JSON.stringify(Simulation.prototype.serialize.call(sim)), "nothing written").toBe(before);
    expect(sim.money).toBe(1e9);
  });
});

describe("sameJson", () => {
  it("ignores key order and compares nested lists and objects", () => {
    expect(sameJson({ a: 1, b: { c: [1, { d: 2 }] } }, { b: { c: [1, { d: 2 }] }, a: 1 })).toBe(true);
    expect(sameJson([], [])).toBe(true);
    expect(sameJson(null, null)).toBe(true);
  });

  it("tells a different value, key set, list length, order or kind apart", () => {
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameJson({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameJson([1, 2], [1, 2, 3])).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson([{ a: 1 }], [{ a: 2 }])).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson({}, [])).toBe(false);
    expect(sameJson({ a: null }, { a: {} })).toBe(false);
    expect(sameJson(1, "1")).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});
