import { describe, it, expect } from "vitest";
import { Tower } from "../Tower";
import { Crowd } from "../Crowd";
import { Clock } from "../Clock";
import type { FacilityKind } from "../types";
import type { Person } from "./person";
import { spawnFloors } from "./spawn";
import { spawnVenueVisit } from "./visits";

/**
 * The metro platform as an outside visit origin (GH #316). Some outside
 * visitors to a ticketed venue (a film at a cinema, a party at a party hall)
 * ride the train in: they enter at the metro platform instead of the ground
 * lobby, then route up to the venue through normal transport. Guards:
 *   - with an operational, served platform, some outside visitors originate on
 *     it and reach the venue carrying a real visit intent (mealVenueId);
 *   - such a rider carries NO `lingerFor` and no platform hold (the double-wait
 *     guard: the platform hold and the visit intent are disjoint);
 *   - with no metro, or a metro whose platform no transport reaches, every
 *     outside visitor enters at the ground lobby exactly as before.
 */

const must = (tower: Tower, kind: FacilityKind, f: number, x: number): number => {
  const r = tower.place(kind, f, x);
  if (!r.ok || r.unitId == null) throw new Error(`fixture place ${kind} @ floor ${f}, x ${x} failed: ${r.reason}`);
  return r.unitId;
};

/** A weekday clock parked inside the given hour (a bare `new Clock()` starts at
 *  07:00; explicit minutes anchor the hour exactly). */
function clockAt(hour: number): Clock {
  return new Clock(hour * 60);
}

/**
 * Full-lot ground line plus basements so a metro can hang below it, a low-rise
 * slab for the venue, and the venue itself (tenanted). The metro anchors at
 * B4 (floor -3) so its platform is floor -2, matching the metro spawn code's
 * `u.floor + 1`. Transport variants:
 *   - "served": one elevator spans the platform up through the venue, so both
 *     the platform and the ground lobby are reachable street doors.
 *   - "unreachable-platform": a lobby elevator serves the venue but starts at
 *     floor 1, so the platform is binned yet unroutable.
 *   - "no-metro": no station at all, just a lobby elevator to the venue.
 */
function venueTower(
  kind: "cinema" | "partyHall",
  variant: "served" | "unreachable-platform" | "no-metro",
): { tower: Tower; venueId: number; venueFloor: number; platform: number } {
  const tower = new Tower();
  for (let x = 0; x < 375; x++) must(tower, "lobby", 1, x);
  for (const f of [0, -1, -2, -3]) for (let x = 0; x < 375; x++) must(tower, "floor", f, x);
  for (const f of [2, 3]) for (let x = 0; x < 40; x++) must(tower, "floor", f, x);
  const venueId = must(tower, kind, 2, 0);
  tower.getUnit(venueId)!.state = "occupied";
  if (variant !== "no-metro") {
    const id = must(tower, "metro", -3, 0);
    tower.getUnit(id)!.state = "occupied";
  }
  // The served variant spans the platform (-2) up through the venue floor (3);
  // the others serve the venue from the ground lobby only.
  const from = variant === "served" ? -2 : 1;
  const res = tower.placeTransport("elevatorStandard", 4, from, 3);
  if (!res.ok) throw new Error(`shaft failed: ${res.reason}`);
  return { tower, venueId, venueFloor: 2, platform: -2 };
}

/** Fire `spawnVenueVisit` for the given outside venue `n` times. */
function spawnOutsideVisits(
  crowd: Crowd,
  tower: Tower,
  kind: "cinema" | "partyHall",
  hour: number,
  n: number,
): void {
  const floors = spawnFloors(tower, clockAt(hour));
  const venueFloors = floors.venuesByKind[kind]!;
  for (let i = 0; i < n; i++) spawnVenueVisit(crowd, tower, kind, venueFloors, floors, hour, "outside");
}

