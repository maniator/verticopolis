import type { TemplateResult } from "lit-html";
import { hotelConditionLines, housekeepingDisplayLines } from "./portServiceDiagnostics";
import type { Simulation } from "../engine/Simulation";
import type { Unit } from "../engine/types";
import { HK_MAIDS_PER_UNIT, HK_NOMINAL_ROOMS_PER_MAID, INFEST_DAYS } from "../engine/economy/housekeeping";
import { towerCatalog } from "../engine/towerCatalog";

/**
 * Housekeeping / cockroach inspector lines, split out of `facilityDiagnostics`
 * to keep that file under the readable ceiling. Same contract as the rest of the
 * diagnostics block: pure functions of (sim, unit) returning lit `TemplateResult`
 * lines, shared by the desktop hover card and the mobile editor fold-in.
 */

/** The two engines share the same diagnostic strings; this is the retired
 * TypeScript engine's independent calculation for parity testing only. */
export function hotelInfestationLines(sim: Simulation, u: Unit): TemplateResult[] {
  return hotelConditionLines(
    u.state, INFEST_DAYS, towerCatalog(sim).economy.exterminator !== null,
  );
}

/** The TypeScript reference engine's coverage calculation. The Rust-backed
 * inspector consumes Rust's status directly and never runs this function. */
export function housekeepingCoverageLines(sim: Simulation): TemplateResult[] {
  const c = sim.housekeepingCoverage();
  const report = sim.economy.housekeepingReport();
  let status = "adequate";
  if (report && report.leftover > 0 && c.rooms > 0) status = "observedShortfall";
  else if (c.dailyCapacity < c.rooms) status = "nominalShortfall";
  return housekeepingDisplayLines({
    status, crews: c.crews, maids: c.maids, rooms: c.rooms,
    maidsPerUnit: HK_MAIDS_PER_UNIT, roomsPerMaid: HK_NOMINAL_ROOMS_PER_MAID,
    cleaned: report?.cleaned ?? NaN, leftover: report?.leftover ?? NaN,
    infested: c.infested, outOfReach: c.outOfReach,
    hasInfested: c.infested > 0, hasOutOfReach: c.outOfReach > 0,
    recovery: towerCatalog(sim).economy.exterminator !== null,
  });
}
