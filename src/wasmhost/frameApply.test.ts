import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { roomUnits } from "../engine/tower/rooms";
import { walkedStats } from "../tests/fixtures/walkedStats";
import { FRAME_HEADER, PERSON_FIXED, UNIT_STATES, decodeFrame, decodeHeader } from "./frameView";
import { appendEngineLog, applyRecords } from "./frameApply";
import { syncCars, syncPeople, syncUnits } from "./frameSync";

/** A seeded generator, so a failure names a case that replays. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A tower with a few units and a shaft to hang counters and cars on. */
function tower(): Simulation {
  const sim = Simulation.newGame(5, "classic");
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) sim.build("lobby", 1, x);
  for (let x = 170; x < 200; x++) sim.build("floor", 2, x);
  sim.build("office", 2, 180);
  sim.build("office", 2, 190);
  sim.buildTransport("elevatorStandard", 172, 1, 2);
  return sim;
}

/** A random frame in the engine's layout over people ids from `pool`, with a
 *  unit record for each of `unitIds` and one for a unit the tower lacks. */
function randomFrame(r: () => number, sim: Simulation, pool: number[], unitIds = sim.tower.units.slice(0, 3).map((u) => u.id)): number[] {
  const ids = pool.filter(() => r() < 0.7);
  if (r() < 0.3) ids.reverse();
  const people = ids.flatMap((id) => {
    const floors = Array.from({ length: Math.floor(r() * 3) }, () => Math.floor(r() * 3));
    const shafts = Array.from({ length: Math.floor(r() * 2) }, () => Math.floor(r() * 5));
    const opt = () => (r() < 0.5 ? -1 : Math.floor(r() * 40));
    return [
      id, Math.floor(r() * 1000), r() < 0.2 ? 1 : 0, Math.floor(r() * 7), Math.floor(r() * 3), r() * 300, r() * 3, Math.floor(r() * 9), 1,
      opt(), opt(), opt(), r() < 0.2 ? 1 : 0, Math.floor(r() * 3), r() < 0.3 ? 1 : 0, r() < 0.5 ? Number.NaN : r() * 60 - 10,
      floors.length, shafts.length, ...floors, ...shafts,
    ];
  });
  const units = [...unitIds, 99_999].flatMap((id) => [id, Math.floor(r() * 10), Math.floor(r() * 6), r() < 0.5 ? -1 : 2, -1, r() < 0.5 ? -1 : 1]);
  const transports = [...sim.tower.transports.map((t) => t.id), 88_888].flatMap((id) => {
    const cars = 1 + Math.floor(r() * 3);
    return [id, cars, ...Array.from({ length: cars }, () => [r() * 2, r() < 0.5 ? -1 : Math.floor(r() * 5), r() < 0.5 ? -1 : 1]).flat()];
  });
  const header = new Array<number>(FRAME_HEADER).fill(0);
  header[23] = ids.length;
  header[24] = unitIds.length + 1;
  header[25] = sim.tower.transports.length + 1;
  return [...header, ...people, ...units, ...transports];
}

const snapshot = (sim: Simulation) => JSON.stringify({ people: sim.crowd.people.map((p) => ({ ...p, has: Object.keys(p).sort() })), units: sim.tower.units, cars: sim.tower.transports });

describe("applyRecords", () => {
  it("leaves the read model as the decode-then-apply path does, frame after frame", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed);
      const a = tower();
      const b = tower();
      const pool = Array.from({ length: 12 }, (_, i) => 100 + i);
      for (let f = 0; f < 30; f++) {
        const v = Float64Array.from(randomFrame(r, a, pool));
        const frame = decodeFrame(v);
        syncPeople(a, frame);
        syncUnits(a, frame);
        syncCars(a, frame);
        applyRecords(b, v, decodeHeader(v));
        expect(snapshot(b), `seed ${seed} frame ${f}`).toBe(snapshot(a));
      }
    }
  });

  it("keeps array identity and skips unchanged routes", () => {
    const sim = tower();
    const v = Float64Array.from(randomFrame(rng(9), sim, [1, 2, 3]));
    applyRecords(sim, v, decodeHeader(v));
    const people = sim.crowd.people;
    const routes = people.map((p) => p.floors);
    applyRecords(sim, v, decodeHeader(v));
    expect(sim.crowd.people).toBe(people);
    sim.crowd.people.forEach((p, i) => expect(p.floors).toBe(routes[i]));
  });

  it("refuses a malformed frame before writing anything", () => {
    const sim = tower();
    const v = randomFrame(rng(3), sim, [1, 2, 3, 4]);
    v[23] = Math.max(1, v[23]);
    const before = snapshot(sim);
    const bad = [...v];
    bad[FRAME_HEADER + 3] = 42; // an unknown person state
    expect(() => applyRecords(sim, bad, decodeHeader(bad))).toThrow(/unknown person state code 42/);
    expect(() => applyRecords(sim, [...v, 1], decodeHeader(v))).toThrow(/left after the last record/);
    const short = v.slice(0, FRAME_HEADER + PERSON_FIXED - 1);
    expect(() => applyRecords(sim, short, decodeHeader(short))).toThrow(/needs/);
    const route = [...v];
    route[FRAME_HEADER + 16] = -1;
    expect(() => applyRecords(sim, route, decodeHeader(route))).toThrow(/bad floors count/);
    const routine = [...v];
    routine[FRAME_HEADER + 13] = 9;
    expect(() => applyRecords(sim, routine, decodeHeader(routine))).toThrow(/unknown routine code 9/);
    expect(snapshot(sim)).toBe(before);
  });

  it("refuses bad unit and car records", () => {
    const sim = Simulation.newGame(1, "classic");
    const header = new Array<number>(FRAME_HEADER).fill(0);
    const unit = [...header];
    unit[24] = 1;
    expect(() => applyRecords(sim, [...unit, 1, 77, 0, 0, 0, 0], decodeHeader(unit))).toThrow(/unknown unit state code 77/);
    const car = [...header];
    car[25] = 1;
    expect(() => applyRecords(sim, [...car, 1, -2], decodeHeader(car))).toThrow(/bad transport 1 cars count -2/);
  });
});

