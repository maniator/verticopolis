import { describe, expect, it } from "vitest";
import type { EnginePort } from "../../simport/enginePort";
import { TsEngine } from "../../engine/port/tsEngine";
import {
  serviceDiagnosticsFixture,
  retailServiceFixture,
  setFixtureHotelState,
} from "../fixtures/serviceDiagnostics.fixture";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

if (wasmRequired() && !hasWasmPackage()) {
  throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");
}

type RustPort = EnginePort & { free(): void };

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
        expect(rust.serviceDiagnostics(-1)).toBeUndefined();
        expect(rust.serviceDiagnostics(1.5)).toBeUndefined();
        expect(rust.serviceDiagnostics(Number.NaN)).toBeUndefined();
        expect(rust.serviceDiagnostics(99_999_999)).toBeUndefined();
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
