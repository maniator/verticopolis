import type { Simulation } from "../Simulation";

import { rentConfig, resaleRefund } from "../econConfig";
import { storeRent } from "./constants";

import { FACILITIES, buildMinutes, facilityFloors, isElevatorKind, isFacilityKind } from "../facilities";
import type { FacilityKind, WeatherKind } from "../types";

/** Build / place / sell for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

/**
 * Non-mutating feasibility + total cost for placing a facility here. Rooms
 * may auto-lay the floor beneath them, so their cost includes the floor tiles
 * that would be created. Used for build previews and by {@link build}.
 */
export function canBuild(sim: Simulation, kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string; cost: number } {
  if (!isFacilityKind(kind)) return { ok: false, reason: "Unknown facility.", cost: 0 };
  const f = FACILITIES[kind];
  if (!sim.isUnlocked(kind)) return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.`, cost: f.cost };

  if (!sim.isRoomKind(kind)) {
    // Manual structure (Modern option): no auto-bridge. A structural tile that
    // is not already connected refuses with its own reason; the player lays the
    // connecting run themselves. Cost is just the tile, never a bridge run.
    if (sim.manualStructure) {
      const c = sim.tower.canPlace(kind, floor, x);
      if (!c.ok) return { ok: false, reason: c.reason, cost: f.cost };
      const afford = sim.money >= f.cost;
      return { ok: afford, reason: afford ? undefined : "Not enough money.", cost: f.cost };
    }
    // A lobby auto-fills the gap to a neighboring lobby with lobby tiles, and
    // the plain floor tool auto-fills the gap to a neighboring floor with
    // floor tiles, so the total charge covers the bridge run in the tile's own
    // substrate (lobby tiles for a lobby, floor tiles for a floor).
    const bridge = sim.tower.bridgeFillPlan(kind, floor, x, f.width, facilityFloors(kind)).length;
    const substrateCost = kind === "lobby" ? FACILITIES.lobby.cost : FACILITIES.floor.cost;
    const c = sim.tower.canPlace(kind, floor, x);
    if (!c.ok) {
      // Rescue a structural tile that fails only because it isn't connected
      // yet: if its bridge reaches a same-substrate neighbor (bridge > 0 means
      // the fill runs up to the tile next to it), it lands connected once the
      // bridge is laid. This only works where support is HORIZONTAL (a tile
      // connects by touching a flank), which is where `Tower.isSupported` uses
      // adjacency rather than the story-below rule: the ground floor for a
      // lobby, and the ground floor OR any basement for a plain floor
      // (basements hang off flanking structure too). Above ground (floor >= 2)
      // a tile rests on the story below, which a bridge does not build, so an
      // unsupported upper tile must still refuse.
      const horizontalSupport = kind === "lobby" ? floor === 1 : floor < 2;
      const bridgeable =
        horizontalSupport && bridge > 0 && sim.tower.canPlaceStructureIgnoringSupport(kind, floor, x).ok;
      if (!bridgeable) return { ok: false, reason: c.reason, cost: f.cost };
    }
    const cost = f.cost + bridge * substrateCost;
    const afford = sim.money >= cost;
    return { ok: afford, reason: afford ? undefined : "Not enough money.", cost };
  }

  const pre = sim.tower.canPlaceRoomIgnoringFloor(kind, floor, x);
  if (!pre.ok) return { ok: false, reason: pre.reason, cost: f.cost };
  const hgt = facilityFloors(kind);
  const missing = sim.tower.missingFloorCount(floor, x, f.width, hgt);
  // Manual structure (Modern option): a room never auto-lays its own floor. If
  // the floor its footprint rests on isn't fully laid (missingFloorCount scans
  // the footprint's own story span), refuse; cost is just the room, no substrate.
  if (sim.manualStructure) {
    if (missing > 0) return { ok: false, reason: "Lay the floor under it first (manual structure is on).", cost: f.cost };
    const afford = sim.money >= f.cost;
    return { ok: afford, reason: afford ? undefined : "Not enough money.", cost: f.cost };
  }
  if (missing > 0 && !sim.tower.spanConnects(floor, x, f.width, hgt)) {
    const reason =
      floor >= 2
        ? "Rooms must sit on the floor below: no floating overhangs."
        : "Build next to the tower. You can't build in midair.";
    return { ok: false, reason, cost: f.cost };
  }
  // Beyond its own floor, a room auto-fills the gap to a neighboring module
  // with plain floor, so the total charge covers those bridge tiles too and
  // placement is blocked when the player can't afford the whole run.
  const bridge = sim.tower.bridgeFillPlan(kind, floor, x, f.width, hgt).length;
  const cost = f.cost + (missing + bridge) * FACILITIES.floor.cost;
  const afford = sim.money >= cost;
  return { ok: afford, reason: afford ? undefined : "Not enough money.", cost };
}

export function build(sim: Simulation, kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string } {
  const can = sim.canBuild(kind, floor, x);
  if (!can.ok) return { ok: false, reason: can.reason };
  const f = FACILITIES[kind];
  const hgt = facilityFloors(kind);
  // The bridge tiles baked into can.cost, read from the same pre-placement
  // state canBuild saw (the scan ignores the footprint columns, so laying the
  // footprint below can't change this count).
  // Manual structure lays no auto-substrate at all (canBuild already refused a
  // placement that would need any), so there is no bridge to quote or fill.
  const quotedBridge = sim.manualStructure ? 0 : sim.tower.bridgeFillPlan(kind, floor, x, f.width, hgt).length;
  // A room lays its own floor where missing (so you never pre-build bare
  // floors for an office or condo, just drop it next to the tower), UNLESS
  // manual structure is on, where the player has already laid it.
  if (sim.isRoomKind(kind) && !sim.manualStructure) {
    const ef = sim.tower.ensureFloorUnder(floor, x, f.width, hgt);
    if (!ef.ok) return { ok: false, reason: ef.reason };
  }
  // Bridge the gap to a neighboring module/lobby BEFORE placing the primary, so
  // a detached ground concourse lobby is connected by the time it lands (rooms
  // and sky lobbies already rest on the story below, so the order is harmless
  // for them). The fill builds outward from the existing neighbor. If the
  // primary still fails after the bridge, roll the bridge tiles back so a
  // rejected build never orphans structure (nothing was charged for them yet).
  const laidBridge = sim.manualStructure ? [] : sim.tower.fillBridge(kind, floor, x, f.width, hgt);
  const res = sim.tower.place(kind, floor, x);
  if (!res.ok) {
    for (const id of laidBridge) sim.tower.removeUnit(id);
    return { ok: false, reason: res.reason };
  }
  // Charge only for tiles actually laid: the plan is exact so this equals
  // can.cost, but reconciling to the real count means a partial fill could
  // never overcharge.
  const substrateCost = kind === "lobby" ? FACILITIES.lobby.cost : FACILITIES.floor.cost;
  sim.money -= can.cost - (quotedBridge - laidBridge.length) * substrateCost;
  // Canon retail variant: shop / fastFood / restaurant carry a named
  // subtype ("Chinese Cafe", "Book Store", ...) from the seeded RNG. Every
  // other kind short-circuits BEFORE the RNG draw (see rollRetailSubtype)
  // so a Classic tower whose diet skips retail stays byte-identical.
  if (res.unitId !== undefined) {
    const name = sim.rollRetailSubtype(kind);
    if (name !== undefined) {
      const u = sim.tower.getUnit(res.unitId);
      if (u) u.subtype = name;
    }
    // A new build in a ladder-priced mode starts on the Average rung (epics
    // AR6). Stored explicitly whenever Average differs from the band default
    // (Classic condos/hotels), so `rentOf` reads a real rung, never an
    // off-ladder band default; where they coincide (offices) the override is
    // stripped, exactly like every other neutral-priced write.
    const priceShape = sim.rules.priceOptions(kind);
    if (priceShape?.shape === "ladder") {
      const u = sim.tower.getUnit(res.unitId);
      const cfg = rentConfig(kind);
      if (u && cfg) storeRent(u, cfg, priceShape.rungs[2].value);
    }
  }
  // Rooms spend time under construction before they can be used.
  const dur = buildMinutes(kind);
  if (dur > 0 && res.unitId !== undefined) {
    const u = sim.tower.getUnit(res.unitId);
    if (u) {
      u.state = "construction";
      u.completeAt = sim.clock.minutes + dur;
      sim.constructing.add(u.id);
    }
  }
  if (kind === "weddingHall") {
    sim.emit("Wedding Hall built! A VIP will inspect your tower soon.", "good");
    sim.vipVisitDay = sim.clock.day + 3;
  }
  // Excavating the basement occasionally turns up buried treasure, just like
  // digging the foundations in the original. Only real rooms trigger it (not
  // the many single floor tiles), and only on tiles never dug before, so it
  // stays a rare windfall and can't be farmed by build/bulldoze cycling.
  if (floor <= 0 && sim.isRoomKind(kind)) {
    let freshGround = false;
    const hgt = facilityFloors(kind);
    for (let fl = floor; fl < floor + hgt; fl++) {
      for (let i = 0; i < f.width; i++) {
        const k = `${fl}:${x + i}`;
        if (!sim.excavated.has(k)) {
          freshGround = true;
          sim.excavated.add(k);
        }
      }
    }
    // Capped per tower so cheap basement parking can't be farmed for tens of
    // millions, it stays a rare windfall, not an income engine.
    if (freshGround && sim.treasuresFound < 3 && sim.rng.chance(0.18)) {
      sim.treasuresFound++;
      const gold = 400_000 + sim.rng.int(0, 200_000); // ~half a million, per the FAQ
      sim.money += gold;
      sim.emit(`💰 Excavation crews unearthed buried treasure worth $${gold.toLocaleString()}!`, "money");
      sim.triggerTreasure(floor, x + Math.floor(f.width / 2)); // sparkle at the dig site (cosmetic)
    }
  }
  return { ok: true };
}

export function buildTransport(sim: Simulation,
  kind: FacilityKind,
  x: number,
  bottom: number,
  top: number,
): { ok: boolean; reason?: string } {
  const f = FACILITIES[kind];
  if (!sim.isUnlocked(kind)) {
    return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.` };
  }
  // Elevators charge per served floor on top of the base price.
  const span = top - bottom;
  const extra = isElevatorKind(kind) ? span * 5_000 : 0;
  const total = f.cost + extra;
  if (sim.money < total) return { ok: false, reason: "Not enough money." };
  const res = sim.tower.placeTransport(kind, x, bottom, top);
  if (!res.ok) return { ok: false, reason: res.reason };
  sim.money -= total;
  return { ok: true };
}

