/**
 * Smoke part 2: export/import round trip (two-step confirm flow), quota
 * injection (AUD-010), post-probe save integrity, Modern founding, and a
 * refined dialog Tab-containment probe (per-Tab activeElement identity).
 */
import path from "node:path";
import fs from "node:fs";
import { launch, attachCollectors, waitGameReady, startNewClassic, saveJson, snap, log, summarizeBucket, EV, ORIGIN } from "./common.mjs";

process.on("unhandledRejection", (e) => log("unhandledRejection (survived):", String(e)));

const { ctx, profileDir } = await launch({ profile: "fresh" });
const bucket = {};
const page = ctx.pages()[0] ?? (await ctx.newPage());
attachCollectors(page, bucket);
const steps = [];
async function step(name, fn) {
  const s = { name, t: new Date().toISOString() };
  try {
    s.result = await fn();
    s.ok = true;
    log("PASS", name, JSON.stringify(s.result ?? ""));
  } catch (e) {
    s.ok = false;
    s.error = String(e && e.message ? e.message : e);
    log("FAIL", name, s.error);
    await snap(page, "s2b-FAIL-" + name.replace(/\W+/g, "-")).catch(() => {});
  }
  steps.push(s);
  return s;
}
const g = (expr) => page.evaluate(expr);

await step("load + new Classic + a few builds", async () => {
  await page.goto(ORIGIN + "/", { waitUntil: "load" });
  await waitGameReady(page);
  await startNewClassic(page);
  await page.waitForTimeout(400);
  // Deterministic small build via the engine surface (pointer path already
  // proven in s2): 3 floor tiles on floor 2.
  return await g(`(() => {
    const gm = window.game, t = gm.sim.tower, c = Math.floor(gm.grid.width / 2);
    for (let x = c - 1; x <= c + 1; x++) t.place("floor", 2, x);
    return { units: t.units.length, money: gm.sim.money };
  })()`);
});

await step("dialog Tab-trace (containment detail)", async () => {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  const trace = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    trace.push(
      await g(`(() => { const a = document.activeElement; const m = document.getElementById("modal"); return { inModal: m.contains(a), tag: a?.tagName, text: (a?.textContent ?? "").trim().slice(0, 24), isBody: a === document.body }; })()`),
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("modal").open);
  return { trace, escapes: trace.filter((t) => !t.inModal).map((t) => `${t.tag}:${t.text}${t.isBody ? ":BODY" : ""}`) };
});

const exportPath = path.join(EV, "raw", "s2b-exported.vctower");
await step("export .vctower (two-step confirm)", async () => {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  await page.click('#modal [data-act="export"]'); // closes Saves, opens confirm
  await page.waitForSelector("#modal[open]");
  const confirmText = await g(`document.getElementById("modal").textContent.replace(/\\s+/g, " ").trim().slice(0, 140)`);
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.click('#modal [data-act="export"]'); // the .vctower choice
  const download = await dl;
  await download.saveAs(exportPath);
  await page.waitForTimeout(500);
  const size = fs.statSync(exportPath).size;
  const toast = await g(`document.getElementById("toast-wrap").textContent`);
  return { confirmText, file: download.suggestedFilename(), size, toast };
});

await step("legacy .TDT export path (Classic tower)", async () => {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  await page.click('#modal [data-act="export"]');
  await page.waitForSelector("#modal[open]");
  await page.click('#modal [data-act="legacy"]');
  // Reverse-fidelity report modal appears BEFORE download.
  await page.waitForSelector("#modal[open]");
  const reportText = await g(`document.getElementById("modal").textContent.replace(/\\s+/g, " ").trim().slice(0, 180)`);
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.click('#modal [data-act="download"]');
  const download = await dl;
  const tdtPath = path.join(EV, "raw", "s2b-exported.TDT");
  await download.saveAs(tdtPath);
  return { reportText, file: download.suggestedFilename(), size: fs.statSync(tdtPath).size };
});

