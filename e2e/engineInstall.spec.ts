/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startDeployments, type Deployment, type Deployments } from "./deployments";
import { onWasm } from "./helpers";
import { engineEntries, engineEntriesOf as entriesOf, expectEngineIs as expectIs, newContext as makeContext, short } from "./engineDeployHelpers";
import { expectControlledWithEngine, hostedGame, installWorker } from "./offlineHelpers";

/**
 * A deploy that lands while a worker is installing (#985, design section 6.2
 * spec 4). The worker script and the engine files are separate requests, so a
 * deploy can answer the first from one build and the second from another. The
 * engine entries carry the integrity of the build their worker was built with,
 * so the install fetch refuses the other build's bytes: the install fails, the
 * worker never waits or activates, and no engine key holds bytes from a build
 * other than the one that named it.
 *
 * Two cases on the two-deployment server (deployments.ts): an update whose
 * engine files come from the build that is already installed, and a first
 * install whose engine files come from the other build. They run on the
 * production build on the chromium-wasm projects.
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine runs on the chromium-wasm and chromium-wasm-only projects"));
test.setTimeout(240_000);

let deployments: Deployments;

// The second deployment is a full `vite build`, with a budget of its own.
test.beforeAll(async () => {
  if (!onWasm(test.info().project.name)) return;
  test.setTimeout(300_000);
  deployments = await startDeployments();
});
test.afterAll(async () => {
  await deployments?.close();
});

const newContext = (browser: Browser): Promise<BrowserContext> => makeContext(browser, deployments);
const engineEntriesOf = (which: Deployment): Record<string, string> => entriesOf(deployments, which);
const expectEngineIs = (page: Page, which: Deployment): Promise<void> => expectIs(deployments, page, which);

test("an update whose engine files come from another build fails to install and leaves the installed engine alone", async ({ browser }) => {
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    deployments.serve("A");
    deployments.engineFrom(null);
    await installWorker(page);
    await page.reload();
    await expectControlledWithEngine(page);
    await hostedGame(page);
    await expectEngineIs(page, "A");

    await test.step("the new worker is refused when its engine files are the installed build's", async () => {
      // The deploy has put the second build's worker script up while the engine
      // files still answer from the first, as they do when the files reach the
      // edge after the script: the second worker's manifest cannot be satisfied.
      const before = deployments.requests.length;
      deployments.serve("B");
      deployments.engineFrom("A");
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update().catch(() => undefined);
      });
      // The install did try the engine files, and they came from the first build.
      await expect
        .poll(() => deployments.requests.slice(before).some((r) => r.path.startsWith("/engine/") && r.from === "A"), { message: "the install asked for the engine files", timeout: 90_000 })
        .toBe(true);
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const registration = await navigator.serviceWorker.getRegistration();
              return { installing: !!registration?.installing, waiting: !!registration?.waiting, active: !!registration?.active };
            }),
          { message: "the failed install leaves nothing installing or waiting and the first worker active", timeout: 90_000 },
        )
        .toEqual({ installing: false, waiting: false, active: true });
      await expect(page.locator('[data-act="update"]'), "no update is offered for a worker that never installed").toHaveCount(0);
    });

    await test.step("the installed set still serves, and no key holds the other build's bytes", async () => {
      await expectEngineIs(page, "A");
      await page.reload();
      await expectControlledWithEngine(page);
      await hostedGame(page);
      expect(await page.evaluate(() => (window as any).__vcEngineBoot?.failure ?? null), "the first build still boots its engine").toBeNull();
    });

    await test.step("once the engine files match the worker script, the update installs and is offered", async () => {
      deployments.engineFrom(null);
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });
      const update = page.locator('[data-act="update"]');
      await update.waitFor({ state: "visible", timeout: 90_000 });
      await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), update.click()]);
      await hostedGame(page);
      await expectEngineIs(page, "B");
    });
  } finally {
    deployments.serve("A");
    deployments.engineFrom(null);
    await context.close();
  }
});

test("a first install whose engine files come from another build never activates, and the page refuses those bytes", async ({ browser }) => {
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    deployments.serve("A");
    deployments.engineFrom("B");
    // The page registers its worker after it boots, so the install is observed
    // from the browser's side: a worker that starts is the install attempt.
    const started = context.waitForEvent("serviceworker", { timeout: 90_000 });
    await page.goto("/");
    await started;
    // A failed first install leaves no registration with a worker in it.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return !registration || (!registration.installing && !registration.waiting && !registration.active);
          }),
        { message: "the worker never installed", timeout: 90_000 },
      )
      .toBe(true);
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller), "nothing controls the page").toBe(false);

    // Whatever the failed install managed to store (entries fetched before the
    // failure stay), no engine key holds the other build's bytes.
    const held = await engineEntries(page);
    const mine = engineEntriesOf("A");
    for (const [key, digest] of Object.entries(held)) expect(digest, `${key} holds only the first build's bytes`).toBe(mine[key]);

    // The page loaded the second build's glue and binary from the network; its own check refuses them.
    await page.waitForFunction(() => (window as any).__vcEngineBoot?.failure != null, undefined, { timeout: 90_000 });
    const failure = await page.evaluate(() => (window as any).__vcEngineBoot.failure as { stage: string; reason: string; package?: { kind: string } });
    expect(failure).toMatchObject({
      stage: "load",
      reason: "package-mismatch",
      package: { kind: "mismatch", expectedPackage: short(deployments.packageId.A), controlled: false },
    });

    await test.step("once the deployment settles, a revisit installs, takes control and plays offline on the first build", async () => {
      deployments.engineFrom(null);
      await page.close();
      const revisit = await context.newPage();
      await installWorker(revisit);
      await revisit.reload();
      await expectControlledWithEngine(revisit);
      await hostedGame(revisit);
      await expectEngineIs(revisit, "A");
      await context.setOffline(true);
      await revisit.reload();
      await expectControlledWithEngine(revisit);
      await hostedGame(revisit);
      expect(await revisit.evaluate(() => (window as any).__vcEngineBoot?.failure ?? null), "no fallback on the offline start").toBeNull();
      await context.setOffline(false);
    });
  } finally {
    deployments.serve("A");
    deployments.engineFrom(null);
    await context.close();
  }
});
