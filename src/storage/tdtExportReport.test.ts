import { describe, expect, it } from "vitest";
import {
  exportReport,
  type EncodeStats,
  type ExportCounts,
  type ExportReportFacts,
} from "./tdtExportReport";

const COUNTS: ExportCounts = {
  rooms: 1234,
  rentsSnapped: 0,
  namesDropped: 0,
  hotelStates: 0,
  occupied: 0,
  construction: 0,
  parkingStalls: 0,
  burnedOut: 0,
  vacancyHistoryLost: 0,
  outOfRange: 0,
};

const STATS: EncodeStats = {
  balance: 10_000,
  money: 1_000_000,
  star: 4,
  shaftsDropped: 0,
  shaftsColliding: 0,
  flightsDropped: 0,
  transportsDropped: 0,
  elevatorsLen: 5,
  walkwaysLen: 8,
  expressLen: 1,
};

function facts(
  counts: Partial<ExportCounts> = {},
  stats: Partial<EncodeStats> = {},
): ExportReportFacts {
  return {
    towerName: "My Tower!",
    counts: { ...COUNTS, ...counts },
    stats: { ...STATS, ...stats },
    topFloor: 30,
    basements: 2,
  };
}

const said = (list: string[]) => list.join("\n");

describe("exportReport", () => {
  it("lists what comes along and the fixed losses", () => {
    const r = exportReport(facts());
    expect(r.filename).toBe("MYTOWER.TDT");
    expect(r).toMatchObject({
      star: 4,
      money: 1_000_000,
      floors: 30,
      basements: 2,
      roomsExported: 1234,
    });
    expect(said(r.comesAlong)).toContain("1,234 rooms with their occupancy");
    expect(said(r.comesAlong)).toContain(
      "5 elevator shafts with per-floor stop settings, and 8 stairway/escalator flights.",
    );
    expect(said(r.comesAlong)).toContain("Your funds ($1,000,000)");
    expect(r.staysBehind).toEqual([
      "The income ledger and finance history start fresh in 1994.",
      "People in transit are not carried; the crowd re-simulates on load.",
      "Satisfaction detail resets; tenants re-judge the tower as it runs.",
    ]);
  });

  it("reads one room, one shaft and one flight, a debt, and caps shafts at the table size", () => {
    const one = exportReport(
      facts({ rooms: 1 }, { elevatorsLen: 1, walkwaysLen: 1, balance: -3 }),
    );
    expect(said(one.comesAlong)).toContain("1 room with");
    expect(said(one.comesAlong)).toContain(
      "1 elevator shaft with per-floor stop settings, and 1 stairway/escalator flight.",
    );
    expect(said(one.comesAlong)).toContain("-$300");
    expect(
      said(exportReport(facts({}, { elevatorsLen: 30 })).comesAlong),
    ).toContain("24 elevator shafts");
    expect(
      said(
        exportReport(facts({}, { walkwaysLen: 10, flightsDropped: 4 }))
          .comesAlong,
      ),
    ).toContain("6 stairway/escalator flights");
  });

  it("reports every loss, plural and singular", () => {
    const plural = said(
      exportReport(
        facts(
          {
            burnedOut: 2,
            vacancyHistoryLost: 2,
            outOfRange: 2,
            namesDropped: 2,
            rentsSnapped: 2,
          },
          {
            shaftsDropped: 2,
            shaftsColliding: 2,
            flightsDropped: 2,
            transportsDropped: 2,
            money: 1,
          },
        ),
      ).staysBehind,
    );
    for (const part of [
      "2 burned or burning rooms arrive cleared",
      "rebuild them in 1994",
      "2 vacant rooms lose their rental history",
      "2 rooms sit outside the floors",
      "2 elevator shafts past 1994's 24-shaft limit",
      "2 transports overlap a neighbor",
      "2 stairway/escalator flights past 1994's 64-slot table",
      "2 transports couldn't be represented",
      "2 custom room names",
      "Exact rents on 2 rooms",
      "Funds round to the nearest $100",
    ]) {
      expect(plural).toContain(part);
    }
    const single = said(
      exportReport(
        facts(
          {
            burnedOut: 1,
            vacancyHistoryLost: 1,
            outOfRange: 1,
            namesDropped: 1,
            rentsSnapped: 1,
          },
          {
            shaftsDropped: 1,
            shaftsColliding: 1,
            flightsDropped: 1,
            transportsDropped: 1,
          },
        ),
      ).staysBehind,
    );
    for (const part of [
      "1 burned or burning room arrives cleared",
      "rebuild it in 1994",
      "1 vacant room loses its rental history",
      "1 room sits outside",
      "1 elevator shaft past",
      "1 transport overlaps a neighbor",
      "1 stairway/escalator flight past",
      "1 transport couldn't be represented",
      "1 custom room name ",
      "Exact rents on 1 room ",
    ]) {
      expect(single).toContain(part);
    }
  });
});
