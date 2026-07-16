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

// ---- Scene builders (each self-contained; run via page.evaluate) ------------

/** The showcase hero: a tall, fully-populated tower at canon widths. */
export function buildCanonTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(2024);
  const s = g.sim;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  s.money = 50_000_000;
  s.star = 5;
  const HALF = 55;
  // Ground lobby grows OUTWARD from the seeded center strip: a ground tile only
  // connects by touching the tower, so laying from a far edge would silently
  // drop every tile left of the seed and clip the tower. (Same rule below for
  // every basement row.) Upper floors then rest on the full story beneath them.
  for (let x = cx; x <= cx + HALF; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= cx - HALF; x--) s.tower.place("lobby", 1, x);
  const span = 100;
  const left = cx - Math.floor(span / 2);
  const right = left + span;
  for (let f = 2; f <= 40; f++) for (let x = left; x < right; x++) s.tower.place("floor", f, x);
  for (const f of [15, 30]) {
    for (let x = left; x < right; x++) {
      const u = s.tower.roomAt(f, x);
      if (u) s.tower.removeUnit(u.id);
      s.tower.place("lobby", f, x);
    }
  }
  // The first bank is placed AFTER the basement dig below (it runs down to
  // the metro platform, and validateTransport rejects a span through floors
  // that do not exist yet; placing it here would silently lose the bank).
  s.tower.placeTransport("elevatorStandard", left + 8, 15, 30);
  s.tower.placeTransport("elevatorStandard", left + 14, 30, 40);
  s.tower.placeTransport("elevatorExpress", left + 20, 1, 30);
  s.tower.placeTransport("stairs", right - 12, 1, 2);
  const fill = (f: number, kind: string, state: string) => {
    for (let x = left + 26; x + 1 <= right; ) {
      const r = s.tower.place(kind, f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = state;
        u.everOccupied = true;
        if (kind === "office") u.label = "Apex Holdings";
        x += u.width;
      } else x += 1;
    }
  };
  for (let x = left + 26; x + 1 <= right; ) {
    const r = s.tower.place("fastFood", 2, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      x += u.width;
    } else x += 1;
  }
  for (let f = 3; f <= 14; f++) fill(f, "office", "occupied");
  for (let f = 16; f <= 22; f++) fill(f, "condo", "occupied");
  for (let f = 23; f <= 29; f++) fill(f, "office", "occupied");
  for (let f = 31; f <= 36; f++) fill(f, "hotelDouble", "asleep");
  fill(37, "shop", "occupied");
  fill(38, "restaurant", "occupied");
  const cine = s.tower.place("cinema", 39, left + 26);
  if (cine.ok) s.tower.getUnit(cine.unitId).state = "occupied";
  s.tower.place("security", 1, left + 26);
  s.tower.place("medical", 2, left);
  // Basement: a full-lot B1 concourse, a canon parking run on B2, and the Metro
  // Station down on B3–B5. The Metro spans the WHOLE lot AND three stories, so a
  // naive place("metro", 0, …) is rejected: a 3-floor span anchored at B1 pokes
  // above ground (it would occupy floors 0..2). Dig the basement full-width down
  // to B5 so the station has floor structure + support on every one of its
  // stories, then anchor it at B5 (floor -4) so its top story (B3) clears the B2
  // parking above it. Without an operational Metro the sim loses its +60 transit
  // capacity and commute relief, so the live hero shot wouldn't behave to canon.
  for (let x = cx; x < W; x++) s.tower.place("floor", 0, x);
  for (let x = cx - 1; x >= 0; x--) s.tower.place("floor", 0, x);
  for (let f = -1; f >= -4; f--) for (let x = 0; x < W; x++) s.tower.place("floor", f, x);
  const metro = s.tower.place("metro", -4, 0);
  if (metro.ok) s.tower.getUnit(metro.unitId).state = "occupied";
  // The first elevator bank, held back from the transport block above: it
  // serves the metro platform (B4, floor -3) through the lobby up to the
  // 15F sky lobby, and can only be placed once the basement floors exist
  // (review Edge #1: the earlier placement was silently rejected, orphaning
  // the platform AND floors 3-14). Hard-assert the result: this call is
  // order-sensitive and load-bearing for the metro scene, so a regression
  // must fail the capture loudly, not ship an empty platform.
  const platformBank = s.tower.placeTransport("elevatorStandard", left + 2, -3, 15);
  if (!platformBank.ok) throw new Error(`hero platform bank failed: ${platformBank.reason}`);
  s.tower.place("parkingRamp", -1, left);
  for (let x = left + 16; x + 1 <= right; ) {
    const r = s.tower.place("parking", -1, x);
    if (r.ok) x += s.tower.getUnit(r.unitId).width;
    else x += 1;
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 20, 0.5);
  // Keep the hero tower LIVE so commuters spawn and elevators move for the
  // people-rush shot; the per-shot pre-capture sweep clears any stray fire the
  // running sim might roll into a frame.
  g.speed = 2;
  g.engine.paused = false;
}

