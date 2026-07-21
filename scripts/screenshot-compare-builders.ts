/**
 * ⚠ BROWSER-INJECTED CODE (same contract as screenshot-tower-builders.ts). Each
 * function here is shipped into the page via Playwright `page.evaluate(fn)`,
 * which serializes it with `.toString()`, so it MUST be fully self-contained: no
 * imports, no references to module-scope values or sibling helpers, only its own
 * arguments and browser globals (window, document). Do NOT extract a shared
 * helper and call it from inside these; inline instead.
 *
 * CAP-8 (classic-modern-reachability): the paired "escalators can serve office
 * floors" builders for `scripts/scenes/classic-vs-modern.ts`. Two mode-forked
 * towers (same seed 4600, same shape) differing only in the `newGame` mode and
 * the fail-closed placement assert, so the still pair is a genuine rule
 * divergence. They live here, not in screenshot-tower-builders.ts, only to keep
 * that file under the file-size guard's line ceiling; the barrel
 * (screenshot-builders.ts) re-exports both sets so importers are unchanged.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** CAP-8: the MODERN half of the "escalators can serve office floors" pair. A
 *  short tower (ground lobby, a commercial floor of shops, two office floors)
 *  with an escalator run that climbs from the lobby up through the office
 *  floors, which Modern permits. Fail closed if the office-touching flights did
 *  NOT place, so the Classic twin's refusal is a genuine rule divergence and not
 *  a staging accident. Body duplicated from the Classic twin (same seed 4600,
 *  same tower shape): injected page code must be self-contained. */
export function buildEscalatorOfficeModern(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(4600, "modern");
  const s = g.sim;
  s.money = 50_000_000;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 12;
  const right = cx + 12;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 4; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  // Floor 2 is commercial (shops); floors 3-4 are offices. Escalators may touch
  // the commercial floor in BOTH modes; only Modern lets them touch offices.
  for (let x = left; x + 1 <= right; ) {
    const r = s.tower.place("shop", 2, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      u.occupants = 4;
      x += u.width;
    } else x += 1;
  }
  for (let f = 3; f <= 4; f++) {
    for (let x = left; x + 1 <= right; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        u.occupants = 6;
        x += u.width;
      } else x += 1;
    }
  }
  // The run stacks in one column (escalators share only their landing floor):
  // lobby->shops (commercial, allowed everywhere), then shops->office and
  // office->office (Modern-only). Fail closed if Modern did not permit them.
  const e1 = s.tower.placeTransport("escalator", cx, 1, 2);
  const e2 = s.tower.placeTransport("escalator", cx, 2, 3);
  const e3 = s.tower.placeTransport("escalator", cx, 3, 4);
  if (!e1.ok || !e2.ok || !e3.ok) {
    throw new Error("Modern escalators should reach the office floors but a flight was refused");
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 2, 1.2);
  g.speed = 0;
  g.engine.paused = true;
}

/** CAP-8: the CLASSIC twin of {@link buildEscalatorOfficeModern}. Same tower and
 *  seed; the lobby->shops escalator still places (commercial, allowed), but the
 *  shops->office and office->office flights are REFUSED, so the office floors
 *  keep no escalator. Fail closed if a supposedly-refused flight placed (or the
 *  refusal reason changed), so the pair can never quietly show two matching
 *  frames. Body duplicated: injected page code must be self-contained. */
export function buildEscalatorOfficeClassic(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(4600, "classic");
  const s = g.sim;
  s.money = 50_000_000;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 12;
  const right = cx + 12;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 4; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  for (let x = left; x + 1 <= right; ) {
    const r = s.tower.place("shop", 2, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      u.occupants = 4;
      x += u.width;
    } else x += 1;
  }
  for (let f = 3; f <= 4; f++) {
    for (let x = left; x + 1 <= right; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        u.occupants = 6;
        x += u.width;
      } else x += 1;
    }
  }
  const e1 = s.tower.placeTransport("escalator", cx, 1, 2);
  const e2 = s.tower.placeTransport("escalator", cx, 2, 3);
  const e3 = s.tower.placeTransport("escalator", cx, 3, 4);
  if (!e1.ok) throw new Error("Classic lobby-to-shops escalator should place but was refused");
  if (e2.ok || e3.ok) throw new Error("Classic must refuse escalators touching office floors, but one placed");
  // Both office-touching flights must be refused FOR THE OFFICE RULE, so a
  // refusal that merely happens for some other reason cannot pass as the
  // divergence this pair documents.
  for (const refused of [e2, e3]) {
    if (!/office floors/.test(refused.reason || "")) {
      throw new Error(`Classic office-escalator refusal reason changed: ${refused.reason}`);
    }
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 2, 1.2);
  g.speed = 0;
  g.engine.paused = true;
}
