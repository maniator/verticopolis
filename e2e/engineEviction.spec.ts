/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { startDeployments, type Deployments } from "./deployments";
import { engineEntries, engineEntriesOf, expectEngineIs, newContext } from "./engineDeployHelpers";
import { onWasm } from "./helpers";
import { expectControlledWithEngine, hostedGame, installWorker } from "./offlineHelpers";

/**
 * A browser can drop cache entries whenever it is short of space (#985, design
 * section 6.2 spec 7, risk R6). The engine files then have to come back from
 * the network with the integrity the worker was built with, under the same
 * keys, and never as another build's bytes. A missing file with no network is
 * the section 5.4 case: the load fails with its own reason and the next online
 * reload refills the key.
 *
 * The two-deployment server (deployments.ts) cuts the connection for the
 * worker's own requests too, which Playwright's offline flag does not.
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine runs on the chromium-wasm and chromium-wasm-only projects"));
test.setTimeout(240_000);

let deployments: Deployments;

test.beforeAll(async () => {
  if (!onWasm(test.info().project.name)) return;
  test.setTimeout(300_000);
  deployments = await startDeployments();
});
test.afterAll(async () => {
  await deployments?.close();
});

const FILES = { glue: "engine/verticopolis_engine.js", wasm: "engine/verticopolis_engine_bg.wasm", record: "engine/BUILD.json" } as const;
type Which = keyof typeof FILES;

/** Drop one engine entry from the precache, as the browser does under storage pressure. */
async function evict(page: Page, which: Which): Promise<void> {
  const removed = await page.evaluate(async (path) => {
    let count = 0;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname === `/${path}` && (await cache.delete(request))) count++;
      }
    }
    return count;
  }, FILES[which]);
  expect(removed, `${FILES[which]} was in the precache`).toBe(1);
}

/** The first build installed and controlling, on the engine. */
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

const bootFailure = (page: Page) =>
  page.evaluate(() => (window as any).__vcEngineBoot?.failure as { stage: string; reason: string; package?: { kind: string; controlled: boolean } } | null | undefined);

test.afterEach(() => {
  deployments?.serve("A");
  deployments?.engineFrom(null);
  deployments?.failNetwork(null);
});

test("an evicted engine file is fetched again with its integrity and stored under its own key", async ({ browser }) => {
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    for (const which of ["glue", "wasm", "record"] as const) {
      await test.step(`the ${which} entry`, async () => {
        await evict(page, which);
        const before = deployments.requests.length;
        await page.reload();
        await hostedGame(page);
        expect(
          deployments.requests.slice(before).some((r) => r.path === `/${FILES[which]}`),
          `the missing ${FILES[which]} was fetched from the server`,
        ).toBe(true);
        await expectEngineIs(deployments, page, "A");
        expect(await bootFailure(page), "the engine runs without a fallback").toBeNull();
      });
    }
  } finally {
    await context.close();
  }
});

test("an evicted binary with no network fails to load with its own reason, and the next online reload fills the key", async ({ browser }) => {
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    await evict(page, "wasm");
    deployments.failNetwork("engine");
    const before = deployments.requests.length;
    await page.reload();
    await page.waitForFunction(() => (window as any).__vcEngineBoot?.failure != null, undefined, { timeout: 60_000 });
    expect(await bootFailure(page)).toMatchObject({ stage: "load", package: { kind: "load-failed", controlled: true } });
    expect(deployments.requests.slice(before).some((r) => r.path === `/${FILES.wasm}`), "the worker tried the network for the missing binary").toBe(true);
    expect(Object.keys(await engineEntries(page)).filter((k) => k.includes("_bg.wasm")), "nothing was stored for the missing binary").toEqual([]);

    deployments.failNetwork(null);
    await page.reload();
    await hostedGame(page);
    await expectEngineIs(deployments, page, "A");
    expect(await bootFailure(page)).toBeNull();
  } finally {
    await context.close();
  }
});

test("an evicted binary is never refilled with another build's bytes while the first build's worker controls the page", async ({ browser }) => {
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    await evict(page, "wasm");
    // The deploy has reached the engine files but not this page's worker.
    deployments.engineFrom("B");
    const before = deployments.requests.length;
    await page.reload();
    await page.waitForFunction(() => (window as any).__vcEngineBoot?.failure != null, undefined, { timeout: 60_000 });
    expect(await bootFailure(page), "the first build's worker refuses the other build's binary").toMatchObject({ stage: "load", package: { kind: "load-failed" } });
    expect(
      deployments.requests.slice(before).some((r) => r.path === `/${FILES.wasm}` && r.from === "B"),
      "the other build's binary reached the worker, which refused it",
    ).toBe(true);
    const held = await engineEntries(page);
    const mine = engineEntriesOf(deployments, "A");
    for (const [key, digest] of Object.entries(held)) expect(digest, `${key} holds only the first build's bytes`).toBe(mine[key]);
    expect(Object.keys(held).filter((k) => k.includes("_bg.wasm"))).toEqual([]);

    deployments.engineFrom(null);
    await page.reload();
    await hostedGame(page);
    await expectEngineIs(deployments, page, "A");
  } finally {
    await context.close();
  }
});

test("with the whole precache gone and no network the page does not load, and an online visit recovers", async ({ browser }) => {
  const context = await newContext(browser, deployments);
  try {
    const page = await context.newPage();
    await installedFirst(page);
    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name);
    });
    deployments.failNetwork("all");
    const outcome = await page.reload({ timeout: 30_000 }).then(
      (response) => `loaded ${response?.status()}`,
      (error: Error) => error.message.split("\n")[0],
    );
    expect(outcome, "the browser's unavailable-page outcome").toMatch(/^page\.reload: net::ERR_/);

    deployments.failNetwork(null);
    await page.close();
    const revisit = await context.newPage();
    await revisit.goto("/");
    await hostedGame(revisit);
    expect(await bootFailure(revisit)).toBeNull();
    await expectEngineIs(deployments, revisit, "A");
  } finally {
    await context.close();
  }
});
