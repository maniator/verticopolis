/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page, type Route } from "@playwright/test";
import { WASM_ONLY_PROJECT } from "./helpers";

/**
 * The engine's identity in Help's About (#963), in a real browser: the
 * engine's own record, the source hash stamped into its binary next to the
 * one the page was built for, and Copy diagnostics, including when the engine
 * never loaded. A wasm-only build stops on a failed load instead of falling
 * back, so these run on the switchable projects.
 */
test.beforeEach(({}, info) => test.skip(info.project.name === WASM_ONLY_PROJECT, "needs the TypeScript engine to fall back to"));
test.setTimeout(60_000);

const WASM = "**/engine/verticopolis_engine_bg.wasm";
const GLUE = "**/engine/verticopolis_engine.js";

interface Record {
  sources: string;
  crate: { name: string; version: string };
}

async function buildRecord(page: Page): Promise<Record> {
  const res = await page.request.get("/engine/BUILD.json");
  expect(res.ok()).toBe(true);
  return (await res.json()) as Record;
}

/** Serve the real binary with one same-length text swap (the last match, where the build stamps its section), so it still compiles
 *  and links but its build section reads differently. */
async function swapInBinary(page: Page, from: string, to: string): Promise<void> {
  expect(to).toHaveLength(from.length);
  await page.route(WASM, async (route: Route) => {
    const res = await route.fetch();
    const body = await res.body();
    const at = body.lastIndexOf(from);
    expect(at, `the served binary holds ${from}`).toBeGreaterThan(-1);
    to.split("").forEach((c, i) => (body[at + i] = c.charCodeAt(0)));
    await route.fulfill({ response: res, body });
  });
}

async function openHelp(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).game && !!(window as any).__vcEngineBoot, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    (window as any).game.ui.showHelp();
  });
  // The diagnostics sit inside the collapsed About section.
  await page.locator("#modal details.help-modes", { has: page.locator(".help-diagnostics") }).locator("summary").click();
  await expect(page.locator("#modal .help-diagnostics")).toBeVisible();
}

/** Press Copy diagnostics and return what reached the clipboard. */
async function copyDiagnostics(page: Page): Promise<string> {
  await page.evaluate(() => {
    (window as any).__copied = null;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => ((window as any).__copied = t) },
      configurable: true,
    });
  });
  await page.locator('#modal [data-act="copy-diagnostics"]').click();
  await expect(page.locator("#modal .help-diagnostics-status")).toHaveText("Copied.");
  return page.evaluate(() => (window as any).__copied as string);
}

const state = (page: Page) => page.locator("#modal .help-diagnostics").getAttribute("data-state");
const short = (hash: string) => hash.slice(0, 12);

test("the main-thread engine shows its record and the source hash BUILD.json records", async ({ page }) => {
  const record = await buildRecord(page);
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("ok");
  const boot = await page.evaluate(() => (window as any).__vcEngineBoot);
  expect(boot.binary).toEqual({ state: "ok", sourceHash: record.sources });
  const block = page.locator("#modal .help-diagnostics");
  await expect(block).toContainText(`${record.crate.name} ${record.crate.version}`);
 
  const copied = await copyDiagnostics(page);
  expect(copied).toContain(`Engine crate: ${record.crate.name} ${record.crate.version}`);
  expect(copied).toContain(`Source hash in the engine binary: ${short(record.sources)}`);
  expect(copied).toContain(`Source hash this page expects: ${short(record.sources)}`);
  expect(copied).toContain("Package id this page expects: ");
});

test("the worker host reports the same stamped hash", async ({ page }) => {
  const record = await buildRecord(page);
  await page.goto("/?engine=wasm-worker");
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("ok");
  expect((await page.evaluate(() => (window as any).__vcEngineBoot)).binary).toEqual({ state: "ok", sourceHash: record.sources });
  expect(await copyDiagnostics(page)).toContain("WASM engine (worker)");
});

test("a binary built from other sources is a mismatch that names the source hash", async ({ page }) => {
  const record = await buildRecord(page);
  const tampered = `${record.sources.startsWith("0") ? "1" : "0"}${record.sources.slice(1)}`;
  await swapInBinary(page, record.sources, tampered);
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("mismatch");
  const copied = await copyDiagnostics(page);
  expect(copied).toContain(`Mismatch: source hash (engine binary ${short(tampered)}, this page was built for ${short(record.sources)})`);
});

test("a binary with no build section keeps running and says the source hash is unavailable", async ({ page }) => {
  await swapInBinary(page, "verticopolis.build", "verticopolis.buile");
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("unavailable");
  expect(await copyDiagnostics(page)).toContain("Source hash in the engine binary: unavailable (no build metadata section)");
});

test("a build section from another schema is malformed, and the engine keeps running", async ({ page }) => {
  await swapInBinary(page, '"schema":1', '"schema":2');
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => !!(window as any).__vcEngine?.status.hosted, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("unavailable");
  expect(await copyDiagnostics(page)).toContain("Source hash in the engine binary: unavailable (malformed: not schema 1)");
});

test("an engine that never loads still copies the page's expected crate and the reason", async ({ page }) => {
  const record = await buildRecord(page);
  await page.route(GLUE, (route) => route.abort("failed"));
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => (window as any).__vcEngineBoot?.failure, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("not-loaded");
  const copied = await copyDiagnostics(page);
  expect(copied).toContain("Failed at: load");
  expect(copied).toContain(`Crate this page expects: ${record.crate.name} ${record.crate.version}`);
  expect(copied).toContain(`Source hash this page expects: ${short(record.sources)}`);
  expect(copied).not.toContain("Engine crate:");
});

test("a binary that never arrives is not-loaded, with no source hash to report", async ({ page }) => {
  await page.route(WASM, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/?engine=wasm");
  await page.waitForFunction(() => (window as any).__vcEngineBoot?.failure, undefined, { timeout: 30_000 });
  await openHelp(page);
  expect(await state(page)).toBe("not-loaded");
  const copied = await copyDiagnostics(page);
  expect(copied).toContain("failed to fetch Wasm: 404");
  expect(copied).not.toContain("Source hash in the engine binary");
});
