/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * Two small Modern towers apart on one lot, each with its own front door: the
 * grand entrance and doorman at the left end of its ground lobby and the
 * service door at the right end (`scripts/scenes/frontDoors.ts`).
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** Two Modern towers 18 tiles wide with 9 tiles of open ground between them,
 *  each with floors 2 and 3 holding a leased office and a standard elevator set in
 *  from its left end, so nothing stands in front of either grand entrance.
 *  The lobbies stand over a basement no transport reaches, which holds the
 *  second one up. Fails closed when a lobby is refused or the two touch. */
export function buildFrontDoorTowers(): void {
  const w = window as unknown as { game: any };
  const g = w.game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7302, "modern");
  const s = g.sim;
  s.money = 20_000_000;
  s.star = 2;
  const cx = Math.floor(g.grid.width / 2);
  const towers: [number, number][] = [
    [cx - 22, cx - 5],
    [cx + 5, cx + 22],
  ];
  const [left, right] = [towers[0][0], towers[1][1]];
  if (!s.tower.place("lobby", 1, left).ok) throw new Error("the first lobby tile was refused");
  for (let x = left; x <= right; x++) s.tower.place("floor", 0, x);
  for (const [lo, hi] of towers) {
    for (let x = lo; x <= hi; x++) {
      if (x !== left && !s.tower.place("lobby", 1, x).ok) throw new Error(`the lobby at ${x} was refused`);
    }
    for (let f = 2; f <= 3; f++) for (let x = lo; x <= hi; x++) s.tower.place("floor", f, x);
    if (!s.tower.placeTransport("elevatorStandard", lo + 5, 1, 3).ok) throw new Error(`no elevator at ${lo + 5}`);
    for (let f = 2; f <= 3; f++) {
      for (let x = lo + 8; x + 9 <= hi + 1; ) {
        const r = s.tower.place("office", f, x);
        if (!r.ok) {
          x += 1;
          continue;
        }
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        x += u.width;
      }
    }
  }
  for (let x = towers[0][1] + 1; x < towers[1][0]; x++) {
    if (s.tower.unitAt(1, x)) throw new Error(`the lobbies touch at ${x}`);
  }
  s.evaluateStar();
  g.engine.setSim(g.enginePort.sim ? s : (g.syncSim(), g.renderSim));
  g.engine.setCamera(cx + 4, 2, 1.5);
  g.speed = 0;
  g.engine.paused = false;
}