await step("import the exported .vctower (round trip)", async () => {
  const pre = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money }))()`);
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  await page.click('#modal [data-act="import"]');
  const fc = await chooser;
  await fc.setFiles(exportPath);
  await page.waitForTimeout(1500);
  const post = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money, toast: document.getElementById("toast-wrap").textContent }))()`);
  if (post.units !== pre.units) throw new Error(`unit mismatch: ${JSON.stringify({ pre, post })}`);
  return { pre, post };
});

await step("quota failure injection on Quick Save (AUD-010)", async () => {
  const r = await page.evaluate(async () => {
    const errs = [];
    const onErr = (e) => { errs.push(String((e.error && e.error.name) || e.message)); };
    window.addEventListener("error", onErr);
    const proto = Object.getPrototypeOf(localStorage);
    const orig = proto.setItem;
    proto.setItem = function () {
      throw new DOMException("Simulated quota exceeded (validation probe)", "QuotaExceededError");
    };
    const toastBefore = document.getElementById("toast-wrap").textContent;
    try {
      document.getElementById("btn-save-top").click();
      await new Promise((r2) => setTimeout(r2, 900));
    } finally {
      proto.setItem = orig;
      window.removeEventListener("error", onErr);
    }
    return { toastBefore, toastAfter: document.getElementById("toast-wrap").textContent, uncaughtErrors: errs };
  });
  return { ...r, toastChanged: r.toastAfter !== r.toastBefore };
});

await step("quota injection on SLOT save (AUD-010 second site)", async () => {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  const r = await page.evaluate(async () => {
    const errs = [];
    const onErr = (e) => { errs.push(String((e.error && e.error.name) || e.message)); };
    window.addEventListener("error", onErr);
    const proto = Object.getPrototypeOf(localStorage);
    const orig = proto.setItem;
    proto.setItem = function () {
      throw new DOMException("Simulated quota exceeded (validation probe)", "QuotaExceededError");
    };
    const toastBefore = document.getElementById("toast-wrap").textContent;
    try {
      document.querySelector('#modal [data-save="2"]')?.click();
      await new Promise((r2) => setTimeout(r2, 900));
    } finally {
      proto.setItem = orig;
      window.removeEventListener("error", onErr);
    }
    return { toastBefore, toastAfter: document.getElementById("toast-wrap").textContent, uncaughtErrors: errs, slot2Row: [...document.querySelectorAll("#modal .slot")].find((x) => x.textContent.includes("Slot 2"))?.textContent.replace(/\s+/g, " ").trim() };
  });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  return r;
});

await step("save still works after probes", async () => {
  await page.click("#btn-save-top");
  await page.waitForTimeout(700);
  return { toast: await g(`document.getElementById("toast-wrap").textContent`) };
});

await step("new Modern game", async () => {
  await page.click("#btn-new");
  await page.waitForSelector("#modal[open]");
  const abandonWarning = await g(`document.querySelector(".nt-abandon")?.textContent ?? null`);
  await page.check('input[name="nt-mode"][value="modern"]');
  const calendarVisible = await g(`(() => { const el = document.querySelector(".nt-modern-only"); return el ? getComputedStyle(el).display !== "none" : null; })()`);
  await page.click('#modal [data-act="found"]');
  await page.waitForTimeout(800);
  const st = await g(`(() => ({ mode: window.game.sim.rules.mode, badge: document.getElementById("btn-mode")?.textContent?.trim(), money: window.game.sim.money, units: window.game.sim.tower.units.length }))()`);
  if (st.mode !== "modern") throw new Error("mode not modern: " + JSON.stringify(st));
  await snap(page, "s2b-new-modern");
  return { ...st, abandonWarning, calendarVisibleWhenModern: calendarVisible };
});

const result = { when: new Date().toISOString(), origin: ORIGIN, steps, collectors: { summary: summarizeBucket(bucket), detail: bucket } };
saveJson("s2b-smoke2.json", result);
log("DONE", JSON.stringify({ pass: steps.filter((s) => s.ok).length, fail: steps.filter((s) => !s.ok).length, collectors: summarizeBucket(bucket) }));
await ctx.close();
fs.rmSync(profileDir, { recursive: true, force: true });
