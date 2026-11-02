import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation } from "../engine/Simulation";
import { towerCatalog } from "../engine/towerCatalog";
import { isElevatorKind } from "../engine/facilityPredicates";
import { SCHEDULE_HOURS } from "../engine/elevatorSchedule";
import { TsEngine } from "../engine/port/tsEngine";
import { decodeVctower } from "../storage/vctowerContainer";
import type { SerializedGame } from "../engine/types";
import { scheduleFromSlots } from "../simport/scheduleSlots";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";
import {
  acknowledgementKey,
  browserAcknowledgements,
  isElevator,
  recoveredSchedule,
  shortFleets,
  type ShaftFacts,
} from "./scheduleRecovery";

const load = (name: string) => decodeVctower(readFileSync(`conformance/fixtures/${name}.vctower`, "utf8")) as SerializedGame;

function reviewOf(raw: SerializedGame) {
  const sim = Simulation.deserialize(raw);
  const port = new TsEngine(sim);
  const shafts = sim.tower.transports.map((t) => ({
    id: t.id,
    kind: t.kind,
    x: t.x,
    bottom: t.bottom,
    top: t.top,
    cars: t.cars,
  }));
  return {
    sim,
    shafts,
    found: shortFleets(shafts, (id) => scheduleFromSlots(port.shaftSchedule(id))),
  };
}

const shaft = (cars: number, over: Partial<ShaftFacts> = {}): ShaftFacts => ({
  id: 7,
  kind: "elevatorStandard",
  x: 10,
  bottom: 1,
  top: 9,
  cars,
  ...over,
});
const flat = (n: number) => Array<number>(24).fill(n);
const only = (s: ShaftFacts, activeCars: ElevatorSchedule["activeCars"]) => shortFleets([s], () => ({ activeCars }))[0];

describe("shortFleets on the repository fixtures (#1548)", () => {
  it("flags the underscheduled shafts of split-tower and nothing else", () => {
    const { found } = reviewOf(load("split-tower"));
    expect(found.map((f) => [f.shaft.id, f.shaft.cars, f.flatAt])).toEqual([[1139, 5, 3]]);
  });

  it("flags exactly the three flat shafts of split-tower-4, and leaves its full-fleet shafts alone", () => {
    const { found, shafts } = reviewOf(load("split-tower-4"));
    expect(found.map((f) => [f.shaft.id, f.shaft.cars, f.flatAt])).toEqual([
      [1139, 8, 3],
      [1735, 8, 3],
      [9281, 8, 2],
    ]);
    expect(shafts.length).toBeGreaterThan(found.length); // 4325, 5675 and the express shafts run 8 of 8
  });

  it("says nothing about the fixtures that carry no authored schedule", () => {
    for (const name of ["sixseven_2", "sixseven-december", "towerone_6"]) expect(reviewOf(load(name)).found, name).toEqual([]);
  });

  it("never edits the fixture bytes", () => {
    const before = readFileSync("conformance/fixtures/split-tower-4.vctower");
    reviewOf(load("split-tower-4"));
    expect(readFileSync("conformance/fixtures/split-tower-4.vctower").equals(before)).toBe(true);
  });
});

