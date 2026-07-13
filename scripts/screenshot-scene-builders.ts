/**
 * ⚠ BROWSER-INJECTED CODE. Every function here is shipped into the page via
 * Playwright `page.evaluate(fn)`, which serializes the function with
 * `.toString()`. That means each one MUST be fully self-contained:
 *
 *   • NO imports, and NO references to module-scope values (constants, other
 *     helpers in this file, Node globals). Only its own arguments and browser
 *     globals (window, document, localStorage) survive serialization.
 *   • Do NOT "DRY up" two builders by extracting a shared helper and calling it
 *     from inside another injected function: the callee is not in the closure
 *     and the call throws (or silently no-ops) in the page. Inline instead.
 *
 * They stage the sim off the public `window.game` API (sim / engine / grid / ui)
 * and read CANON facility widths from the sim so a hardcoded stride can't gap or
 * overlap a floor. The runner (screenshots.ts) and the manifest
 * (screenshot-scenes.ts) pass these by identity to `page.evaluate`. The in-page
 * primitives they lean on (clock adoption, stepping, chrome sweeps) live in
 * `screenshot-page-ops.ts`; every set is re-exported from
 * `screenshot-builders.ts` so importers keep their existing paths.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

// ---- More scene builders (folded in from the old shot-*.mjs generators) -----

/** The end-to-end engine proof: a mid-size mixed tower centered by the engine. */
export function buildEngineTower(): void {
  const g = (window as unknown as { game: any }).game;
  const sim = g.sim;
  // Center on the seeded lobby (newGame seeds a 40-tile strip at the grid
  // center); a ground row only connects by touching the tower, so it must grow
  // outward from center, not from a far edge.
  const cx = Math.floor(g.grid.width / 2);
  const left = cx - 30;
  for (let x = cx; x < left + 60; x++) sim.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 12; f++) for (let x = left + 4; x < left + 56; x++) sim.tower.place("floor", f, x);
  for (let f = 3; f <= 7; f++)
    for (let x = left + 10; x + 1 <= left + 55; ) {
      const r = sim.tower.place("office", f, x);
      if (r.ok) {
        const u = sim.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        x += u.width; // advance by the placed unit's canon width, not a fixed stride
      } else x += 1;
    }
  for (let f = 8; f <= 12; f++)
    for (let x = left + 10; x + 6 <= left + 55; ) {
      const r = sim.tower.place("hotelDouble", f, x);
      if (r.ok) {
        sim.tower.getUnit(r.unitId).state = "asleep";
        x += sim.tower.getUnit(r.unitId).width;
      } else x += 1;
    }
  for (let x = left + 6; x + 1 <= left + 55; ) {
    const r = sim.tower.place("fastFood", 2, x);
    if (r.ok) {
      sim.tower.getUnit(r.unitId).state = "occupied";
      x += sim.tower.getUnit(r.unitId).width;
    } else x += 1;
  }
  sim.tower.placeTransport("elevatorStandard", left + 6, 1, 12);
  sim.tower.placeTransport("stairs", left + 50, 1, 2); // stairs link exactly 2 floors (maxSpanFor === 1)
  g.engine.center();
  g.speed = 2;
  g.engine.paused = false;
}

/** A compact, fully-staffed tower at the Monday-morning rush for crowd shots. */
export function buildCrowdTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(3);
  const s = g.sim;
  const cx = Math.floor(g.grid.width / 2);
  const left = cx - 25; // center on the seeded lobby; grow the ground row outward
  for (let x = cx; x < left + 50; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 10; f++) for (let x = left + 4; x < left + 46; x++) s.tower.place("floor", f, x);
  for (let f = 3; f <= 9; f++)
    for (let x = left + 10; x + 1 <= left + 45; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        u.occupants = 6;
        x += u.width; // advance by the placed unit's canon width, not a fixed stride
      } else x += 1;
    }
  s.tower.placeTransport("elevatorStandard", left + 6, 1, 10);
  s.star = 3;
  const c = s.clock;
  c.minutes = c.minutes - c.minuteOfDay + 8 * 60; // Monday 08:00
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(left + 22, 5, 1.5);
  g.speed = 2;
  g.engine.paused = false;
}

/** A tower with one room ablaze (and its neighbors), for the fire shot. */
export function buildFireTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(5);
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 4;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 22;
  const right = cx + 22;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x); // grow outward
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 9; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 9);
  const fill = (f: number, kind: string) => {
    for (let x = left + 6; x + 1 <= right; ) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        x += u.width;
      } else x += 1;
    }
  };
  for (let f = 2; f <= 9; f++) fill(f, "office");
  // Ignite a room mid-tower plus its immediate neighbors so the blaze reads.
  const targets = s.tower.units.filter((u: any) => u.kind === "office" && u.floor === 5).sort((a: any, b: any) => a.x - b.x);
  const mid = targets[Math.floor(targets.length / 2)];
  for (const u of targets) if (Math.abs(u.x - (mid?.x ?? 0)) <= 12) u.state = "fire";
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 5, 1.2);
  g.speed = 0; // freeze so the flames hold
  g.engine.paused = false;
}

