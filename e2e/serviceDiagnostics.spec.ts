/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { serviceDiagnosticsFixture, setFixtureHotelState } from "../src/tests/fixtures/serviceDiagnostics.fixture";
import { onWasm, expectEngineHosted } from "./helpers";

/**
 * Browser-level smoke test for the actual WASM-hosted inspector. The same
 * asserted deterministic fixture also drives Rust/TS differential tests.
 * No simulation logic or mocked diagnostics are used inside the browser.
 */
test.describe("Rust service diagnostics in the real browser", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!onWasm(info.project.name), "the inspector must run on the actual Rust WASM engine");
    await page.goto("/?engine=wasm");
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
    await expect(page.locator("#inspector")).toContainText("Demand:");

    await page.evaluate(({ id, kind }) => {
      (window as any).game.inspector.inspectPicked({ type: "unit", id, kind });
    }, { id: f.disconnectedParking.id, kind: f.disconnectedParking.kind });
    await expect(page.locator("#inspector")).toContainText("Ramp access: none");
    await expect(page.locator("#inspector")).not.toContainText("Demand:");
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
