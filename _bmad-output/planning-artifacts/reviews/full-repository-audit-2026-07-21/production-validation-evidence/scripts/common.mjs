/**
 * Shared harness for the live-production validation supplement.
 * Drives the installed Chrome (channel: "chrome", headed => real GPU) against
 * https://verticopolis.com with full console/network/pageerror capture.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ORIGIN = "https://verticopolis.com";

export function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

export function saveJson(name, data) {
  const p = path.join(EV, "raw", name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  log("saved", p);
}

/**
 * Launch a context. `profile: "fresh"` uses a throwaway profile dir per run;
 * `profile: "persistent"` reuses prod-validation-evidence/profile (for SW /
 * repeat-load behavior). Headed by default so the real GPU renders.
 */
export async function launch(opts = {}) {
  const { profile = "fresh", headless = false, contextOpts = {} } = opts;
  const dir =
    profile === "persistent"
      ? path.join(EV, "profile")
      : fs.mkdtempSync(path.join(EV, "profile-tmp-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chrome",
    headless,
    viewport: null,
    args: ["--window-size=1600,1000", "--lang=en-US"],
    ...contextOpts,
  });
  return { ctx, profileDir: dir, isTemp: profile !== "persistent" };
}

/** Attach console / pageerror / request-failure collectors to a page. */
export function attachCollectors(page, bucket) {
  bucket.console ??= [];
  bucket.pageErrors ??= [];
  bucket.failedRequests ??= [];
  bucket.badResponses ??= [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      bucket.console.push({ t: Date.now(), type: m.type(), text: m.text(), url: page.url() });
    }
  });
  page.on("pageerror", (e) => bucket.pageErrors.push({ t: Date.now(), message: e.message, url: page.url() }));
  page.on("requestfailed", (r) =>
    bucket.failedRequests.push({ t: Date.now(), url: r.url(), failure: r.failure()?.errorText, pageUrl: page.url() }),
  );
  page.on("response", (r) => {
    if (r.status() >= 400)
      bucket.badResponses.push({ t: Date.now(), url: r.url(), status: r.status(), pageUrl: page.url() });
  });
}

/** Wait until the game app is fully wired (same invariants as the repo e2e). */
export async function waitGameReady(page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const g = window.game;
      const canvas = document.querySelector("#view");
      return Boolean(g?.sim && g.engine && canvas && canvas.width > 0 && canvas.height > 0);
    },
    undefined,
    { timeout },
  );
}

/** Dismiss the splash via its real button (Continue if present, else New Tower->Found). */
export async function startNewClassic(page) {
  await page.click('[data-splash="new"]');
  await page.waitForSelector("#modal[open]");
  await page.check('input[name="nt-mode"][value="classic"]');
  await page.click('#modal [data-act="found"]');
  await page.waitForFunction(() => !document.getElementById("splash"));
}

export async function snap(page, name) {
  const p = path.join(EV, "screenshots", name + ".png");
  await page.screenshot({ path: p });
  log("screenshot", p);
  return p;
}

/** Summarize collector bucket, filtering known-benign noise (none known yet). */
export function summarizeBucket(bucket) {
  return {
    consoleErrors: bucket.console.filter((c) => c.type === "error").length,
    consoleWarnings: bucket.console.filter((c) => c.type === "warning").length,
    pageErrors: bucket.pageErrors.length,
    failedRequests: bucket.failedRequests.length,
    badResponses: bucket.badResponses.length,
  };
}
