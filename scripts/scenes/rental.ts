/**
 * Modern rental living showcase (GDD gdd-verticopolis-2026-07-23-modern-rental-living):
 * a static, frozen Modern tower with a floor of occupied Studios and a floor of
 * Apartments (varied households, condo-style), plus one vacant unit showing the
 * "LEASE" on-market shell. Part of the SCENES manifest; concatenated by
 * screenshot-scenes.ts. Fully static (units placed + occupied directly, sim
 * frozen), so it needs no drawSettle and is deterministic. The Sprite Gallery
 * shot already lists the two kinds; this shows them in a real tower. Keep ERASABLE.
 */
import { PHONE, type Scene } from "../screenshot-env.ts";

/** Page-context builder: a Modern tower with a Studio floor and an Apartment
 *  floor, occupied and frozen. Self-contained (serialized into the browser), so
 *  it references only `window.game`, mirroring buildModernPricingTower. */
function buildRentalTower(): void {
  const g = (window as unknown as { game: any }).game;
  const Sim = g.sim.constructor;
  g.sim = Sim.newGame(7700, "modern");
  const s = g.sim;
  s.money = 50_000_000;
  s.star = 3; // both rentals unlocked (Studio 2, Apartment 3)
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 28;
  const right = cx + 28;
  for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 4; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
  s.tower.placeTransport("elevatorStandard", left + 3, 1, 4);
  // Floor 2: a strip of Studios (single occupants), all leased.
  for (let x = left + 6; x + 1 <= right; ) {
    const r = s.tower.place("rentalStudio", 2, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      u.occupants = 1;
      x += u.width;
    } else x += 1;
  }
  // Floor 3: Apartments with a deterministic 2-5 household cycle, all leased,
  // except the last one left vacant so the "LEASE" on-market shell is in frame.
  const sizes = [3, 2, 4, 5, 3, 2];
  const placed: any[] = [];
  let ci = 0;
  for (let x = left + 6; x + 1 <= right; ) {
    const r = s.tower.place("rentalApartment", 3, x);
    if (r.ok) {
      const u = s.tower.getUnit(r.unitId);
      u.state = "occupied";
      u.everOccupied = true;
      u.residents = sizes[ci % sizes.length];
      u.occupants = u.residents;
      ci++;
      placed.push(u);
      x += u.width;
    } else x += 1;
  }
  const last = placed[placed.length - 1];
  if (last) {
    last.state = "empty"; // on-market: shows the "LEASE" shell
    last.everOccupied = false;
    last.occupants = 0;
    last.residents = undefined;
  }
  s.evaluateStar();
  g.engine.setSim(s);
  g.engine.setCamera(cx, 2, 1.15); // frame the Studio + Apartment floors
  g.speed = 0;
  g.engine.paused = true;
}

export const RENTAL_SCENES: Scene[] = [
  {
    id: "rental-living",
    outDir: "features",
    build: buildRentalTower,
    shots: [
      {
        // Evening clock so the occupied homes read as lit (residents home).
        name: "rental-living",
        clock: 19,
        wait: 500,
      },
    ],
  },
  {
    // The phone companion Epic 8 asks for. Same frozen tower and the same evening
    // clock, so the two shots differ only by viewport: on a phone the rental floors
    // are what a player actually scrolls past, and the room art has to read at that
    // width. Static like its desktop sibling (no sim stepping), so no settle needed.
    id: "rental-living-mobile",
    outDir: "features",
    viewport: PHONE,
    build: buildRentalTower,
    shots: [
      {
        name: "rental-living-mobile",
        clock: 19,
        wait: 500,
      },
    ],
  },
];
