import type { Simulation } from "../Simulation";

import { rentOf, rentConfig } from "../econConfig";

import { subtypeListFor } from "../retailSubtypes";
import { FACILITIES, isCommercialKind, isOpenAt, isHotelKind, residentCount } from "../facilities";
import type { FacilityKind, Unit, VacateReason } from "../types";

import { isDormant, isOperational, VACATE_REASON_TEXT } from "../types";

import { VACATE_NOTICE_MINUTES, VACATE_RESCIND, NOISE_CAP, NOISE_EROSION, CONDO_NOISE_EROSION, TRANSPORT_FAR_TILES, OFFICE_NOISE_TILES, HOTEL_NOISE_TILES } from "./constants";

/** Presence, satisfaction, noise notices for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function updatePresence(sim: Simulation): void {
  const weekend = sim.clock.isWeekend;
  for (const u of sim.tower.units) {
    const f = FACILITIES[u.kind];
    if (isDormant(u)) {
      u.occupants = 0;
      continue;
    }
    switch (u.kind) {
      case "office":
        // Offices staffed on weekday working hours.
        u.occupants =
          !weekend && sim.clock.hour >= 8 && sim.clock.hour < 18 ? f.population : 0;
        break;
      case "condo":
        // Residents home in evenings/night/weekends, the whole household
        // (its real size in Modern, the flat 3 in Classic); one person stays
        // home during the weekday workday.
        u.occupants =
          sim.clock.isNight() || sim.clock.isEvening() || weekend ? residentCount(u) : 1;
        break;
      case "hotelSingle":
      case "hotelDouble":
      case "hotelSuite":
        u.occupants = u.state === "asleep" ? f.population : 0;
        break;
      default:
        // Every kind without its own case above takes this open-hours gate.
        // It only changes behavior for commercial venues (fastFood,
        // restaurant, shop): they show their ambient crowd only while open,
        // so a tenanted but closed venue reads zero and the heatmap and
        // lit-window sprite go dark after closing time. The other
        // default-branch kinds are unaffected: cinema and partyHall have
        // population 0 (occupants is 0 either way) and kinds without
        // business hours pass isOpenAt unconditionally.
        u.occupants =
          u.state === "occupied" && isOpenAt(u.kind, sim.clock.hour)
            ? f.population
            : 0;
    }
  }
}

export function updateSatisfaction(sim: Simulation): void {
  // v2 (review F3): congestion is SPATIAL, each floor is stressed only by the
  // shafts that actually serve it, so layout/zoning/parallel shafts matter.
  // v1: one tower-wide scalar applied to everyone (the shipped behavior).
  const congMap = sim.simModel === "v2" ? sim.spatialCongestionByFloor() : null;
  const globalCong = congMap
    ? Math.max(0, ...[0, ...congMap.values()])
    : sim.congestion();
  // Warn the player when their elevators can't keep up.
  if (globalCong > 1.4 && sim.clock.hour === 9 && sim.rng.chance(0.5)) {
    sim.emit("Tenants are complaining of long elevator waits. Add cars or shafts.", "bad");
  }
  // New notices this tick are batched into one toast (like move-ins) so a
  // tower-wide problem raises a single alarm, not one per unit.
  const notices: { floor: number; kind: FacilityKind; reason: VacateReason }[] = [];
  for (const u of sim.tower.units) {
    if (isDormant(u)) continue;
    const served = sim.tower.isFloorServed(u.floor);
    const cong = congMap ? (congMap.get(u.floor) ?? 0) : globalCong;
    // A bigger Modern household leans harder on the tower: scale only the
    // NEGATIVE access/congestion pressures, never the recovery, so a well-served
    // big family is just as happy as a small one, the size only bites when the
    // tower is failing them. The rule-set returns 1 in Classic (and for
    // flat/unsold condos), so those towers are untouched.
    const churn = sim.rules.churnMultiplier(u.residents);
    if (!served) {
      u.satisfaction = Math.max(0, u.satisfaction - 0.15 * churn);
    } else if (u.floor !== 1 && cong > 1) {
      // Overcrowded vertical transport stresses everyone, more so the worse it
      // is, but tenants on the ground floor (floor 1) never ride an elevator,
      // so elevator congestion can't possibly bother them.
      u.satisfaction = Math.max(0, u.satisfaction - 0.04 * Math.min(3, cong - 1) * churn);
    } else {
      u.satisfaction = Math.min(1, u.satisfaction + 0.05);
    }
    // Rent pressure: charging an office above the going rate erodes
    // satisfaction (and so retention); undercutting it keeps tenants happy.
    // The coefficient is tuned to exceed the +0.05 served-recovery near the
    // top of the band, so a gouged office trends to a net-negative drift and
    // eventually vacates, otherwise rent would be free money (fill cheap,
    // then crank to max with no downside).
    if (u.kind === "office" && served) {
      const cfg = rentConfig("office")!;
      const over = (rentOf(u) - cfg.default) / cfg.default; // <0 cheap, >0 pricey
      u.satisfaction = Math.max(0, Math.min(1, u.satisfaction - over * 0.07));
    }
    // Placement pressure (canon "…is too noisy" / "the stairs/elevators are far
    // away"): a served room is worn down in two phases, an immediate annoyance
    // CEILING (NOISE_CAP), then, if the cause is never dealt with, a slow EROSION
    // past it (NOISE_EROSION outpaces the +0.05 served recovery). Sustained,
    // unaddressed exposure drives the tenant below the rescind bar and out;
    // fixing the cause lets satisfaction recover normally. Two causes feed this
    // one drain:
    //   • W1 transport-too-far, a served office whose nearest reachable shaft on
    //     its floor sits beyond the walking tolerance (ground-floor offices walk
    //     to the lobby, not a shaft, so they're exempt; offices can't be founded
    //     on floor 1 anyway, so this guard is belt-and-suspenders).
    //   • W2 noise, a noise-sensitive room within its canon buffer of a source
    //     (office↔commercial 11, hotel/condo↔office-or-commercial 21; see
    //     {@link noiseAfflicted}), widening the old 1-tile office→hotel rule.
    // They share ONE erosion step per tick (not one each): a doubly-afflicted
    // office still erodes at the telegraphed ≈ −0.02/hr and lands on the 0.6 cap,
    // rather than eroding twice and cratering at ~2× the documented rate. The
    // cause is attributed in vacateCause (transport-far before noise). Erode THEN
    // clamp to the cap so a freshly-exposed unit lands exactly on 0.6.
    const farWalk =
      u.kind === "office" &&
      served &&
      u.floor !== 1 &&
      sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES;
    const noisy =
      (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo") &&
      served &&
      sim.noiseAfflicted(u);
    if (farWalk || noisy) {
      // A *sold* condo (everOccupied) is an owner, not a nightly guest, so it
      // erodes at the gentler condo rate, sticky against a transient neighbor
      // the player removes in time, worn out only by sustained, unaddressed
      // adjacency. Hotels, offices, and any not-yet-sold condo keep the steeper
      // rate; gating on everOccupied matches the "sold" predicate the rest of the
      // condo logic uses (priceUnit, overhead) and is robust to a corrupt save
      // with an occupied-but-unsold condo. The annoyance cap is shared, so all
      // still redden on the stats overlay from the moment of exposure.
      const baseErosion = u.kind === "condo" && u.everOccupied ? CONDO_NOISE_EROSION : NOISE_EROSION;
      // W1 transport-too-far is canon parity and erodes in EVERY tower. W2
      // office-noise is the Modern-only mechanic: when noise is the ONLY cause,
      // Classic scales the erosion to 0 so noise merely CAPS satisfaction at
      // NOISE_CAP and never erodes/evicts (canon "noise caps but never evicts");
      // Modern keeps eroding. A far-walk office always erodes regardless of mode.
      const scale = farWalk ? 1 : sim.rules.noiseErosionScale();
      const erosion = baseErosion * scale;
      u.satisfaction = Math.max(0, Math.min(u.satisfaction - erosion, NOISE_CAP));
    }
    // NOTE: the individually-routed crowd's frustration is exposed read-only via
    // {@link crowdStress} for the HUD, but is deliberately NOT written back into
    // satisfaction, its value depends on frame/step cadence, so feeding it into
    // the authoritative, persisted satisfaction would make the headless and
    // browser runs diverge. The aggregate congestion model above is the single
    // authoritative stress driver.
    // Tenants abandon a unit that stays unbearable. Offices and condos are
    // long-term leases, so a bottomed-out satisfaction first puts them "on
    // notice", the `vacating` grace period, rather than evicting instantly;
    // fix the cause in time and they rescind and stay. Hotel guests have no
    // lease to give notice on (and a room cycles nightly), so a chronically
    // miserable room simply fails to hold its guest right away (review F25).
    // Commercial venues aren't here: their income already requires a served
    // floor, so poor access starves them directly rather than via move-out.
    const leaseTenant = u.kind === "office" || u.kind === "condo";
    if (leaseTenant && u.state === "vacating") {
      // A relocation is a life event, not a complaint: nothing the player does
      // (not even a fully satisfied tenant) rescinds it, and it is never
      // re-attributed to another cause. Read it up front from the original
      // reason so no branch below can flip it. (The noise re-attribution below
      // only fires for a "noise" reason, so a relocation never reaches it, but
      // reading it here keeps that independence obvious.)
      const isRelocation = u.vacateReason === "relocation";
      // A mode that caps noise but never evicts for it (Classic:
      // noiseErosionScale 0) must not let a "noise" notice fire, including one
      // carried in from a pre-split save where noise still eroded. But a real
      // non-noise problem that has appeared since the notice (the floor went
      // unserved, its transport is congested, or a far-walk office lost its
      // shaft) can still evict. So when noise can't be the cause, re-attribute a
      // stale "noise" stamp to the live cause if such a problem exists, and
      // otherwise rescind the notice outright. Classic thus never shows a
      // noise-caused eviction, while a genuine access problem still lands.
      const noiseCannotEvict = u.vacateReason === "noise" && sim.rules.noiseErosionScale() === 0;
      // Every non-noise satisfaction sink still bites in Classic (only noise is
      // mode-gated), so mirror vacateCause's non-noise causes: unserved
      // (access), congested, an office priced over the going rate (rent), or a
      // far-walk office (transportFar). Any of these is a real problem that must
      // still evict, so it blocks the noise rescind and re-attributes the stamp.
      const officeCfg = u.kind === "office" ? rentConfig("office") : undefined;
      const overMarketRent = !!officeCfg && rentOf(u) > officeCfg.default;
      const nonNoiseProblem = !served || (u.floor !== 1 && cong > 1) || overMarketRent || farWalk;
      if (noiseCannotEvict && nonNoiseProblem) {
        u.vacateReason = sim.vacateCause(u, served, cong);
      }
      const rescindNoise = noiseCannotEvict && !nonNoiseProblem;
      if (!isRelocation && (u.satisfaction >= VACATE_RESCIND || rescindNoise)) {
        // Conditions recovered inside the notice window, so they quietly stay.
        // No toast: "silence when correct", and a per-tick good/bad pair on a
        // unit that flaps around the threshold would be pure noise. The
        // clearing inspector/ribbon is the (pull) cue that the fix worked.
        u.state = "occupied";
        u.vacateReason = undefined;
        u.vacateAt = undefined;
        // Lift a rescinded noise-only tenant to the cap so a migrated save
        // becomes self-consistent (a noise-capped unit sits AT the cap, as a
        // fresh Classic tower would, not below it from the old erosion).
        if (rescindNoise) u.satisfaction = Math.max(u.satisfaction, NOISE_CAP);
      } else if (sim.clock.minutes >= (u.vacateAt ?? 0)) {
        // Notice ran out and it's still unbearable, so they leave for good.
        sim.vacate(u, u.vacateReason ?? "access");
      }
    } else if (leaseTenant && u.satisfaction <= 0) {
      // Give notice: enter the grace period with the attributed cause.
      u.state = "vacating";
      u.vacateReason = sim.vacateCause(u, served, cong);
      u.vacateAt = sim.clock.minutes + VACATE_NOTICE_MINUTES;
      notices.push({ floor: u.floor, kind: u.kind, reason: u.vacateReason });
    } else if (u.satisfaction <= 0 && isHotelKind(u.kind)) {
      sim.vacate(u, sim.vacateCause(u, served, cong));
    }
  }
  sim.emitNotices(notices);
}

/** Announce this tick's fresh notices as a single toast: a named unit when
 *  just one gave notice, or a per-cause tally when several did at once, so a
 *  tower-wide access/congestion problem is one alarm, not a flood. */
