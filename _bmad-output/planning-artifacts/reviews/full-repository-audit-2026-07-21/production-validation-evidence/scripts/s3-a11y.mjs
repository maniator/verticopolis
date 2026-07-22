/**
 * Phase 6 accessibility: axe scans (supplemental), touch-target measurement
 * under coarse-pointer emulation (AUD-025), unaffordable palette cue (AUD-026),
 * narrow-viewport overflow, touch tap-to-build, reduced-motion load.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { launch, attachCollectors, waitGameReady, startNewClassic, saveJson, snap, log, summarizeBucket, EV, ORIGIN } from "./common.mjs";

const axeSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/axe-core/axe.min.js"),
  "utf8",
);
const steps = [];
async function runStep(page, name, fn) {
  const s = { name, t: new Date().toISOString() };
  try {
    s.result = await fn();
    s.ok = true;
    log("PASS", name, JSON.stringify(s.result ?? "").slice(0, 400));
  } catch (e) {
    s.ok = false;
    s.error = String(e?.message ?? e);
    log("FAIL", name, s.error);
    if (page) await snap(page, "s3-FAIL-" + name.replace(/\W+/g, "-")).catch(() => {});
  }
  steps.push(s);
  return s;
}
async function axeScan(page, label) {
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 8), count: v.nodes.length }));
  });
  fs.writeFileSync(path.join(EV, "raw", `s3-axe-${label}.json`), JSON.stringify(res, null, 2));
  return { label, violations: res.length, detail: res.map((v) => `${v.impact}:${v.id} x${v.count}`) };
}

// ---------- Desktop context ----------
{
  const { ctx, profileDir } = await launch({ profile: "fresh" });
  const bucket = {};
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  attachCollectors(page, bucket);

  await runStep(page, "axe: splash", async () => {
    await page.goto(ORIGIN + "/", { waitUntil: "load" });
    await waitGameReady(page);
    return await axeScan(page, "splash");
  });

  await runStep(page, "axe: in-game", async () => {
    await startNewClassic(page);
    await page.waitForTimeout(500);
    return await axeScan(page, "ingame");
  });

  await runStep(page, "axe: help page", async () => {
    const p2 = await ctx.newPage();
    attachCollectors(p2, bucket);
    await p2.goto(ORIGIN + "/help", { waitUntil: "load" });
    await p2.waitForTimeout(800);
    const r = await axeScan(p2, "help");
    await p2.close();
    return r;
  });

  await runStep(page, "unaffordable palette cue with low funds (AUD-026)", async () => {
    return await page.evaluate(async () => {
      window.game.sim.money = 500; // client-local only; fresh throwaway tower
      await new Promise((r) => setTimeout(r, 1200)); // let ui.update repaint
      const items = [...document.querySelectorAll(".pal-item")];
      const un = items.filter((i) => i.classList.contains("unaffordable"));
      const s = un[0];
      return {
        total: items.length,
        unaffordable: un.length,
        sample: s
          ? { kind: s.dataset.kind, opacity: getComputedStyle(s).opacity, ariaDisabled: s.getAttribute("aria-disabled"), disabled: s.hasAttribute("disabled"), ariaLabel: s.getAttribute("aria-label"), title: s.title || null, textHasCost: /\$/.test(s.textContent) }
          : null,
        affordableOpacity: items.find((i) => !i.classList.contains("unaffordable")) ? getComputedStyle(items.find((i) => !i.classList.contains("unaffordable"))).opacity : null,
      };
    });
  });

  await runStep(page, "reduced motion load", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "load" });
    await waitGameReady(page);
    const errs = bucket.pageErrors.length;
    await snap(page, "s3-reduced-motion");
    return { pageErrorsSoFar: errs, splashVisible: await page.locator("#splash").isVisible() };
  });

  saveJson("s3-desktop-collectors.json", { summary: summarizeBucket(bucket), detail: bucket });
  await ctx.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}

// ---------- Touch / narrow viewport context ----------
{
  const dir = fs.mkdtempSync(path.join(EV, "profile-tmp-touch-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  });
  const bucket = {};
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  attachCollectors(page, bucket);

  await runStep(page, "narrow viewport load + overflow", async () => {
    await page.goto(ORIGIN + "/", { waitUntil: "load" });
    await waitGameReady(page);
    const layout = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      topbarVisible: (() => { const t = document.getElementById("topbar"); const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0; })(),
      splashMobileClass: document.getElementById("splash")?.className ?? null,
    }));
    await snap(page, "s3-mobile-splash");
    return layout;
  });

  await runStep(page, "touch: start game + tap palette", async () => {
    await page.tap('[data-splash="new"]');
    await page.waitForSelector("#modal[open]");
    await page.tap('#modal [data-act="found"]');
    await page.waitForFunction(() => !document.getElementById("splash"));
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({ mode: window.game.sim.rules.mode, units: window.game.sim.tower.units.length }));
    await snap(page, "s3-mobile-ingame");
    return st;
  });

  await runStep(page, "coarse-pointer touch-target sizes (AUD-025)", async () => {
    // Open the inspector (tap an existing unit) and the saves modal to expose
    // .btn.xs close buttons, then measure all of them.
    const sizes = await page.evaluate(async () => {
      const out = { coarseMatch: matchMedia("(pointer: coarse)").matches, buttons: [] };
      document.getElementById("btn-load").click();
      await new Promise((r) => setTimeout(r, 400));
      const measure = (el, where) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out.buttons.push({ where, cls: el.className, w: +r.width.toFixed(1), h: +r.height.toFixed(1), padding: cs.padding, meets24: r.width >= 24 && r.height >= 24, meets36: r.width >= 36 && r.height >= 36 });
      };
      document.querySelectorAll("#modal .btn.xs, #modal button.xs, #modal .modal-x, #modal [aria-label='Close']").forEach((el) => measure(el, "modal"));
      document.querySelectorAll("#modal .slot-actions .btn").forEach((el) => measure(el, "modal-slot"));
      return out;
    });
    await page.keyboard.press("Escape").catch(() => {});
    return sizes;
  });

  await runStep(page, "inspector close button size (AUD-025)", async () => {
    return await page.evaluate(async () => {
      // Select an existing lobby tile via the inspect path to open the inspector.
      const gm = window.game;
      const u = gm.sim.tower.units.find((x) => x.kind === "lobby") ?? gm.sim.tower.units[0];
      gm.selectPicked({ kind: "unit", unit: u });
      await new Promise((r) => setTimeout(r, 400));
      const insp = document.getElementById("inspector");
      const btns = [...insp.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect();
        return { cls: b.className, label: b.getAttribute("aria-label") ?? b.textContent.trim().slice(0, 12), w: +r.width.toFixed(1), h: +r.height.toFixed(1), meets24: r.width >= 24 && r.height >= 24 };
      });
      return { inspectorVisible: !insp.classList.contains("hidden"), buttons: btns.slice(0, 12) };
    });
  });

  saveJson("s3-touch-collectors.json", { summary: summarizeBucket(bucket), detail: bucket });
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

saveJson("s3-a11y.json", { when: new Date().toISOString(), steps });
log("DONE", JSON.stringify({ pass: steps.filter((s) => s.ok).length, fail: steps.filter((s) => !s.ok).length }));
