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
 * (screenshot-scenes.ts) pass these by identity to `page.evaluate`.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties).
 */

/** Sweep transient chrome just before a capture: toasts always go; a stray
 *  event/emergency dialog (a random fire the running sim popped) goes unless the
 *  shot is deliberately showing a modal. Runs in the browser. */
export function pgClearTransients(keepDialogs: boolean): void {
  document.getElementById("toast-wrap")?.replaceChildren();
  if (!keepDialogs) {
    document.querySelectorAll<HTMLElement>("#modal [data-act='close'], #modal [data-act='decline']").forEach((b) => b.click());
    document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close?.());
    document.querySelector(".modal-backdrop")?.remove();
  }
}

// ---- In-page helpers (serialized into the browser by page.evaluate) ---------
// These run in the browser off window.game; they cannot reference Node scope.

/** Swap the page's live Excalibur clock for a manually stepped TestClock, so
 *  frames advance ONLY when pgStep drives them. Rendering, the decorative
 *  animation clock, and the per-frame sim feed all hang off that clock, so
 *  every capture becomes a pure function of the step count instead of wall
 *  time; that (plus seeded sims) is what makes CI regens byte-stable. Also
 *  zeroes the decorative animation clock, which accumulated a boot-dependent
 *  amount of time before adoption. Handles both page shapes: the game
 *  (window.game.engine is the TowerEngine) and the excalibur.html tooling page
 *  (window.engine is).
 *
 *  Returns a status the runner MUST check, because a silent fall-through here
 *  would quietly hand the page back to wall-clock timing and void the whole
 *  determinism guarantee: "adopted" (including already adopted), "none" (page
 *  has no engine: gallery/preview), or "failed" (an engine exists but the
 *  clock could not be swapped, e.g. an Excalibur API change). */
export function pgAdoptTestClock(): "adopted" | "none" | "failed" {
  const w = window as unknown as { game?: any; engine?: any };
  const te = w.game?.engine ?? w.engine;
  const eng = te?.engine;
  if (!eng) return "none";
  // Install the manually stepped clock if it isn't already the active one.
  // When it IS already installed (a re-entry on the same page), fall through
  // to the resets below rather than returning early: the resets are idempotent
  // and skipping them on re-entry would leave a boot-dependent decorative clock
  // or wall-time accumulator in place, reintroducing the very drift this guards.
  if (typeof eng.clock?.step !== "function") {
    // Prefer Excalibur's sanctioned frame-by-frame debug path; it stops the
    // running clock, converts it, and re-assigns it in one place.
    if (typeof eng.debug?.useTestClock === "function") eng.debug.useTestClock();
    if (typeof eng.clock?.step !== "function") return "failed";
  }
  // Zero the decorative animation clock via the engine's own reset (it
  // accumulated a boot-dependent amount before adoption). Fall back to the
  // field only if an older engine lacks the method, so a partial refactor
  // can't silently leave the clock un-reset.
  if (typeof te.resetDecorativeClock === "function") te.resetDecorativeClock();
  else if (typeof te.animClock === "number") te.animClock = 0;
  // Neither reset path exists (a TowerEngine refactor renamed both): refuse the
  // adoption rather than capture a boot-phased decorative clock. The runner
  // turns "failed" into a hard scene error, so this can't silently drift.
  else return "failed";
  // Collapse the last wall-clock input on the GAME page. main.ts drives the sim
  // from its per-frame update(), but two things there read REAL time via
  // performance.now(): the ~160ms DOM/audio/event-modal throttle, and (through
  // it) the auto-surfacing of an emergency choice modal, which sets shownChoice
  // and then FREEZES the sim (accMinutes=0, early return) until dismissed. Under
  // manual stepping those wall-time reads fire on wall-dependent frames, so a
  // live event could surface its modal (and freeze the sim) at a different step
  // each run: the tower would advance a different number of minutes and every
  // downstream shot would drift. Point performance.now() at the stepped clock
  // and clear the wall-time throttle + the sub-minute accumulator (which also
  // carried a boot-period value), so update() becomes a pure function of the
  // seeded sim and the step count. No-op for the excalibur.html tooling page
  // (no window.game), which has no such loop.
  const g = w.game;
  if (g) {
    try {
      Object.defineProperty(performance, "now", { configurable: true, value: () => eng.clock.now() });
    } catch {
      /* non-writable in a hardened Chromium: leave real time; the resets below still help */
    }
    // Pin Date.now() too. It never drives the sim clock, but the app stamps a
    // save's savedAt with it (SaveGame.saveTime) and the Saves dialog renders
    // that stamp (UI.showSaves), so a shot that quick-saves and opens the dialog
    // (first-run/02c-saves) would show a wall-clock time that differs every run.
    // A fixed epoch makes the rendered timestamp byte-stable. Constant (not the
    // stepped clock) is right here: nothing in a capture measures Date.now()
    // deltas, and a fixed absolute time is what the dialog should show.
    try {
      const FIXED_NOW = 1_704_067_200_000; // 2024-01-01T00:00:00Z, a stable stamp
      Object.defineProperty(Date, "now", { configurable: true, value: () => FIXED_NOW });
    } catch {
      /* non-writable: leave real time; only the Saves-dialog timestamp is affected */
    }
    try {
      g.lastUiUpdate = 0;
    } catch {
      /* ignore */
    }
    try {
      g.accMinutes = 0;
    } catch {
      /* ignore */
    }
  }
  return "adopted";
}

