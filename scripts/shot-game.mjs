import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
p.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE:", m.text()); });

await p.addInitScript(() => localStorage.clear());
await p.goto("http://localhost:4173/index.html", { waitUntil: "networkidle" });

// Wait for the Excalibur engine to be live.
await p.waitForFunction(() => {
  const g = window.game;
  return g && g.engine && g.engine.engine && g.engine.engine.currentScene;
}, null, { timeout: 15000 });
await p.waitForTimeout(1000);
await p.screenshot({ path: "docs/screenshots/10-game-boot.png" });
console.log("captured game boot");

// Drive the simulation programmatically through the live engine to prove the
// whole pipeline (tower model → Excalibur actors) works end-to-end.
await p.evaluate(() => {
  const g = window.game;
  const sim = g.sim;
  const W = sim.tower.constructor;
  void W;
  const left = 80;
  for (let x = left; x < left + 60; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 12; f++) for (let x = left + 4; x < left + 56; x++) sim.tower.place("floor", f, x);
  for (let f = 3; f <= 7; f++) for (let x = left + 10; x + 9 <= left + 55; x += 9) {
    const r = sim.tower.place("office", f, x);
    if (r.ok) { const u = sim.tower.units.find((uu) => uu.id === r.unitId); u.state = "occupied"; u.everOccupied = true; }
  }
  for (let f = 8; f <= 12; f++) for (let x = left + 10; x + 6 <= left + 55; x += 6) {
    const r = sim.tower.place("hotelDouble", f, x);
    if (r.ok) sim.tower.units.find((uu) => uu.id === r.unitId).state = "asleep";
  }
  // Commercial sits on floor 2 (the lobby concourse on floor 1 stays clear).
  for (let x = left + 6; x + 16 <= left + 55; x += 16) {
    const r = sim.tower.place("fastFood", 2, x);
    if (r.ok) sim.tower.units.find((uu) => uu.id === r.unitId).state = "occupied";
  }
  sim.tower.placeTransport("elevatorStandard", left + 6, 1, 12);
  sim.tower.placeTransport("stairs", left + 50, 1, 4);
  g.engine.center();
});
await p.waitForTimeout(1200);
await p.screenshot({ path: "docs/screenshots/11-game-tower.png" });
console.log("captured built tower");

// Prove zoom works through the Excalibur camera.
await p.evaluate(() => window.game.engine.zoomAt(1.6, 640, 400));
await p.waitForTimeout(600);
await p.screenshot({ path: "docs/screenshots/12-game-zoom.png" });
console.log("captured zoom");

// Night render: jump the clock and let lights/sky update.
await p.evaluate(() => {
  const c = window.game.sim.clock;
  c.minutes = c.minutes - c.minuteOfDay + 23 * 60; // jump to 11pm same day
  window.game.engine.zoomAt(1 / 1.6, 640, 400);
});
await p.waitForTimeout(800);
await p.screenshot({ path: "docs/screenshots/13-game-night.png" });
console.log("captured night");

await b.close();
