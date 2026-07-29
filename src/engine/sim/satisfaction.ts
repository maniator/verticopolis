import type { Simulation } from "../Simulation";

import { rentOf, rentConfig } from "../econConfig";

import { subtypeListFor } from "../retailSubtypes";
import { FACILITIES, isCommercialKind, isHotelKind } from "../facilities";
import { isRentalKind } from "../residentialRentals";
import type { FacilityKind, Unit, VacateReason } from "../types";

import { isDormant, isOperational, VACATE_REASON_TEXT } from "../types";

import { VACATE_NOTICE_MINUTES, VACATE_RESCIND, NOISE_CAP, OFFICE_NOISE_TILES, HOTEL_NOISE_TILES } from "./constants";
import { buildSatisfactionContext, satisfactionStep } from "./satisfactionStep";

/** Satisfaction, noise notices, and the amenity halos for the Simulation, as
 * friend functions taking the instance. Extracted from `Simulation.ts`; the
 * class keeps thin delegations. Per-hour occupancy lives in `presence.ts`,
 * re-exported here so `Simulation`'s existing `satisfaction.updatePresence`
 * delegation keeps working without a second namespace import. */
export { updatePresence } from "./presence";

export function updateSatisfaction(sim: Simulation): void {
  // The per-unit satisfaction math and its once-per-sweep context (congestion,
  // the served set, the four Modern amenity floor-sets, the lazy demand map) live
  // in ./satisfactionStep as a PURE step, so the move-in sustainability gate reads
  // the same source of truth (spec-move-in-sustainability-gate-2026-07-23). The
  // RNG congestion toast and the notice/vacate state machine stay here.
  const ctx = buildSatisfactionContext(sim);
  // Warn the player when their elevators can't keep up.
  if (ctx.globalCong > 1.4 && sim.clock.hour === 9 && sim.rng.chance(0.5)) {
    sim.emit("Tenants are complaining of long elevator waits. Add cars or shafts.", "bad");
  }
  // New notices this tick are batched into one toast (like move-ins) so a
  // tower-wide problem raises a single alarm, not one per unit.
  const notices: { floor: number; kind: FacilityKind; reason: VacateReason }[] = [];
  for (const u of sim.tower.units) {
    if (isDormant(u)) continue;
    const { next, served, cong, farWalk, noisy, lobbyFar, unmetDemand, unmetCov } = satisfactionStep(
      sim,
      u,
      u.satisfaction,
      ctx,
    );
    u.satisfaction = next;
    // #548: cause attribution judges the harshest drain against `unmetCov`, the
    // coverage the step itself just read from this sweep's demand map, never
    // the hour-memoized one (which lags the occupancy changes a shed cascade
    // makes mid-sweep and would let the comparison flip attribution on stale
    // data). Null for kinds outside the drain, which the comparison treats as
    // inert.
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
    const leaseTenant = u.kind === "office" || u.kind === "condo" || u.kind === "fitnessClub" || u.kind === "clinic" || isRentalKind(u.kind);
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
      // Over-market rent erodes an office OR a rental tenant (the GDD's "rent too
      // high"): a picky Apartment renter leaves when priced above the going rate,
      // reusing the office path rather than a new vacate reason.
      const priceCfg = u.kind === "office" || isRentalKind(u.kind) ? rentConfig(u.kind) : undefined;
      const overMarketRent = !!priceCfg && rentOf(u) > priceCfg.default;
      const nonNoiseProblem = !served || (u.floor !== 1 && cong > 1) || overMarketRent || farWalk || lobbyFar;
      if (noiseCannotEvict && nonNoiseProblem) {
        u.vacateReason = sim.vacateCause(u, served, cong, farWalk, noisy, lobbyFar, unmetDemand, unmetCov);
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
      u.vacateReason = sim.vacateCause(u, served, cong, farWalk, noisy, lobbyFar, unmetDemand, unmetCov);
      u.vacateAt = sim.clock.minutes + VACATE_NOTICE_MINUTES;
      notices.push({ floor: u.floor, kind: u.kind, reason: u.vacateReason });
    } else if (u.satisfaction <= 0 && isHotelKind(u.kind)) {
      sim.vacate(u, sim.vacateCause(u, served, cong, farWalk, noisy, lobbyFar, unmetDemand, unmetCov));
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
  if (isHotelKind(u.kind) || u.kind === "condo" || isRentalKind(u.kind)) {
    // Hotels/condos/rentals are bothered by a noisy office OR any commercial source.
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