/** A Modern tower whose condos are sold to a spread of household sizes. */
export function buildModernCondoTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(2024, "modern");
  const s = g.sim;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  s.money = 50_000_000;
  s.star = 5;
  const HALF = 30;
  for (let x = cx; x <= cx + HALF; x++) s.tower.place("lobby", 1, x); // grow outward
  for (let x = cx - 1; x >= cx - HALF; x--) s.tower.place("lobby", 1, x);
  const span = 52;
  const left = cx - Math.floor(span / 2);
  for (let f = 2; f <= 12; f++) for (let x = left; x < left + span; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 12);
  const spread = [3, 2, 4, 3, 5, 3, 2, 4, 3, 5, 4];
  let i = 0;
  for (let f = 2; f <= 12; f++) {
    for (let x = left; x + 1 <= left + span; ) {
      const r = s.tower.place("condo", f, x);
      if (!r.ok) {
        x += 1;
        continue;
      }
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      u.residents = spread[i % spread.length];
      i++;
      x += u.width;
    }
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 7, 0.7);
  g.speed = 1;
  g.engine.paused = false;
}

/** A well-run tower that has earned a quarter of income/elevator data. */
export function buildStatsTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(42);
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 4;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 40;
  const right = cx + 40;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x); // grow outward
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 14; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 4, 1, 14);
  s.tower.placeTransport("elevatorStandard", right - 4, 1, 14);
  const fill = (f: number, kind: string, state: string) => {
    for (let x = left + 8; x + 1 <= right - 4; ) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = state;
        u.everOccupied = true;
        if (kind === "office") u.occupants = 6;
        x += u.width;
      } else x += 1;
    }
  };
  for (let x = left + 8; x + 1 <= right - 4; ) {
    const r = s.tower.place("fastFood", 2, x);
    if (r.ok) {
      s.tower.getUnit(r.unitId).state = "occupied";
      x += s.tower.getUnit(r.unitId).width;
    } else x += 1;
  }
  for (let f = 3; f <= 9; f++) fill(f, "office", "occupied");
  for (let f = 10; f <= 14; f++) fill(f, "hotelDouble", "asleep");
  // A basement parking run so "Parking demand" has both sides of the ledger.
  for (let x = left; x <= right; x++) s.tower.place("floor", 0, x);
  s.tower.place("parkingRamp", 0, left + 4);
  for (let x = left + 20; x + 1 <= right; ) {
    const r = s.tower.place("parking", 0, x);
    if (r.ok) x += s.tower.getUnit(r.unitId).width;
    else x += 1;
  }
  // Run a simulated quarter so incomeBreakdown()/elevator loads have data.
  s.evaluateStar();
  for (let i = 0; i < 90; i++) s.tick(60);
  s.money = 9_126_661;
  g.engine.setSim(s);
  g.engine.setCamera(cx, 7, 0.6);
  g.speed = 1;
  g.engine.paused = false;
}

/** A hotspot tower: 8 healthy floors + a 3-floor jam on one weak shaft. */
export function buildHotspotTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(1);
  const s = g.sim;
  s.simModel = "v2";
  s.money = 1e12;
  s.star = 5;
  const W = g.grid.width;
  const C = Math.floor(W / 2);
  // Grow every structural row outward from the seeded center lobby. place()
  // rejects a disconnected/overhanging tile, so laying floor 1 left-to-right from
  // x=0 would strand the whole left half (nothing touches the center seed until
  // the cursor reaches it), which then starves the office fill on the jam floors.
  const layRow = (place: (x: number) => void) => {
    for (let x = C; x < W; x++) place(x);
    for (let x = C - 1; x >= 0; x--) place(x);
  };
  layRow((x) => s.tower.place("lobby", 1, x));
  for (let f = 2; f <= 20; f++) layRow((x) => s.tower.place("floor", f, x));
  s.tower.placeTransport("elevatorStandard", W - 6, 1, 10);
  s.tower.setCars(s.tower.transports[0].id, 8);
  s.tower.placeTransport("elevatorStandard", W - 12, 10, 20);
  s.tower.setCars(s.tower.transports[1].id, 1);
  const fill = (f: number, n: number) => {
    let placed = 0;
    for (let x = 0; x + 1 <= W && placed < n; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        placed++;
        x += u.width; // advance by the placed unit's canon width, not a fixed stride
      } else x += 1;
    }
  };
  for (let f = 2; f <= 9; f++) fill(f, 12);
  for (const f of [11, 12, 13]) fill(f, 30);
  s.evaluateStar();
  s.money = 9_126_661;
  g.engine.setSim(s);
  g.engine.setCamera(Math.floor(W / 2), 10, 0.5);
  g.speed = 1;
  g.engine.paused = false;
}