/** A ramp-chained basement garage for the parking/recycling/garbage shots. */
export function buildBasement(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7);
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 5;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 60;
  const right = cx + 60;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x); // grow outward
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 6; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  // offices up top so the tower has workers who need parking
  s.tower.placeTransport("elevatorStandard", left + 4, 1, 6);
  for (let f = 2; f <= 6; f++) {
    for (let x = left + 10; x + 1 <= right; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.occupants = 6;
        x += u.width;
      } else x += 1;
    }
  }
  // Four basement decks laid top-down (each rests on the one above). Decks B1/B2
  // (floors 0/-1) are parking: a 16-wide ramp then flush 4-wide spaces. Recycling
  // is 2 floors tall, so it drops to B4 (floor -3, spanning -3/-2) to stay clear
  // of the parking on 0/-1, since sharing a floor would collide.
  for (const f of [0, -1, -2, -3]) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  for (const f of [0, -1]) {
    s.tower.place("parkingRamp", f, left + 4);
    for (let x = left + 20; x + 1 <= right; ) {
      const r = s.tower.place("parking", f, x);
      if (r.ok) x += s.tower.getUnit(r.unitId).width;
      else x += 1;
    }
  }
  // A couple of recycling centers on B4 so recycling/garbage shots have a subject.
  s.tower.place("recycling", -3, left + 4);
  s.tower.place("recycling", -3, left + 26);
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, -1, 1.6);
  // Freeze: the basement shots jump the clock hours to fill recycling / summon
  // the garbage truck, and a running sim would roll random fires into the frame.
  g.speed = 0;
  g.engine.paused = true;
}

/**
 * A compact MODERN-rules tower for the mode-forked pricing shots (issue #443).
 * The pricing split (PR #440) made Classic and Modern diverge on player-visible
 * surfaces: Classic prices through the 1994 rung picker while Modern keeps the
 * free number steppers, and the stats Tenancy block adds the Modern-only
 * Households readout. The Classic halves of those shot pairs render off the
 * existing classic towers (the showcase hero and the stats tower); this builder
 * stages their Modern sibling, small on purpose, for the two light pricing
 * scenes (pricing-modern at features resolution, pricing-modern-batch at the
 * showcase gallery's resolution):
 *   - offices for the editor steppers + the batch band dialog, with a few
 *     plain vacancies (Modern never holds the No-Rate state, so unlike the
 *     Classic tenancy shot there is no off-market split to stage here);
 *   - sold condos with 2-5 person households so the Households readout has a
 *     real distribution to draw.
 */
