import type { Simulation } from "../Simulation";

import { rentOf, rentConfig } from "../econConfig";

import { subtypeListFor } from "../retailSubtypes";
import { FACILITIES, isCommercialKind, isOpenAt, isHotelKind, residentCount, syncAttendanceOccupants } from "../facilities";
import type { FacilityKind, Unit, VacateReason } from "../types";

import { isDormant, isOperational, isTenanted, VACATE_REASON_TEXT } from "../types";

import { VACATE_NOTICE_MINUTES, VACATE_RESCIND, NOISE_CAP, GRIPE_WARN, NOISE_EROSION, CONDO_NOISE_EROSION, TRANSPORT_FAR_TILES, OFFICE_NOISE_TILES, HOTEL_NOISE_TILES, LOBBY_NO_DRAIN, SERVED_RECOVERY } from "./constants";
import { computeDemandMap, type DemandMap } from "./demand";
import { unmetCoverage } from "./gripe";

/** Presence, satisfaction, noise notices for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function updatePresence(sim: Simulation): void {
  const weekend = sim.clock.isWeekend;
  for (const u of sim.tower.units) {
    const f = FACILITIES[u.kind];
    if (isDormant(u)) {
      // The wedding hall is never tenanted, so its lifetime state is "empty"
      // (dormant); mirror its live routed attendance rather than stamping 0
      // over a mid-wedding house. Real dormancy (construction / fire /
      // gutted) still zeroes: the spawn side gates on isOperational, so no
      // new guest can be inside one.
      if (u.state === "empty" && f.attendance !== undefined) syncAttendanceOccupants(u);
      else u.occupants = 0;
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
        // Attendance venues (cinema / party hall / wedding hall): occupants
        // mirrors the live routed attendance, never the catalog population
        // (0). The mirror is also written at every tally change; this hourly
        // write keeps presence from stamping 0 over a mid-show house.
        if (f.attendance !== undefined) {
          syncAttendanceOccupants(u);
          break;
        }
        // Every kind without its own case above takes this open-hours gate.
        // It only changes behavior for commercial venues (fastFood,
        // restaurant, shop): they show their ambient crowd only while open,
        // so a tenanted but closed venue reads zero and the heatmap and
        // lit-window sprite go dark after closing time. Kinds without
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
  // One set read per sweep instead of a 4-deep delegation per unit: the set
  // itself is already revision-memoized (tower/routing.ts servedFloors).
  const servedSet = sim.tower.servedFloors();
  // Modern-only Fitness Club amenity halo: the floors of every operational club,
  // gathered once so a nearby condo can read its floor-distance to the closest.
  // Pure (no RNG). A Classic tower holds no club, so this stays empty and the
  // halo seam returns 0, leaving Classic satisfaction byte-identical.
  const clubFloors: number[] = [];
  for (const c of sim.tower.units) {
    if (c.kind === "fitnessClub" && isTenanted(c) && servedSet.has(c.floor)) clubFloors.push(c.floor);
  }
  // Unmet local-demand coverage (#395): the demand map is computed fresh (like the
  // income loop) rather than through the hour-memoized accessor, so an occupancy
  // change is reflected the same tick and the inspector memo is not perturbed. It
  // draws no RNG and mutates nothing, so it never touches the seeded stream. Built
  // LAZILY on the first served office/condo/hotel that reads coverage, so a tower
  // with no such tenant (all-commercial, still-empty, or early game) pays nothing.
  let demandMap: DemandMap | null = null;
  for (const u of sim.tower.units) {
    if (isDormant(u)) continue;
    const served = servedSet.has(u.floor);
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
      u.satisfaction = Math.min(1, u.satisfaction + SERVED_RECOVERY);
    }
    // Rent pressure: charging an office above the going rate erodes
    // satisfaction (and so retention); undercutting it keeps tenants happy.
    // The coefficient is tuned to exceed the +0.05 served-recovery near the
    // top of the band, so a gouged office trends to a net-negative drift and
    // eventually vacates, otherwise rent would be free money (fill cheap,
    // then crank to max with no downside).
    // The Modern Fitness Club is a lease tenant too, so its membership dues carry
    // the same discipline: gouge past the going rate and the club sours and
    // eventually gives up its lease. Classic never has one, so this stays office-
    // only there.
    if ((u.kind === "office" || u.kind === "fitnessClub") && served) {
      const cfg = rentConfig(u.kind)!;
      const over = (rentOf(u) - cfg.default) / cfg.default; // <0 cheap, >0 pricey
      u.satisfaction = Math.max(0, Math.min(1, u.satisfaction - over * 0.07));
    }
    // Modern amenity halo: a condo near an operational Fitness Club is a little
    // happier. Only the NEAREST club counts (no compounding), capped and
    // distance-decayed by the rule-set (0 in Classic, so Classic is untouched).
    // Applied on top of the served recovery and clamped to 1.
    if (u.kind === "condo" && served && clubFloors.length > 0) {
      let nearest = Infinity;
      for (const cf of clubFloors) {
        const d = Math.abs(cf - u.floor);
        if (d < nearest) nearest = d;
      }
      const bonus = sim.rules.fitnessHaloBonus(nearest);
      if (bonus > 0) u.satisfaction = Math.min(1, u.satisfaction + bonus);
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
    // W-new lobby-distance pressure (#394): the graduated far/very-far penalty on
    // the same office/condo/hotel set, keyed on floors from the nearest (sky)lobby.
    // It joins THIS shared step rather than adding a second compounding drain, so a
    // multiply-afflicted tenant still erodes once per tick. `cap < 1` marks the far
    // or very-far band; only the very-far band carries erosion (the far band is a
    // ceiling only, never evicts). Motivates the sky lobby: a deep floor with no
    // lobby above the ground anchor sits far from any lobby and caps low.
    const lobbyDrain =
      served && (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo")
        ? sim.rules.lobbyDistanceDrain(sim.tower.nearestLobbyFloorDistance(u.floor))
        : LOBBY_NO_DRAIN;
    const lobbyCapped = lobbyDrain.cap < 1;
    // W-new unmet local-demand pressure (#395): the same office/condo/hotel set,
    // keyed on the tenant's reachable retail coverage. It joins THIS shared step
    // too, so a tenant also hit by noise or lobby distance still erodes once per
    // tick. Classic caps only (never evicts for it); Modern additionally erodes
    // once coverage falls deep enough, so a chronically under-served tenant gives
    // notice. A fully-covered tower (coverage 1) returns the neutral drain, so
    // this is a no-op there. Couples venue mix to population and the star gates.
    const coverage =
      served && (u.kind === "office" || isHotelKind(u.kind) || u.kind === "condo")
        ? unmetCoverage((demandMap ??= computeDemandMap(sim)), u)
        : null;
    const unmetDrain = coverage === null ? LOBBY_NO_DRAIN : sim.rules.unmetDemandDrain(coverage);
    const unmetCapped = unmetDrain.cap < 1;
    if (farWalk || noisy || lobbyCapped || unmetCapped) {
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
      const placementErosion = farWalk || noisy ? baseErosion * scale : 0;
      // One erosion step, steepest cause wins (max, never the sum), so a tenant
      // hit by several placement problems still lands on its cap at the telegraphed
      // pace instead of cratering N times as fast.
      const erosion = Math.max(placementErosion, lobbyDrain.erosion, unmetDrain.erosion);
      // The ceiling is the tightest among the active afflictions (noise 0.6, the
      // lobby-distance cap, and/or the unmet-demand cap). Erode THEN clamp so a
      // freshly-exposed unit lands exactly on the cap.
      const cap = Math.min(farWalk || noisy ? NOISE_CAP : 1, lobbyDrain.cap, unmetDrain.cap);
      u.satisfaction = Math.max(0, Math.min(u.satisfaction - erosion, cap));
    }
    // The very-far tier (ceiling at or below the gripe bar) is the tier that also
    // erodes and can evict; it is the attributable `lobbyFar` cause below. The far
    // band (a higher ceiling, no erosion) never bottoms a tenant out on its own, so
    // it is deliberately not a nameable gripe.
    const lobbyFar = lobbyDrain.cap <= GRIPE_WARN;
    // Unmet demand only NAMES the departure (and can evict) where it actually
    // erodes: that is Modern past the evict floor. Classic caps but never erodes,
    // so `unmetDrain.erosion > 0` is false there and unmet demand never becomes a
    // Classic vacate cause, exactly like noise. The gentlest sink, so it sits last
    // in the gripe ladder below.
    const unmetDemand = unmetDrain.erosion > 0;
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
    const leaseTenant = u.kind === "office" || u.kind === "condo" || u.kind === "fitnessClub";
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
      // (access), congested, an office priced over the going rate (rent), a
      // far-walk office (transportFar), or a very-far-from-lobby tenant (lobbyFar,
      // which erodes in both modes). Any of these is a real problem that must
      // still evict, so it blocks the noise rescind and re-attributes the stamp.
      const officeCfg = u.kind === "office" ? rentConfig("office") : undefined;
      const overMarketRent = !!officeCfg && rentOf(u) > officeCfg.default;
      const nonNoiseProblem = !served || (u.floor !== 1 && cong > 1) || overMarketRent || farWalk || lobbyFar;
      if (noiseCannotEvict && nonNoiseProblem) {
        u.vacateReason = sim.vacateCause(u, served, cong, farWalk, noisy, lobbyFar, unmetDemand);
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
      u.vacateReason = sim.vacateCause(u, served, cong, farWalk, noisy, lobbyFar, unmetDemand);
      u.vacateAt = sim.clock.minutes + VACATE_NOTICE_MINUTES;
      notices.push({ floor: u.floor, kind: u.kind, reason: u.vacateReason });
    } else if (u.satisfaction <= 0 && isHotelKind(u.kind)) {
      sim.vacate(u, sim.vacateCause(u, served, cong, farWalk, noisy, lobbyFar, unmetDemand));
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
 *  so the two can never disagree. Memoized per unit for the lifetime of one
 *  tower.revision: `noiseAfflictedFresh` is a pure function of layout, and the
 *  memo clears strictly when tower.revision changes, so every hit equals a
 *  fresh scan of the current layout no matter when the caller queries. Unit
 *  STATE is deliberately not an input (a gutted or empty room still radiates
 *  by kind); anyone adding a state gate here must also drop this memo, see the
 *  functionalParkingSet precedent. */
export function noiseAfflicted(sim: Simulation, u: Unit): boolean {
  if (sim.noiseMemoRev !== sim.tower.revision) {
    sim.noiseMemo.clear();
    sim.noiseMemoRev = sim.tower.revision;
  }
  const hit = sim.noiseMemo.get(u.id);
  if (hit !== undefined) return hit;
  const fresh = noiseAfflictedFresh(sim, u);
  sim.noiseMemo.set(u.id, fresh);
  return fresh;
}

/** The cache-bypassed compute behind {@link noiseAfflicted}: the memo fills
 *  through this, and the differential test pins memo === fresh across every
 *  mutation kind, so the two paths cannot drift apart. */
export function noiseAfflictedFresh(sim: Simulation, u: Unit): boolean {
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