/** A deliberately IMPERFECT tower for the map-overlay shots. The showcase hero is
 *  fully healthy, so its overlays read as a flat green wash; this tower has vacant
 *  bands (occupancy contrast), an under-carred upper local that jams at the rush
 *  (congestion), and a block far from transport (satisfaction). It runs a FIXED
 *  tick budget so the crowd/congestion develop identically every run, then freezes
 *  for a byte-stable capture. */
export function buildOverlayTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(2024);
  const s = g.sim;
  s.money = 1e12;
  s.star = 5;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 46;
  const right = cx + 46;
  // Ground lobby grows outward from the seeded center; a sky lobby at 15.
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 28; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  for (let x = left; x <= right; x++) {
    const u = s.tower.roomAt(15, x);
    if (u) s.tower.removeUnit(u.id);
    s.tower.place("lobby", 15, x);
  }
  // Full transport for the lower zone; the UPPER zone gets a single under-carred
  // local, so the morning rush jams it (reads on the congestion overlay).
  s.tower.placeTransport("elevatorStandard", left + 4, 1, 15);
  s.tower.placeTransport("elevatorStandard", left + 12, 1, 15);
  s.tower.placeTransport("elevatorExpress", cx, 1, 28);
  s.tower.placeTransport("elevatorStandard", left + 8, 15, 28);
  const upper = s.tower.transports.find((t: any) => t.bottom === 15 && t.top === 28);
  if (upper) s.tower.setCars(upper.id, 2);
  // Occupy a VARIED pattern: most floors full, two vacant bands for the occupancy
  // overlay, and the far-right columns left unoccupied so they sit far from a
  // shaft (satisfaction overlay).
  const fill = (f: number, occupy: boolean) => {
    for (let x = left + 6; x + 1 <= right; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        if (occupy) {
          u.state = "occupied";
          u.everOccupied = true;
          u.occupants = 6;
        }
        x += u.width;
      } else x += 1;
    }
  };
  for (let f = 2; f <= 28; f++) {
    if (f === 15) continue;
    const vacantBand = (f >= 10 && f <= 12) || (f >= 24 && f <= 26);
    fill(f, !vacantBand);
  }
  s.evaluateStar();
  // Monday 08:00 + a FIXED tick budget so crowd + congestion develop identically
  // every run, then FREEZE so the capture is byte-stable.
  const c = s.clock;
  c.minutes = c.minutes - c.minuteOfDay + 8 * 60;
  for (let i = 0; i < 150; i++) s.tick(1);
  // Stage a satisfaction spread AFTER the ticks (updateSatisfaction would recompute
  // it): the well-served left/lower core stays happy, the far-right (transport-far)
  // and the jammed upper zone read unhappy, so the satisfaction overlay shows the
  // full green->red range instead of a flat-happy wash. The occupancy and congestion
  // overlays don't read satisfaction, so they're unaffected.
  for (const u of s.tower.units) {
    if (u.kind !== "office" || u.state !== "occupied") continue;
    const frac = (u.x - left) / (right - left); // 0 at the left core, 1 at the far right
    let sat = 0.95 - frac * 0.82;
    if (u.floor >= 16) sat -= 0.18; // upper zone rides the under-carred jammed shaft
    u.satisfaction = Math.max(0.08, Math.min(0.95, sat));
  }
  g.engine.setSim(s);
  g.engine.setCamera(cx, 14, 0.42);
  g.speed = 0;
  g.engine.paused = true;
}

/** A modest mixed tower for the responsive-layout (tablet) shots. */
export function buildTabletTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7);
  const s = g.sim;
  s.simModel = "v2";
  s.money = 1e12;
  s.star = 5;
  const W = g.grid.width;
  const C = Math.floor(W / 2);
  for (let x = C; x <= C + 40; x++) s.tower.place("lobby", 1, x); // grow outward
  for (let x = C - 1; x >= C - 40; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 16; f++) for (let x = C - 40; x <= C + 40; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", C - 6, 1, 16);
  s.tower.placeTransport("elevatorStandard", C + 6, 1, 16);
  const fill = (f: number, kind: string) => {
    for (let x = C - 36; x + 1 <= C + 40; ) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = kind.startsWith("hotel") ? "asleep" : "occupied";
        u.everOccupied = true;
        x += u.width;
      } else x += 1;
    }
  };
  for (let f = 2; f <= 8; f++) fill(f, "office");
  for (let f = 9; f <= 12; f++) fill(f, "condo");
  for (let f = 13; f <= 16; f++) fill(f, "hotelDouble");
  s.money = 9_126_661;
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(C, 9, 0.45);
  g.speed = 1;
  g.engine.paused = false;
}

