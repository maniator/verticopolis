/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { Simulation } from "../src/engine/Simulation";
import { serviceDiagnosticsFixture, retailServiceFixture, setFixtureHotelState } from "../src/tests/fixtures/serviceDiagnostics.fixture";
import { expectEngineHosted } from "./helpers";

/**
 * Browser-level smoke test for the actual WASM-hosted inspector. The same
 * asserted deterministic fixture also drives Rust/TS differential tests.
 * No simulation logic or mocked diagnostics are used inside the browser.
 */
test.describe("Rust service diagnostics in the real browser", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const w = window as any;
      return Boolean(w.__vcEngine?.status?.hosted && w.game);
    }, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      document.getElementById("splash")?.remove();
      (window as any).game.setSpeed(0);
    });
  });
  test.afterEach(async ({ page }) => expectEngineHosted(page));

  /** Restore the same fixture used in native/WASM integration tests using the
   * app's real engine swap path, so the reader, card cache and panels refresh. */
  async function loadFixture(page: Page, save: string): Promise<void> {
    const status = await page.evaluate((json) => {
      const g = (window as any).game;
      const answer = g.enginePort.restore(json);
      if (answer[0] !== 1) throw new Error(`Rust rejected service fixture: ${g.enginePort.lastReason()}`);
      g.followSwap();
      g.setSpeed(0);
      return {
        wasm: g.enginePort === (window as any).__vcEngine.port,
        hasStructuredPort: typeof g.enginePort.serviceDiagnostics === "function",
      };
    }, save);
    expect(status).toEqual({ wasm: true, hasStructuredPort: true });
  }

  function buildUtilizedPassengerLiftFixture(): { save: string; id: number; kind: "elevatorStandard" } {
    const sim = Simulation.newGame(11, "modern");
    sim.money = 1e9;
    sim.star = 5;
    sim.clock.minutes = 7 * 60;
    for (let x = 150; x < 240; x++) {
      expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
      for (let floor = 2; floor <= 16; floor++) {
        expect(sim.tower.place("floor", floor, x).ok).toBe(true);
      }
    }
    const shaft = sim.tower.placeTransport("elevatorStandard", 165, 1, 16);
    if (!shaft.ok || shaft.transportId === undefined) throw new Error("fixture failed to build the passenger shaft");
    expect(sim.tower.setCars(shaft.transportId, 1)).toBe(true);
    for (let floor = 2; floor <= 16; floor++) {
      for (let x = 150; x < 240; x += 9) {
        const room = sim.tower.place("office", floor, x);
        if (!room.ok || room.unitId === undefined) throw new Error(`fixture failed to build office at ${floor}/${x}`);
        const unit = sim.tower.getUnit(room.unitId);
        if (!unit) throw new Error(`fixture lost office at ${floor}/${x}`);
        unit.state = "occupied";
      }
    }
    return { save: JSON.stringify(sim.serialize()), id: shaft.transportId, kind: "elevatorStandard" };
  }

  test("desktop inspector and the mobile editor show the real Rust passenger-elevator load warning", async ({ page }) => {
    const fixture = buildUtilizedPassengerLiftFixture();
    await loadFixture(page, fixture.save);
    const readout = await page.evaluate(({ id }) => {
      const g = (window as any).game;
      const slots = JSON.parse(g.enginePort.viewLayout()).records.shaftCard;
      const index = slots.indexOf("utilization");
      if (index < 0) {
        throw new Error(`Rust shaft-card layout missing 'utilization' slot: ${JSON.stringify(slots)}`);
      }
      const shaft = g.sim.tower.getTransport(id);
      if (!shaft) throw new Error("fixture did not restore the passenger shaft");
      let util = Number.NaN;
      let peak = Number.NEGATIVE_INFINITY;
      let crossedAtHour = -1;
      for (let hour = 1; hour <= 120; hour++) {
        g.enginePort.tick(60);
        g.reader.update();
        // The port contract returns a Float64Array. Read only the named slot,
        // without copying the (potentially large) shaft-card record.
        const card = g.enginePort.shaftCard(id) as Float64Array | undefined;
        if (!card || index >= card.length || !Number.isFinite(card[index])) {
          throw new Error(
            `Rust shaft-card payload has invalid utilization for shaft ${id}: index=${index}, length=${card?.length ?? "missing"}`,
          );
        }
        util = card[index];
        if (Number.isFinite(util)) peak = Math.max(peak, util);
        if (Number.isFinite(util) && util > 0.85) {
          crossedAtHour = hour;
          break;
        }
      }
      if (crossedAtHour < 0) throw new Error(`Rust runtime never crossed 85% utilization (peak=${peak})`);
      return { util, pct: Number.isFinite(util) ? Math.round(util * 100) : NaN, crossedAtHour };
    }, { id: fixture.id });
    expect(readout.util).toBeGreaterThan(0.85);
    await page.evaluate(({ id, kind }) => {
      (window as any).game.inspector.inspectPicked({ type: "transport", id, kind });
    }, { id: fixture.id, kind: fixture.kind });
    await expect(page.locator("#inspector")).toContainText(`Avg load: ${readout.pct}% full`);
    await expect(page.locator("#inspector")).toContainText("Near capacity; consider more cars or a parallel shaft.");

    await page.setViewportSize({ width: 390, height: 700 });
    await page.evaluate(({ id, kind }) => {
      (window as any).game.selectPicked({ type: "transport", id, kind });
    }, { id: fixture.id, kind: fixture.kind });
    await expect(page.locator("#editor .ed-diagnostics")).toContainText(`Avg load: ${readout.pct}% full`);
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Near capacity; consider more cars or a parallel shaft.");
  });

  test("desktop inspector renders Rust hotel and connected/disconnected garage verdicts", async ({ page }) => {
    const f = serviceDiagnosticsFixture("modern");
    f.sim.star = 4;
    setFixtureHotelState(f, "dirty");
    await loadFixture(page, JSON.stringify(f.sim.serialize()));

    await page.evaluate(({ id, kind }) => {
      (window as any).game.inspector.inspectPicked({ type: "unit", id, kind });
    }, { id: f.hotel.id, kind: f.hotel.kind });
    await expect(page.locator("#inspector")).toContainText("Counts toward stars: no");
    await expect(page.locator("#inspector")).toContainText("Left dirty for 3 days");

    await page.evaluate(({ id, kind }) => {
      (window as any).game.inspector.inspectPicked({ type: "unit", id, kind });
    }, { id: f.connectedParking.id, kind: f.connectedParking.kind });
    await expect(page.locator("#inspector")).toContainText("Ramp access: connected");
    await expect(page.locator("#inspector")).toContainText("Parking demand:");

    await page.evaluate(({ id, kind }) => {
      (window as any).game.inspector.inspectPicked({ type: "unit", id, kind });
    }, { id: f.disconnectedParking.id, kind: f.disconnectedParking.kind });
    await expect(page.locator("#inspector")).toContainText("Ramp access: none");
    await expect(page.locator("#inspector")).not.toContainText("Parking demand:");
  });

  test("real Rust retail copy appears on desktop and the mobile editor", async ({ page }) => {
    const f = retailServiceFixture("modern");
    await loadFixture(page, JSON.stringify(f.sim.serialize()));
    await page.evaluate(({ id, kind }) => {
      (window as any).game.inspector.inspectPicked({ type: "unit", id, kind });
    }, { id: f.shop.id, kind: f.shop.kind });
    await expect(page.locator("#inspector")).toContainText("Today's patronage: 40 customers");
    await expect(page.locator("#inspector")).toContainText("Very few customers.");
    await expect(page.locator("#inspector")).toContainText("Yesterday's profit: $200.");
    await expect(page.locator("#inspector")).toContainText("more retail than its shoppers fill");

    await page.setViewportSize({ width: 390, height: 700 });
    await page.evaluate(({ id, kind }) => {
      (window as any).game.selectPicked({ type: "unit", id, kind });
    }, { id: f.restaurant.id, kind: f.restaurant.kind });
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Business is booming.");
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Yesterday's profit: $4,800.");
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Local demand:");
  });

  test("mobile editor folds in Rust housekeeping and infested-hotel warnings", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    const f = serviceDiagnosticsFixture("modern");
    await loadFixture(page, JSON.stringify(f.sim.serialize()));
    await page.evaluate(({ id, kind }) => {
      (window as any).game.selectPicked({ type: "unit", id, kind });
    }, { id: f.housekeeping.id, kind: f.housekeeping.kind });
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Fields 6 maids");
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("hotel room(s)");

    setFixtureHotelState(f, "infested");
    await loadFixture(page, JSON.stringify(f.sim.serialize()));
    await page.evaluate(({ id, kind }) => {
      (window as any).game.selectPicked({ type: "unit", id, kind });
    }, { id: f.hotel.id, kind: f.hotel.kind });
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Cockroach infested");
    await expect(page.locator("#editor .ed-diagnostics")).toContainText("Call an exterminator");
  });
});
