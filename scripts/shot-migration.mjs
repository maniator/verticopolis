/**
 * Before/after capture of the v1→v2 canon-width **reflow migration**, driven on
 * the real `towerone_6` save the parity initiative was grounded in.
 *
 *  - "before" — the save stamped to the current version so the reflow is SKIPPED:
 *    rooms render at their stored (pre-canon) widths, the weird spacing the player
 *    reported.
 *  - "after" — the genuine v1 save: `migrateSave` runs the reflow and re-lays each
 *    floor at canon 1994 widths.
 *
 * Both load through the app's own `Simulation.deserialize` (reached via
 * `game.sim.constructor`) and `adoptSim`, so the shot can't drift from ship code.
 * Run via `SHOT_SCRIPT=scripts/shot-migration.mjs node scripts/serve-and-shoot.mjs`.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { inflateSync } from "fflate";

// ---- Decode the .vctower save (VCTOWER1\n + base64(deflate-raw(JSON))) --------
const raw = readFileSync("src/tests/fixtures/towerone_6.vctower", "utf8");
const nl = raw.indexOf("\n");
const b64 = raw.slice(nl + 1);
const compressed = new Uint8Array(Buffer.from(b64, "base64"));
const data = JSON.parse(new TextDecoder().decode(inflateSync(compressed)));
console.log(`decoded save: version=${data.version} units=${data.units?.length} transports=${data.transports?.length}`);

const BASE = process.env.BASE_URL || "http://localhost:4173";
// Use the browser pre-installed in this environment (Playwright's default
// download is disabled here), matching scripts/shot-game.mjs.
const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const p = await b.newPage({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
p.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE:", m.text()); });

await p.addInitScript(() => localStorage.clear());
await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
await p.waitForFunction(() => window.game && window.game.engine && window.game.sim, null, { timeout: 15000 });

// Load a version of the save and drop the splash; returns the parking centroid
// (tile,floor) so the detail shot can frame where the width change is loudest.
async function load(version) {
  return await p.evaluate(({ d, version }) => {
    const g = window.game;
    const Sim = g.sim.constructor;
    // Deep-clone so deserialize can't mutate the shared source between shots.
    const clone = JSON.parse(JSON.stringify(d));
    clone.version = version;
    g.adoptSim(Sim.deserialize(clone));
    // A fresh boot with no save shows the first-run splash overlay on top of the
    // (always-rendering) canvas — drop it so the tower behind it is visible.
    document.getElementById("splash")?.remove();
    document.querySelector(".modal-backdrop")?.remove();
    // Find where the parking lives (ramps + spaces) — that's where the canon
    // width change (space 6→4, ramp 6→16) reads most clearly.
    const park = g.sim.tower.units.filter((u) => u.kind === "parking" || u.kind === "parkingRamp");
    let tile = 187;
    let floor = 6;
    if (park.length) {
      // Pick the most-populated parking floor, center on its spread.
      const byFloor = new Map();
      for (const u of park) byFloor.set(u.floor, (byFloor.get(u.floor) ?? 0) + 1);
      floor = [...byFloor.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const onFloor = park.filter((u) => u.floor === floor);
      tile = Math.round(onFloor.reduce((s, u) => s + u.x + u.width / 2, 0) / onFloor.length);
    }
    return { tile, floor };
  }, { d: data, version });
}

async function shotFull(version, path, label) {
  await load(version);
  await p.evaluate(() => {
    const g = window.game;
    g.engine.setCamera(187, Math.max(6, g.sim.tower.highestFloor) / 2, 0.42);
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path });
  console.log(`captured ${label} → ${path}`);
}

async function shotDetail(version, path, label) {
  await load(version);
  // Tight on a ramp column: the parking ramp is the loudest single change
  // (6→16 wide), so frame it close enough that the width difference dominates —
  // a wider view is swamped by the offices/condos that DON'T change width.
  const at = await p.evaluate(() => {
    const g = window.game;
    const ramp = g.sim.tower.units
      .filter((u) => u.kind === "parkingRamp")
      .sort((a, b) => a.floor - b.floor)[0];
    const tile = ramp ? ramp.x + 8 : 240;
    const floor = ramp ? ramp.floor : -1;
    g.engine.setCamera(tile, floor, 3.6);
    return { tile, floor, w: ramp ? ramp.width : -1 };
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path });
  console.log(`captured ${label} (floor ${at.floor}, tile ${at.tile}, rampWidth ${at.w}) → ${path}`);
}

await shotFull(2, "docs/screenshots/features/parity-migration-before.png", "before (reflow skipped)");
await shotFull(1, "docs/screenshots/features/parity-migration-after.png", "after (reflow applied)");
await shotDetail(2, "docs/screenshots/features/parity-migration-parking-before.png", "parking before");
await shotDetail(1, "docs/screenshots/features/parity-migration-parking-after.png", "parking after");

await b.close();
