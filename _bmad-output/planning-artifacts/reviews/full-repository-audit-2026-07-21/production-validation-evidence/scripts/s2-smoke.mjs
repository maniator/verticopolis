/**
 * Phase 3 + parts of Phase 6: live-origin interactive smoke in a FRESH profile.
 * Every step records pass/fail + evidence; console/network captured throughout.
 * Includes: new Classic/Modern, real pointer build, keyboard/mouse camera,
 * dialogs + focus, quick save/reload/continue, slot save, export/import round
 * trip, AUD-021 undo-behind-modal/splash probes, AUD-010 quota injection,
 * AUD-022 announce mechanism, AUD-026 palette cue.
 */
import path from "node:path";
import fs from "node:fs";
import { launch, attachCollectors, waitGameReady, startNewClassic, saveJson, snap, log, summarizeBucket, EV, ORIGIN } from "./common.mjs";

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
    await snap(page, "s2-FAIL-" + name.replace(/\W+/g, "-")).catch(() => {});
  }
  steps.push(s);
  return s;
}
const g = (expr) => page.evaluate(expr);

await step("load", async () => {
  await page.goto(ORIGIN + "/", { waitUntil: "load" });
  await waitGameReady(page);
  return { splash: await page.locator("#splash").isVisible() };
});

await step("splash Ctrl+Z probe (AUD-021 splash half)", async () => {
  const before = await g(`(() => { const s = window.game.sim; return { money: s.money, units: s.tower.units.length, min: s.clock.minutes }; })()`);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const after = await g(`(() => { const s = window.game.sim; return { money: s.money, units: s.tower.units.length, min: s.clock.minutes }; })()`);
  return { before, after, mutated: JSON.stringify(before) !== JSON.stringify(after), splashStillUp: await page.locator("#splash").isVisible() };
});

await step("new Classic game", async () => {
  await startNewClassic(page);
  await page.waitForTimeout(500);
  const st = await g(`(() => { const s = window.game.sim; return { mode: s.rules.mode, money: s.money, units: s.tower.units.length, badge: document.getElementById("btn-mode")?.textContent }; })()`);
  if (st.mode !== "classic") throw new Error("mode not classic: " + JSON.stringify(st));
  await snap(page, "s2-new-classic");
  return st;
});

await step("real pointer build (palette + canvas click)", async () => {
  // Select the floor tool via its real palette button, then click the canvas
  // one floor above the seeded lobby strip centre.
  await page.click('.pal-item[data-kind="floor"]');
  const pt = await g(`(() => {
    const gm = window.game, e = gm.engine, c = Math.floor(gm.grid.width / 2);
    const rect = document.getElementById("view").getBoundingClientRect();
    const sx = e.worldToScreenX(c), sy = (e.worldToScreenY(2) + e.worldToScreenY(1)) / 2;
    return { x: rect.left + sx, y: rect.top + sy, unitsBefore: gm.sim.tower.units.length, moneyBefore: gm.sim.money };
  })()`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  const after = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money }))()`);
  if (after.units <= pt.unitsBefore) throw new Error(`no unit placed: ${pt.unitsBefore} -> ${after.units}`);
  return { before: { units: pt.unitsBefore, money: pt.moneyBefore }, after };
});

await step("keyboard camera (arrows + zoom keys)", async () => {
  const before = await g(`(() => { const e = window.game.engine; return { x: e.worldToScreenX(0), y: e.worldToScreenY(0) }; })()`);
  await page.click("#view", { position: { x: 200, y: 200 } }).catch(() => {});
  for (const k of ["ArrowRight", "ArrowRight", "ArrowUp", "ArrowUp"]) await page.keyboard.press(k);
  await page.keyboard.press("+");
  await page.waitForTimeout(200);
  const after = await g(`(() => { const e = window.game.engine; return { x: e.worldToScreenX(0), y: e.worldToScreenY(0) }; })()`);
  return { before, after, moved: before.x !== after.x || before.y !== after.y };
});

await step("mouse wheel zoom + drag pan", async () => {
  const box = await page.locator("#view").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const z0 = await g(`Math.abs(window.game.engine.worldToScreenY(1) - window.game.engine.worldToScreenY(0))`);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(200);
  const z1 = await g(`Math.abs(window.game.engine.worldToScreenY(1) - window.game.engine.worldToScreenY(0))`);
  const p0 = await g(`window.game.engine.worldToScreenX(0)`);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const p1 = await g(`window.game.engine.worldToScreenX(0)`);
  return { zoomBefore: z0, zoomAfter: z1, zoomChanged: z0 !== z1, panBefore: p0, panAfter: p1, panChanged: p0 !== p1 };
});

for (const [btn, label] of [["#btn-load", "Saves"], ["#btn-settings", "Settings"], ["#btn-help", "Help"]]) {
  await step(`dialog ${label}: open, a11y, focus containment, Escape`, async () => {
    await page.click(btn);
    await page.waitForSelector("#modal[open]");
    const a11y = await g(`(() => {
      const m = document.getElementById("modal");
      const lbl = m.getAttribute("aria-labelledby");
      const lblEl = lbl ? document.getElementById(lbl) : null;
      return { ariaLabelledby: lbl, labelText: lblEl ? lblEl.textContent.trim().slice(0, 60) : null, focusInside: m.contains(document.activeElement), activeTag: document.activeElement?.tagName };
    })()`);
    const containment = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      containment.push(await g(`document.getElementById("modal").contains(document.activeElement)`));
    }
    await snap(page, `s2-dialog-${label.toLowerCase()}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("modal").open);
    return { ...a11y, tabStaysInside: containment.every(Boolean) };
  });
}

