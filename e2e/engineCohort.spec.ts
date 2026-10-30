/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { WASM_PROJECT } from "./helpers";

/**
 * The staged cohort's stickiness (#1197) in a real browser, on the switchable
 * build. The tooling seam (`vc.cohortTooling`, compiled out of production)
 * sets the stage and the test seeds the bucket, so the policy runs as a
 * player's browser would: no `?engine=` and no stored choice. Covers the
 * cohort's own pick, a trap that reloads and a second one that keeps every
 * later boot on TypeScript until the player retries (its first boot offering
 * the crash report), a test link's tab held
 * after two traps, a TypeScript choice that survives a reload and a stage
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

test("the cohort puts a WASM-arm browser on the Rust engine with no URL or stored choice", async ({ page }) => {
  await seed(page, 1, 3);
  expect(await bootedEngine(page)).toBe("wasm");
  expect(await bootedEngine(page, true)).toBe("wasm");
});

/** Force a trap in a frame's step: the real step runs, then the call throws.
 *  The trap reloads the page (#1422); this waits for the boot after it. */
async function trapAndReload(page: Page): Promise<string> {
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
  await expect(page.locator("#boot-fallback-host")).toContainText("Reloading your tower", { timeout: 30_000 });
  await page.waitForEvent("load", { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  return page.evaluate(() => (window as any).__vcEngineBoot.engine as string);
}

test("a trap reloads on Rust, and a second keeps every later boot on TypeScript until the player retries", async ({ page }) => {
  await seed(page, 1, 3);
  expect(await bootedEngine(page)).toBe("wasm");
  // The first trap reloads onto Rust and latches nothing.
  expect(await trapAndReload(page)).toBe("wasm");
  expect(await page.evaluate(() => localStorage.getItem("vc.engineSafety"))).toBeNull();
  // The second reloads onto TypeScript and says why.
  expect(await trapAndReload(page)).toBe("ts");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vc.engineSafety")!))).toMatchObject({ reason: "trap-loop", stage: "crash-loop", scope: "fault" });
  // That boot offers the crash report once (#1422): a zip of both engines,
  // the fault and the save the TypeScript engine writes.
  const report = page.locator("#modal[open]");
  await expect(report).toContainText("The Rust engine crashed twice, so this game is running on the TypeScript engine for now.");
  const [download] = await Promise.all([page.waitForEvent("download"), report.locator('[data-act="download"]').click()]);
  expect(download.suggestedFilename()).toMatch(/^verticopolis-crash-report-.*\.zip$/);
  await expect(report.locator(".crash-status")).toContainText("Crash report ready.");
  await report.locator('[data-act="close"]').click();
  await expect(page.locator("#modal[open]")).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    expect(await bootedEngine(page, true)).toBe("ts");
    await expect(page.locator("#modal[open]")).toHaveCount(0);
  }
});

test("a trap during an autosave keeps the last good save, and both reloads load it", async ({ page }) => {
  await seed(page, 1, 3);
  expect(await bootedEngine(page)).toBe("wasm");
  // Run the tower a little, pause it, and save: the last good save.
  await page.evaluate(() => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    g.setSpeed(3);
  });
  await page.waitForFunction(() => (window as any).game.reader.header.minutes > 0, undefined, { timeout: 30_000 });
  const saved = await page.evaluate(() => {
    const g = (window as any).game;
    g.setSpeed(0);
    g.saveLoad.save(true);
    return { text: localStorage.getItem("verticopolis-save"), minutes: g.reader.header.minutes as number };
  });
  expect(saved.text).not.toBeNull();
  // The engine traps inside the autosave's serialize, and every later call
  // on it throws, as a poisoned wasm-bindgen object does.
  await page.evaluate(() => {
    const engine = (window as any).__vcEngine.port;
    const proto = Object.getPrototypeOf(engine);
    Object.defineProperty(engine, "serialize", {
      value: () => {
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (key === "constructor" || typeof Object.getOwnPropertyDescriptor(proto, key)?.value !== "function") continue;
          Object.defineProperty(engine, key, {
            value: () => {
              throw new Error("recursive use of an object detected which would lead to unsafe aliasing in rust");
            },
            configurable: true,
            writable: true,
          });
        }
        throw new WebAssembly.RuntimeError("unreachable");
      },
      configurable: true,
      writable: true,
    });
    void (window as any).game.saveLoad.autosave();
    // The next step hears the poisoned engine as the trap.
    (window as any).game.setSpeed(1);
  });
  await expect(page.locator("#boot-fallback-host")).toContainText("Reloading your tower", { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("verticopolis-save"))).toBe(saved.text);
  await page.waitForEvent("load", { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).__vcEngineBoot.engine as string)).toBe("wasm");
  await page.waitForFunction((m) => (window as any).game.reader.header.minutes === m, saved.minutes, { timeout: 10_000 });
  // The second trap runs a real step first, so the TypeScript engine shows
  // the save's time only if it loaded the save rather than the lost state.
  expect(await trapAndReload(page)).toBe("ts");
  await page.waitForFunction((m) => (window as any).game.reader.header.minutes === m, saved.minutes, { timeout: 10_000 });
  expect(await page.evaluate(() => localStorage.getItem("verticopolis-save"))).toBe(saved.text);
});

test("a test link's tab is held on TypeScript after two traps, and a new tab tries Rust again", async ({ page, context }) => {
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  expect(await trapAndReload(page)).toBe("wasm");
  expect(await trapAndReload(page)).toBe("ts");
  // A test visit leaves the player's own records alone.
  expect(await page.evaluate(() => localStorage.getItem("vc.engineSafety"))).toBeNull();
  const fresh = await context.newPage();
  await fresh.goto("/?engine=wasm");
  await fresh.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  expect(await fresh.evaluate(() => (window as any).__vcEngineBoot.engine as string)).toBe("wasm");
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
});
