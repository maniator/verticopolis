/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). The
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * Flights beside a venue (`src/render/venueFlights.ts`) for the Help site's
 * "Stairs and escalators" page (`scripts/scenes/venueFlights.ts`). It founds
 * the tower through the real New Tower path and builds on the hosted engine
 * with the same calls the build tools make.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** A Modern 4-star tower (the metro unlocks at 4 stars): a cinema on floors
 *  2 and 3 with a stairway against its left wall, a party hall over it on 4
 *  and 5 with an escalator against its left wall, and a metro station in the
 *  basement with an escalator and a stairway stacked against its left wall. `window.__vcShotVenueFlights` may set `{ mode: "classic" }` for the
 *  straight-flight comparison. Every venue is opened (no construction
 *  scaffolding). Fails closed when anything is refused. */
export function buildVenueFlightsTower(): void {
  const w = window as unknown as { game: any; __vcShotVenueFlights?: any };
  const g = w.game;
  const opts = w.__vcShotVenueFlights ?? {};
  g.saveLoad.newGame(opts.mode ?? "modern");
  const port = g.enginePort;
  const save = JSON.parse(port.serialize());
  save.star = 4;
  port.restore(JSON.stringify(save));
  port.setMoney(50_000_000);
  const kind = (k: string): number => g.portCodes.kind(k);
  const why = (): string => port.lastReason?.() ?? "";
  const must = (res: Float64Array, what: string): void => {
    if (res[0] !== 1) throw new Error(`${what} was refused: ${why()}`);
  };
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 30;
  const right = cx + 29;
  for (let x = cx; x <= right; x++) port.buildAt(kind("lobby"), 1, x);
  for (let x = cx - 1; x >= left; x--) port.buildAt(kind("lobby"), 1, x);
  const row = (k: string, floor: number, lo: number, hi: number): void => {
    for (let x = lo; x <= hi; x++) port.buildAt(kind(k), floor, x);
  };
  for (let f = 2; f <= 5; f++) row("floor", f, left + 2, right - 2);
  for (let f = 0; f >= -2; f--) row("floor", f, left + 2, right - 2);
  const width = (k: string): number => g.getCatalog().facilities.find((f: any) => f.key === k).width;
  const cinemaX = cx - Math.floor(width("cinema") / 2);
  must(port.buildAt(kind("cinema"), 2, cinemaX), "the cinema");
  must(port.buildShaft(kind("stairs"), cinemaX - width("stairs"), 2, 3), "the stairs by the cinema");
  must(port.buildAt(kind("partyHall"), 4, cinemaX), "the party hall");
  must(port.buildShaft(kind("escalator"), cinemaX - width("escalator"), 4, 5), "the escalator by the party hall");
  const metroX = cinemaX;
  must(port.buildAt(kind("metro"), -2, metroX), "the metro");
  const flightX = metroX - width("escalator");
  must(port.buildShaft(kind("escalator"), flightX, -2, -1), "the escalator by the metro");
  must(port.buildShaft(kind("stairs"), flightX, -1, 0), "the stairs by the metro");
  g.syncSim?.();
  for (const u of g.sim.tower.units) {
    if (u.kind !== "cinema" && u.kind !== "partyHall" && u.kind !== "metro") continue;
    if (!port.setUnitState(u.id, "occupied")) throw new Error(`the ${u.kind} would not open`);
  }
  g.syncSim?.();
  // The venues' left wall, where every flight stands.
  (window as unknown as { __vcShotVenueFlightsAt?: unknown }).__vcShotVenueFlightsAt = { wall: cinemaX };
  g.engine.setCamera(cinemaX, 3.5, 1.6);
}