await step("palette unaffordable cue (AUD-026)", async () => {
  return await g(`(() => {
    const items = [...document.querySelectorAll(".pal-item")];
    const un = items.filter((i) => i.classList.contains("unaffordable"));
    const probe = (un[0] ?? items[items.length - 1]);
    const cs = getComputedStyle(probe);
    return { total: items.length, unaffordableNow: un.length, sample: un[0] ? { kind: un[0].dataset.kind, opacity: getComputedStyle(un[0]).opacity, ariaDisabled: un[0].getAttribute("aria-disabled"), disabled: un[0].hasAttribute("disabled"), title: un[0].title || null } : null, probeOpacity: cs.opacity };
  })()`);
});

await step("announce mechanism (AUD-022)", async () => {
  return await g(`(async () => {
    const el = document.getElementById("a11y-live");
    if (!el) return { present: false };
    let mutations = 0;
    const mo = new MutationObserver((m) => (mutations += m.length));
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    window.game.announce("Validation probe message");
    await new Promise((r) => setTimeout(r, 120));
    const afterFirst = mutations;
    window.game.announce("Validation probe message");
    await new Promise((r) => setTimeout(r, 120));
    mo.disconnect();
    const el2 = document.getElementById("a11y-live");
    return { present: true, ariaLive: el2.getAttribute("aria-live"), afterFirst, afterSecond: mutations, secondReFired: mutations > afterFirst };
  })()`);
});

await step("undo behind open modal (AUD-021 modal half)", async () => {
  const before = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money }))()`);
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);
  const during = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money, modalOpen: document.getElementById("modal").open }))()`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("modal").open);
  return { before, during, mutatedUnderModal: during.units !== before.units || during.money !== before.money };
});

await step("quick save + toast", async () => {
  await g(`document.getElementById("toast-wrap").textContent`);
  await page.click("#btn-save-top");
  await page.waitForTimeout(600);
  const toast = await g(`document.getElementById("toast-wrap").textContent`);
  return { toast };
});

let savedState;
await step("reload -> Continue restores state", async () => {
  savedState = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money, mode: window.game.sim.rules.mode }))()`);
  await page.reload({ waitUntil: "load" });
  await waitGameReady(page);
  await page.waitForSelector('[data-splash="continue"]');
  await page.click('[data-splash="continue"]');
  await page.waitForFunction(() => !document.getElementById("splash"));
  await page.waitForTimeout(500);
  const restored = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money, mode: window.game.sim.rules.mode }))()`);
  if (restored.units !== savedState.units || restored.mode !== savedState.mode) throw new Error(`mismatch: ${JSON.stringify({ savedState, restored })}`);
  return { savedState, restored };
});