export function emitNotices(sim: Simulation, notices: { floor: number; kind: FacilityKind; reason: VacateReason }[]): void {
  if (notices.length === 0) return;
  if (notices.length === 1) {
    const n = notices[0];
    sim.emit(
      `${FACILITIES[n.kind].name} on ${sim.floorLabel(n.floor)} gave notice: ${VACATE_REASON_TEXT[n.reason]}. Fix it before they leave.`,
      "bad",
    );
    return;
  }
  const byReason = new Map<VacateReason, number>();
  for (const n of notices) byReason.set(n.reason, (byReason.get(n.reason) ?? 0) + 1);
  const parts = [...byReason].map(([r, n]) => `${n} × ${VACATE_REASON_TEXT[r]}`);
  sim.emit(`${notices.length} tenants gave notice: ${parts.join(", ")}. Fix the flagged units before they leave.`, "bad");
}

/**
 * Attribute a tenant's departure to the dominant satisfaction drain at the
 * moment it bottomed out, so the toast/inspector names the real cause instead
 * of always blaming access. The order mirrors the drains in
 * {@link updateSatisfaction}: an unreachable floor is harshest, then elevator
 * crowding, then an over-market office rent, and finally, for a served,
 * uncongested hotel/condo, sustained office-noise erosion. `access` remains
 * the catch-all for the rare emergency-driven bottom-out.
 */