describe("shortFleets keeps detection conservative", () => {
  it("offers the one-click recovery only to a flat, nonzero, short schedule on both day types", () => {
    expect(only(shaft(8), { weekday: flat(3), weekend: flat(3) })?.flatAt).toBe(3);
    // Different counts per day type, a staggered day, an off-duty hour or a missing day are all deliberate shapes.
    expect(only(shaft(8), { weekday: flat(3), weekend: flat(4) })?.flatAt).toBeNull();
    expect(
      only(shaft(8), {
        weekday: flat(3).map((n, h) => (h < 6 ? 1 : n)),
        weekend: flat(3),
      })?.flatAt,
    ).toBeNull();
    expect(
      only(shaft(8), {
        weekday: flat(3).map((n, h) => (h < 6 ? 0 : n)),
        weekend: flat(3),
      })?.flatAt,
    ).toBeNull();
    expect(only(shaft(8), { weekday: flat(3) })?.flatAt).toBeNull();
    expect(only(shaft(8), { weekday: flat(0), weekend: flat(0) })?.flatAt).toBeNull();
  });

  it("still lists a staggered or half-scheduled shaft for manual review", () => {
    const staggered = only(shaft(4), {
      weekday: flat(4).map((n, h) => (h < 8 ? 1 : n)),
      weekend: flat(4),
    });
    expect([staggered?.least, staggered?.most, staggered?.flatAt]).toEqual([1, 4, null]);
    const oneDay = only(shaft(4), { weekday: flat(2) });
    expect([oneDay?.least, oneDay?.most]).toEqual([2, 4]);
  });

  it("skips full fleets, unscheduled shafts and stairs", () => {
    expect(only(shaft(4), { weekday: flat(4), weekend: flat(4) })).toBeUndefined();
    expect(only(shaft(4), {})).toBeUndefined();
    expect(
      shortFleets([shaft(4, { kind: "stairs" })], () => ({
        activeCars: { weekday: flat(1), weekend: flat(1) },
      })),
    ).toEqual([]);
    expect(shortFleets([shaft(4)], () => undefined)).toEqual([]);
  });
});

describe("recoveredSchedule", () => {
  it("fills the on-shift hours, keeps off-duty hours and a missing day, and touches nothing else", () => {
    const schedule: ElevatorSchedule = {
      activeCars: { weekday: flat(3).map((n, h) => (h < 5 ? 0 : n)) },
      homeFloors: [1, 9, 1],
      waitingCarResponse: 4,
      standardFloorDeparture: 30,
    };
    const s = shaft(8);
    const out = recoveredSchedule({ shaft: s, schedule });
    expect(out.activeCars).toEqual({
      weekday: flat(8).map((n, h) => (h < 5 ? 0 : n)),
    });
    expect(out.homeFloors).toEqual([1, 9, 1]);
    expect([out.waitingCarResponse, out.standardFloorDeparture]).toEqual([4, 30]);
    expect(schedule.activeCars?.weekday?.[10]).toBe(3); // the input is not mutated
  });

  it("is idempotent", () => {
    const f = only(shaft(8), { weekday: flat(3), weekend: flat(3) })!;
    const once = recoveredSchedule(f);
    expect(recoveredSchedule({ shaft: f.shaft, schedule: once })).toEqual(once);
    expect(shortFleets([f.shaft], () => once)).toEqual([]);
  });
});

describe("acknowledgementKey", () => {
  it("names the tower and the shaft, and survives a save and reload", () => {
    const raw = load("split-tower-4");
    const header = (sim: Simulation) => ({
      seed: sim.rng.initialSeed,
      mode: sim.mode,
    });
    const a = Simulation.deserialize(raw);
    const b = Simulation.deserialize(JSON.parse(JSON.stringify(a.serialize())) as SerializedGame);
    const t = a.tower.transports.find((x) => x.id === 1139)!;
    const facts = {
      id: t.id,
      kind: t.kind,
      x: t.x,
      bottom: t.bottom,
      top: t.top,
      cars: t.cars,
    };
    expect(acknowledgementKey(header(b), facts)).toBe(acknowledgementKey(header(a), facts));
  });

  it("differs between towers and between shafts, and ignores mutable span geometry", () => {
    const one = acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8));
    expect(acknowledgementKey({ seed: 2, mode: "classic" }, shaft(8))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "modern" }, shaft(8))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { id: 8 }))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { x: 11 }))).not.toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { bottom: 3 }))).toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { top: 12 }))).toBe(one);
    expect(acknowledgementKey({ seed: 1, mode: "classic" }, shaft(8, { cars: 3 }))).toBe(one); // buying a car is not a new shaft
  });

  it("treats the two split-tower saves as one tower, and a tower with another founding seed as another", () => {
    // split-tower-4 is a later save of the same Split Tower: shaft 1139 keeps its key as cars are bought.
    const keyOf = (name: string, id: number, seed?: number) => {
      const sim = Simulation.deserialize(load(name));
      const t = sim.tower.transports.find((x) => x.id === id)!;
      const facts = {
        id: t.id,
        kind: t.kind,
        x: t.x,
        bottom: t.bottom,
        top: t.top,
        cars: t.cars,
      };
      return acknowledgementKey({ seed: seed ?? sim.rng.initialSeed, mode: sim.mode }, facts);
    };
    expect(keyOf("split-tower", 1139)).toBe(keyOf("split-tower-4", 1139));
    expect(keyOf("split-tower", 1139)).not.toBe(keyOf("split-tower", 1139, 99));
    expect(keyOf("split-tower-4", 1139)).not.toBe(keyOf("split-tower-4", 1735));
  });
});

