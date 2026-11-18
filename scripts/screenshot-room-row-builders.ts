/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * A small Modern tower with empty floors and a condo on one of them, for
 * the row of rooms' stills (`scripts/scenes/roomRow.ts`, #646) and the Help
 * site's "Place a row of rooms" paragraph.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** A Modern tower 60 tiles wide, a lobby on floor 1 and plain floors 2 to 6,
 *  with a condo on floor 4 a third of the way across, so a row of offices
 *  dragged along floor 4 goes on past it. The row's ends (the press and the
 *  pointer) and its floor are left on `window.__vcShotRoomRow`. Founded
 *  through New Tower and built with the build tools' own engine calls; fails
 *  closed when a tile is refused. */
export function buildRoomRowTower(): void {
  const w = window as unknown as { game: any; __vcShotRoomRow?: unknown };
  const g = w.game;
  g.saveLoad.newGame("modern");
  const port = g.enginePort;
  port.setMoney(5_000_000);
  const kind = (k: string): number => g.portCodes.kind(k);
  const lay = (k: string, floor: number, x: number): boolean => port.buildAt(kind(k), floor, x)[0] === 1;
  const cx = Math.floor(g.grid.width / 2);
  const lo = cx - 30;
  const hi = cx + 29;
  for (let x = lo; x <= hi; x++) if (!lay("lobby", 1, x)) throw new Error(`the ground lobby at ${x} was refused`);
  for (let f = 2; f <= 6; f++) {
    for (let x = lo; x <= hi; x++) if (!lay("floor", f, x)) throw new Error(`the floor at ${f}:${x} was refused`);
  }
  if (!lay("condo", 4, lo + 12)) throw new Error("the condo was refused");
  g.reader.update();
  w.__vcShotRoomRow = { from: lo + 1, to: hi - 1, floor: 4 };
  g.engine.setCamera(cx + 7, 4, 1.15);
  g.speed = 0;
}
