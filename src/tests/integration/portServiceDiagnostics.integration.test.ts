import { describe, expect, it } from "vitest";
import type { EnginePort } from "../../simport/enginePort";
import { TsEngine } from "../../engine/port/tsEngine";
import {
  serviceDiagnosticsFixture,
  lobbyDistanceFixture,
  retailServiceFixture,
  underServedRetailFixture,
  setFixtureHotelState,
} from "../fixtures/serviceDiagnostics.fixture";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { placeUnit } from "../fixtures/towerFixtures";
import { GARBAGE_COLLECT_HOUR, PARKING_WORKERS_PER_SPACE, RECYCLING_POP_PER_CENTER } from "../../engine/census";
import type { Simulation } from "../../engine/Simulation";
import type { GameMode, UnitState } from "../../shared/types";
import { FACILITIES } from "../../engine/facilities";

if (wasmRequired() && !hasWasmPackage()) {
  throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");
}

type RustPort = EnginePort & { free(): void };

/** The offices one floor of the recycling tower holds. */
const OFFICES_PER_FLOOR = Math.floor((280 - 110) / FACILITIES.office.width);

/** One recycling center under `offices` occupied offices, filled floor by
 *  floor from floor 2, with `singles` occupied single hotel rooms beside the
 *  last ones. An office holds 6 people and a single room 1, so the
 *  population can land on the center's capacity exactly, in either mode. */
function recyclingTower(mode: GameMode, offices: number, singles = 0): Simulation {
  const { sim } = TsEngine.newGame(13, mode);
  sim.money = 1e12;
  sim.star = 5;
  const place = (kind: "lobby" | "floor", f: number, x: number) => {
    const r = sim.tower.place(kind, f, x);
    if (!r.ok) throw new Error(`${kind} at floor ${f}, x ${x}: ${r.reason}`);
  };
  for (let x = 100; x < 280; x++) {
    place("lobby", 1, x);
    for (const f of [0, -1]) place("floor", f, x);
    for (let f = 2; f <= 25; f++) place("floor", f, x);
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 102, -1, 25);
  if (!lift.ok) throw new Error(`lift: ${lift.reason}`);
  placeUnit(sim, "recycling", -1, 150);
  const at = (i: number) => ({ floor: 2 + Math.floor(i / OFFICES_PER_FLOOR), x: 110 + (i % OFFICES_PER_FLOOR) * FACILITIES.office.width });
  for (let i = 0; i < offices; i++) placeUnit(sim, "office", at(i).floor, at(i).x).state = "occupied";
  const { floor, x } = at(offices);
  for (let i = 0; i < singles; i++) placeUnit(sim, "hotelSingle", floor, x + i * FACILITIES.hotelSingle.width).state = "occupied";
  return sim;
}

function fromFixture(sim: ReturnType<typeof serviceDiagnosticsFixture>["sim"]): RustPort {
  return wasm().Engine.fromSave(JSON.stringify(sim.serialize())) as unknown as RustPort;
}