export function buildModernPricingTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  // The mode is founded at newGame and permanent for the tower's life; this is
  // the one place the gallery builds a Modern sim (everything else stays on the
  // classic default).
  g.sim = Sim.newGame(4400, "modern");
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 3;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 30;
  const right = cx + 30;
  // Ground lobby grows outward from the seeded center strip (a ground tile only
  // connects by touching the tower); upper floors rest on the story below.
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 8; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 4, 1, 8);
  // Offices on 2..5, leased, reading each placed unit's canon width to advance.
  for (let f = 2; f <= 5; f++) {
    for (let x = left + 8; x + 1 <= right; ) {
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
  // Condos on 6..8, SOLD with a deterministic 2-5 household cycle so the
  // Modern-only Households readout shows the full size spread.
  const sizes = [2, 3, 4, 5];
  let ci = 0;
  for (let f = 6; f <= 8; f++) {
    for (let x = left + 8; x + 1 <= right; ) {
      const r = s.tower.place("condo", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        u.residents = sizes[ci % sizes.length];
        u.occupants = u.residents;
        ci++;
        x += u.width;
      } else x += 1;
    }
  }
  // Stage plain vacancies on floor 5 so the Vacancies row reads nonzero. NO
  // No-Rate here on purpose: Modern never holds the No-Rate state
  // (GameRules.coerceNoRate strips it), so an off-market split in this shot
  // would document a state the mode cannot reach; the Classic tenancy shot is
  // the one that shows the split.
  const f5 = s.tower.units.filter((u: any) => u.kind === "office" && u.floor === 5).sort((a: any, b: any) => a.x - b.x);
  if (f5.length < 5) throw new Error(`pricing-modern tower staged only ${f5.length} floor-5 offices (need 5 for the vacancy row)`);
  for (let i = 0; i < 5; i++) {
    const u = f5[i];
    u.state = "empty";
    u.everOccupied = false;
    u.occupants = 0;
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 4, 0.9);
  // Freeze: every shot here is a DOM panel/dialog over a static backdrop, and a
  // running sim would churn the frame between regens.
  g.speed = 0;
  g.engine.paused = true;
}

/** Build deterministically to a target star rating and return the star the
 *  sim's OWN evaluateStar() awards, so the milestone is honest, not forced.
 *
 *  The ladder's real gates (facilities.ts / Simulation.evaluateStar):
 *    2★ ≥ 300 pop · 3★ ≥ 1,000 + Security · 4★ ≥ 5,000 (non-hotel) + Medical +
 *    recycling demand met + ≥2 Hotel Suites + a favorable VIP · 5★ ≥ 10,000 +
 *    Metro. Offices (population 6) are the population workhorse; we build enough
 *    to clear each threshold with margin, add exactly the amenities that tier
 *    needs, leave star at 1, then let evaluateStar() raise it. place() has no
 *    minStar gate, so a 1★ tower can still host a Metro for the 5★ build. */
export function pgGrowToStar(target: number): number {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(2024 + target);
  const s = g.sim;
  s.money = 1e12;
  s.star = 1; // build UP from 1★; evaluateStar only ever raises
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  // Office count sized to clear each population threshold with ~15% headroom.
  const officesByStar: Record<number, number> = { 1: 20, 2: 70, 3: 200, 4: 960, 5: 1760 };
  const wantOffices = officesByStar[target] ?? 20;
  const left = 2;
  const right = W - 3;
  const perFloor = Math.floor((right - left) / 9); // ~40 offices across the lot
  const top = Math.max(2, Math.ceil(wantOffices / perFloor) + 1);
  // Ground lobby grows outward from the seeded center strip (a ground tile only
  // connects by touching the tower), then upper floors rest on the full story
  // beneath; laying either from a far edge would clip the tower's left side.
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= top; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  // Elevators in 15-floor zones, plus an express spanning tall towers. The
  // column cycles by band INDEX ((b-1)/15 = 0,1,2,3,...) so the x offset stays an
  // INTEGER; placeTransport doesn't floor x, and a fractional column would key the
  // structure map as "floor:6.4" (never matching), silently failing every shaft.
  for (let b = 1; b < top; b += 15) s.tower.placeTransport("elevatorStandard", left + 4 + (((b - 1) / 15) % 4) * 6, b, Math.min(b + 15, top));
  if (top > 20) s.tower.placeTransport("elevatorExpress", cx, 1, top);
  let placed = 0;
  for (let f = 2; f <= top && placed < wantOffices; f++) {
    for (let x = left; x + 1 <= right && placed < wantOffices; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        placed++;
        x += u.width;
      } else x += 1;
    }
  }
  // Tier amenities sit on a reserved floor ABOVE the offices (floor 2's columns
  // are all taken by the office fill); the widths are spaced so nothing overlaps
  // (Security 8, Medical 16, Suite 10). Basements carry recycling / the Metro.
  const amenityFloor = top + 1;
  for (let x = left; x <= right; x++) s.tower.place("floor", amenityFloor, x);
  if (target >= 3) s.tower.place("security", amenityFloor, left);
  if (target >= 4) {
    s.tower.place("medical", amenityFloor, left + 10);
    // Two hotel suites so the 4★ suite gate is met (clear of the 16-wide Medical).
    for (let i = 0; i < 2; i++) {
      const r = s.tower.place("hotelSuite", amenityFloor, left + 30 + i * 12);
      if (r.ok) s.tower.getUnit(r.unitId).state = "asleep";
    }
    s.vipFavorable = true; // stands in for a favorable VIP review
    // A basement stack, laid top-down so each deck rests on the one above:
    //  · Recycling is 2 floors tall (a room's height grows UPWARD), so its floor
    //    must be low enough that its top stays underground (≤ floor 0).
    //  · The Metro (5★) is the whole lot × 3 floors, so it claims B1..B3 (0/-1/-2),
    //    so recycling drops to B5 (floor -4, spanning -4/-3), clear of the Metro.
    //    Without a Metro (4★), recycling sits at B2 (floor -1, spanning -1/0).
    const deepest = target >= 5 ? -4 : -1;
    for (let f = 0; f >= deepest; f--) {
      for (let x = cx; x < W; x++) s.tower.place("floor", f, x);
      for (let x = cx - 1; x >= 0; x--) s.tower.place("floor", f, x);
    }
    if (target >= 5) {
      const m = s.tower.place("metro", -2, 0); // occupies floors -2/-1/0
      if (m.ok) s.tower.getUnit(m.unitId).state = "occupied";
    }
    // Recycling: one center per ~2,000 population so demand is comfortably met.
    const recFloor = target >= 5 ? -4 : -1;
    const centers = Math.ceil((placed * 6) / 2000) + 1;
    let rx = left;
    for (let i = 0; i < centers; i++) {
      const r = s.tower.place("recycling", recFloor, rx);
      if (r.ok) rx += s.tower.getUnit(r.unitId).width + 1;
      else rx += 2;
    }
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, Math.max(2, Math.floor(top / 2)), Math.max(0.18, 0.95 - top / 70));
  // Freeze so the milestone shots are byte-stable across regens (nothing here needs
  // a live crowd, unlike the showcase people-rush shot); a moving sim would churn
  // the committed diff frame-to-frame.
  g.speed = 0;
  g.engine.paused = true;
  return s.star;
}
