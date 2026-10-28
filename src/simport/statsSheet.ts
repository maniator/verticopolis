import type { LedgerCat } from "../engine/Ledger";
import type { StarGateId } from "../engine/sim/star";
import type { FacilityKind } from "../engine/types";
import type { PortRecord } from "./enginePort";
import type { ElevatorStatsRow, HousekeepingCoverageView, NextStarView, StatsReport, TowerStats } from "./panels";
import type { PortCodes } from "./portCodes";

/**
 * The stats screen's report, read off the port's `statsSheet` record: the
 * header `records.statsSheet` names, then the sections its last six slots
 * count, in the order both engines write them (`engine-rs/src/
 * wasm_port_reports.rs`, `src/engine/port/reports.ts`): the HUD strip
 * (`statsStrip`), the housekeeping readout (`crewCoverage`), the ledger
 * averages (`ledgerCats`), the next star (`nextStar`, then its `gateRow`
 * rows), the stranded floors, a flag per milestone, the elevator rows
 * (`elevatorRow`) and the household mix (`mixRow`). A NaN slot is a null.
 * Read once per open of the screen, never per frame.
 */
export function statsReport(rec: PortRecord, codes: PortCodes): StatsReport {
  const head = codes.fields("statsSheet");
  const h = (name: string): number => rec[head.indexOf(name)];
  const yes = (name: string): boolean => h(name) === 1;
  const orNull = (v: number): number | null => (Number.isNaN(v) ? null : v);
  let at = head.length;
  /** The next section, as an object keyed by `names`. */
  const named = <T>(names: readonly string[]): T => Object.fromEntries(names.map((n) => [n, rec[at++]])) as T;

  const stats = named<TowerStats>(codes.fields("statsStrip"));
  const housekeeping = named<HousekeepingCoverageView>(codes.fields("crewCoverage"));
  const averages = named<Record<LedgerCat, number>>(codes.names("ledgerCats"));

  let nextStar: NextStarView | null = null;
  if (yes("nextStar")) {
    const n = named<Record<keyof Omit<NextStarView, "gates">, number>>(codes.fields("nextStar"));
    const gateIds = codes.names("starGates");
    const gates: { id: StarGateId; met: boolean }[] = [];
    const gateRow = codes.fields("gateRow");
    for (let i = 0; i < h("gates"); i++) {
      const g = named<{ gateCode: number; met: number }>(gateRow);
      gates.push({ id: gateIds[g.gateCode] as StarGateId, met: g.met === 1 });
    }
    nextStar = {
      star: n.star,
      isTower: n.isTower === 1,
      popHave: n.popHave,
      popNeed: n.popNeed,
      popMet: n.popMet === 1,
      gates,
      allMet: n.allMet === 1,
    };
  }

  const strandedFloors = Array.from(rec.subarray(at, (at += h("stranded"))));
  const ids = codes.names("milestones");
  const list: { id: string; done: boolean }[] = [];
  for (let i = 0; i < h("milestones"); i++) list.push({ id: ids[i], done: rec[at++] === 1 });

  const kinds = codes.names("kinds");
  const row = codes.fields("elevatorRow");
  const elevators: ElevatorStatsRow[] = [];
  for (let i = 0; i < h("elevators"); i++) {
    const e = named<Record<string, number>>(row);
    elevators.push({
      id: e.id,
      kind: kinds[e.kindCode] as FacilityKind,
      bottom: e.bottom,
      top: e.top,
      cars: e.cars,
      capacity: e.capacity,
      utilization: e.utilization,
    });
  }
  const mix: (readonly [number, number])[] = [];
  const mixRow = codes.fields("mixRow");
  for (let i = 0; i < h("mix"); i++) {
    const m = named<{ size: number; count: number }>(mixRow);
    mix.push([m.size, m.count]);
  }

  const cleaned = orNull(h("cleaned"));
  return {
    stats,
    ratingPopulation: h("ratingPopulation"),
    hotelsCountTowardRating: yes("hotelsCountTowardRating"),
    functionalParking: h("functionalParking"),
    parkingDemand: {
      officePop: h("parkingOfficePop"),
      offices: h("parkingOffices"),
      suites: h("parkingSuites"),
      total: h("parkingTotal"),
    },
    housekeeping,
    housekeepingReport: cleaned === null ? null : { cleaned, leftover: h("leftover") },
    recycling: { capacity: h("recyclingCapacity"), demandMet: yes("recyclingDemandMet") },
    strandedFloors,
    nextStarThreshold: orNull(h("nextStarThreshold")),
    nextStar,
    milestones: { achieved: h("milestonesAchieved"), total: h("milestones"), list },
    income: { averages, hasData: yes("incomeHasData") },
    elevators,
    vipVisits: h("vipVisits"),
    vipFavorable: yes("vipFavorable"),
    exterminationDueDay: orNull(h("exterminationDueDay")),
    households: { households: h("households"), residents: h("residents"), mix },
  };
}
