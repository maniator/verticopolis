/**
 * Hand-edited saves load the way the Rust loader loads them (#858): a field
 * the game writes as a boolean, string or whole number narrows to that type,
 * and every engine-written value loads as before (a save at random state 0 is
 * #856's one change, in rng.test.ts). The cross-engine half is the
 * loader table (`loaderCases.integration.test.ts`) and its WASM run.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeVctower } from "../../storage/vctowerContainer";
import { Simulation } from "../Simulation";
import type { SerializedGame } from "../types";
import { coerceLastVipNagDay, coerceMinutes, knownTransportKeys, savedFlag, savedInt, savedName } from "./coerce";
import { floatingStructureCount, migrationLooksValid, reflowV1toV2 } from "../migrations/v1tov2";

const MAX = Number.MAX_SAFE_INTEGER;
type Any = Record<string, unknown>;

/** A small Modern tower with two offices, a condo and one elevator, saved. */
function base(): Any {
  const sim = Simulation.newGame(7, "modern");
  sim.money = 1e8;
  for (let x = 170; x < 192; x++) expect(sim.build("lobby", 1, x).ok, `lobby @1,${x}`).toBe(true);
  for (let fl = 2; fl <= 3; fl++) for (let x = 171; x < 191; x++) expect(sim.build("floor", fl, x).ok, `floor @${fl},${x}`).toBe(true);
  expect(sim.build("office", 2, 172).ok).toBe(true);
  expect(sim.build("office", 2, 181).ok).toBe(true);
  expect(sim.build("condo", 3, 172).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 171, 1, 3).ok).toBe(true);
  return JSON.parse(JSON.stringify(sim.serialize())) as Any;
}

const load = (data: Any): Simulation => Simulation.deserialize(data as unknown as SerializedGame);
const edited = (edit: (s: Any) => void): Any => {
  const s = base();
  edit(s);
  return s;
};
const units = (s: Any): Any[] => s.units as Any[];
const transports = (s: Any): Any[] => s.transports as Any[];
const office = (s: Any): Any => units(s).find((u) => u.kind === "office")!;

describe("the coercion helpers", () => {
  it("savedInt truncates toward zero and clamps", () => {
    expect([2.5, -2.5, 7].map((v) => savedInt(v))).toEqual([2, -2, 7]);
    // An integer has no -0, and the Rust cast reads NaN as 0.
    expect(Object.is(savedInt(-0.5), 0)).toBe(true);
    expect(Object.is(savedInt(-0.5, -1, 1), 0)).toBe(true);
    expect(savedInt(NaN)).toBe(0);
    expect(savedInt(1e300)).toBe(MAX);
    expect(savedInt(-1e300)).toBe(-MAX);
    expect(savedInt(0.5, -1, 1)).toBe(0);
    expect(savedInt(2.5, -1, 1)).toBe(1);
    expect(savedInt(-3, 0)).toBe(0);
  });

  it("savedFlag keeps absent and reads anything but true as false", () => {
    expect(savedFlag(undefined)).toBeUndefined();
    expect([true, false, 1, "yes", null, 0, {}].map(savedFlag)).toEqual([true, false, false, false, false, false, false]);
  });

  it("savedName keeps absent and a string, and reads anything else as empty", () => {
    expect(savedName(undefined)).toBeUndefined();
    expect(["Sky", "", 5, null, { a: 1 }].map(savedName)).toEqual(["Sky", "", "", "", ""]);
  });

  it("coerceLastVipNagDay floors, caps at the save's day and clamps", () => {
    expect(coerceLastVipNagDay(10, 3.7)).toBe(3);
    // Floored, not truncated: -3.5 reads as -4.
    expect(coerceLastVipNagDay(10, -3.5)).toBe(-4);
    expect(coerceLastVipNagDay(10, 99)).toBe(10);
    expect(coerceLastVipNagDay(10, "3")).toBe(-100);
    expect(coerceLastVipNagDay(10, undefined)).toBe(-100);
    expect(coerceLastVipNagDay(10, -1e300)).toBe(-MAX);
  });

  it("knownTransportKeys drops unknown keys and keeps the order", () => {
    expect(Object.keys(knownTransportKeys({ kind: "stairs", foo: 1, id: 3, __proto__x: 2 }))).toEqual(["kind", "id"]);
    // JSON.parse makes "__proto__" an own key; it is dropped, and the result keeps its prototype.
    const kept = knownTransportKeys(JSON.parse('{"__proto__": {"x": 1}, "kind": "stairs"}') as object);
    expect(Object.keys(kept)).toEqual(["kind"]);
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
  });

  it("coerceMinutes keeps a sub-minute save and caps at 2^53 - 1", () => {
    expect([1440.5, -5, "abc", undefined, 1e23].map(coerceMinutes)).toEqual([1440.5, 0, 0, 0, MAX]);
  });
});

