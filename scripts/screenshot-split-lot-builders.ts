/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * Two Modern towers side by side on one lot, each on its own ground lobby with
 * open ground between them, for the Help site's "How people get around"
 * section (`scripts/scenes/splitLot.ts`): people walk the street from one
 * lobby to the other (`engine-rs/src/crowd/street.rs`).
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** Two Modern towers 24 tiles wide with 20 tiles of open ground between them,
 *  each with floors 2 to 5 and a standard elevator from its lobby to the top.
 *  The left one holds offices, the right one the only fast food, so the
 *  office staff walk over for lunch. The lobbies stand over a basement no
 *  transport reaches, which holds the second one up. The towers' tile ranges
 *  are left on `window.__vcShotSplitLot`. Fails closed when a lobby is
 *  refused or the two lobbies touch. */
export function buildSplitLotTower(): void {
  const w = window as unknown as { game: any; __vcShotSplitLot?: unknown };
  const g = w.game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7300, "modern");
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 3;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const towers: [number, number][] = [
    [cx - 33, cx - 10],
    [cx + 10, cx + 33],
  ];
  w.__vcShotSplitLot = towers;
  const [left, right] = [towers[0][0], towers[1][1]];
  if (!s.tower.place("lobby", 1, left).ok) throw new Error("the first lobby tile was refused");
  for (let x = left; x <= right; x++) s.tower.place("floor", 0, x);
  for (const [lo, hi] of towers) {
    for (let x = lo; x <= hi; x++) {
      if (x !== left && !s.tower.place("lobby", 1, x).ok) throw new Error(`the lobby at ${x} was refused`);
    }
    for (let f = 2; f <= 5; f++) for (let x = lo; x <= hi; x++) s.tower.place("floor", f, x);
    if (!s.tower.placeTransport("elevatorStandard", lo + 1, 1, 5).ok) throw new Error(`no elevator at ${lo + 1}`);
  }
  for (let x = towers[0][1] + 1; x < towers[1][0]; x++) {
    if (s.tower.unitAt(1, x)) throw new Error(`the lobbies touch at ${x}`);
  }
  const fill = (kind: string, f: number, [lo, hi]: [number, number], people: number): void => {
    for (let x = lo + 5; x <= hi;) {
      const r = s.tower.place(kind, f, x);
      if (!r.ok) {
        x += 1;
        continue;
      }
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      if (people > 0) u.occupants = people;
      x += u.width;
    }
  };
  for (let f = 2; f <= 5; f++) fill("office", f, towers[0], 6);
  for (let f = 2; f <= 5; f++) fill("fastFood", f, towers[1], 0);
  const c = s.clock;
  c.minutes = c.minutes - c.minuteOfDay + 12 * 60;
  s.evaluateStar();
  g.engine.setSim(g.enginePort.sim ? s : (g.syncSim(), g.renderSim));
  g.engine.setCamera(cx + 6, 3, 1.25);
  g.speed = 0;
  g.engine.paused = false;
}

/** Four Modern towers of different heights on one lot with open air of 2, 3
 *  and 7 tiles between them, offices on their floors and an elevator in each,
 *  for the Map's gallery shots of narrow gaps between buildings
 *  (`scripts/scenes/overviewMap.ts`). Fails closed when a lobby is refused
 *  or two towers touch. */
export function buildSplitGapTowers(): void {
  const w = window as unknown as { game: any };
  const g = w.game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7301, "modern");
  const s = g.sim;
  s.money = 90_000_000;
  s.star = 3;
  const cx = Math.floor(g.grid.width / 2);
  const left = cx - 86;
  // [first column, last column, top floor] of each tower.
  const towers: [number, number, number][] = [
    [left, left + 39, 24],
    [left + 42, left + 81, 18],
    [left + 85, left + 124, 24],
    [left + 132, left + 171, 14],
  ];
  const right = towers[towers.length - 1][1];
  if (!s.tower.place("lobby", 1, left).ok) throw new Error("the first lobby tile was refused");
  for (let x = left; x <= right; x++) s.tower.place("floor", 0, x);
  for (const [lo, hi, top] of towers) {
    for (let x = lo; x <= hi; x++) {
      if (x !== left && !s.tower.place("lobby", 1, x).ok) throw new Error(`the lobby at ${x} was refused`);
    }
    for (let f = 2; f <= top; f++) for (let x = lo; x <= hi; x++) s.tower.place("floor", f, x);
    if (!s.tower.placeTransport("elevatorStandard", lo + 1, 1, top).ok) throw new Error(`no elevator at ${lo + 1}`);
    for (let f = 2; f <= top; f++) {
      for (let x = lo + 6; x + 9 <= hi + 1;) {
        const r = s.tower.place(f % 6 === 0 ? "condo" : "office", f, x);
        if (!r.ok) {
          x += 1;
          continue;
        }
        x += s.tower.getUnit(r.unitId).width;
      }
    }
  }
  for (let i = 1; i < towers.length; i++) {
    for (let x = towers[i - 1][1] + 1; x < towers[i][0]; x++) {
      if (s.tower.unitAt(1, x)) throw new Error(`the lobbies touch at ${x}`);
    }
  }
  s.evaluateStar();
  g.engine.setSim(g.enginePort.sim ? s : (g.syncSim(), g.renderSim));
  g.engine.setCamera(cx, 8, 0.6);
  g.speed = 0;
  g.engine.paused = false;
}