await step("named slot save (slot 1)", async () => {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  await page.click('#modal [data-save="1"]');
  await page.waitForTimeout(600);
  const slotRow = await g(`(() => { const rows = [...document.querySelectorAll("#modal .slot")]; const r = rows.find((x) => x.textContent.includes("Slot 1")); return r ? r.textContent.replace(/\\s+/g, " ").trim() : null; })()`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("modal").open);
  if (!slotRow || slotRow.includes("empty")) throw new Error("slot 1 still empty: " + slotRow);
  return { slotRow };
});

const exportPath = path.join(EV, "raw", "s2-exported.vctower");
await step("export to file", async () => {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.click('#modal [data-act="export"]');
  const download = await dl;
  await download.saveAs(exportPath);
  await page.waitForTimeout(400);
  const size = fs.statSync(exportPath).size;
  const toast = await g(`document.getElementById("toast-wrap").textContent`);
  if (!size) throw new Error("empty export");
  return { file: download.suggestedFilename(), size, toast };
});

await step("import the exported save (round trip)", async () => {
  const pre = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money }))()`);
  const modalOpen = await g(`document.getElementById("modal").open`);
  if (!modalOpen) {
    await page.click("#btn-load");
    await page.waitForSelector("#modal[open]");
  }
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  await page.click('#modal [data-act="import"]');
  const fc = await chooser;
  await fc.setFiles(exportPath);
  await page.waitForTimeout(1500);
  const post = await g(`(() => ({ units: window.game.sim.tower.units.length, money: window.game.sim.money, toast: document.getElementById("toast-wrap").textContent, modalOpen: document.getElementById("modal").open }))()`);
  if (post.units !== pre.units) throw new Error(`unit mismatch after re-import: ${JSON.stringify({ pre, post })}`);
  return { pre, post };
});

await step("quota failure injection on Quick Save (AUD-010)", async () => {
  const r = await page.evaluate(async () => {
    const errs = [];
    const onErr = (e) => errs.push(String(e.error ?? e.message));
    window.addEventListener("error", onErr);
    const proto = Object.getPrototypeOf(localStorage);
    const orig = proto.setItem;
    proto.setItem = function () {
      const e = new DOMException("Simulated quota exceeded (validation probe)", "QuotaExceededError");
      throw e;
    };
    document.getElementById("toast-wrap").textContent;
    const toastBefore = document.getElementById("toast-wrap").textContent;
    try {
      document.getElementById("btn-save-top").click();
      await new Promise((r2) => setTimeout(r2, 800));
    } finally {
      proto.setItem = orig;
      window.removeEventListener("error", onErr);
    }
    return { toastBefore, toastAfter: document.getElementById("toast-wrap").textContent, uncaughtErrors: errs };
  });
  await page.waitForTimeout(300);
  return r;
});

await step("verify save still works after quota probe", async () => {
  await page.click("#btn-save-top");
  await page.waitForTimeout(600);
  return { toast: await g(`document.getElementById("toast-wrap").textContent`) };
});

await step("new Modern game", async () => {
  await page.click("#btn-new");
  await page.waitForSelector("#modal[open]");
  await page.check('input[name="nt-mode"][value="modern"]');
  const calendarVisible = await g(`(() => { const el = document.querySelector(".nt-modern-only"); return el ? getComputedStyle(el).display !== "none" : null; })()`);
  await page.click('#modal [data-act="found"]');
  await page.waitForTimeout(800);
  const st = await g(`(() => ({ mode: window.game.sim.rules.mode, badge: document.getElementById("btn-mode")?.textContent?.trim(), money: window.game.sim.money, units: window.game.sim.tower.units.length }))()`);
  if (st.mode !== "modern") throw new Error("mode not modern: " + JSON.stringify(st));
  await snap(page, "s2-new-modern");
  return { ...st, calendarVisibleWhenModern: calendarVisible };
});

const result = { when: new Date().toISOString(), origin: ORIGIN, steps, collectors: { summary: summarizeBucket(bucket), detail: bucket } };
saveJson("s2-smoke.json", result);
log("DONE", JSON.stringify({ pass: steps.filter((s) => s.ok).length, fail: steps.filter((s) => !s.ok).length, collectors: summarizeBucket(bucket) }));
await ctx.close();
fs.rmSync(profileDir, { recursive: true, force: true });