describe("hand-edited fields load as the Rust loader reads them (#858)", () => {
  it("a whole-number occupants count", () => {
    expect(load(edited((s) => (office(s).occupants = 2.5))).tower.units.find((u) => u.kind === "office")!.occupants).toBe(2);
    expect(load(edited((s) => (office(s).occupants = 1e300))).tower.units.find((u) => u.kind === "office")!.occupants).toBe(MAX);
  });

  it("a car direction of -1, 0 or 1", () => {
    expect(load(edited((s) => (transports(s)[0].carDir = [0.5]))).tower.transports[0].carDir).toEqual([0]);
    expect(load(edited((s) => (transports(s)[0].carDir = [-1e300]))).tower.transports[0].carDir).toEqual([-1]);
    expect(load(edited((s) => (transports(s)[0].carDir = [2.5]))).tower.transports[0].carDir).toEqual([1]);
    expect(load(edited((s) => (transports(s)[0].carDir = [1e300]))).tower.transports[0].carDir).toEqual([1]);
  });

  it("a whole-number transport load, 0 when missing or not a number", () => {
    const loadOf = (v: unknown): unknown =>
      load(edited((s) => (v === undefined ? delete transports(s)[0].load : (transports(s)[0].load = v)))).tower.transports[0].load;
    expect([2.5, "x", null, undefined, 1e300].map(loadOf)).toEqual([2, 0, 0, 0, MAX]);
  });

  it("no unknown transport key survives into the next save", () => {
    const sim = load(edited((s) => (transports(s)[0].foo = 1)));
    expect(sim.serialize().transports[0]).not.toHaveProperty("foo");
  });

  it("the boolean flags and the tower name", () => {
    const sim = load(edited((s) => Object.assign(s, { builtWeddingHall: 1, evaluatedTower: "yes", vipFavorable: 1, towerName: 5 })));
    expect([sim.tower.builtWeddingHall, sim.evaluatedTower, sim.vipFavorable, sim.tower.towerName]).toEqual([false, false, false, ""]);
    expect(["yes", 0, true].map((v) => load(edited((s) => (s.vipFavorable = v))).vipFavorable)).toEqual([false, false, true]);
    // Absent stays absent, so the next save leaves the key out again.
    const absent = JSON.parse(JSON.stringify(load(edited((s) => { delete s.evaluatedTower; delete s.towerName; delete s.builtWeddingHall; })).serialize())) as Any;
    expect(absent).not.toHaveProperty("evaluatedTower");
    expect(absent).not.toHaveProperty("towerName");
    expect(absent).not.toHaveProperty("builtWeddingHall");
  });

  it("a VIP visit day that is not a number reads as no visit", () => {
    expect(load(edited((s) => (s.vipVisitDay = "3"))).vipVisitDay).toBe(-1);
    expect(load(edited((s) => (s.vipVisitDay = true))).vipVisitDay).toBe(-1);
    expect(load(edited((s) => (s.vipVisitDay = 12.5))).vipVisitDay).toBe(12.5);
  });

  it("minutes cap where the Rust day would saturate", () => {
    expect(load(edited((s) => (s.minutes = 1e23))).clock.minutes).toBe(MAX);
  });

  it("a pre-mode condo with a non-string state gets no legacy sold price", () => {
    const condoRent = (state: unknown): unknown => load(edited((s) => {
      delete s.mode;
      const condo = units(s).find((u) => u.kind === "condo")!;
      Object.assign(condo, { everOccupied: true, state });
      delete condo.rent;
    })).tower.units.find((u) => u.kind === "condo")!.rent;
    // A non-string state loads like "empty"; the control is a sold condo,
    // which gets the legacy price (on the Classic ladder, as a pre-mode save is Classic).
    const unsold = condoRent("empty");
    expect(condoRent("occupied")).not.toBe(unsold);
    expect(condoRent(5)).toBe(unsold);
    expect(condoRent({})).toBe(unsold);
  });

  describe("the v1 to v5 checks read geometry as numbers", () => {
    const v1 = (edit: (s: Any) => void): SerializedGame => ({ ...edited(edit), version: 1 }) as unknown as SerializedGame;
    const floorTile = (s: Any): Any => units(s).find((u) => u.kind === "floor" && u.floor === 2)!;
    /** The last floor-2 tile, at x = 190; the lobby ends at 191. */
    const edgeTile = (s: Any): Any => units(s).find((u) => u.kind === "floor" && u.floor === 2 && u.x === 190)!;

    it("a string room x or floor", () => {
      expect(migrationLooksValid(v1(() => {}))).toBe(true);
      expect(migrationLooksValid(v1((s) => Object.assign(office(s), { floor: "2", x: "172" })))).toBe(true);
    });

    it("a string structure x or floor, and a width that is not a number", () => {
      const plain = floatingStructureCount(v1(() => {}));
      expect(floatingStructureCount(v1((s) => Object.assign(floorTile(s), { floor: String(floorTile(s).floor), x: String(floorTile(s).x) })))).toBe(plain);
      // A string width counts as 1, as in the Rust loader; read as 4, the
      // tile would hang two columns past the lobby.
      expect(floatingStructureCount(v1((s) => (edgeTile(s).width = 4)))).toBe(plain + 2);
      expect(floatingStructureCount(v1((s) => (edgeTile(s).width = "4")))).toBe(plain);
      // Floors read as `Number` reads them; left as text, the floor-3 tiles
      // would float over " 2 ", and tiles at "1" would not be on the ground.
      const allAt = (floor: number, text: string): SerializedGame => v1((s) => {
        for (const u of units(s)) if ((u.kind === "floor" || u.kind === "lobby") && u.floor === floor) u.floor = text;
      });
      expect(floatingStructureCount(allAt(2, " 2 "))).toBe(plain);
      expect(floatingStructureCount(allAt(1, "1"))).toBe(plain);
    });

    it("a room width that is not a number takes the catalog's", () => {
      // The second office moved 3 columns left of the first: 1 wide it ends
      // before the first, 9 wide (the catalog's) it overlaps it.
      const left = (width: unknown): SerializedGame => v1((s) => {
        const [a, b] = units(s).filter((u) => u.kind === "office");
        Object.assign(b, { width, x: (a.x as number) - 3 });
      });
      expect(migrationLooksValid(left(1))).toBe(true);
      expect(migrationLooksValid(left(9))).toBe(false);
      expect(migrationLooksValid(left("abc"))).toBe(false);
    });

    it("a room at a NaN column is left out of the overlap check", () => {
      const overlap = (s: Any): void => {
        const [a, b] = units(s).filter((u) => u.kind === "office");
        b.x = (a.x as number) + 1;
      };
      expect(migrationLooksValid(v1(overlap))).toBe(false);
      // Sorted between the two, the NaN room would hide their overlap.
      const between = (s: Any): void => { overlap(s); units(s).splice(units(s).indexOf(office(s)) + 1, 0, { ...office(s), id: 9003, x: "abc" }); };
      expect(migrationLooksValid(v1(between))).toBe(false);
      expect(migrationLooksValid(v1((s) => { overlap(s); units(s).push({ ...office(s), id: 9003, x: "abc" }); }))).toBe(false);
      expect(migrationLooksValid(v1((s) => units(s).push({ ...office(s), id: 9003, x: "abc" })))).toBe(true);
    });

    it("a two-story room at 2^53 floors and a tile far wider than the lot end", () => {
      expect(migrationLooksValid(v1((s) => Object.assign(office(s), { kind: "cinema", floor: 2 ** 53 })))).toBe(true);
      // Capped at the lot's 375 columns, two of them over the lobby; uncapped,
      // the count would be 1e8 - 2. The ground floor is never counted, so the
      // lobby below only has to end.
      expect(floatingStructureCount(v1((s) => (edgeTile(s).width = 1e8)))).toBe(floatingStructureCount(v1(() => {})) + 373);
      expect(floatingStructureCount(v1((s) => (units(s).find((u) => u.kind === "lobby")!.width = 1e8)))).toBe(floatingStructureCount(v1(() => {})));
      expect(() => load(v1((s) => (units(s).find((u) => u.kind === "lobby")!.width = 1e8)) as unknown as Any)).not.toThrow();
    });

    it("the reflow pads from a floored nextId, only on the lot, and leaves a far column alone", () => {
      const ids = (out: SerializedGame): unknown[] => out.units.filter((u) => u.kind === "floor" && u.floor === 4).map((u) => u.id);
      const moved = (s: Any): void => { units(s).filter((u) => u.kind === "office")[1].floor = 4; };
      const whole = reflowV1toV2(v1(moved));
      const fractional = reflowV1toV2(v1((s) => { moved(s); s.nextId = (s.nextId as number) + 100.5; }));
      expect(ids(whole).length).toBeGreaterThan(0);
      expect(ids(fractional)).toEqual(ids(whole).map((id) => (id as number) + 100));
      expect(Number.isInteger(fractional.nextId)).toBe(true);
      // A footprint kept far off the lot paves nothing, so the reflow ends.
      const offLot = reflowV1toV2(v1((s) => Object.assign(office(s), { x: 400, width: 1e9 })));
      expect(offLot.units.length).toBe(v1(() => {}).units.length);
      // A room column at -FAR_COORD is left out of the reflow, as it was saved
      // (a far column on the other side would pave nothing either way).
      const far = reflowV1toV2(v1((s) => (office(s).x = -(2 ** 52))));
      expect(far.units.find((u) => u.kind === "office" && u.x === -(2 ** 52))).toBeDefined();
    });

    it("a room from 2^52 floors up is left out of the checks", () => {
      // Two overlapping offices: found below FAR_COORD, skipped at it.
      const overlapAt = (floor: number) => v1((s) => {
        const [a, b] = units(s).filter((u) => u.kind === "office");
        Object.assign(b, { x: (a.x as number) + 1, floor });
        a.floor = floor;
      });
      expect(migrationLooksValid(overlapAt(2 ** 52 - 1))).toBe(false);
      expect(migrationLooksValid(overlapAt(2 ** 52))).toBe(true);
    });
  });

  it("a pending message that is not a string reads as none", () => {
    const messageOf = (message: unknown): unknown => {
      const events = load(edited((s) => (s.events = { ...(s.events as Any), pending: { kind: "bombThreat", cost: 300000, message } }))).serialize().events;
      return (events as { pending?: { message: unknown } }).pending?.message;
    };
    expect(["Call the police?", [1, 2], 1e21, 5, null, undefined].map(messageOf)).toEqual(["Call the police?", "", "", "", "", ""]);
  });

  it("a null save still refuses to load, and any other top-level value loads", () => {
    expect(() => Simulation.deserialize(null as unknown as SerializedGame)).toThrow();
    // As in the Rust loader, which refuses only null.
    expect(() => Simulation.deserialize(5 as unknown as SerializedGame)).not.toThrow();
    expect(() => Simulation.deserialize([] as unknown as SerializedGame)).not.toThrow();
    expect(() => Simulation.deserialize("abc" as unknown as SerializedGame)).not.toThrow();
  });
});

