import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { MID, newSeededGame } from "../tests/fixtures/towerFixtures";
import { describePortContract } from "./contract.fixture";
import { createTsSim } from "./tsSim";

// In the `unitWasm` parity project every Simulation is hosted on the Rust
// engine through the mirror, so this file checks TsSim on both of today's
// hosts.
describePortContract("TsSim", () => {
  const sim = newSeededGame(7, "modern");
  return createTsSim(() => sim);
});

describe("TsSim over the live instance", () => {
  it("hands out the live tower and crowd, and reads the header from the instance", () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    expect(port.view.tower).toBe(sim.tower);
    expect(port.view.crowd).toBe(sim.crowd);
    expect(port.view.header).toEqual({
      money: sim.money,
      star: sim.star,
      population: sim.population,
      weather: sim.weather,
      logSeq: sim.logSeq,
      pendingChoice: sim.pendingChoice,
      minutes: sim.clock.minutes,
      minuteOfDay: sim.clock.minuteOfDay,
      revision: sim.tower.revision,
      mealOverlayRevision: sim.tower.mealOverlayRevision,
    });
  });

  it("follows a tower swap without being rebuilt", () => {
    let sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    const first = port.view.tower;
    sim = Simulation.newGame(9, "classic");
    expect(port.view.tower).toBe(sim.tower);
    expect(port.view.tower).not.toBe(first);
  });

  it("runs each command through the instance's own method, so the relay sees it", async () => {
    const sim = newSeededGame(7, "modern");
    // One tick first, so the parity project's host attaches (and wraps the
    // instance's methods) before the spies go on; attaching inside the first
    // `callExterminator` would re-dispatch it through the spy.
    sim.tick(1);
    const calls: string[] = [];
    const spy = <T extends object>(obj: T, name: keyof T & string) => {
      const original = obj[name] as unknown as (...args: unknown[]) => unknown;
      Object.defineProperty(obj, name, { configurable: true, writable: true, value: (...args: unknown[]) => { calls.push(name); return original.apply(obj, args); } });
    };
    for (const name of ["build", "callExterminator", "emit", "resolveChoice", "toggleAutoBridge", "applyRentBatch"] as const) spy(sim, name);
    for (const name of ["setLabel", "setStop", "clearStops"] as const) spy(sim.tower, name);
    const port = createTsSim(() => sim);
    await port.command({ op: "build", kind: "office", floor: 2, x: MID - 4 });
    const office = sim.tower.units.find((u) => u.kind === "office");
    await port.command({ op: "setLabel", id: office?.id ?? -1, label: "Spied" });
    await port.command({ op: "setStop", id: -1, floor: 2, stop: true });
    await port.command({ op: "clearStops", id: -1 });
    await port.command({ op: "callExterminator" });
    await port.command({ op: "emit", text: "hello" });
    await port.command({ op: "resolveChoice", accept: false });
    await port.command({ op: "toggleAutoBridge" });
    await port.command({ op: "applyRentBatch", kind: "office", target: "default" });
    expect(calls).toEqual(["build", "setLabel", "setStop", "clearStops", "callExterminator", "emit", "resolveChoice", "toggleAutoBridge", "applyRentBatch"]);
    expect(sim.log[sim.log.length - 1]).toMatchObject({ text: "hello", kind: "info" });
  });

  it("writes the watched fields the way the host does", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    await port.command({ op: "setTowerName", name: "Port Tower" });
    expect(sim.tower.towerName).toBe("Port Tower");
    await port.command({ op: "setView", view: { tile: 12, floor: 3, zoom: 1.5 } });
    expect(sim.view).toEqual({ tile: 12, floor: 3, zoom: 1.5 });
    expect(await port.command({ op: "setAutoBridge", value: false })).toEqual({ ok: true, value: false });
    expect(sim.autoBridge).toBe(false);
  });

  it("converts each return value without dropping a field", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    expect(await port.command({ op: "build", kind: "office", floor: 2, x: MID - 4 })).toMatchObject({ ok: true });
    const id = sim.tower.units.find((u) => u.kind === "office")?.id ?? -1;
    expect(await port.command({ op: "priceUnit", id: -1, target: 5000 })).toEqual({ ok: false });
    const priced = await port.command({ op: "priceUnit", id, target: 12000 });
    expect(priced).toEqual({ ok: true, rent: sim.tower.getUnit(id)?.rent });
    expect(await port.command({ op: "adjustRent", id: -1, dir: 1 })).toEqual({ ok: false });
    expect(await port.command({ op: "setNoRate", id })).toEqual({ ok: sim.tower.getUnit(id)?.noRate === true });
    expect(await port.command({ op: "rerollSubtype", id })).toEqual({ ok: false });
    expect(await port.command({ op: "setFilmPolicy", id, policy: "feature" })).toEqual({ ok: false });
    const batch = await port.command({ op: "applyRentBatch", kind: "office", target: "default", onlyDefaultPriced: true });
    expect(batch.ok).toBe(true);
    expect(batch.batch).toMatchObject({ matched: 1 });
    expect(await port.command({ op: "applyRentBatch", kind: "lobby", target: "default" })).toEqual({ ok: false });
  });

  it("rejects with the instance's own error", async () => {
    const sim = newSeededGame(7, "modern");
    const boom = new Error("boom");
    Object.defineProperty(sim, "build", { configurable: true, value: () => { throw boom; } });
    const port = createTsSim(() => sim);
    await expect(port.command({ op: "build", kind: "office", floor: 2, x: MID })).rejects.toBe(boom);
    Object.defineProperty(sim, "canBuild", { configurable: true, value: () => { throw boom; } });
    await expect(port.query({ op: "canBuild", kind: "office", floor: 2, x: MID })).rejects.toBe(boom);
    Object.defineProperty(sim, "serialize", { configurable: true, value: () => { throw boom; } });
    await expect(port.save()).rejects.toBe(boom);
  });

  it("answers queries as the instance does, and saves what the instance serializes", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    for (const x of [MID - 4, MID + 30, 0]) expect(await port.query({ op: "canBuild", kind: "office", floor: 2, x })).toEqual(sim.canBuild("office", 2, x));
    expect(await port.query({ op: "isUnlocked", kind: "hotelSingle" })).toBe(sim.isUnlocked("hotelSingle"));
    expect(await port.save()).toBe(JSON.stringify(sim.serialize()));
  });

  it("keeps a bounded number of cached answers, dropping the oldest", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    for (let x = 0; x < 300; x++) await port.query({ op: "canBuild", kind: "floor", floor: 2, x });
    expect(port.cached({ op: "canBuild", kind: "floor", floor: 2, x: 0 })).toBeUndefined();
    expect(port.cached({ op: "canBuild", kind: "floor", floor: 2, x: 299 })).toBeDefined();
    // Asking again moves an answer to the newest end.
    await port.query({ op: "canBuild", kind: "floor", floor: 2, x: 44 });
    for (let x = 300; x < 400; x++) await port.query({ op: "canBuild", kind: "floor", floor: 2, x });
    expect(port.cached({ op: "canBuild", kind: "floor", floor: 2, x: 44 })).toBeDefined();
  });
});