export function vacateCause(sim: Simulation, u: Unit, served: boolean, cong: number): VacateReason {
  if (!served) return "access";
  if (u.floor !== 1 && cong > 1) return "congestion";
  if (u.kind === "office") {
    const cfg = rentConfig("office");
    if (cfg && rentOf(u) > cfg.default) return "rent";
    // A served, market-priced office that still bottomed out did so through the
    // W1 walk penalty, its nearest shaft is beyond tolerance (ground-floor
    // offices are exempt, so this only fires above floor 1).
    if (u.floor !== 1 && sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES) {
      return "transportFar";
    }
    // …or the W2 commercial-noise band next door.
    if (sim.noiseAfflicted(u)) return "noise";
    return "access";
  }
  // A served, uncongested hotel/condo that still bottomed out did so through
  // sustained noise erosion (office or commercial within its band), the only
  // remaining satisfaction sink.
  if (sim.noiseAfflicted(u)) return "noise";
  return "access";
}

/** True when a noise SOURCE of one of `kinds` sits within `maxTiles` tiles
 *  ("segments") of `u` on the same floor, scanning outward from each side of
 *  the footprint. Noise is a proximity radius that carries THROUGH built floor
 *  and any non-source rooms in between (GDD §4.1 uses "empty segments" and
 *  "tiles" interchangeably for the straight-line distance, "empty" is not a
 *  gate). Only two things stop it: a **lobby tile** in the gap (canon buffer,
 *  a lobby between source and sensitive room cancels the noise; this is the
 *  ONLY documented shield, which is exactly why an intervening non-source room
 *  must NOT shield), and an **open-air gap** of unbuilt tiles (noise needs
 *  floor to travel). Distance 0 is the shared-wall case, so this subsumes the
 *  old ±1 rule with no double-count. O(maxTiles) per side, bounded and cheap. */