describe.skipIf(!hasWasmPackage())("real Rust/WASM keyed service diagnostics from deterministic save fixtures", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: preserves nested JS object shape and matches the reference port`, () => {
      const f = serviceDiagnosticsFixture(mode);
      const ts = new TsEngine(f.sim);
      const rust = fromFixture(f.sim);
      try {
        for (const u of [f.hotel, f.housekeeping, f.office, f.ramp, f.connectedParking, f.disconnectedParking]) {
          const actual = rust.serviceDiagnostics(u.id);
          expect(actual, `${mode}: missing Rust diagnostics for ${u.kind}`).toBeDefined();
          expect(actual, `${mode}: mismatch for ${u.kind} #${u.id}`).toEqual(ts.serviceDiagnostics(u.id));
          expect(typeof actual).toBe("object");
          expect(Array.isArray(actual)).toBe(false);
        }
        // Ids that name no unit, side by side: a missing id, not finite, out
        // of range, and four built from the hotel's id (half past it, its
        // negative and 2^32 either side of it), where a truncation, an
        // absolute value or a wrap would land on it. (The binding turns any JS
        // value into a number first, so the port's type is what keeps a
        // non-number out.)
        const h = f.hotel.id;
        const malformed = [undefined, h + 0.5, -h, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 99_999_999, h + 2 ** 32, h - 2 ** 32];
        for (const id of malformed) {
          const ask = (port: EnginePort) => port.serviceDiagnostics(id as number);
          expect(ask(rust), `Rust, id ${String(id)}`).toBeUndefined();
          expect(ask(ts), `reference, id ${String(id)}`).toBeUndefined();
          // The fixture has no shaft, so each shaft card is the empty record;
          // the retail case below asks beside a real shaft.
          const card = (port: EnginePort) => Array.from(port.shaftCard(id as number));
          expect(card(rust), `Rust shaft card, id ${String(id)}`).toEqual([]);
          expect(card(ts), `reference shaft card, id ${String(id)}`).toEqual([]);
        }
        // Explicitly retain tenant's existing numeric record as a separate API.
        expect(rust.unitFacts(f.hotel.id)).toBeInstanceOf(Float64Array);
      } finally {
        rust.free();
      }
    });

    for (const condition of ["dirty", "infested"] as const) {
      it(`${mode}: ${condition} hotel and star-gate decisions survive save/load`, () => {
        const f = serviceDiagnosticsFixture(mode);
        f.sim.star = 4;
        setFixtureHotelState(f, condition);
        const ts = new TsEngine(f.sim);
        const rust = fromFixture(f.sim);
        try {
          const actual = rust.serviceDiagnostics(f.hotel.id);
          expect(actual).toEqual(ts.serviceDiagnostics(f.hotel.id));
          expect(actual?.hotel.rating).toBe("excluded");
          expect(actual?.hotel.condition).toBe(condition);
          if (condition === "dirty") expect(actual?.hotel.infestDays).toBe(3);
          if (condition === "infested") expect(actual?.hotel.recovery).toBe(mode === "modern");
        } finally {
          rust.free();
        }
      });
    }
  }

  it("honors a disconnected garage and ignores neighboring functional parking", () => {
    const f = serviceDiagnosticsFixture();
    const rust = fromFixture(f.sim);
    try {
      expect(rust.serviceDiagnostics(f.connectedParking.id)?.parking.status).toBe("connected");
      expect(rust.serviceDiagnostics(f.disconnectedParking.id)?.parking).toMatchObject({
        status: "disconnected", have: null, shortage: null,
      });
      expect(rust.serviceDiagnostics(f.ramp.id)?.parking.status).toBe("ramp");
    } finally {
      rust.free();
    }
    // Re-load the same authored tower after removing ramp operation.
    f.ramp.state = "fire";
    const after = fromFixture(f.sim);
    try {
      expect(after.serviceDiagnostics(f.connectedParking.id)?.parking.status).toBe("disconnected");
    } finally {
      after.free();
    }
  });

  for (const mode of ["classic", "modern"] as const) {
    // The fixture's own office, plus enough to put exactly one space's worth
    // of workers in the tower (one stall covers them), then one office more
    // (the demand rounds up to a second space the tower lacks).
    const { population, width } = FACILITIES.office;
    const atOneSpace = PARKING_WORKERS_PER_SPACE / population - 1;
    for (const [added, shortage] of [[atOneSpace, false], [atOneSpace + 1, true]] as const) {
      it(`${mode}: ${added} more offices ${shortage ? "leave a stall short of" : "fill one stall with"} their cars, as the reference says`, () => {
        expect(PARKING_WORKERS_PER_SPACE % population, "offices fill a space exactly").toBe(0);
        const f = serviceDiagnosticsFixture(mode);
        for (let x = 160; x < 160 + added * width; x++) expect(f.sim.tower.place("floor", 3, x).ok, `floor tile at x ${x}`).toBe(true);
        for (let i = 0; i < added; i++) placeUnit(f.sim, "office", 3, 160 + i * width).state = "occupied";
        const ts = new TsEngine(f.sim);
        const rust = fromFixture(f.sim);
        try {
          for (const unit of [f.connectedParking, f.ramp]) {
            expect(rust.serviceDiagnostics(unit.id), `${unit.kind} ${unit.id}`).toStrictEqual(ts.serviceDiagnostics(unit.id));
          }
          expect(rust.serviceDiagnostics(f.connectedParking.id)?.parking).toMatchObject({
            status: "connected", shortage, have: 1, total: shortage ? 2 : 1, offices: shortage ? 2 : 1, suites: 0,
          });
        } finally {
          rust.free();
        }
      });
    }

    // Well over capacity, one person over it, exactly at it, well under it,
    // and a center with no one to serve, each with its population pinned on
    // the reference, so the pair at capacity pins the verdict's `<=`. Each
    // reads a minute before the collection hour, when the bins are fullest:
    // the fill reaches its clamp at 1 well over capacity, and stops just
    // short of it one person over (2,501 people for a day's 2,500).
    const RECYCLING_CASES = [
      { name: "well over capacity", offices: 24 * OFFICES_PER_FLOOR, singles: 0, population: 2_592, met: false, clamped: true },
      { name: "one person over capacity", offices: 416, singles: 5, population: 2_501, met: false, clamped: false },
      { name: "at capacity", offices: 416, singles: 4, population: 2_500, met: true, clamped: false },
      { name: "well under capacity", offices: OFFICES_PER_FLOOR, singles: 0, population: 108, met: true, clamped: false },
      { name: "with no one to serve", offices: 0, singles: 0, population: 0, met: true, clamped: false },
    ] as const;
    const MINUTES_PER_DAY = 24 * 60;
    const READ_MINUTE = GARBAGE_COLLECT_HOUR * 60 - 1;
    for (const { name, offices, singles, population: people, met, clamped } of RECYCLING_CASES) {
      it(`${mode}: a recycling center ${name} (${people} people) reads the reference's capacity, fill and verdict`, () => {
        const sim = recyclingTower(mode, offices, singles);
        sim.clock.minutes += (READ_MINUTE - sim.clock.minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY;
        expect(sim.clock.minuteOfDay).toBe(READ_MINUTE);
        const population = sim.tower.totalPopulation();
        expect(population).toBe(people);
        expect(population > RECYCLING_POP_PER_CENTER, `population ${population}`).toBe(!met);
        const ts = new TsEngine(sim);
        const rust = fromFixture(sim);
        try {
          const reads = (port: EnginePort) => ({ capacity: port.recyclingCapacity(), fill: port.recyclingFill(), met: port.recyclingDemandMet() });
          const actual = reads(rust);
          expect(actual).toStrictEqual(reads(ts));
          expect(actual).toMatchObject({ capacity: RECYCLING_POP_PER_CENTER, met });
          expect(actual.fill > 0, `fill ${actual.fill}`).toBe(people > 0);
          expect(actual.fill === 1, `fill ${actual.fill}`).toBe(clamped);
        } finally {
          rust.free();
        }
      });
    }

    // An inert housekeeping station or ramp (the corpus has neither): its
    // section reads as not applicable, on both engines alike.
    for (const state of ["construction", "fire", "gutted"] as const satisfies readonly UnitState[]) {
      it(`${mode}: a housekeeping station and a ramp (${state}) read their sections as switched off`, () => {
        const f = serviceDiagnosticsFixture(mode);
        f.housekeeping.state = state;
        f.ramp.state = state;
        const ts = new TsEngine(f.sim);
        const rust = fromFixture(f.sim);
        try {
          for (const u of [f.housekeeping, f.ramp]) {
            const actual = rust.serviceDiagnostics(u.id);
            expect(actual, `${u.kind} ${u.id}`).toStrictEqual(ts.serviceDiagnostics(u.id));
            expect(actual?.housekeeping.status, `${u.kind} ${u.id}`).toBe("notApplicable");
            expect(actual?.parking.status, `${u.kind} ${u.id}`).toBe("notApplicable");
          }
        } finally {
          rust.free();
        }
      });
    }

    it(`${mode}: retail shops, fast food and restaurants match the TS reference through real WASM`, () => {
      const f = retailServiceFixture(mode);
      const rust = fromFixture(f.sim);
      const reference = new TsEngine(f.sim);
      try {
        for (const venue of [f.shop, f.fastFood, f.restaurant]) {
          const actual = rust.serviceDiagnostics(venue.id);
          expect(actual).toEqual(reference.serviceDiagnostics(venue.id));
          expect(actual?.retail.active).toBe(true);
          expect(typeof actual).toBe("object");
          expect(Array.isArray(actual)).toBe(false);
        }
        expect(rust.serviceDiagnostics(f.shop.id)?.retail.tier).toBe("low");
        expect(rust.serviceDiagnostics(f.fastFood.id)?.retail.tier).toBe("noData");
        expect(rust.serviceDiagnostics(f.restaurant.id)?.retail.tier).toBe("booming");
        expect(rust.serviceDiagnostics(f.shop.id)?.retail.advice).toBe(mode === "modern" ? "overBuilt" : "none");
        // Beside a real shaft, ids that name no shaft read the empty card:
        // fractional, negative, and past 2^32, which must not wrap onto it.
        const shaft = f.sim.tower.transports[0];
        if (!shaft) throw new Error("the retail fixture has no shaft");
        const card = (port: EnginePort, id: number) => Array.from(port.shaftCard(id));
        expect(card(rust, shaft.id), "the real shaft's card").toEqual(card(reference, shaft.id));
        expect(card(rust, shaft.id).length, "the real shaft's card").toBeGreaterThan(0);
        for (const id of [shaft.id + 0.5, -shaft.id, 2 ** 32 + shaft.id]) {
          expect(card(rust, id), `Rust shaft card, id ${id}`).toEqual([]);
          expect(card(reference, id), `reference shaft card, id ${id}`).toEqual([]);
        }
        // Units and shafts share one id counter, so each read refuses the
        // other's ids: a shaft has no service facts, and a room no shaft card.
        expect(f.sim.tower.units.some((u) => u.id === shaft.id), "a unit with the shaft's id").toBe(false);
        expect(f.sim.tower.transports.some((t) => t.id === f.shop.id), "a shaft with the shop's id").toBe(false);
        expect(rust.serviceDiagnostics(shaft.id), "Rust, the shaft's id").toBeUndefined();
        expect(reference.serviceDiagnostics(shaft.id), "reference, the shaft's id").toBeUndefined();
        expect(card(rust, f.shop.id), "Rust shaft card, the shop's id").toEqual([]);
        expect(card(reference, f.shop.id), "reference shaft card, the shop's id").toEqual([]);
      } finally {
        rust.free();
      }
    });
  }

  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: a tower whose shoppers outstrip its retail reads under-served in Modern, through real WASM`, () => {
      const f = underServedRetailFixture(mode);
      const rust = fromFixture(f.sim);
      try {
        const actual = rust.serviceDiagnostics(f.shop.id);
        expect(actual).toEqual(new TsEngine(f.sim).serviceDiagnostics(f.shop.id));
        expect(actual?.retail.advice).toBe(mode === "modern" ? "underServed" : "none");
      } finally {
        rust.free();
      }
    });
  }

  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: a venue past two floors from a lobby is flagged by Rust, a sky bar and an office are not`, () => {
      const f = lobbyDistanceFixture(mode);
      const rust = fromFixture(f.sim);
      const reference = new TsEngine(f.sim);
      try {
        for (const u of [f.near, f.far, f.skyBar, f.office]) {
          expect(rust.serviceDiagnostics(u.id), `${mode}: ${u.kind} on floor ${u.floor}`)
            .toEqual(reference.serviceDiagnostics(u.id));
        }
        expect(rust.serviceDiagnostics(f.near.id)?.commercial.lobbyFar).toBe(false);
        expect(rust.serviceDiagnostics(f.far.id)?.commercial.lobbyFar).toBe(true);
        expect(rust.serviceDiagnostics(f.skyBar.id)?.commercial.lobbyFar).toBeNull();
        expect(rust.serviceDiagnostics(f.office.id)?.commercial.lobbyFar).toBeNull();
      } finally {
        rust.free();
      }
    });
  }

  it("keeps housekeeping's coverage figures authoritative after real WASM load", () => {
    const f = serviceDiagnosticsFixture();
    const rust = fromFixture(f.sim);
    try {
      const ref = new TsEngine(f.sim).serviceDiagnostics(f.housekeeping.id);
      const actual = rust.serviceDiagnostics(f.housekeeping.id);
      expect(actual).toEqual(ref);
      expect(actual?.housekeeping).toMatchObject({
        status: "adequate", maidsPerUnit: 6, roomsPerMaid: 19,
      });
      expect(actual?.housekeeping.rooms).toBeGreaterThan(0);
    } finally {
      rust.free();
    }
  });
});
