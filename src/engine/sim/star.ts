import type { Simulation } from "../Simulation";

import { MILESTONES } from "../milestones";

import { FACILITIES, STAR_THRESHOLDS, TOWER_POPULATION, censusCount, isCommercialKind, isHotelKind } from "../facilities";
import type { FacilityKind } from "../types";

import { isPresent } from "../types";

/** Star rating + population census for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function evaluateStar(sim: Simulation): void {
  if (sim.star >= 6) return;
  // Evaluate each rung with the population appropriate to THAT rung, not the
  // tower's current star. Hotels help climb up through 4★ but 5★ (and TOWER)
  // need real residents, so a rung at/above the 5★ drop-out point is tested on
  // the non-hotel occupant census. Keying off the rung (rather than the current
  // star, as {@link ratingPopulation} does for display) stops a single tick
  // from leaping 3★→5★ on hotel guests.
  const popWithHotels = sim.tower.totalPopulation();
  const popOccupantsOnly = sim.occupantPopulation();
  let target = sim.star;
  for (let s = 5; s >= 1; s--) {
    const pop = s >= 5 ? popOccupantsOnly : popWithHotels;
    if (pop >= STAR_THRESHOLDS[s]) {
      target = s;
      break;
    }
  }
  // Extra gates beyond raw population, matching the original's ladder. A
  // facility only counts once it is actually operational (not still under
  // construction, not on fire).
  if (target >= 3 && !sim.hasOperational("security")) target = Math.min(target, 2);
  // 4★ wants the full amenity set: Medical, Recycling DEMAND MET (one center
  // per ~2,500 population, see {@link recyclingDemandMet}), more than one
  // Hotel Suite, and a favorable VIP review (see {@link maybeVipStay}), per canon.
  if (
    target >= 4 &&
    !(
      sim.hasOperational("medical") &&
      sim.recyclingDemandMet() &&
      sim.countOperational("hotelSuite") >= 2 &&
      sim.vipFavorable
    )
  ) {
    target = Math.min(target, 3);
  }
  // 5★ needs a Metro Station (canon), it was previously only checked at the
  // TOWER stage.
  if (target >= 5 && !sim.hasOperational("metro")) target = Math.min(target, 4);

  if (target > sim.star) {
    sim.star = target;
    sim.emit(`Congratulations! Your tower reached ${sim.star} stars.`, "good");
  }
}

/** Population that counts toward the star/TOWER thresholds, from the CURRENT
 * star's perspective, this is the display/HUD read. Hotel rooms and suites
 * count while climbing up through 4★; once the tower is 4★ they no longer count
 * toward 5★/TOWER (the displayed {@link population} still includes them).
 * {@link evaluateStar} does NOT use this for promotion: it tests each rung on
 * the population appropriate to that rung, so promotion can't leap 3★→5★ on
 * hotel guests. A meal round-tripper counts at their origin room (its
 * canonical occupancy still carries them) AND again at the venue via
 * `customersIn` while they eat. That double count is deliberate: the 1994
 * finance window lists venue customers on top of the workers and residents
 * who are those same customers, so the census swells during meal windows. */
export function ratingPopulation(sim: Simulation): number {
  if (sim.star < 4) {
    return sim.tower.totalPopulation();
  }
  return sim.occupantPopulation();
}

/** Non-hotel occupant census: office workers, condo residents, and live
 * commercial venue customers (`customersIn`), minus the hotel-origin eaters
 * (`hotelCustomersIn`): hotel guests drop from this census at 4★+, and a
 * guest eating at a fastFood must not smuggle back in through the venue
 * tally. This is the rating population once hotels drop out (4★+) and the
 * figure each 5★/TOWER rung is tested against in {@link evaluateStar}. */
export function occupantPopulation(sim: Simulation): number {
  let pop = 0;
  for (const u of sim.tower.units) {
    if (isPresent(u) && !isHotelKind(u.kind)) {
      // censusCount: commercial units contribute their live customer tally
      // (cinema excluded via population = 0), everyone else residentCount.
      pop += censusCount(u);
      // The subtraction mirrors censusCount's gate exactly, population > 0
      // included: a commercial kind censusCount skips (cinema) must not have
      // forged or future customer counters subtracted from a tally that
      // never added them.
      if (isCommercialKind(u.kind) && FACILITIES[u.kind].population > 0) {
        pop -= Math.min(u.hotelCustomersIn ?? 0, u.customersIn ?? 0);
      }
    }
  }
  return pop;
}

export function hasAny(sim: Simulation, kind: FacilityKind): boolean {
  return sim.tower.units.some((u) => u.kind === kind);
}

