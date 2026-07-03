/**
 * Browser-side E2E helpers. Each function is SELF-CONTAINED (no module-scope
 * refs) because Playwright serializes it into `page.evaluate` — the canonical,
 * richly-asserted build lives in the Tier-1 fixture `src/tests/fixtures`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Grow the one persistent tower (window.game.sim) until `evaluateStar()` reaches
 * `target` star, then return sim.star. Cumulative — call it with 1,2,…,6 in turn
 * and each call extends the SAME tower (taller, more offices, the next gate), so
 * the run tells a real 1★→TOWER growth story. Deterministic: the rating is
 * driven directly (no crowd tick), exactly like the headless fixture.
 */
export function buildToStar(target: number): number {
  const g = (window as any).game;
  const s = g.sim;
  const t = s.tower;
  const W = g.grid.width;
  g.speed = 0; // freeze time so the crowd sim can't churn the setup
  s.money = 1e9;

  // Office top floor per rung — sized so population lands in that star's band.
  const officeTop = { 1: 3, 2: 6, 3: 12, 4: 37, 5: 62, 6: 99 }[target] as number;
  const structTop = target === 6 ? 100 : officeTop; // floor 100 carries the hall

  // Ground lobby, extended OUTWARD from centre (newGame seeds a centre strip and
  // ground floors must connect to existing structure).
  const c = Math.floor(W / 2);
  for (let x = c; x < W; x++) t.place("lobby", 1, x);
  for (let x = c - 1; x >= 0; x--) t.place("lobby", 1, x);

  // Deep basement (full width) once we need the basement-only Recycling / Metro.
  if (target >= 4) for (let f = 0; f >= -9; f--) for (let x = 0; x < W; x++) t.place("floor", f, x);

  // Above-ground structure + offices up to the current height (idempotent: a
  // re-place of an existing tile fails harmlessly, so this just extends).
  for (let f = 2; f <= structTop; f++) for (let x = 4; x < W - 4; x++) t.place("floor", f, x);
  for (let f = 3; f <= officeTop; f++) for (let x = 34; x + 9 <= W - 4; x += 9) t.place("office", f, x);

  for (const u of t.units as any[]) {
    if (u.kind === "office" || u.kind === "condo") {
      u.state = "occupied";
      u.everOccupied = true;
      u.satisfaction = 1;
    } else if (u.kind === "hotelSuite") {
      u.state = "asleep";
      u.everOccupied = true;
      u.satisfaction = 1;
    }
  }

  // Gates, added at the rung they unlock.
  if (target >= 3) t.place("security", 2, 24);
  if (target >= 4) {
    t.place("medical", 2, 44);
    // Recycling demand scales with population (~2,500/center): the full tower
    // runs ~19k occupants, so a row of nine centers (22.5k capacity) keeps
    // demand met at every rung — same sizing as the Tier-1 fixture.
    for (let i = 0; i < 9; i++) t.place("recycling", -1, 64 + i * 20);
    t.place("hotelSuite", 2, 84);
    t.place("hotelSuite", 2, 100);
    // One working parking space per suite (canon) — chained to a ramp, clear
    // of the recycling row on B1.
    t.place("parkingRamp", 0, 260);
    t.place("parking", 0, 266);
    t.place("parking", 0, 272);
    s.vipFavorable = true;
  }
  if (target >= 5) t.place("metro", -9, 0);

  s.evaluateStar();

  if (target === 6) {
    s.build("weddingHall", 100, c); // schedules the VIP inspection
    const wh = (t.units as any[]).find((u) => u.kind === "weddingHall");
    if (wh && wh.state === "construction") wh.state = "empty"; // done building
    s.clock.advance(10 * 24 * 60);
    s.checkVip(); // real win logic → star 6, evaluatedTower = true
  }
  return s.star;
}

/**
 * Frame the whole tower: centre the camera, then zoom so the built floor span
 * fits the viewport height (clamped to the engine's 0.3–3 range — which lands
 * small towers low with sky above and fills the frame at TOWER). Derives the
 * current zoom from two world points since there's no absolute-zoom setter.
 */
export function fitCamera(): void {
  const g = (window as any).game;
  const e = g.engine;
  const FLOOR = 34;
  e.center();
  const cur = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(0)) / FLOOR;
  let minF = 1;
  let maxF = 1;
  for (const u of g.sim.tower.units as any[]) {
    if (u.floor < minF) minF = u.floor;
    if (u.floor > maxF) maxF = u.floor;
  }
  const floors = maxF - minF + 8; // a little sky/margin
  const desired = e.viewHeight / (floors * FLOOR);
  e.zoomAt(desired / cur, g.grid.width * 0, e.viewHeight / 2); // vertical fit; recentre next
  e.center();
}