/** Bulldoze a unit/transport for a partial refund. */
export function sellAt(sim: Simulation, floor: number, x: number): boolean {
  const t = sim.tower.transportAt(floor, x);
  const u = sim.tower.unitAt(floor, x);
  // Prefer removing a room over the transport/floor beneath it.
  if (u && u.kind !== "floor" && u.kind !== "lobby") {
    // Can't sell a burning unit, the bulldozer is post-fire cleanup, not a
    // way to end a blaze and skip the rescue fee. Mirrors the UI-side guards
    // so every removal path upholds the anti-cheat.
    if (u.state === "fire") return false;
    sim.tower.removeUnit(u.id);
    // A gutted shell has no salvage value; everything else refunds half.
    sim.money += u.state === "gutted" ? 0 : resaleRefund(u.kind);
    // If the last Wedding Hall is gone before the VIP arrived, cancel the
    // pending inspection so it can't keep re-failing and spamming the log.
    if (u.kind === "weddingHall" && !sim.tower.builtWeddingHall && !sim.evaluatedTower) {
      sim.vipVisitDay = -1;
    }
    return true;
  }
  if (t) {
    sim.tower.removeTransport(t.id);
    sim.money += resaleRefund(t.kind);
    return true;
  }
  if (u) {
    // A floor/lobby tile that holds up the story above can't be pulled out,
    // that would leave the structure above hanging in midair.
    if (sim.tower.removalReason(u.id)) return false;
    sim.tower.removeUnit(u.id);
    sim.money += resaleRefund(u.kind);
    return true;
  }
  return false;
}

/** True for kinds that ride on a floor (and so can auto-lay one). */
export function isRoomKind(_sim: Simulation, kind: FacilityKind): boolean {
  return kind !== "floor" && kind !== "lobby" && !FACILITIES[kind].transport;
}

/** Whether a facility kind is currently unlocked by star rating. */
export function isUnlocked(sim: Simulation, kind: FacilityKind): boolean {
  return sim.star >= FACILITIES[kind].minStar;
}

/**
 * Deterministic per-day sky weather, a self-contained hash of the day, kept
 * off the gameplay RNG so adding it can't shift any seeded outcome. Mostly
 * clear, sometimes cloudy, occasionally rainy.
 */
export function weatherFor(day: number): WeatherKind {
  // 32-bit integer mixing via Math.imul (plain * would lose precision past 2^53).
  let h = Math.imul(day | 0, 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  const r = ((h >>> 8) & 0xffff) / 0x10000;
  return r < 0.62 ? "clear" : r < 0.85 ? "cloudy" : "rain";
}
