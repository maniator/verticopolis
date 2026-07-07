/**
 * Focused capture for the Traffic HUD chip. Builds a "hotspot" tower (healthy
 * floors + a localized jam on a weak shaft) through the public sim API, lets the
 * live UI loop drive the chip, and screenshots the HUD bar (#topbar).
 *
 * Run via: SHOT_SCRIPT=scripts/shot-traffic.mjs node scripts/serve-and-shoot.mjs
 * Output name is set by OUT_LABEL (default "traffic"); goes to docs/screenshots/.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../docs/screenshots");
const BASE = process.env.BASE_URL || "http://localhost:4173";
const LABEL = process.env.OUT_LABEL || "traffic";
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(OUT, { recursive: true });

/** Build a tower with 8 healthy floors + a 3-floor jam on one weak shaft. */
function buildHotspot() {
  const g = window.game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(1);
  const s = g.sim;
  s.simModel = "v2";
  s.money = 1e12;
  s.star = 5;
  const W = g.grid.width;
  for (let x = 0; x < W; x++) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 20; f++) for (let x = 0; x < W; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", W - 6, 1, 10);
  s.tower.setCars(s.tower.transports[0].id, 8); // strong shaft, low zone
  s.tower.placeTransport("elevatorStandard", W - 12, 10, 20);
  s.tower.setCars(s.tower.transports[1].id, 1); // weak shaft, high zone
  const fill = (f, n) => {
    let placed = 0;
    for (let x = 0; x + 9 <= W && placed < n; x += 9) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        s.tower.getUnit(r.unitId).state = "occupied"; // O(1) lookup, no scan
        placed++;
      }
    }
  };
  for (let f = 2; f <= 9; f++) fill(f, 12); // healthy zone A
  for (const f of [11, 12, 13]) fill(f, 30); // jammed zone B
  s.evaluateStar?.();
  g.engine.setSim(s);
  g.engine.setCamera(Math.floor(W / 2), 10, 0.5);
  g.speed = 1;
  g.engine.paused = false;
  // Report what the chip's signal is, for the console log.
  return { peak: s.peakCongestion(), floor: s.peakCongestionFloor?.() ?? null };
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
// A roomy desktop width so the full HUD lays out on one row — brand on one line
// and every speed button visible (a 900px viewport cramped the bar, wrapping the
// brand and clipping the right-hand buttons).
const page = await browser.newPage({ viewport: { width: 1440, height: 400 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "networkidle" });

// Dismiss first-run chrome and resume the engine — thoroughly, so no
// semi-transparent overlay (splash, onboarding spotlight, mobile scrim, or an
// open <dialog>'s ::backdrop) is left dimming the HUD.
const covering = await page.evaluate(() => {
  try { localStorage.setItem("tt.onboarded", "1"); } catch { /* ignore */ }
  document.querySelector("#splash [data-splash='continue'], #splash [data-splash='new']")?.click();
  for (const id of ["splash", "onboard", "scrim"]) document.getElementById(id)?.remove();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close?.());
  document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
  const g = window.game;
  if (g) { g.speed = 1; g.engine.paused = false; }
  // Report anything still painted over the HUD bar's center (diagnostic).
  const bar = document.getElementById("topbar");
  const r = bar.getBoundingClientRect();
  const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return stack
    .map((el) => `${el.id || el.tagName}.${el.className || ""}`)
    .filter((s) => !/topbar|status|stat|HTML|BODY/i.test(s));
});
console.log(`[${LABEL}] layers above HUD after teardown:`, JSON.stringify(covering));

const signal = await page.evaluate(buildHotspot);
console.log(`[${LABEL}] peakCongestion=${signal.peak?.toFixed(3)} worstFloor=${signal.floor}`);

// Let the live UI loop update the chip; poll until the label settles off "Smooth".
let label = "Smooth";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(150);
  label = await page.evaluate(() => document.getElementById("traffic-label")?.textContent ?? "");
  if (label && label !== "Smooth") break;
}
const aria = await page.evaluate(() => document.getElementById("traffic")?.getAttribute("aria-label"));
console.log(`[${LABEL}] chip label = "${label}"  aria = "${aria}"`);

// Swap the demo's build-budget (1e12, a 13-digit FUND that bloats the bar) for a
// realistic balance now that the tower is built, so the HUD reads like real play.
await page.evaluate(() => { window.game.sim.money = 9_126_661; });
await page.waitForTimeout(250); // let the UI loop render the new FUND

await page.locator("#topbar").screenshot({ path: resolve(OUT, `traffic-${LABEL}.png`) });
console.log(`[${LABEL}] wrote docs/screenshots/traffic-${LABEL}.png`);

// Mobile: the HUD bar wraps its stats onto a second row (max-width:860px block).
// Re-shoot the same live state at a phone width to verify the chip reads there too.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400); // let the responsive layout settle
await page.locator("#topbar").screenshot({ path: resolve(OUT, `traffic-${LABEL}-mobile.png`) });
console.log(`[${LABEL}] wrote docs/screenshots/traffic-${LABEL}-mobile.png`);
await browser.close();
