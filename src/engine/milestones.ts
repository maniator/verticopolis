import type { Simulation } from "./Simulation";
import type { Unit } from "./types";
import { isTenanted } from "./types";
import { FACILITIES, isHotelKind } from "./facilities";

/** An above-ground, currently-occupied, population-bearing tenant unit — the
 *  shared "a real resident/worker/guest lives here" test used by both the
 *  milestone served-check and the stranded-floors diagnostic, so the two can't
 *  drift. (Hotels carry population, so they're included via `population > 0`.) */
export function isTenantFloorUnit(u: Unit): boolean {
  return u.floor >= 2 && (isTenanted(u) || u.state === "asleep") && FACILITIES[u.kind].population > 0;
}

/**
 * Optional milestones — light, one-time goals that give the mid-late game texture
 * (see the GDD/architecture docs under _bmad-output/planning-artifacts/design/).
 * Data-driven and pure: each `test` reads only public sim state, so the set is
 * deterministic and headless-testable. Evaluated once per in-game day.
 */
export interface Milestone {
  /** Stable key — persisted; never renumber. */
  id: string;
  label: string;
  desc: string;
  test: (sim: Simulation) => boolean;
}
// Recognition-only by design: milestones are goals/acknowledgment, NOT cash.
// The GDD flagged that money already trivializes late-game; paying out for
// milestones would make that worse and confound the economy. The reward is the
// headline + the checklist filling in.

/** True when every occupied, population-bearing above-ground floor is reachable
 *  (served) — i.e. the transport is genuinely keeping up, not just built. */
function everyOccupiedFloorServed(sim: Simulation): boolean {
  let sawOne = false;
  for (const u of sim.tower.units) {
    if (!isTenantFloorUnit(u)) continue;
    sawOne = true;
    if (!sim.tower.isFloorServed(u.floor)) return false;
  }
  return sawOne;
}

/** True when no leasable tenant space (office, condo, or hotel room) is sitting
 *  empty — a real "no vacancy", not just full offices. */
function noLeasableVacancy(sim: Simulation): boolean {
  for (const u of sim.tower.units) {
    if (u.state !== "empty") continue;
    if (u.kind === "office" || u.kind === "condo" || isHotelKind(u.kind)) return false;
  }
  return true;
}

export const MILESTONES: Milestone[] = [
  { id: "pop-500", label: "Getting Started", desc: "Reach 500 population.", test: (s) => s.population >= 500 },
  { id: "pop-2500", label: "Rising", desc: "Reach 2,500 population.", test: (s) => s.population >= 2500 },
  { id: "pop-7500", label: "Metropolis", desc: "Reach 7,500 population.", test: (s) => s.population >= 7500 },
  { id: "pop-12000", label: "Almost There", desc: "Reach 12,000 population.", test: (s) => s.population >= 12000 },
  { id: "star-4", label: "Four Stars", desc: "Earn a 4-star rating.", test: (s) => s.star >= 4 },
  { id: "star-5", label: "Five Stars", desc: "Earn a 5-star rating.", test: (s) => s.star >= 5 },
  { id: "cinema", label: "Showtime", desc: "Run an operational cinema.", test: (s) => s.hasOperational("cinema") },
  { id: "metro", label: "On the Map", desc: "Connect an operational Metro Station.", test: (s) => s.hasOperational("metro") },
  { id: "skyline", label: "Touch the Sky", desc: "Build up to the 100th floor.", test: (s) => s.tower.highestFloor >= 100 },
  {
    id: "well-served",
    label: "Smooth Operator",
    desc: "Reach 5,000 population with every occupied, tenant-bearing floor reachable.",
    test: (s) => s.population >= 5000 && everyOccupiedFloorServed(s),
  },
  {
    id: "full-house",
    label: "No Vacancy",
    desc: "Reach 2,000 population with no vacant offices, condos, or hotel rooms.",
    test: (s) => s.population >= 2000 && noLeasableVacancy(s),
  },
];