export function nearestKindWithin(sim: Simulation,
  u: Unit,
  isSource: (kind: FacilityKind) => boolean,
  maxTiles: number,
): boolean {
  for (const dir of [-1, 1] as const) {
    const start = dir < 0 ? u.x - 1 : u.x + u.width;
    for (let d = 0; d <= maxTiles; d++) {
      const x = start + dir * d;
      // A lobby between the source and the sensitive room shields it, stop
      // this direction the moment we cross one.
      if (sim.tower.structureKindAt(u.floor, x) === "lobby") break;
      const room = sim.tower.roomAt(u.floor, x);
      if (room && isSource(room.kind)) return true;
      // Noise travels along the floor: a gap of unbuilt tiles (no structure at
      // all) breaks the run, so a source across an open-air gap doesn't carry.
      if (!room && !sim.tower.hasStructure(u.floor, x)) break;
    }
  }
  return false;
}

/** True when `u` is a noise-sensitive room within its canon buffer of a source
 *  (W2): an office bothered by commercial within 11 tiles, or a hotel/condo
 *  bothered by an office OR commercial within 21. The commercial source set is
 *  the canon {@link isCommercialKind} four (shared with W3). The single
 *  noise-adjacency test, shared by the noise erosion and its cause attribution
 *  so the two can never disagree. */
