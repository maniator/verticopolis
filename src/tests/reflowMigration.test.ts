import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
// The real v1 save, inlined as a string (vite ?raw) so the test needs no node fs.
import towerFile from "./fixtures/towerone_6.vctower?raw";
import { Simulation } from "../engine/Simulation";
import { SAVE_VERSION, floatingStructureCount } from "../engine/saveMigration";
import { FACILITIES, facilityFloors } from "../engine/facilities";
import type { SerializedGame, Unit } from "../engine/types";

/** Decode a `.vctower` container (magic line + base64 deflate-raw JSON) with
 *  fflate — synchronous and env-agnostic (no DecompressionStream needed). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

/**
 * E1c — the v1 → v2 canon-width reflow migration (`upgradeV1toV2`, run inside
 * `migrateSave` on deserialize). A v1 save carries pre-E1b facility widths; the
 * migration re-lays each floor's rooms at their canon widths without overlaps,
 * keeps parking chains functional, and anchors ramp columns. See
 * arch-simtower-parity §1.
 */

/** A minimal, valid v1 SerializedGame carrying the given units. */
function v1Save(units: Partial<Unit>[]): SerializedGame {
  return {
    version: 1,
    seed: 1,
    money: 1e9,
    star: 3,
    minutes: 0,
    mode: "classic",
    units: units.map((u, i) => ({
      id: i + 1,
      state: "occupied",
      occupants: 0,
      everOccupied: false,
      width: 1,
      floor: 1,
      x: 0,
      ...u,
    })) as Unit[],
    transports: [],
    nextId: units.length + 1,
    towerName: "Legacy",
    builtWeddingHall: false,
    evaluatedTower: false,
  } as SerializedGame;
}

/** Paving tiles (floor/lobby) across [x0, x1) on a floor. */
function pave(kind: "floor" | "lobby", floor: number, x0: number, x1: number): Partial<Unit>[] {
  const out: Partial<Unit>[] = [];
  for (let x = x0; x < x1; x++) out.push({ kind, floor, x, width: 1 });
  return out;
}

