/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_PROJECT } from "./helpers";

/**
 * The staged cohort's stickiness (#1197) in a real browser, on the switchable
 * build. The tooling seam (`vc.cohortTooling`, compiled out of production)
 * sets the stage and the test seeds the bucket, so the policy runs as a
 * player's browser would: no `?engine=` and no stored choice. Covers the
 * cohort's own pick, a fault that keeps every later boot on TypeScript until
 * the player retries, a TypeScript choice that survives a reload and a stage
 * change that enrolls the browser, and a crash loop.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== WASM_PROJECT, "needs the engine package of the switchable build"));
test.setTimeout(90_000);
// No stored engine choice: the project's `vc.engine` seed would be a Settings choice.
test.use({ storageState: { cookies: [], origins: [] } });

/** Seed the stage and the bucket once, before the first boot reads them. */
async function seed(page: Page, stage: number, bucket: number): Promise<void> {
  await page.addInitScript(
    ([s, b]) => {
      if (localStorage.getItem("vc.cohortTooling") !== null) return;
      localStorage.setItem("vc.cohortTooling", JSON.stringify({ stage: s }));
      localStorage.setItem("vc.engineCohort", JSON.stringify({ v: 1, bucket: b }));
    },
    [stage, bucket],
  );
}

/** Load the page and wait for the game, returning the engine boot settled on. */
async function bootedEngine(page: Page, reload = false): Promise<string> {
  if (reload) await page.reload();
  else await page.goto("/");
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  return page.evaluate(() => (window as any).__vcEngineBoot.engine as string);
}

async function settingsStatus(page: Page): Promise<string> {
  await page.evaluate(() => (window as any).game.ui.showSettings());
  const status = page.locator("#set-engine-status");
  await expect(status).toBeVisible();
  return (await status.textContent())!.replace(/\s+/g, " ").trim();
}

test("the cohort puts a WASM-arm browser on the Rust engine with no URL or stored choice", async ({ page }) => {
  await seed(page, 1, 3);
  expect(await bootedEngine(page)).toBe("wasm");
  expect(await bootedEngine(page, true)).toBe("wasm");
  expect(await settingsStatus(page)).toContain("Running now: Rust engine");
});

test("a fault keeps every later boot on TypeScript until the player retries", async ({ page }) => {
  await seed(page, 1, 3);
  expect(await bootedEngine(page)).toBe("wasm");
  // Force a trap in a frame's step: the real step runs, then the call throws.
  await page.evaluate(() => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    const engine = (window as any).__vcEngine.port;
    const real = engine.advance.bind(engine);
    engine.advance = (...args: unknown[]) => {
      real(...args);
      throw new WebAssembly.RuntimeError("unreachable");
    };
    g.setSpeed(1);
  });
  // The trap stops the game (no fallback until PR 6).
  await page.waitForFunction(() => !!document.getElementById("engine-failure"), undefined, { timeout: 30_000 });
  for (let i = 0; i < 2; i++) expect(await bootedEngine(page, true)).toBe("ts");
  expect(await settingsStatus(page)).toContain("The Rust engine had a problem on this device earlier");
  await page.locator("[data-engine-retry]").click();
  expect(await settingsStatus(page)).toContain("Restart the game to switch engines.");
  expect(await bootedEngine(page, true)).toBe("wasm");
});

test("a TypeScript choice in Settings survives a reload and a stage change that enrolls the browser", async ({ page }) => {
  // Bucket 15 is on the TypeScript arm at stage 1 (10%) and the WASM arm at stage 2 (25%).
  await seed(page, 1, 15);
  expect(await bootedEngine(page)).toBe("ts");
  await settingsStatus(page);
  await page.locator('input[name="set-engine"][value="typescript"]').check();
  expect(await page.evaluate(() => localStorage.getItem("vc.engine"))).toBe("ts");
  expect(await bootedEngine(page, true)).toBe("ts");
  await page.evaluate(() => localStorage.setItem("vc.cohortTooling", JSON.stringify({ stage: 2 })));
  expect(await bootedEngine(page, true)).toBe("ts");
  expect(await page.evaluate(() => localStorage.getItem("vc.engine"))).toBe("ts");
  // Control: back on Automatic, the same stage puts this browser on Rust.
  await settingsStatus(page);
  await page.locator('input[name="set-engine"][value="auto"]').check();
  await expect(page.locator("#set-engine-status")).toContainText("Restart the game to switch engines.");
  expect(await bootedEngine(page, true)).toBe("wasm");
});

test("two page lives that died while visible latch a crash loop", async ({ page }) => {
  await seed(page, 1, 3);
  expect(await bootedEngine(page)).toBe("wasm");
  // Two entries for this build whose heartbeats went stale, as tabs killed
  // while visible leave them. Written as the next page starts, since this
  // page's clean exit would clear stale entries on the way out.
  const sha = await page.evaluate(() => JSON.parse(localStorage.getItem("vc.engineBoot")!).entries[0].sha as string);
  await page.addInitScript((buildSha) => {
    if (sessionStorage.getItem("deadEntries")) return;
    sessionStorage.setItem("deadEntries", "1");
    const stale = Date.now() - 120_000;
    localStorage.setItem("vc.engineBoot", JSON.stringify({ v: 1, entries: [{ id: "dead1", sha: buildSha, beat: stale }, { id: "dead2", sha: buildSha, beat: stale }] }));
  }, sha);
  expect(await bootedEngine(page, true)).toBe("ts");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vc.engineSafety")!))).toMatchObject({ reason: "unclean-exit", scope: "fault" });
  expect(await settingsStatus(page)).toContain("the game closed unexpectedly while using it");
});
