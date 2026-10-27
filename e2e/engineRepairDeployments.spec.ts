/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { startDeployments, type Deployments } from "./deployments";
import { engineEntries, expectEngineIs, newContext } from "./engineDeployHelpers";
import { tamperCache } from "./engineCacheHelpers";
import { WASM_ONLY_PROJECT } from "./helpers";
import { expectControlledWithEngine, hostedGame, installWorker, lobbyAt } from "./offlineHelpers";

/**
 * Repair engine files next to a save, a lost connection and a second tab (#985,
 * design 6.2 spec 8). Repair writes only the running build's three engine keys
 * and never touches anything else, so a save stays, and another tab keeps
 * keeps its own engine until it reloads. A stop screen with a build waiting does not
 * wait for Repair: it takes the build at once. It runs on the two-deployment
 * server (deployments.ts), on the wasm-only build, where the stop screen with
 * the Repair action exists.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_ONLY_PROJECT, "the stop screen exists on the wasm-only build"));
test.setTimeout(240_000);

let deployments: Deployments;

test.beforeAll(async () => {
  if (test.info().project.name !== WASM_ONLY_PROJECT) return;
  test.setTimeout(300_000);
  deployments = await startDeployments();
});
test.afterAll(async () => {
  await deployments?.close();
});
test.afterEach(() => {
  deployments?.serve("A");
  deployments?.engineFrom(null);
  deployments?.failNetwork(null);
});

const repairButton = (page: Page) => page.locator('#engine-failure [data-act="repair-engine"]');
const status = (page: Page) => page.locator("#engine-failure .engine-failure-repair-status");
const refused = (page: Page) => page.waitForFunction(() => (window as any).__vcEngineBoot?.failure?.reason === "package-mismatch", undefined, { timeout: 60_000 });
const slotStored = (page: Page) => page.evaluate(() => localStorage.getItem("simtower-clone-slot-1") !== null);
const bootFailure = (page: Page) => page.evaluate(() => (window as any).__vcEngineBoot?.failure ?? null);

/** The first build installed and controlling this page, on the engine. */
async function installedFirst(page: Page): Promise<void> {
  deployments.serve("A");
  deployments.engineFrom(null);
  deployments.failNetwork(null);
  await installWorker(page);
  await page.reload();
  await expectControlledWithEngine(page);
  await hostedGame(page);
  await expectEngineIs(deployments, page, "A");
}

test("a repair leaves a save that was made online, and the repaired engine loads it", async ({ browser }) => {
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    const built = await page.evaluate(() => {
      const g = (window as any).game;
      g.sim.money = 1e9;
      const ok = g.sim.build("lobby", 1, 160).ok;
      (window as any).__vcEngine.current().syncStructure();
      g.saveToSlot(1);
      return ok;
    });
    expect(built, "the lobby was built before the save").toBe(true);
    expect(await slotStored(page), "slot 1 holds the save before the damage").toBe(true);

    await tamperCache(page, "wasm", "salt");
    await page.reload();
    await refused(page);
    await repairButton(page).click();
    await expect(status(page)).toHaveText("Engine files repaired. Press Reload to try again.");
    await page.reload();
    await hostedGame(page);
    await expectEngineIs(deployments, page, "A");
    // The save sits in its slot, not in the page: a new game has no lobby yet,
    // so an autosave of the old tower cannot stand in for the slot.
    expect(await slotStored(page), "slot 1 still holds the save after the repair").toBe(true);
    expect(await lobbyAt(page, 160), "the booted game does not already hold the lobby").toBe(false);

    const loaded = await page.evaluate(() => {
      (window as any).game.loadFromSlot(1);
      return (JSON.parse((window as any).__vcEngine.current().engine.serialize()).units as { kind: string; x: number }[]).some((u) => u.kind === "lobby" && u.x === 160);
    });
    expect(loaded, "the save made before the repair loads on the repaired engine").toBe(true);
    expect(await lobbyAt(page, 160)).toBe(true);
  } finally {
    await context.close();
  }
});

test("with the engine network cut at the server, a repair changes nothing and the next repair works", async ({ browser }) => {
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    await tamperCache(page, "wasm", "salt");
    const damaged = await engineEntries(page);
    await page.reload();
    await refused(page);
    const before = deployments.requests.length;
    deployments.failNetwork("engine");
    await repairButton(page).click();
    await expect(status(page)).toContainText(/Could not download the engine files\. Nothing was changed/);
    expect(await engineEntries(page), "nothing was written").toEqual(damaged);
    const asked = deployments.requests.slice(before).filter((r) => r.path.startsWith("/engine/"));
    expect(
      asked.some((r) => r.path.endsWith(".wasm") || r.path.endsWith("BUILD.json")),
      "Repair stopped at the first failed file",
    ).toBe(false);
    await expect(repairButton(page)).toBeEnabled();

    deployments.failNetwork(null);
    await repairButton(page).click();
    await expect(status(page)).toHaveText("Engine files repaired. Press Reload to try again.");
    await expectEngineIs(deployments, page, "A");
  } finally {
    await context.close();
  }
});

test("a stop screen takes a waiting build at once, and the damaged entry leaves with the old keys", async ({ browser }) => {
  // A page stopped on a damaged engine has no tower to save, so it activates a
  // waiting build as soon as one is there (bootstrap.ts, registerPWA with an
  // activate-at-once handler). That is the way out of a package no Repair can
  // fix, so Repair never meets a waiting build on a stop screen.
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    const other = await context.newPage();
    await other.goto("/");
    await hostedGame(other);

    await tamperCache(page, "wasm", "salt");
    await page.reload();
    await refused(page);
    await expect(repairButton(page), "the stop screen offers Repair while no build waits").toBeVisible();

    await test.step("the second build is deployed and the stopped page moves onto it by itself", async () => {
      deployments.serve("B");
      const reloaded = page.waitForEvent("load", { timeout: 90_000 });
      await other.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });
      await reloaded;
      await hostedGame(page);
      expect(await bootFailure(page), "the page runs the second build's engine").toBeNull();
      await expectEngineIs(deployments, page, "B");
    });

    await test.step("the other tab, reloaded after the switch, lands on the second build's consistent set", async () => {
      await other.reload();
      await hostedGame(other);
      expect(await bootFailure(other)).toBeNull();
      await expectEngineIs(deployments, other, "B");
    });

    await test.step("a cold start with no network runs the second build's engine", async () => {
      deployments.failNetwork("all");
      await page.reload();
      await hostedGame(page);
      expect(await bootFailure(page), "no fallback on the offline start").toBeNull();
      const record = await page.evaluate(async () => (await (await fetch("/engine/BUILD.json", { cache: "no-store" })).json()).package as string);
      expect(record).toBe(deployments.packageId.B);
      await expectEngineIs(deployments, page, "B");
    });
  } finally {
    await context.close();
  }
});