describe("v1 → v2 reflow migration", () => {
  it("resizes a parking chain to canon, keeps every space chained, and anchors the ramp column", () => {
    // Legacy widths: ramp 6, parking 6. Chain: ramp@20, then three spaces flush.
    const save = v1Save([
      ...pave("lobby", 1, 0, 60),
      ...pave("floor", 0, 0, 60),
      { kind: "parkingRamp", floor: 0, x: 20, width: 6 },
      { kind: "parking", floor: 0, x: 26, width: 6 },
      { kind: "parking", floor: 0, x: 32, width: 6 },
      { kind: "parking", floor: 0, x: 38, width: 6 },
    ]);
    const sim = Simulation.deserialize(save);

    const ramp = sim.tower.units.find((u) => u.kind === "parkingRamp")!;
    const spaces = sim.tower.units.filter((u) => u.kind === "parking");
    // Canon widths applied.
    expect(ramp.width).toBe(FACILITIES.parkingRamp.width); // 16
    expect(spaces.every((s) => s.width === FACILITIES.parking.width)).toBe(true); // 4
    // Ramp column stays anchored at its original x (aligned across floors).
    expect(ramp.x).toBe(20);
    // Every space is still chained to the ramp → all functional.
    expect(sim.tower.functionalParkingSpots()).toBe(3);
    // The whole run is contiguous (ramp then spaces, no gaps).
    const xs = [ramp, ...spaces].map((u) => ({ x: u.x, w: u.width })).sort((a, b) => a.x - b.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i].x).toBe(xs[i - 1].x + xs[i - 1].w);
  });

  it("grows a widened room into the gap and shoves its neighbor just enough — no overlap", () => {
    // Legacy fast food (12) beside an office (9). Fast food widens to 16.
    const save = v1Save([
      ...pave("floor", 2, 0, 60),
      { kind: "fastFood", floor: 2, x: 0, width: 12 },
      { kind: "office", floor: 2, x: 12, width: 9 },
    ]);
    const sim = Simulation.deserialize(save);
    const ff = sim.tower.units.find((u) => u.kind === "fastFood")!;
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(ff.width).toBe(16); // canon
    expect(ff.x).toBe(0);
    expect(office.x).toBeGreaterThanOrEqual(ff.x + ff.width); // shoved clear, no overlap
    expect(office.width).toBe(9);
  });

  it("stays valid (and never throws) on a save that can't all fit at canon width", () => {
    // Cram more fast food (old 12, canon 16) than can fit across the lot at canon
    // width — forces the boxed-in guard / safety fallback. Loading must not throw,
    // must stamp the current version, and must leave a valid layout (no overlaps, nothing off-lot).
    const units: Partial<Unit>[] = [...pave("floor", 2, 0, 375)];
    for (let x = 0; x + 12 <= 375; x += 12) units.push({ kind: "fastFood", floor: 2, x, width: 12 });
    const sim = Simulation.deserialize(v1Save(units)); // must not throw
    expect(sim.serialize().version).toBe(SAVE_VERSION);
    const ff = sim.tower.units.filter((u) => u.kind === "fastFood").map((r) => ({ x: r.x, w: r.width })).sort((a, b) => a.x - b.x);
    for (const r of ff) expect(r.x + r.w).toBeLessThanOrEqual(375); // on-lot
    for (let i = 1; i < ff.length; i++) expect(ff[i].x).toBeGreaterThanOrEqual(ff[i - 1].x + ff[i - 1].w); // no overlap
  });

  it("keeps a boxed-in room at its legacy footprint (never flung across the tower)", () => {
    // A 2-floor recycling column (canon 20) pokes up into floor 0 at x20-40. A
    // restaurant at x0 (legacy 16) can't grow to canon 24 without hitting it —
    // canon would fling it past the column, so it must stay put at legacy width.
    const save = v1Save([
      ...pave("floor", -1, 0, 60),
      ...pave("floor", 0, 0, 60),
      { kind: "recycling", floor: -1, x: 20, width: 20 }, // 2-floor → occupies floor 0 at 20-40
      { kind: "restaurant", floor: 0, x: 0, width: 16 },
    ]);
    const sim = Simulation.deserialize(save);
    const rest = sim.tower.units.find((u) => u.kind === "restaurant")!;
    const rec = sim.tower.units.find((u) => u.kind === "recycling")!;
    expect(rest.x).toBe(0); // stayed home
    expect(rest.width).toBe(16); // LEGACY width kept (not canon 24) — the boxed-room guard
    expect(rest.x + rest.width).toBeLessThanOrEqual(rec.x); // no overlap with the column
  });

  it("never pads a floating floor when a widened room would be shoved past its floor's support", () => {
    // Floor 3's support (floor 2) ends at x=30. At legacy widths the restaurant
    // (16) + office (9) fit within 0..30. Canon-widening the restaurant to 24 would
    // shove the office to x=24..33 — past x=30, where floor 2 no longer holds it up,
    // so the reflow would pad floor-3 tiles at 30..32 over thin air. The per-floor
    // guard must instead keep the floor at legacy widths (supported, no float).
    const save = v1Save([
      ...pave("floor", 1, 0, 30), // ground, so floor 2 isn't pre-existing-floating
      ...pave("floor", 2, 0, 30),
      ...pave("floor", 3, 0, 30),
      { kind: "restaurant", floor: 3, x: 0, width: 16 },
      { kind: "office", floor: 3, x: 16, width: 9 },
    ]);
    const sim = Simulation.deserialize(save);
    expect(sim.serialize().version).toBe(SAVE_VERSION);
    // Zero floating floors: every floor tile rests on the story below.
    expect(floatingStructureCount(sim.serialize())).toBe(0);
    // Nothing off-lot, no overlap, and no room paved beyond floor 2's x=30 support.
    const rooms = sim.tower.units.filter((u) => u.kind !== "floor" && u.kind !== "lobby");
    for (const r of rooms) expect(r.x + r.width).toBeLessThanOrEqual(30);
  });

  it("resolves two ramps on one floor without overlap (multi-ramp garage)", () => {
    // Two separate ramp runs whose legacy ramps (w6) sit only 14 apart — closer
    // than the canon ramp width (16). Anchoring both at their original x would
    // overlap; the run-sweep must shove the second run clear.
    const save = v1Save([
      ...pave("floor", 0, 0, 120),
      { kind: "parkingRamp", floor: 0, x: 20, width: 6 },
      { kind: "parking", floor: 0, x: 26, width: 6 },
      { kind: "parkingRamp", floor: 0, x: 40, width: 6 },
      { kind: "parking", floor: 0, x: 46, width: 6 },
    ]);
    const sim = Simulation.deserialize(save);
    const park = sim.tower.units
      .filter((u) => u.kind === "parking" || u.kind === "parkingRamp")
      .map((u) => ({ x: u.x, w: u.width }))
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < park.length; i++) expect(park[i].x).toBeGreaterThanOrEqual(park[i - 1].x + park[i - 1].w);
    expect(sim.tower.functionalParkingSpots()).toBe(2); // both spaces still chained
  });

  it("stamps the current version and leaves a current save untouched", () => {
    const sim = Simulation.newGame(7);
    sim.money = 1e9;
    sim.tower.place("lobby", 1, 0);
    const current = sim.serialize();
    expect(current.version).toBe(SAVE_VERSION);
    // Round-trip a current save: the migration must NOT alter units again (idempotent).
    const before = JSON.stringify(current.units);
    const reloaded = Simulation.deserialize(current).serialize();
    expect(reloaded.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(reloaded.units)).toBe(before);
  });

  it("migrates the real towerone_6 save (golden fixture): canon widths, no overlaps, parking still functional, ramps aligned", () => {
    const raw = decodeVctower(towerFile);
    expect(raw.version).toBe(1); // it's a pre-migration save
    const parkingBefore = raw.units.filter((u) => u.kind === "parking").length;
    const rampXsBefore = raw.units.filter((u) => u.kind === "parkingRamp").map((u) => u.x).sort((a, b) => a - b);
    const origW = new Map(raw.units.map((u) => [u.id, u.width]));

    const sim = Simulation.deserialize(raw); // runs upgradeV1toV2
    expect(sim.serialize().version).toBe(SAVE_VERSION);

    const rooms = sim.tower.units.filter((u) => u.kind !== "floor" && u.kind !== "lobby");
    // (a) Every room is EITHER at its canon width or its original legacy width —
    // never some arbitrary in-between. A room only keeps legacy width when its
    // floor is too packed to fit every room at canon (the per-floor fallback), so
    // the overwhelming majority reach canon on this tower.
    let atCanon = 0;
    for (const r of rooms) {
      const canon = FACILITIES[r.kind].width;
      expect([canon, origW.get(r.id)]).toContain(r.width);
      if (r.width === canon) atCanon++;
    }
    expect(atCanon / rooms.length).toBeGreaterThan(0.95); // ≥95% canon-ized
    // (a2) The migration introduces NO new floating floor: every floor tile it pads
    // under a widened/shifted room rests on the story below. (A pre-existing float
    // in the original save is left as-is — the migration must never make it worse.)
    expect(floatingStructureCount(sim.serialize())).toBeLessThanOrEqual(floatingStructureCount(raw));
    // (b) No two room footprints overlap on any shared floor.
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const aF1 = a.floor + facilityFloors(a.kind) - 1, bF1 = b.floor + facilityFloors(b.kind) - 1;
        if (a.floor <= bF1 && b.floor <= aF1 && a.x < b.x + b.width && b.x < a.x + a.width) {
          throw new Error(`overlap: ${a.kind}@${a.floor}:${a.x} vs ${b.kind}@${b.floor}:${b.x}`);
        }
      }
    }
    // (c) All 85 parking spaces survive AND stay functional (chained to a ramp).
    expect(sim.tower.units.filter((u) => u.kind === "parking").length).toBe(parkingBefore);
    expect(sim.tower.functionalParkingSpots()).toBe(parkingBefore);
    // (d) Ramp columns are preserved (anchored at their original x).
    const rampXsAfter = sim.tower.units.filter((u) => u.kind === "parkingRamp").map((u) => u.x).sort((a, b) => a - b);
    expect(rampXsAfter).toEqual(rampXsBefore);
    // (e) Nothing runs off the (now 375-wide) lot.
    for (const r of rooms) expect(r.x + r.width).toBeLessThanOrEqual(375);
  });

  it("never overlaps two rooms on a floor after migrating a dense legacy strip", () => {
    // Restaurant (16→24) + cinema (24→31, 2 floors) + suite (12→10) packed tight.
    const save = v1Save([
      ...pave("floor", 2, 0, 120),
      ...pave("floor", 3, 0, 120),
      { kind: "restaurant", floor: 2, x: 0, width: 16 },
      { kind: "cinema", floor: 2, x: 16, width: 24 }, // 2-floor span comes from facilityFloors
      { kind: "hotelSuite", floor: 2, x: 40, width: 12 },
      { kind: "office", floor: 2, x: 52, width: 9 },
    ]);
    const sim = Simulation.deserialize(save);
    const rooms = sim.tower.units.filter((u) => u.kind !== "floor" && u.kind !== "lobby");
    // No two room footprints overlap on any shared floor.
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const aF1 = a.floor + (FACILITIES[a.kind].floors ?? 1) - 1;
        const bF1 = b.floor + (FACILITIES[b.kind].floors ?? 1) - 1;
        const floorsOverlap = a.floor <= bF1 && b.floor <= aF1;
        const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
        expect(floorsOverlap && xOverlap).toBe(false);
      }
    }
    // Every room reached its canon width.
    for (const r of rooms) expect(r.width).toBe(FACILITIES[r.kind].width);
  });
});
