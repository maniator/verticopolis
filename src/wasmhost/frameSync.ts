import type { Simulation } from "../engine/Simulation";
import { markRoom } from "../engine/tower/rooms";
import type { Person } from "../engine/crowd/person";
import type { FrameView } from "./frameView";
import { PERSON_OPTIONALS, clearOptional } from "./personFields";

/** The step-mode frame sync's per-record writers: the crowd, the units'
 *  per-frame counters and the cars, from a decoded frame view onto the read
 *  model (the WASM host, `wasmHost.ts`). */

export function syncPeople(sim: Simulation, frame: FrameView): void {
  const held = new Map<number, Person>();
  for (const p of sim.crowd.people) held.set(p.id, p);
  const next = frame.people.map((r) => {
    let p = held.get(r.id);
    if (!p) {
      // A person first seen in a frame starts from placeholders for the
      // fields the frame does not carry (the route's leg, shaftId and
      // carIndex, destX, tripWait, age, linger), so a reader of those sees
      // a new walker's values even while the engine has the person riding.
      // Backlog #868 owns the gap.
      p = {
        id: r.id, seed: r.seed, state: r.state, floor: r.floor, fy: r.fy, x: r.x,
        floors: [], originFloor: r.originFloor, shafts: [], leg: 0, shaftId: null, carIndex: null,
        destX: r.x, wait: r.wait, tripWait: 0, age: 0, linger: 0,
      };
    } else {
      p.seed = r.seed;
      p.state = r.state;
      p.floor = r.floor;
      p.x = r.x;
      p.fy = r.fy;
      p.wait = r.wait;
      p.originFloor = r.originFloor;
    }
    // The route, in place: a holder of the arrays sees the new legs.
    p.floors.splice(0, p.floors.length, ...r.floors);
    p.shafts.splice(0, p.shafts.length, ...r.shafts);
    for (const key of PERSON_OPTIONALS) {
      const value = r[key];
      if (value === undefined) clearOptional(p, key);
      else (p as Record<typeof key, typeof value>)[key] = value;
    }
    // The flags: true when set, and a false one cleared as above.
    if (r.staff) p.staff = true;
    else clearOptional(p, "staff");
    if (r.countedHotelGuest) p.countedHotelGuest = true;
    else clearOptional(p, "countedHotelGuest");
    if (r.returning) p.returning = true;
    else clearOptional(p, "returning");
    return p;
  });
  sim.crowd.people.splice(0, sim.crowd.people.length, ...next);
}

export function syncUnits(sim: Simulation, frame: FrameView): void {
  for (const r of frame.units) {
    const u = sim.tower.byId.get(r.id);
    if (!u) continue;
    // The HUD's room counts recount a room only when a field they read moved.
    if (u.state !== r.state || u.customersIn !== r.customersIn) markRoom(sim.tower, u);
    u.state = r.state;
    u.occupants = r.occupants;
    u.customersIn = r.customersIn;
    u.hotelCustomersIn = r.hotelCustomersIn;
    u.outForMeal = r.outForMeal;
  }
}

export function syncCars(sim: Simulation, frame: FrameView): void {
  for (const r of frame.transports) {
    const t = sim.tower.transportsById.get(r.id);
    if (!t) continue;
    t.carPositions.splice(0, t.carPositions.length, ...r.carPositions);
    t.carDir.splice(0, t.carDir.length, ...r.carDir);
    if (r.carLoad) {
      if (t.carLoad) t.carLoad.splice(0, t.carLoad.length, ...r.carLoad);
      else t.carLoad = r.carLoad;
    } else {
      delete t.carLoad;
    }
  }
}
