import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { MID, newSeededGame } from "../tests/fixtures/towerFixtures";
import { parityRestarts } from "../tests/parity/typescriptOnly";
import { setStepGate } from "../wasmhost/stepGate";
import { describePortContract } from "./contract.fixture";
import { createTsSim } from "./tsSim";

// In the `unitWasm` parity project every Simulation is hosted on the Rust
// engine through the mirror, so this file checks TsSim on both of today's
// hosts; `parityRestarts` makes a divergence there fail the contract.
describePortContract(
  "TsSim",
  () => {
    const sim = newSeededGame(7, "modern");
    return createTsSim(() => sim);
  },
  { restarts: parityRestarts },
);

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
      mode: sim.mode,
      modernCalendar: sim.modernCalendar,
    });
  });

  it("walks the rooms for population only when it is read, once per header", () => {
    const sim = newSeededGame(7, "modern");
    let walks = 0;
    Object.defineProperty(sim, "population", { configurable: true, get: () => ++walks });
    const port = createTsSim(() => sim);
    const header = port.view.header;
    expect([header.money, header.revision, port.view.header.minutes]).toEqual([sim.money, sim.tower.revision, sim.clock.minutes]);
    expect(walks).toBe(0);
    expect([header.population, header.population]).toEqual([1, 1]);
    expect(walks).toBe(1);
  });

  it("follows a tower swap without being rebuilt, and drops the old tower's answers", async () => {
    let sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    const first = port.view.tower;
    const office = { op: "isUnlocked", kind: "office" } as const;
    expect(await port.query(office)).toBe(true);
    sim = Simulation.newGame(9, "classic");
    expect(port.view.tower).toBe(sim.tower);
    expect(port.view.tower).not.toBe(first);
    expect(port.cached(office)).toBeUndefined();
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
    expect(await port.command({ op: "setAutoBridge", value: false })).toEqual({ ok: true, delta: 0, value: false });
    expect(sim.autoBridge).toBe(false);
    expect(await port.command({ op: "toggleAutoBridge" })).toEqual({ ok: true, delta: 0, value: true });
  });

  it("keeps a Classic tower bridging, refusing a change", async () => {
    const sim = Simulation.newGame(9, "classic");
    const port = createTsSim(() => sim);
    expect(sim.autoBridge).toBe(true);
    expect(await port.command({ op: "setAutoBridge", value: false })).toEqual({ ok: false, delta: 0, value: true });
    expect(await port.command({ op: "toggleAutoBridge" })).toEqual({ ok: false, delta: 0, value: true });
    expect(await port.command({ op: "setAutoBridge", value: true })).toEqual({ ok: true, delta: 0, value: true });
    expect(sim.autoBridge).toBe(true);
  });

  it("answers an emergency only while one is waiting, and reports what it paid", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    expect(await port.command({ op: "resolveChoice", accept: true })).toEqual({ ok: false, delta: 0 });
    sim.events.pending = { kind: "fireRescue", cost: 40_000, message: "fire" };
    expect(await port.command({ op: "resolveChoice", accept: true })).toEqual({ ok: true, delta: -40_000 });
    expect(sim.pendingChoice).toBeNull();
    expect(await port.command({ op: "resolveChoice", accept: true })).toEqual({ ok: false, delta: 0 });
  });

  it("books the exterminator, with its price, the rooms and the charge", async () => {
    const sim = newSeededGame(7, "modern");
    for (let x = MID - 6; x < MID + 6; x++) sim.tower.place("floor", 2, x);
    expect(sim.tower.place("hotelSingle", 2, MID - 4).ok).toBe(true);
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle");
    if (!room) throw new Error("no room");
    room.state = "infested";
    sim.money = 1e8;
    const port = createTsSim(() => sim);
    const booked = await port.command({ op: "callExterminator" });
    expect(booked).toMatchObject({ ok: true, rooms: 1 });
    expect(booked.cost).toBeGreaterThan(0);
    expect(booked.delta).toBe(-(booked.cost ?? 0));
    expect(sim.money).toBe(1e8 - (booked.cost ?? 0));
  });

  it("converts each return value without dropping a field", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    expect(await port.command({ op: "build", kind: "office", floor: 2, x: MID - 4 })).toMatchObject({ ok: true });
    const id = sim.tower.units.find((u) => u.kind === "office")?.id ?? -1;
    expect(await port.command({ op: "priceUnit", id: -1, target: 5000 })).toEqual({ ok: false, delta: 0 });
    const priced = await port.command({ op: "priceUnit", id, target: 12000 });
    expect(priced).toEqual({ ok: true, delta: 0, rent: sim.tower.getUnit(id)?.rent });
    expect(await port.command({ op: "adjustRent", id: -1, dir: 1 })).toEqual({ ok: false, delta: 0 });
    expect(await port.command({ op: "rerollSubtype", id })).toEqual({ ok: false, delta: 0 });
    expect(await port.command({ op: "setFilmPolicy", id, policy: "feature" })).toEqual({ ok: false, delta: 0 });
    const batch = await port.command({ op: "applyRentBatch", kind: "office", target: "default", onlyDefaultPriced: true });
    expect(batch.ok).toBe(true);
    expect(batch.batch).toMatchObject({ matched: 1 });
    expect(await port.command({ op: "applyRentBatch", kind: "lobby", target: "default" })).toEqual({ ok: false, delta: 0 });
    // A Modern office's rent is a band, with no "no rate" step.
    expect(await port.command({ op: "setNoRate", id })).toEqual({ ok: false, delta: 0 });
  });

  it("converts a reroll and a film policy on the rooms that take them", async () => {
    const sim = newSeededGame(7, "modern");
    for (const floor of [2, 3, 4]) for (let x = MID - 16; x < MID + 16; x++) sim.tower.place("floor", floor, x);
    expect([sim.tower.place("cinema", 3, MID - 15).ok, sim.tower.place("shop", 2, MID - 15).ok]).toEqual([true, true]);
    const shopId = sim.tower.units.find((u) => u.kind === "shop")?.id ?? -1;
    const cinemaId = sim.tower.units.find((u) => u.kind === "cinema")?.id ?? -1;
    const port = createTsSim(() => sim);
    const reroll = await port.command({ op: "rerollSubtype", id: shopId });
    expect(reroll).toEqual({ ok: true, delta: 0, subtype: sim.tower.getUnit(shopId)?.subtype });
    expect(typeof reroll.subtype).toBe("string");
    expect(await port.command({ op: "setFilmPolicy", id: cinemaId, policy: "blockbuster" })).toEqual({ ok: true, delta: 0, policy: "blockbuster" });
    expect(await port.command({ op: "setFilmPolicy", id: shopId, policy: "feature" })).toEqual({ ok: false, delta: 0 });
  });

  it("takes a Classic office off the market", async () => {
    const sim = Simulation.newGame(9, "classic");
    for (let x = MID - 6; x < MID + 6; x++) sim.tower.place("lobby", 1, x);
    for (let x = MID - 6; x < MID + 6; x++) sim.tower.place("floor", 2, x);
    expect(sim.tower.place("office", 2, MID - 4).ok).toBe(true);
    const id = sim.tower.units.find((u) => u.kind === "office")?.id ?? -1;
    const port = createTsSim(() => sim);
    expect(await port.command({ op: "setNoRate", id })).toEqual({ ok: true, delta: 0 });
    expect(sim.tower.getUnit(id)?.noRate).toBe(true);
    expect(await port.command({ op: "setNoRate", id: -1 })).toEqual({ ok: false, delta: 0 });
  });

  it("passes the batch option through only when the caller gave one", async () => {
    const sim = newSeededGame(7, "modern");
    const seen: unknown[][] = [];
    const original = sim.applyRentBatch.bind(sim);
    Object.defineProperty(sim, "applyRentBatch", { configurable: true, value: (...args: Parameters<Simulation["applyRentBatch"]>) => { seen.push(args); return original(...args); } });
    const port = createTsSim(() => sim);
    await port.command({ op: "applyRentBatch", kind: "office", target: "default" });
    await port.command({ op: "applyRentBatch", kind: "office", target: "default", onlyDefaultPriced: false });
    expect(seen).toEqual([["office", "default"], ["office", "default", { onlyDefaultPriced: false }]]);
  });

  it("hands the drain the release flag only when asked", () => {
    const sim = newSeededGame(7, "modern");
    const seen: unknown[][] = [];
    Object.defineProperty(sim, "drainGameplayEvents", { configurable: true, value: (...args: unknown[]) => { seen.push(args); return []; } });
    const port = createTsSim(() => sim);
    port.drainEvents();
    port.drainEvents({ release: false });
    port.drainEvents({ release: true });
    expect(seen).toEqual([[], [], [{ release: true }]]);
  });

  it("waits for a host that steps in the background before saving, and saves the tower held then", async () => {
    let sim = newSeededGame(7, "modern");
    const first = sim;
    let caughtUp!: () => void;
    const settled = new Promise<void>((resolve) => (caughtUp = resolve));
    setStepGate(first, { canStep: () => true, flush: () => undefined, settle: () => settled });
    try {
      const port = createTsSim(() => sim);
      const pending = port.save();
      sim = newSeededGame(9, "modern");
      sim.money = 123_456;
      caughtUp();
      expect(JSON.parse(await pending)).toMatchObject({ money: 123_456 });
    } finally {
      setStepGate(first, null);
    }
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

  it("keeps a bounded number of placement answers, dropping the least recently used, and every unlock answer", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    const cell = (x: number) => ({ op: "canBuild", kind: "floor", floor: 2, x }) as const;
    await port.query({ op: "isUnlocked", kind: "office" });
    for (let x = 0; x < 300; x++) await port.query(cell(x));
    expect(port.cached(cell(0))).toBeUndefined();
    expect(port.cached(cell(299))).toBeDefined();
    expect(port.cached({ op: "isUnlocked", kind: "office" })).toBe(true);
    // Asking again, or reading the cache, moves an answer to the newest end.
    await port.query(cell(44));
    expect(port.cached(cell(45))).toBeDefined();
    for (let x = 300; x < 500; x++) await port.query(cell(x));
    expect(port.cached(cell(44))).toBeDefined();
    expect(port.cached(cell(45))).toBeDefined();
    expect(port.cached(cell(46))).toBeUndefined();
  });
});