export function population(sim: Simulation): number {
  // Displayed population is the canonical room census PLUS live commercial
  // customers: a worker out to lunch still counts via their origin room's
  // baseline occupancy and, while eating, again at the venue (customersIn),
  // so the HUD number deliberately swells during meal windows and settles
  // between them. Delegate to Tower.totalPopulation() so this metric has a
  // single source of truth.
  return sim.tower.totalPopulation();
}

export function nextStarThreshold(sim: Simulation): number | null {
  if (sim.star >= 5) return null;
  return STAR_THRESHOLDS[sim.star + 1];
}

/** One requirement toward the next star: a human label and whether it is met. */
export interface StarRequirement {
  label: string;
  met: boolean;
}

/** The "what is blocking my next star" read model. Read-only: it mirrors the
 *  gates in {@link evaluateStar} (and {@link checkVip} for the TOWER rung)
 *  EXACTLY, so the checklist can never claim a rung is ready that promotion
 *  would refuse. Keep this list in step with those two functions. */
export interface NextStarProgress {
  /** The rung being worked toward: 2..5, or 6 for the final TOWER inspection. */
  star: number;
  /** True when the next rung is the TOWER rating. */
  isTower: boolean;
  /** Population on the census THIS rung is judged against. Hotels help up
   *  through 4★, then 5★ and TOWER want real occupants, matching evaluateStar
   *  and checkVip. */
  popHave: number;
  popNeed: number;
  popMet: boolean;
  /** Facility gates for this rung (empty for 2★, which is population-only). */
  gates: StarRequirement[];
  /** True when the population bar and every gate are satisfied. */
  allMet: boolean;
}

/** Requirements for the tower's next star, for the stats readout. Returns null
 *  once the tower is a TOWER (nothing above it). */
export function nextStarRequirements(sim: Simulation): NextStarProgress | null {
  if (sim.star >= 6) return null;
  const star = sim.star + 1;
  const isTower = star === 6;
  const popHave = star >= 5 ? sim.occupantPopulation() : sim.tower.totalPopulation();
  const popNeed = isTower ? TOWER_POPULATION : STAR_THRESHOLDS[star];
  const popMet = popHave >= popNeed;
  const gates: StarRequirement[] = [];
  // A facility counts only once operational (hasOperational / countOperational).
  if (isTower) {
    // The TOWER inspection (checkVip) checks ONLY these, not the cumulative
    // lower-rung amenity set: build the Wedding Hall on floor 100 to summon the
    // VIP, keep the metro, and clear the 15,000 population bar.
    gates.push({ label: "Wedding Hall (floor 100)", met: sim.hasOperational("weddingHall") });
    gates.push({ label: "Metro station", met: sim.hasOperational("metro") });
  } else {
    // evaluateStar re-checks EVERY lower rung's facility gate on each tick, and
    // the star never falls, so being at a rung does not guarantee that rung's
    // facilities still stand. Reaching star N therefore needs the gates for all
    // of rungs 3..N re-satisfied, not just rung N's own. List them cumulatively
    // so the checklist matches promotion (for example recycling that outgrows
    // its capacity, or a sold-off security office, blocks 5★ and shows here).
    if (star >= 3) {
      gates.push({ label: "Security office", met: sim.hasOperational("security") });
    }
    if (star >= 4) {
      gates.push({ label: "Medical center", met: sim.hasOperational("medical") });
      gates.push({ label: "Recycling meets demand", met: sim.recyclingDemandMet() });
      gates.push({ label: "2+ hotel suites", met: sim.countOperational("hotelSuite") >= 2 });
      gates.push({ label: "Favorable VIP review", met: sim.vipFavorable });
    }
    if (star >= 5) {
      gates.push({ label: "Metro station", met: sim.hasOperational("metro") });
    }
  }
  const allMet = popMet && gates.every((g) => g.met);
  return { star, isTower, popHave, popNeed, popMet, gates, allMet };
}

/** Whether hotel guests currently count toward the star rating (they stop at 4★). */
export function hotelsCountTowardRating(sim: Simulation): boolean {
  return sim.star < 4;
}

/** Milestone progress for the UI (achieved count + per-milestone done flags). */
export function milestoneProgress(sim: Simulation): { achieved: number; total: number; list: { label: string; desc: string; done: boolean }[] } {
  const list = MILESTONES.map((m) => ({ label: m.label, desc: m.desc, done: sim.achievedMilestones.has(m.id) }));
  return { achieved: list.filter((m) => m.done).length, total: MILESTONES.length, list };
}

/** Announce any newly-satisfied optional milestones, once each, then persisted.
 *  Recognition-only (no cash): they're pacing goals, not an income source. */
export function checkMilestones(sim: Simulation): void {
  for (const m of MILESTONES) {
    if (sim.achievedMilestones.has(m.id)) continue;
    if (!m.test(sim)) continue;
    sim.achievedMilestones.add(m.id);
    sim.emit(`🏅 Milestone: ${m.label}`, "good");
  }
}
