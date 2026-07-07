import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
p.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE:", m.text()); });

await p.addInitScript(() => {
  localStorage.clear();
  // Pin the steady clock so the fixed 6s wait lands mid-morning-rush as
  // calibrated; the breathing clock (default on) would race to noon and stall
  // the shot in the lunch crawl.
  localStorage.setItem("vc.prefs", JSON.stringify({ steadyClock: true }));
});
await p.goto("http://localhost:4173/index.html", { waitUntil: "networkidle" });
await p.waitForFunction(() => window.game?.engine?.engine?.currentScene, null, { timeout: 15000 });

// Build a compact, fully-staffed tower with an elevator the commuters will use.
await p.evaluate(() => {
  const g = window.game;
  const sim = g.sim;
  const left = 80;
  for (let x = left; x < left + 50; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 10; f++) for (let x = left + 4; x < left + 46; x++) sim.tower.place("floor", f, x);
  for (let f = 3; f <= 9; f++) for (let x = left + 10; x + 9 <= left + 45; x += 9) {
    const r = sim.tower.place("office", f, x);
    if (r.ok) { const u = sim.tower.units.find((uu) => uu.id === r.unitId); u.state = "occupied"; u.everOccupied = true; u.occupants = 6; }
  }
  sim.tower.placeTransport("elevatorStandard", left + 6, 1, 10);
  sim.star = 3;
  // Monday morning rush so commuters pour into the offices.
  const c = sim.clock;
  c.minutes = c.minutes - c.minuteOfDay + 8 * 60;
  g.speed = 2; // 30 in-game min/sec — keeps cars moving for boarding
  g.engine.setCamera(left + 22, 5, 1.5);
});

// Let the crowd spawn, route, wait at the shaft and ride.
await p.waitForTimeout(6000);
await p.screenshot({ path: "docs/screenshots/14-crowd-routing.png" });
console.log("captured commuters routing through the tower");
await b.close();