/** Step the adopted TestClock forward `frames` whole 60fps frames. Returns
 *  whether stepping happened, so the runner can fall back to a real wait on
 *  pages that have no engine clock (gallery/preview route pages, composite
 *  setContent shots). A non-finite or non-positive `frames` is treated as an
 *  invalid request: no stepping, returns false, so a bad caller can't mistake
 *  "did nothing" for "advanced time" and quietly void determinism. */
export function pgStep(frames: number): boolean {
  const w = window as unknown as { game?: any; engine?: any };
  const clock = (w.game?.engine ?? w.engine)?.engine?.clock;
  if (!clock || typeof clock.step !== "function") return false;
  const n = Math.floor(frames);
  if (!Number.isFinite(n) || n <= 0) return false;
  for (let i = 0; i < n; i++) clock.step(1000 / 60);
  return true;
}

/** Repaint the throttled DOM chrome (topbar, traffic chip, open editor) off the
 *  final sim state. The per-frame update() only refreshes that DOM every ~160ms
 *  of WALL time, so under stepped frames the last refresh lands on an arbitrary
 *  step; one explicit refresh right before capture pins it to the final state. */
export function pgRefreshUi(): void {
  const g = (window as unknown as { game?: any }).game;
  if (!g) return;
  g.ui?.update?.(g.sim);
  g.updateTraffic?.();
  if (g.selected != null && g.ui?.isEditorOpen?.() && !g.ui?.isEditorBusy?.()) g.refreshEditor?.();
}

/** Dismiss first-run splash/onboarding and resume the paused engine. */
export function pgDismissSplash(): void {
  try {
    localStorage.setItem("tt.onboarded", "1");
  } catch {
    /* ignore */
  }
  const w = window as unknown as { game?: any };
  document.querySelector("#splash [data-splash='continue'], #splash [data-splash='new']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // Remove only the first-run chrome. #scrim is a PERSISTENT app element (the
  // mobile drawer's dimming overlay, body.panels-open #scrim); deleting it would
  // break the mobile-drawer shots, so leave it (it's inert when no panel is open).
  for (const id of ["splash", "onboard"]) document.getElementById(id)?.remove();
  document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close?.());
  document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
  const g = w.game;
  if (g) {
    g.speed = 1;
    g.engine.paused = false;
  }
}

/** Fill a row of `kind` from x0 up to x1, reading each placed unit's CANON width
 *  to advance so rooms sit flush without overlap regardless of the width table. */
export function pgFillRow(kind: string, floor: number, x0: number, x1: number, state: string): void {
  const s = (window as unknown as { game: any }).game.sim;
  for (let x = x0; x + 1 <= x1; ) {
    const r = s.tower.place(kind, floor, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = state;
      u.everOccupied = true;
      x += u.width; // canon width of what actually got placed
    } else {
      x += 1; // obstacle (shaft) or edge, step over it
    }
  }
}

/** Set the tower's star rating and refresh the build palette to it, then expand
 *  the docked scroll so the whole (growing) tool list is in frame. isUnlocked()
 *  keys off star alone, so no built tower is needed to show the unlock set. */
export function pgPaletteAtStar(star: number): void {
  const g = (window as unknown as { game: any }).game;
  g.sim.star = star;
  g.ui.update(g.sim);
  for (const id of ["palette", "palette-scroll"]) {
    const el = document.getElementById(id);
    if (el) {
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
    }
  }
}

/** Set the in-game clock to a whole hour without advancing days. */
export function pgSetClock(hour: number): void {
  const c = (window as unknown as { game: any }).game.sim.clock;
  let delta = hour * 60 - c.minuteOfDay;
  if (delta < 0) delta += 1440;
  c.advance(delta);
}

/** Drive the real Map-overlay dropdown so the shot exercises the shipped path. */
export function pgSetOverlay(mode: string): void {
  const sel = document.getElementById("overlay-mode") as HTMLSelectElement | null;
  if (sel) {
    sel.value = mode;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/** Centre the Excalibur camera on the lot. */
export function pgFrame(arg: { tile: number | null; floor: number; zoom: number }): void {
  const g = (window as unknown as { game: any }).game;
  const tile = arg.tile ?? Math.floor(g.grid.width / 2);
  g.engine.setCamera(tile, arg.floor, arg.zoom);
}

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
  s.tower.placeTransport("elevatorStandard", left + 2, 1, 15);
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
  // Ground lobby grows outward from the seeded centre strip (a ground tile only
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


// ---- More scene builders (folded in from the old shot-*.mjs generators) -----

/** The end-to-end engine proof: a mid-size mixed tower centred by the engine. */
export function buildEngineTower(): void {
  const g = (window as unknown as { game: any }).game;
  const sim = g.sim;
  // Centre on the seeded lobby (newGame seeds a 40-tile strip at the grid
  // centre); a ground row only connects by touching the tower, so it must grow
  // outward from centre, not from a far edge.
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
  const left = cx - 25; // centre on the seeded lobby; grow the ground row outward
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
  // Ground lobby grows outward from the seeded centre; a sky lobby at 15.
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

