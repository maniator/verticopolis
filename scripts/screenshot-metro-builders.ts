/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * A Modern tower with three metro stations on one line, for the `metro-line`
 * scene: one train runs the line and calls at each station in turn.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** A small Modern office tower over a basement dug to B5, with three stations
 *  on B3 to B5 (20 tiles apart) and a platform elevator in each gap. Fails
 *  closed when a station or a platform elevator is refused. */
export function buildMetroLineTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(4800, "modern");
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 5;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 70;
  const right = cx + 70;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  for (let x = cx; x < W; x++) s.tower.place("floor", 0, x);
  for (let x = cx - 1; x >= 0; x--) s.tower.place("floor", 0, x);
  for (let f = -1; f >= -4; f--) for (let x = 0; x < W; x++) s.tower.place("floor", f, x);
  for (const x of [cx - 65, cx - 15, cx + 35]) {
    const m = s.tower.place("metro", -4, x);
    if (!m.ok) throw new Error(`metro line station at ${x} failed: ${m.reason}`);
    s.tower.getUnit(m.unitId).state = "occupied";
  }
  for (const x of [cx - 30, cx + 20]) {
    const t = s.tower.placeTransport("elevatorStandard", x, -3, 5);
    if (!t.ok) throw new Error(`metro line platform elevator at ${x} failed: ${t.reason}`);
  }
  for (let f = 2; f <= 5; f++) {
    for (let x = left; x + 1 <= right; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        x += u.width;
      } else x += 1;
    }
  }
  s.evaluateStar();
  g.engine.setSim(g.enginePort.sim ? s : (g.syncSim(), g.renderSim));
  g.engine.setCamera(cx, -2, 1);
  g.speed = 2;
  g.engine.paused = false;
}
