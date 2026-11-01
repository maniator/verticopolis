import { describe, expect, it, vi } from "vitest";
import { TsEngine } from "./tsEngine";
import { serviceDiagnosticsFixture, setFixtureHotelState } from "../../tests/fixtures/serviceDiagnostics.fixture";

describe("TypeScript reference engine's keyed service diagnostics", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: uses stable nested fields and refuses missing unit IDs`, () => {
      const f = serviceDiagnosticsFixture(mode);
      const port = new TsEngine(f.sim);
      const hotel = port.serviceDiagnostics(f.hotel.id);
      expect(hotel).toMatchObject({
        hotel: { rating: "counts", condition: "other", infestDays: null, recovery: null },
        parking: { status: "notApplicable", shortage: null },
        housekeeping: { status: "notApplicable", crews: null },
      });
      expect(port.serviceDiagnostics(-1)).toBeUndefined();
      expect(port.serviceDiagnostics(1.5)).toBeUndefined();
      expect(port.serviceDiagnostics(Number.NaN)).toBeUndefined();
      expect(port.serviceDiagnostics(99_999_999)).toBeUndefined();
    });
  }

  it("recognizes the same connected, disconnected and ramp fixtures", () => {
    const f = serviceDiagnosticsFixture();
    const port = new TsEngine(f.sim);
    expect(port.serviceDiagnostics(f.ramp.id)?.parking.status).toBe("ramp");
    const linked = port.serviceDiagnostics(f.connectedParking.id)?.parking;
    expect(linked?.status).toBe("connected");
    expect(linked?.have).toBe(1);
    expect(linked?.total).not.toBeNull();
    expect(port.serviceDiagnostics(f.disconnectedParking.id)?.parking).toMatchObject({
      status: "disconnected", have: null, shortage: null, total: null,
    });
    // No stale connection cached across operational state transitions.
    f.ramp.state = "fire";
    expect(port.serviceDiagnostics(f.connectedParking.id)?.parking).toMatchObject({
      status: "disconnected", have: null, shortage: null,
    });
  });

  it("distinguishes star eligibility, dirty days and infested recovery by mode", () => {
    for (const mode of ["classic", "modern"] as const) {
      const f = serviceDiagnosticsFixture(mode);
      const port = new TsEngine(f.sim);
      f.sim.star = 4;
      setFixtureHotelState(f, "dirty");
      expect(port.serviceDiagnostics(f.hotel.id)?.hotel).toMatchObject({
        rating: "excluded", condition: "dirty", infestDays: 3, recovery: null,
      });
      setFixtureHotelState(f, "infested");
      expect(port.serviceDiagnostics(f.hotel.id)?.hotel).toMatchObject({
        rating: "excluded", condition: "infested", infestDays: null,
      });
    }
  });

  it("reports housekeeping's observed shortfall and preserves its recorded figures", () => {
    const f = serviceDiagnosticsFixture();
    const report = vi.spyOn(f.sim.economy, "housekeepingReport").mockReturnValue({ cleaned: 8, leftover: 4 });
    const port = new TsEngine(f.sim);
    const hk = port.serviceDiagnostics(f.housekeeping.id)?.housekeeping;
    expect(hk).toMatchObject({
      status: "observedShortfall", cleaned: 8, leftover: 4,
      maidsPerUnit: 6, roomsPerMaid: 19,
    });
    expect(hk?.rooms).toBeGreaterThan(0);
    expect(hk?.crews).toBe(1);
    report.mockRestore();
    expect(port.serviceDiagnostics(f.housekeeping.id)?.housekeeping.cleaned).toBeNull();
  });

  it("does not emit operational advice when the inspected housekeeping or parking unit is inert", () => {
    const f = serviceDiagnosticsFixture();
    const port = new TsEngine(f.sim);
    f.housekeeping.state = "construction";
    f.connectedParking.state = "fire";
    expect(port.serviceDiagnostics(f.housekeeping.id)?.housekeeping.status).toBe("notApplicable");
    expect(port.serviceDiagnostics(f.connectedParking.id)?.parking.status).toBe("notApplicable");
  });
});
