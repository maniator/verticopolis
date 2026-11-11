/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). Each
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document).
 *
 * The Security tower for `scripts/scenes/security.ts`: the screenshots that
 * watch guards move through the building during a bomb search (both modes, and
 * a late office joining inside one long step) and at a quiet time with no
 * event running. One builder serves every scene; the scene's `initScript`
 * leaves its choices on `window.__vcShotSecurity` before the page boots.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** A 12-floor office tower with one Security office on floor 6 and a row of
 *  fast food on floor 2 for the staff's lunch. `window.__vcShotSecurity`
 *  picks the mode, the hour the tower starts at, whether the bomb ransom call
 *  is waiting for the player (the scene's setup declines it through the real
 *  dialog), whether floor 11 keeps a gap a second Security office can be
 *  built in, and the game speed. */
export function buildSecurityTower(): void {
  const w = window as unknown as { game: any; __vcShotSecurity?: any };
  const g = w.game;
  const opts = w.__vcShotSecurity ?? {};
  const mode: string = opts.mode ?? "classic";
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(opts.seed ?? 6100, mode);
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 4;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 20;
  const right = cx + 19;
  // The founding lot differs by mode, so lay the ground row outward from the
  // center in both: every later tile connects by touching the first.
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 12; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 12);
  const room = (kind: string, f: number, x: number, people: number): number => {
    const r = s.tower.place(kind, f, x);
    if (!r.ok) return 1;
    const u = s.tower.getUnit(r.unitId);
    u.state = "occupied";
    u.everOccupied = true;
    if (people > 0) u.occupants = people;
    return u.width;
  };
  // Floor 6: the Security office at the left of the rooms, offices after it.
  const sec = s.tower.place("security", 6, left + 6);
  if (!sec.ok) throw new Error(`the Security office did not place: ${sec.reason ?? "no reason given"}`);
  const secWidth = s.tower.getUnit(sec.unitId).width;
  for (let f = 2; f <= 12; f++) {
    // Floor 11 keeps room for a second office when the scene asks for it;
    // the setup builds it at the first free tile, left on the window.
    const gap = f === 11 && opts.gap;
    const end = gap ? right - secWidth - 8 : right;
    let x = f === 6 ? left + 6 + secWidth : left + 6;
    while (x + 1 <= end) x += room(f === 2 ? "fastFood" : "office", f, x, f === 2 ? 0 : 6);
    if (gap) {
      if (right + 1 - x < secWidth) throw new Error(`floor 11 left ${right + 1 - x} free tiles, short of a Security office`);
      (window as unknown as { __vcShotSecurityGapAt?: number }).__vcShotSecurityGapAt = x;
    }
  }
  if (opts.ransom) {
    s.events.pending = {
      kind: "bombThreat",
      cost: 300_000,
      message: "💣 A caller demands a $300,000 ransom or a bomb detonates. Pay, or have Security search the tower.",
    };
  }
  const c = s.clock;
  c.minutes = c.minutes - c.minuteOfDay + (opts.hour ?? 10) * 60;
  s.evaluateStar();
  g.engine.setSim(g.enginePort.sim ? s : (g.syncSim(), g.renderSim));
  g.engine.setCamera(cx, 7, 1.0);
  g.speed = opts.speed ?? 0;
  g.engine.paused = false;
}