describe("browserAcknowledgements", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("remembers a decision across store instances and keeps keys apart", () => {
    const storage = memory();
    browserAcknowledgements(storage).set("a", "kept");
    browserAcknowledgements(storage).set("b", "told");
    expect(browserAcknowledgements(storage).get("a")).toBe("kept");
    expect(browserAcknowledgements(storage).get("b")).toBe("told");
    expect(browserAcknowledgements(storage).get("c")).toBeUndefined();
  });

  it("survives blocked storage and garbage in the slot", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const store = browserAcknowledgements(blocked);
    expect(() => store.set("a", "kept")).not.toThrow();
    expect(store.get("a")).toBe("kept"); // held for this session, though storage would not take it
    expect(browserAcknowledgements(blocked).get("a")).toBeUndefined(); // a reload forgets it
    const junk = memory();
    junk.setItem("vc-elevator-schedule-review", "[1,2");
    expect(browserAcknowledgements(junk).get("a")).toBeUndefined();
    expect(browserAcknowledgements(undefined).get("a")).toBeUndefined();
  });

  it("lets a newer answer storage refused beat an older one it took", () => {
    const data = new Map<string, string>();
    let full = false;
    const store = browserAcknowledgements({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw new Error("quota");
        data.set(k, v);
      },
    });
    store.set("a", "told");
    full = true;
    store.set("a", "kept");
    expect(store.get("a")).toBe("kept");
  });

  it("migrates legacy keys that still carried the old mutable bottom floor", () => {
    const storage = memory();
    storage.setItem("vc-elevator-schedule-review", JSON.stringify({ "classic:1:1139:elevatorStandard:4:1": "kept" }));
    const store = browserAcknowledgements(storage);
    expect(store.get("classic:1:1139:elevatorStandard:4")).toBe("kept");
    store.set("classic:1:1139:elevatorStandard:4", "told");
    expect(JSON.parse(storage.getItem("vc-elevator-schedule-review") ?? "{}")).toEqual({ "classic:1:1139:elevatorStandard:4": "told" });
  });

  it("trims the oldest decisions past its cap", () => {
    const storage = memory();
    const store = browserAcknowledgements(storage);
    for (let i = 0; i < 450; i++) store.set(`k${i}`, "kept");
    expect(store.get("k0")).toBeUndefined();
    expect(store.get("k449")).toBe("kept");
  });
});

describe("the constants kept here instead of imported from the engine", () => {
  it("name the same elevator kinds as the engine, and a row of the same length", () => {
    const kinds = towerCatalog(Simulation.newGame(1)).facilities.map((f) => f.key);
    expect(kinds.length).toBeGreaterThan(20);
    for (const kind of kinds) expect(isElevator(kind), kind).toBe(isElevatorKind(kind));
    expect(flat(1)).toHaveLength(SCHEDULE_HOURS);
  });
});
