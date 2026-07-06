/**
 * Captures the two UI surfaces added by the condo-modes feature:
 *   1. features/new-tower-modes.png       — the New Tower rule-set picker
 *   2. features/stats-households-modern.png — the Modern-only Households readout
 *
 * Assumes a static server is serving the built app at BASE_URL (see
 * `vite preview`). Mirrors scripts/screenshots.mjs conventions (drives the live
 * `window.game`, real lot width, deterministic seed).
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../docs/screenshots/features");
const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(OUT, { recursive: true });

/** Build a compact Modern tower whose condos are sold to varied households, so
 *  the Households stats section has a real size mix to show. */
function buildModernCondoTower() {
  const g = window.game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(2024, "modern");
  const s = g.sim;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  s.money = 50_000_000;
  s.star = 5;

  const HALF = 30;
  for (let x = cx - HALF; x <= cx + HALF; x++) s.tower.place("lobby", 1, x);
  const span = 52;
  const left = cx - Math.floor(span / 2);
  for (let f = 2; f <= 12; f++) for (let x = left; x < left + span; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 12);

  // Fill floors 2..12 with condos, each sold to a deterministic spread of
  // household sizes so the "Size mix" line shows 2p/3p/4p/5p all present.
  const spread = [3, 2, 4, 3, 5, 3, 2, 4, 3, 5, 4];
  let i = 0;
  for (let f = 2; f <= 12; f++) {
    for (let x = left; x + 16 <= left + span; x += 16) {
      const r = s.tower.place("condo", f, x);
      if (!r.ok) continue;
      const u = s.tower.units.find((uu) => uu.id === r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      u.residents = spread[i % spread.length];
      i++;
    }
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 7, 0.7);
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.game, null, { timeout: 10000 });

  // 1) New Tower rule-set picker: from the first-run splash, press New Tower to
  // open the picker, then select Modern so its card + variant-households feature
  // line are highlighted.
  await page.waitForSelector("#splash", { timeout: 4000 }).catch(() => {});
  await page.click('#splash [data-splash="new"]');
  await page.waitForSelector("#modal .nt-modes", { timeout: 4000 });
  await page.click('#modal input[value="modern"]');
  await page.waitForTimeout(250);
  await page.locator("#modal .modal-box").screenshot({ path: `${OUT}/new-tower-modes.png` });
  console.log("captured new-tower-modes");

  // Commit the Modern tower so the app is in Modern mode, then swap in a built
  // tower whose condos are sold to varied households.
  await page.click('#modal [data-act="found"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    try {
      localStorage.setItem("tt.onboarded", "1");
    } catch {
      /* ignore */
    }
    document.getElementById("onboard")?.remove();
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
  });
  await page.evaluate(buildModernCondoTower);
  await page.waitForTimeout(400);

  // 2) Tower Statistics with the Households section. Open stats, scroll the
  // Households header to the top of the scroll area, and shoot the modal box.
  await page.click("#btn-stats");
  await page.waitForSelector("#modal .stats-grid", { timeout: 4000 });
  await page.evaluate(() => {
    const box = document.querySelector("#modal .modal-box");
    const headers = [...box.querySelectorAll(".stats-section")];
    const hh = headers.find((h) => /Households/.test(h.textContent || ""));
    if (hh) box.scrollTop = hh.offsetTop - box.offsetTop - 8;
  });
  await page.waitForTimeout(250);
  await page.locator("#modal .modal-box").screenshot({ path: `${OUT}/stats-households-modern.png` });
  console.log("captured stats-households-modern");

  await browser.close();
  console.log("Done. Screenshots in", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