describe("metro platform as an outside visit origin", () => {
  it("cinema: some outside visitors ride the train in and reach the venue", () => {
    const { tower, venueId, venueFloor, platform } = venueTower("cinema", "served");
    const station = tower.units.find((u) => u.kind === "metro")!;
    const crowd = new Crowd(7);
    expect(spawnFloors(tower, clockAt(14)).metroStations).toHaveLength(1);
    expect(tower.isFloorServed(platform)).toBe(true);

    spawnOutsideVisits(crowd, tower, "cinema", 14, 240);
    const visitors = crowd.people.filter((p) => p.mealVenueId === venueId);
    expect(visitors.length).toBeGreaterThan(0);

    const fromPlatform = visitors.filter((p) => p.floors[0] === platform);
    const fromLobby = visitors.filter((p) => p.floors[0] === 1);
    // The mix carries both: riders arriving by train and walk-ins.
    expect(fromPlatform.length).toBeGreaterThan(0);
    expect(fromLobby.length).toBeGreaterThan(0);

    for (const p of fromPlatform) {
      // Routed up to the venue from the platform.
      expect(p.floors[p.floors.length - 1]).toBe(venueFloor);
      // Origin x stamped inside the station footprint (the platform story has
      // no floor tiles for pickX).
      expect(p.x).toBeGreaterThanOrEqual(station.x + 2);
      expect(p.x).toBeLessThanOrEqual(station.x + station.width - 3);
    }
  });

  it("a metro-origin visitor carries no platform hold (the double-wait guard)", () => {
    const { tower, venueId, platform } = venueTower("cinema", "served");
    const crowd = new Crowd(7);
    spawnOutsideVisits(crowd, tower, "cinema", 14, 240);
    const fromPlatform = crowd.people.filter((p) => p.mealVenueId === venueId && p.floors[0] === platform);
    expect(fromPlatform.length).toBeGreaterThan(0);
    for (const p of fromPlatform) {
      // `lingerFor` is the metro platform hold; the departure marker IS that
      // field. A visits-flow rider must never carry it, or it would wait at the
      // platform AND dwell at the venue. The venue dwell is set on arrival
      // (`dwellSecondsLeft`), not at spawn.
      expect(p.lingerFor).toBeUndefined();
      expect(p.dwellSecondsLeft).toBeUndefined();
    }
  });

  it("party hall: outside visitors also ride the train in", () => {
    const { tower, venueId, platform } = venueTower("partyHall", "served");
    const crowd = new Crowd(11);
    spawnOutsideVisits(crowd, tower, "partyHall", 18, 240);
    const visitors = crowd.people.filter((p) => p.mealVenueId === venueId);
    expect(visitors.length).toBeGreaterThan(0);
    const fromPlatform = visitors.filter((p) => p.floors[0] === platform);
    expect(fromPlatform.length).toBeGreaterThan(0);
    for (const p of fromPlatform) expect(p.lingerFor).toBeUndefined();
  });

  it("with no metro, every outside visitor enters at the ground lobby", () => {
    const { tower, venueId } = venueTower("cinema", "no-metro");
    const crowd = new Crowd(7);
    const floors = spawnFloors(tower, clockAt(14));
    expect(floors.metroStations).toHaveLength(0);
    spawnOutsideVisits(crowd, tower, "cinema", 14, 120);
    const visitors = crowd.people.filter((p) => p.mealVenueId === venueId);
    expect(visitors.length).toBeGreaterThan(0);
    for (const p of visitors) expect(p.floors[0]).toBe(1);
  });

  it("a metro-origin visitor's return leg lands inside the station footprint", () => {
    const { tower, venueId, venueFloor, platform } = venueTower("cinema", "served");
    const station = tower.units.find((u) => u.kind === "metro")!;
    const crowd = new Crowd(7);
    // A platform-origin visitor mid-dwell at the cinema: the outbound route
    // origin is the platform (floors[0]), no origin room (an outside visitor),
    // and the venue intent is stamped. On dwell expiry the return leg routes
    // back down to the platform, and its destX must sit inside the station
    // footprint rather than strand at the lot-edge pickX fallback (the platform
    // story has no floor tiles).
    const p: Person = {
      id: 1,
      seed: 24680,
      state: "dwelling",
      floor: venueFloor,
      fy: venueFloor,
      x: 5,
      floors: [platform, venueFloor],
      shafts: [],
      leg: 0,
      shaftId: null,
      carIndex: null,
      destX: 5,
      wait: 0,
      age: 0,
      linger: 0,
      mealVenueId: venueId,
      dwellSecondsLeft: 0.1,
    };
    crowd.people.push(p);
    crowd.advance(1, tower); // the dwell expires and the return leg is built
    expect(p.returning).toBe(true);
    expect(p.floors[p.floors.length - 1]).toBe(platform); // heading back to the platform
    expect(p.destX).toBeGreaterThanOrEqual(station.x + 2);
    expect(p.destX).toBeLessThanOrEqual(station.x + station.width - 3);
  });

  it("a return leg lands inside the footprint even if the metro broke mid-trip", () => {
    // The station's deck still physically exists when it catches fire or is
    // gutted, so a visitor who rode in and is now returning must still land on
    // it, not the lot-edge pickX fallback. The return-leg lookup is state-
    // agnostic on purpose (only the outbound origin gate is operational-only).
    const { tower, venueId, venueFloor, platform } = venueTower("cinema", "served");
    const station = tower.units.find((u) => u.kind === "metro")!;
    station.state = "fire"; // broke while the visitor was dwelling at the cinema
    const crowd = new Crowd(7);
    const p: Person = {
      id: 1,
      seed: 24680,
      state: "dwelling",
      floor: venueFloor,
      fy: venueFloor,
      x: 5,
      floors: [platform, venueFloor],
      shafts: [],
      leg: 0,
      shaftId: null,
      carIndex: null,
      destX: 5,
      wait: 0,
      age: 0,
      linger: 0,
      mealVenueId: venueId,
      dwellSecondsLeft: 0.1,
    };
    crowd.people.push(p);
    crowd.advance(1, tower);
    expect(p.returning).toBe(true);
    expect(p.destX).toBeGreaterThanOrEqual(station.x + 2);
    expect(p.destX).toBeLessThanOrEqual(station.x + station.width - 3);
  });

  it("a wedding-hall outside guest stays at the ground lobby even with a served metro", () => {
    // The wedding hall admits the `outside` origin too, so the cinema/party
    // hall-only gate in pickOutsideStreetDoor is load-bearing: a wedding guest
    // must never ride the train in, even when a served platform exists. The
    // hall crowns floor 100 (canon), reachable from the platform via a lobby
    // transfer (route -2 -> 1 -> 100), so this fixture WOULD produce
    // platform-origin guests if the gate were removed.
    const tower = new Tower();
    for (let x = 0; x < 375; x++) must(tower, "lobby", 1, x);
    for (const f of [0, -1, -2, -3]) for (let x = 0; x < 375; x++) must(tower, "floor", f, x);
    for (let f = 2; f <= 100; f++) for (let x = 0; x < 20; x++) must(tower, "floor", f, x);
    const mid = must(tower, "metro", -3, 0);
    tower.getUnit(mid)!.state = "occupied";
    expect(tower.placeTransport("elevatorStandard", 4, -2, 3).ok).toBe(true); // serves the platform
    expect(tower.placeTransport("elevatorExpress", 17, 1, 100).ok).toBe(true); // lobby to the hall
    const wid = must(tower, "weddingHall", 100, 0); // functional-when-built; leave state as placed

    const crowd = new Crowd(7);
    const floors = spawnFloors(tower, clockAt(14));
    expect(floors.metroStations).toHaveLength(1);
    expect(tower.isFloorServed(-2)).toBe(true); // a served platform is present...
    const wFloors = floors.venuesByKind.weddingHall!;
    expect(wFloors.length).toBe(1);
    for (let i = 0; i < 200; i++) spawnVenueVisit(crowd, tower, "weddingHall", wFloors, floors, 14, "outside");
    const guests = crowd.people.filter((p) => p.mealVenueId === wid);
    expect(guests.length).toBeGreaterThan(0);
    for (const p of guests) expect(p.floors[0]).toBe(1); // ...yet every guest still enters at the ground lobby
  });

  it("an unreachable platform is never used as a street door", () => {
    const { tower, venueId, platform } = venueTower("cinema", "unreachable-platform");
    const crowd = new Crowd(7);
    const floors = spawnFloors(tower, clockAt(14));
    expect(floors.metroStations).toHaveLength(1); // binned (operational)...
    expect(tower.isFloorServed(platform)).toBe(false); // ...but no transport reaches it
    spawnOutsideVisits(crowd, tower, "cinema", 14, 120);
    const visitors = crowd.people.filter((p) => p.mealVenueId === venueId);
    expect(visitors.length).toBeGreaterThan(0);
    for (const p of visitors) expect(p.floors[0]).toBe(1);
  });
});