export function noiseAfflicted(sim: Simulation, u: Unit): boolean {
  if (u.kind === "office") {
    return sim.nearestKindWithin(u, isCommercialKind, OFFICE_NOISE_TILES);
  }
  if (isHotelKind(u.kind) || u.kind === "condo") {
    // Hotels/condos are bothered by a noisy office OR any commercial source.
    return sim.nearestKindWithin(
      u,
      (k) => k === "office" || isCommercialKind(k),
      HOTEL_NOISE_TILES,
    );
  }
  return false;
}

/** Count of hotel rooms still awaiting cleaning. */
export function dirtyRooms(sim: Simulation): number {
  return sim.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
}

/** Retail-only: roll today's per-unit patronage + profit accumulators into
 *  the "yesterday" slot the inspector reads, and reset today. Runs at the
 *  end of {@link onDay} so a mid-day save preserves the day-in-progress
 *  counter and a rebuilt-just-now unit reads 0 until it earns its first
 *  hour of income. Non-operational units (mid-build, on-fire, gutted) are
 *  skipped so the "undefined = no data yet" invariant survives midnight: a
 *  shop still under construction at 23:00 must not wake to a defined
 *  "Yesterday's profit: $0" line, and `EventSystem.gut`'s undefined reset
 *  must not be silently upgraded to 0 by the very next `onDay`. A venue that
 *  is operational but never traded (built after its closing hour, or stranded
 *  and unreachable all day) has every field still `undefined`; it too is left
 *  alone, so it keeps reading "just opened" instead of a false 0 verdict on
 *  its first midnight. A venue with ANY field set (it traded today, or it has
 *  a prior day) does roll over, so a genuine idle day correctly records 0. */
export function rollOverRetailDay(sim: Simulation): void {
  for (const u of sim.tower.units) {
    if (subtypeListFor(u.kind) === null) continue;
    if (!isOperational(u)) continue;
    const hasData =
      u.patronageToday !== undefined ||
      u.patronageYest !== undefined ||
      u.profitToday !== undefined ||
      u.profitYest !== undefined;
    if (!hasData) continue;
    u.patronageYest = u.patronageToday ?? 0;
    u.patronageToday = 0;
    u.profitYest = u.profitToday ?? 0;
    u.profitToday = 0;
  }
}
