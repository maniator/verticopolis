/**
 * Full-app layout capture across widths, for designing/verifying the responsive
 * breakpoints (phone / tablet / desktop). Builds a modest demo tower through the
 * public window.game API, then screenshots the whole page at each viewport in
 * VIEWPORTS.
 *
 * Run: SHOT_SCRIPT=scripts/shot-tablet.mjs node scripts/serve-and-shoot.mjs
 * Writes docs/screenshots/features/layout-<w>x<h>.png (override dir with OUT_DIR).
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR || resolve(__dirname, "../docs/screenshots/features");
const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(OUT, { recursive: true });

// Canonical tablet orientations + the cramped desktop band + a phone baseline.
const VIEWPORTS = (process.env.VIEWPORTS || "768x1024,1024x768,834x1112,900x700,390x844")
  .split(",")
  .map((s) => s.split("x").map(Number))
  .map(([width, height]) => ({ width, height }));

function buildDemoTower() {
  const g = window.game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7);
  const s = g.sim;
  s.simModel = "v2";
  s.money = 1e12;
  s.star = 5;
  const W = g.grid.width;
  const C = Math.floor(W / 2);
  for (let x = C - 40; x <= C + 40; x++) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 16; f++) for (let x = C - 40; x <= C + 40; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", C - 6, 1, 16);
  s.tower.placeTransport("elevatorStandard", C + 6, 1, 16);
  const fill = (f, kind, w) => {
    for (let x = C - 36; x + w <= C + 40; x += w) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) { const u = s.tower.getUnit(r.unitId); u.state = kind.startsWith("hotel") ? "asleep" : "occupied"; u.everOccupied = true; }
    }
  };
  for (let f = 2; f <= 8; f++) fill(f, "office", 9);
  for (let f = 9; f <= 12; f++) fill(f, "condo", 16);
  for (let f = 13; f <= 16; f++) fill(f, "hotelDouble", 6);
  s.money = 9_126_661;
  s.evaluateStar?.();
  g.engine.setSim(s);
  g.engine.setCamera(C, 9, 0.45);
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: VIEWPORTS[0], deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => {
  try { localStorage.setItem("tt.onboarded", "1"); } catch { /* ignore */ }
  document.querySelector("#splash [data-splash='continue'], #splash [data-splash='new']")?.click();
  for (const id of ["splash", "onboard"]) document.getElementById(id)?.remove();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close?.());
  const g = window.game;
  if (g) { g.speed = 1; g.engine.paused = false; }
});
await page.evaluate(buildDemoTower);
await page.waitForTimeout(600);

for (const vp of VIEWPORTS) {
  await page.setViewportSize(vp);
  await page.waitForTimeout(500); // let the responsive layout + canvas resize settle
  const path = resolve(OUT, `layout-${vp.width}x${vp.height}.png`);
  await page.screenshot({ path });
  console.log(`wrote ${path}`);
}
await browser.close();
