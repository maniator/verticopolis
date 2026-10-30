/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page, type Route } from "@playwright/test";
import { WASM_PROJECT } from "./helpers";

/**
 * The engine-test rows in a real browser (the analytics packet, rev 5,
 * section 6). The preview server is on localhost, where nothing is sent, so a
 * tooling build hands the page every event as the adapter would receive it
 * (`captureForTooling` in src/analyticsCore.ts).
 *
 * - An aborted package load still leaves its `attempt` row (#1461): the row
 *   goes out before the load, so a tab closed mid-load is counted.
 * - One scripted session engages: a refused command and a paused clock never
 *   engage, the first accepted command does, once, after `attempt` and
 *   `settle`.
 */

type Row = { trigger: string; engine: string; fallback_reason: string; engaged_by?: string; page_life: string };

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__vcEvents = [];
  });
});

/** The page's `engine_status` rows so far, in order. */
const statusRows = (page: Page): Promise<Row[]> =>
  page.evaluate(() => ((window as any).__vcEvents as { name: string; props: Row }[]).filter((e) => e.name === "engine_status").map((e) => e.props));

test("a package load that never finishes has already sent its attempt row", async ({ page }, info) => {
  test.skip(info.project.name !== WASM_PROJECT, "needs a boot that asks for the Rust engine");
  // The package's requests are held, never answered, as on a tab closed mid-load.
  const held: Route[] = [];
  let release = false;
  await page.route(/\/engine\//, (route) => (release ? route.abort() : void held.push(route)));
  await page.goto("/");
  await expect.poll(() => held.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await statusRows(page)).map((r) => r.trigger), { timeout: 10_000 }).toEqual(["attempt"]);
  const [attempt] = await statusRows(page);
  expect(attempt).toMatchObject({ trigger: "attempt", engine: "wasm", fallback_reason: "none" });
  // Still only the attempt while the load waits.
  await page.waitForTimeout(1_000);
  expect((await statusRows(page)).map((r) => r.trigger)).toEqual(["attempt"]);

  // Letting the load fail settles the same page life on TypeScript.
  release = true;
  for (const route of held.splice(0)) await route.abort();
  await expect.poll(async () => (await statusRows(page)).map((r) => r.trigger), { timeout: 30_000 }).toEqual(["attempt", "settle"]);
  const [, settle] = await statusRows(page);
  expect(settle.engine).toBe("ts-fallback");
  expect(settle.fallback_reason).not.toBe("none");
  expect(settle.page_life).toBe(attempt.page_life);
});

test("a session engages on its first accepted command, after attempt and settle", async ({ page }, info) => {
  test.skip(info.project.name !== WASM_PROJECT, "the switchable project");
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game?.enginePort, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.setSpeed(0);
  });
  const triggers = async () => (await statusRows(page)).map((r) => r.trigger);
  await expect.poll(triggers).toEqual(["attempt", "settle"]);

  // A refused command and a few paused seconds do not engage.
  const refused = await page.evaluate(() => {
    const g = (window as any).game;
    return g.enginePort.buildAt(g.portCodes.kind("office"), 2, -50)[0] as number;
  });
  expect(refused, "the off-map office is refused").toBe(0);
  await page.waitForTimeout(3_000);
  expect(await triggers()).toEqual(["attempt", "settle"]);

  // The first accepted command engages; a second sends nothing more.
  const accepted = await page.evaluate(() => {
    const g = (window as any).game;
    const lobby = g.portCodes.kind("lobby");
    return [g.enginePort.buildAt(lobby, 1, 160)[0], g.enginePort.buildAt(lobby, 1, 161)[0]] as number[];
  });
  expect(accepted, "both lobby tiles are built").toEqual([1, 1]);
  await expect.poll(triggers).toEqual(["attempt", "settle", "engaged"]);
  const rows = await statusRows(page);
  expect(rows.map((r) => r.engine)).toEqual(["wasm", "wasm", "wasm"]);
  expect(rows[2]!.engaged_by).toBe("command");
  expect(new Set(rows.map((r) => r.page_life)).size).toBe(1);
});
