/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * Two Modern towers with a sky lobby on floor 15 each and open air between
 * them, at 3 stars, for the Sky Bridge tool's stills (`scripts/scenes/skyBridge.ts`)
 * and the Help site's "Sky bridges" section.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** Two Modern towers 14 tiles wide with 17 tiles of open air between them,
 *  floors 2 to 17 with offices, and a sky lobby across each on floor 15. The
 *  lot's center column (the middle of the gap) and the sky lobby floor are
 *  left on `window.__vcShotSkyBridge`. Founded through New Tower and built
 *  with the build tools' own engine calls; fails closed when a tile is
 *  refused or the gap is not open air. */
export function buildSkyBridgeTower(): void {
  const w = window as unknown as { game: any; __vcShotSkyBridge?: unknown };
  const g = w.game;
  g.saveLoad.newGame("modern");
  const port = g.enginePort;
  const save = JSON.parse(port.serialize());
  save.star = 3;
  port.restore(JSON.stringify(save));
  port.setMoney(50_000_000);
  // Two towers with open air between them: no floor bridges the gap.
  port.chooseAutoBridge(false);
  const kind = (k: string): number => g.portCodes.kind(k);
  const lay = (k: string, floor: number, x: number): boolean => port.buildAt(kind(k), floor, x)[0] === 1;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const catalog = g.getCatalog();
  const sky: number = catalog.world.lobbyInterval;
  const office: number = catalog.facilities.find((f: { key: string }) => f.key === "office").width;
  const towers: [number, number][] = [
    [cx - 22, cx - 9],
    [cx + 9, cx + 22],
  ];
  for (const [lo, hi] of towers) {
    for (let x = lo; x <= hi; x++) if (!lay("lobby", 1, x)) throw new Error(`the ground lobby at ${x} was refused`);
    for (let f = 2; f <= sky + 2; f++) {
      const k = f === sky ? "lobby" : "floor";
      for (let x = lo; x <= hi; x++) if (!lay(k, f, x)) throw new Error(`the ${k} at ${f}:${x} was refused`);
    }
    for (let f = 2; f <= sky + 2; f++) {
      if (f === sky) continue;
      for (let x = lo; x <= hi; ) x += lay("office", f, x) ? office : 1;
    }
  }
  g.reader.update();
  for (let x = towers[0][1] + 1; x < towers[1][0]; x++) {
    if (g.reader.tower.structureKindAt(sky, x) !== undefined) throw new Error(`the gap is not open air at ${x}`);
  }
  w.__vcShotSkyBridge = { cx, sky };
  g.engine.setCamera(cx, sky, 1.6);
  g.speed = 0;
}

/** Five Modern towers 10 tiles wide with four 6-tile gaps between them, floors
 *  2 to 17 with a sky lobby across each on floor 15, for the bridge looks'
 *  stills. The gaps' center columns and the sky lobby floor are left on
 *  `window.__vcShotSkyBridgeLooks`. Founded and built like
 *  {@link buildSkyBridgeTower}; fails closed when a tile is refused. */
export function buildSkyBridgeLooksTower(): void {
  const w = window as unknown as { game: any; __vcShotSkyBridgeLooks?: unknown };
  const g = w.game;
  g.saveLoad.newGame("modern");
  const port = g.enginePort;
  const save = JSON.parse(port.serialize());
  save.star = 3;
  port.restore(JSON.stringify(save));
  port.setMoney(50_000_000);
  port.chooseAutoBridge(false);
  const kind = (k: string): number => g.portCodes.kind(k);
  const lay = (k: string, floor: number, x: number): boolean => port.buildAt(kind(k), floor, x)[0] === 1;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const sky: number = g.getCatalog().world.lobbyInterval;
  const left = cx - 37;
  const gaps: number[] = [];
  for (let t = 0; t < 5; t++) {
    const lo = left + t * 16;
    const hi = lo + 9;
    if (t > 0) gaps.push(lo - 3);
    for (let x = lo; x <= hi; x++) if (!lay("lobby", 1, x)) throw new Error(`the ground lobby at ${x} was refused`);
    for (let f = 2; f <= sky + 2; f++) {
      const k = f === sky ? "lobby" : "floor";
      for (let x = lo; x <= hi; x++) if (!lay(k, f, x)) throw new Error(`the ${k} at ${f}:${x} was refused`);
    }
  }
  g.reader.update();
  w.__vcShotSkyBridgeLooks = { cx, sky, gaps };
  g.engine.setCamera(cx + 10, sky, 1.1);
  g.speed = 0;
}