/** Every value the narrowing and the #856 restore touch, where `raw` holds one,
 *  as `loaded` holds it: equal for a game-written save. */
function expectNarrowedKept(raw: Any, loaded: Any, f: string): void {
  const pick = (s: Any, at: Any): unknown => {
    const byId = new Map(units(s).map((u) => [u.id, u]));
    return {
      top: Object.fromEntries(["seed", "minutes", "builtWeddingHall", "towerName", "vipFavorable", "evaluatedTower", "vipVisitDay", "lastVipNagDay"].filter((k) => at[k] !== undefined).map((k) => [k, s[k]])),
      rngState: (s.events as Any | undefined)?.rngState,
      // The sparse writer leaves out a zero count.
      occupants: units(at).filter((u) => u.occupants !== undefined).map((u) => [u.id, byId.get(u.id)?.occupants ?? 0]),
      transports: transports(at).map((t) => { const v = transports(s).find((x) => x.id === t.id)!; return [t.id, v.carDir, v.load, Object.keys(v)]; }),
    };
  };
  expect(pick(loaded, raw), f).toEqual(pick(raw, raw));
}

// Loading as before for every other input is the loader table's job (each
// case that was there before keeps its hash, apart from the two former
// recorded divergences) and the conformance fixtures'; these show the
// narrowing leaves a game-written save alone.
describe("engine-written values load as before", () => {
  it("a saved tower round-trips byte for byte", () => {
    const s = base();
    expect(JSON.stringify(load(s).serialize())).toBe(JSON.stringify(s));
  });

  it("every .vctower fixture keeps its narrowed values, and saves and reloads to the same save", () => {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../conformance/fixtures");
    const files = readdirSync(dir).filter((f) => f.endsWith(".vctower"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = decodeVctower(readFileSync(resolve(dir, f), "utf8"), f) as Any;
      // No game-written transport holds a key the narrowing drops.
      for (const t of transports(raw)) expect(Object.keys(knownTransportKeys(t)), f).toEqual(Object.keys(t));
      const once = JSON.stringify(load(raw).serialize());
      expectNarrowedKept(raw, JSON.parse(once) as Any, f);
      expect(JSON.stringify(load(JSON.parse(once) as Any).serialize()), f).toBe(once);
    }
  });
});