describe("appendEngineLog", () => {
  it("replaces the instance's own lines with the engine's, in the engine's order", () => {
    const sim = Simulation.newGame(2, "classic");
    sim.log.length = 0;
    sim.logSeq = 10;
    sim.log.push({ minute: 1, text: "old", kind: "info" }, { minute: 2, text: "mine", kind: "info" });
    sim.logSeq = 11;
    appendEngineLog(sim, [{ minute: 2, text: "tick line", kind: "info" }, { minute: 2, text: "mine", kind: "info" }], 1);
    expect(sim.log.map((e) => e.text)).toEqual(["old", "tick line", "mine"]);
    expect(sim.logSeq).toBe(12);
    // An engine that logged less than the instance never moves the cursor back.
    appendEngineLog(sim, [], 2);
    expect(sim.logSeq).toBe(12);
    expect(sim.log.map((e) => e.text)).toEqual(["old"]);
  });
});

describe("the HUD's room counts over frames", () => {
  /** Rooms of every condition the counts track, beside floor tiles. */
  function rooms(): Simulation {
    const sim = Simulation.newGame(5, "classic");
    const t = sim.tower;
    for (let x = 150; x < 200; x++) t.place("lobby", 1, x);
    for (const floor of [2, 3]) for (let x = 150; x < 200; x++) t.place("floor", floor, x);
    const placed: [Parameters<typeof t.place>[0], number, number][] = [["office", 2, 150], ["fastFood", 2, 160], ["hotelSingle", 3, 150], ["condo", 3, 160]];
    for (const [kind, floor, x] of placed) expect(t.place(kind, floor, x).ok, kind).toBe(true);
    return sim;
  }

  it("follow the rooms each frame rewrites, on the decode path and the direct apply", () => {
    const moved = { population: 0, occupiedOffices: 0, occupiedHotel: 0, dirty: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed);
      const a = rooms();
      const b = rooms();
      // Records out of the mirror's order (the rooms, then a tile), in it
      // (every unit, as the engine sends them), and in it but for one pair.
      const inOrder = a.tower.units.map((u) => u.id);
      const swapped = [...inOrder];
      const [i, j] = roomUnits(a.tower).slice(0, 2).map((u) => a.tower.units.indexOf(u));
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      const ids = [[...roomUnits(a.tower).map((u) => u.id), a.tower.units[0].id], inOrder, swapped][seed % 3];
      let last = a.stats(); // the counts are kept from this read on
      b.stats();
      for (let f = 0; f < 30; f++) {
        const v = Float64Array.from(randomFrame(r, a, [], ids));
        const frame = decodeFrame(v);
        syncUnits(a, frame);
        applyRecords(b, v, decodeHeader(v));
        for (const sim of [a, b]) {
          for (const rec of frame.units) expect(sim.tower.getUnit(rec.id)?.state ?? rec.state, `seed ${seed} frame ${f} unit ${rec.id}`).toBe(rec.state);
        }
        const hud = a.stats();
        expect(hud, `seed ${seed} frame ${f}`).toMatchObject(walkedStats(a));
        expect(b.stats(), `seed ${seed} frame ${f}`).toEqual(hud);
        for (const k of Object.keys(moved) as (keyof typeof moved)[]) if (hud[k] !== last[k]) moved[k]++;
        last = hud;
      }
    }
    for (const [k, n] of Object.entries(moved)) expect(n, k).toBeGreaterThan(0);
  });

  it("read a NaN customer count as none, so the next frame's count lands", () => {
    const a = rooms();
    const b = rooms();
    const venue = a.tower.units.find((u) => u.kind === "fastFood")!;
    a.stats();
    b.stats();
    for (const customers of [Number.NaN, 4]) {
      const v = Float64Array.from(randomFrame(rng(1), a, [], [venue.id]));
      v.set([venue.id, UNIT_STATES.indexOf("occupied"), 0, customers], FRAME_HEADER);
      syncUnits(a, decodeFrame(v));
      applyRecords(b, v, decodeHeader(v));
      for (const sim of [a, b]) expect(sim.stats(), `customers ${customers}`).toMatchObject(walkedStats(sim));
    }
    expect(a.stats().population).toBe(4);
  });
});
