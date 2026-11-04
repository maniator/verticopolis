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
import { PARKING_WORKERS_PER_SPACE, RECYCLING_POP_PER_CENTER } from "../../engine/census";
import type { Simulation } from "../../engine/Simulation";
import type { GameMode } from "../../engine/types";
import { FACILITIES } from "../../engine/facilities";

if (wasmRequired() && !hasWasmPackage()) {
  throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");
}

type RustPort = EnginePort & { free(): void };

/** One recycling center under 24 floors of occupied offices, more people than
 *  one center serves. */
function recyclingOverCapacity(mode: GameMode): Simulation {
  const { sim } = TsEngine.newGame(13, mode);
  sim.money = 1e12;
  sim.star = 5;
  for (let x = 100; x < 280; x++) {
    sim.tower.place("lobby", 1, x);
    for (const f of [0, -1]) sim.tower.place("floor", f, x);
    for (let f = 2; f <= 25; f++) sim.tower.place("floor", f, x);
  }
  const lift = sim.tower.placeTransport("elevatorStandard", 102, -1, 25);
  if (!lift.ok) throw new Error(`lift: ${lift.reason}`);
  placeUnit(sim, "recycling", -1, 150);
  for (let f = 2; f <= 25; f++) {
    for (let x = 110; x + FACILITIES.office.width <= 280; x += FACILITIES.office.width) placeUnit(sim, "office", f, x).state = "occupied";
  }
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
        // Ids that name no unit, side by side: a missing id, fractional,
        // negative, not finite, out of range, and past 2^32, which must not
        // wrap onto the hotel. (The binding turns any JS value into a number
        // first, so the port's type is what keeps a non-number out.)
        const malformed = [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 99_999_999, 2 ** 32 + f.hotel.id];
        for (const id of malformed) {
          const ask = (port: EnginePort) => port.serviceDiagnostics(id as number);
          expect(ask(rust), `Rust, id ${String(id)}`).toBeUndefined();
          expect(ask(ts), `reference, id ${String(id)}`).toBeUndefined();
          // None names a shaft either, so each shaft card is the empty record.
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

    it(`${mode}: a recycling center over capacity reads the reference's capacity, fill and verdict`, () => {
      const sim = recyclingOverCapacity(mode);
      const ts = new TsEngine(sim);
      const rust = fromFixture(sim);
      try {
        const reads = (port: EnginePort) => ({ capacity: port.recyclingCapacity(), fill: port.recyclingFill(), met: port.recyclingDemandMet() });
        const actual = reads(rust);
        expect(actual).toStrictEqual(reads(ts));
        expect(actual).toMatchObject({ capacity: RECYCLING_POP_PER_CENTER, met: false });
        expect(actual.fill, "the bins fill").toBeGreaterThan(0);
      } finally {
        rust.free();
      }
    });

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
