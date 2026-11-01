import { describe, expect, it } from "vitest";
import { facilityFloors } from "../engine/facilities";
import { TsEngine } from "../engine/port/tsEngine";
import type { EnginePort } from "../simport/enginePort";
import { ViewReader } from "../simport/viewReader";
import { serviceDiagnosticsFixture, retailServiceFixture, setFixtureHotelState } from "../tests/fixtures/serviceDiagnostics.fixture";
import { html } from "lit-html";
import { renderToFragment } from "../ui/testing/litTestUtils";
import { unitEditorTemplate } from "../ui/templates/editor";
import { unitInspectorTemplate } from "../ui/templates/inspector";
import { createCardKit } from "./cardKit";

/** Exercise the exact Rust UI branch: EnginePort without a .sim property.
 * The separate WASM integration tests prove the real Rust binder's facts. */
function hostedFixture() {
  const f = serviceDiagnosticsFixture();
  const ts = new TsEngine(f.sim);
  let reads = 0;
  const port = new Proxy(ts, {
    get(target, key) {
      if (key === "sim") return undefined;
      if (key === "serviceDiagnostics") return (id: number) => {
        reads++;
        return target.serviceDiagnostics(id);
      };
      return Reflect.get(target, key, target);
    },
  }) as unknown as EnginePort;
  const reader = new ViewReader(port, facilityFloors);
  const kit = createCardKit({ enginePort: port, reader });
  const copy = (id: number, fresh = true) => kit.diagnostics.unit(id, fresh)
    .map((line) => line.strings.map((s, i) => s + (i < line.values.length ? String(line.values[i]) : "")).join(""))
    .join("\n");
  return { ...f, port, reader, kit, copy, reads: () => reads };
}

describe("service inspector cards against the Rust-style EnginePort", () => {
  it("renders dirty and infested hotel warnings on desktop and mobile without accessing a TS tower", () => {
    const f = hostedFixture();
    f.sim.star = 4;
    setFixtureHotelState(f, "dirty");
    const lines = f.kit.diagnostics.unit(f.hotel.id, true);
    const unit = f.kit.cards.unit(f.hotel.id);
    if (!unit) throw new Error("fixture's hotel card is missing");
    const mobile = renderToFragment(unitEditorTemplate(unit, f.kit.catalog(), 12, true, lines));
    const desktop = renderToFragment(unitInspectorTemplate(unit, f.kit.catalog(), 12, lines));
    for (const target of [mobile.textContent, desktop.textContent]) {
      expect(target).toContain("Counts toward stars: no");
      expect(target).toContain("Left dirty for 3 days");
    }
    setFixtureHotelState(f, "infested");
    const text = f.copy(f.hotel.id, true);
    expect(text).toContain("Cockroach infested");
    expect(text).toContain("Call an exterminator");
  });

  it("shows connected and disconnected parking in the inspector without inventing per-space demand", () => {
    const f = hostedFixture();
    expect(f.copy(f.connectedParking.id)).toContain("Ramp access: connected");
    const disconnected = f.copy(f.disconnectedParking.id);
    expect(disconnected).toContain("Ramp access: none");
    expect(disconnected).not.toContain("Parking demand:");
    expect(f.copy(f.ramp.id)).toContain("Parking demand:");
  });

  it("shows the engine's housekeeping coverage and never duplicates warnings on refresh", () => {
    const f = hostedFixture();
    const text = f.copy(f.housekeeping.id);
    expect(text).toContain("Fields 6 maids");
    expect(text).toContain("Tower: 1 crew");
    expect(text).not.toContain("Falling behind:");
    expect((text.match(/Fields 6 maids/g) ?? [])).toHaveLength(1);
    const count = f.reads();
    for (let i = 0; i < 8; i++) f.kit.diagnostics.unit(f.housekeeping.id);
    expect(f.reads()).toBe(count);
    f.kit.diagnostics.invalidate();
    f.kit.diagnostics.unit(f.housekeeping.id);
    expect(f.reads()).toBeGreaterThan(count);
  });

  it("does not duplicate commercial lines through the Rust-style card cache and refresh", () => {
    const fixture = retailServiceFixture("modern");
    const ts = new TsEngine(fixture.sim);
    let reads = 0;
    const port = new Proxy(ts, {
      get(target, key) {
        if (key === "sim") return undefined;
        if (key === "serviceDiagnostics") return (id: number) => {
          reads++;
          return target.serviceDiagnostics(id);
        };
        return Reflect.get(target, key, target);
      },
    }) as unknown as EnginePort;
    const reader = new ViewReader(port, facilityFloors);
    const kit = createCardKit({ enginePort: port, reader });
    const count = (parts: ReturnType<typeof kit.diagnostics.unit>) =>
      renderToFragment(html`${parts}`).textContent ?? "";
    const first = count(kit.diagnostics.unit(fixture.shop.id, true));
    expect(first.split("Today's patronage:")).toHaveLength(2);
    expect(first.split("Very few customers.")).toHaveLength(2);
    const readsAfter = reads;
    for (let i = 0; i < 8; i++) {
      expect(count(kit.diagnostics.unit(fixture.shop.id))).toBe(first);
    }
    expect(reads).toBe(readsAfter);
    kit.diagnostics.invalidate();
    const refreshed = count(kit.diagnostics.unit(fixture.shop.id, true));
    expect(refreshed.split("Today's patronage:")).toHaveLength(2);
  });

  it("does not render service warnings for offices or construction-state service units", () => {
    const f = hostedFixture();
    const office = f.copy(f.office.id);
    expect(office).not.toContain("Ramp access:");
    expect(office).not.toContain("Counts toward stars:");
    f.housekeeping.state = "construction";
    expect(f.copy(f.housekeeping.id)).not.toContain("Fields 6 maids");
  });
});
