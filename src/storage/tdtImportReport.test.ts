import { describe, expect, it } from "vitest";
import {
  importReport,
  type ImportCounts,
  type ImportReportFacts,
} from "./tdtImportReport";

const ZERO: ImportCounts = {
  rooms: 0,
  offices: 0,
  occupiedOffices: 0,
  condos: 0,
  soldCondos: 0,
  hotelRooms: 0,
  hotelAsleep: 0,
  hotelDirty: 0,
  hotelBooked: 0,
  asleepConverted: 0,
  infested: 0,
  venues: 0,
  services: 0,
  parkingStalls: 0,
  construction: 0,
  rentsApplied: 0,
  twinRooms: 0,
  secom: 0,
  cathedral: 0,
  burned: 0,
  unknown: 0,
  droppedFloors: 0,
  offLot: 0,
  overlapping: 0,
  misplaced: 0,
  clamped: 0,
  widthMismatch: 0,
  residentsSeeded: 0,
};

function facts(
  over: Partial<Omit<ImportReportFacts, "counts">> & {
    counts?: Partial<ImportCounts>;
  } = {},
): ImportReportFacts {
  const { counts, ...rest } = over;
  return {
    towerName: "Test Tower",
    counts: { ...ZERO, ...counts },
    decoded: true,
    decodeStats: { droppedShafts: 0, adjustedShafts: 0, droppedFlights: 0 },
    parkingConnected: null,
    peopleCount: null,
    floors: 12,
    basements: 0,
    minutes: 0,
    shafts: 2,
    flights: 3,
    star: 3,
    money: 1_500_000,
    notes: [],
    ...rest,
  };
}

const said = (list: string[]) => list.join("\n");

describe("importReport", () => {
  it("states funds, rating, structure and the clock", () => {
    const r = importReport(
      facts({ minutes: 1440 + 13 * 60 + 5, basements: 2 }),
    );
    expect(r.day).toBe(2);
    expect(said(r.broughtOver)).toContain(
      "$1,500,000 in funds and your 3-star rating.",
    );
    expect(said(r.broughtOver)).toContain(
      "12 floors of structure and 2 basement levels.",
    );
    expect(said(r.broughtOver)).toContain("The clock: day 2, 1:05 PM.");
    expect(said(r.broughtOver)).toContain(
      "2 elevator shafts and 3 stairway/escalator flights",
    );
    expect(r.couldNotBring[r.couldNotBring.length - 1]).toBe(
      "Tenant names and finance history aren't imported yet.",
    );
  });

  it("reads the singular forms, the TOWER rating, debt and midnight", () => {
    const r = importReport(
      facts({
        star: 6,
        money: -5,
        floors: 1,
        basements: 1,
        shafts: 1,
        flights: 1,
        minutes: 0,
      }),
    );
    const text = said(r.broughtOver);
    expect(text).toContain("-$5 in funds and the TOWER rating.");
    expect(text).toContain("1 floor of structure and 1 basement level.");
    expect(text).toContain("1 elevator shaft and 1 stairway/escalator flight,");
    expect(text).toContain("12:00 AM");
  });

  it("says so when the save had no transport", () => {
    expect(
      said(importReport(facts({ shafts: 0, flights: 0 })).broughtOver),
    ).toContain("no elevators or stairways built yet");
  });

  it("leaves the transport line out when the elevator data was not decoded", () => {
    const r = importReport(facts({ decoded: false }));
    expect(said(r.broughtOver)).not.toContain("straight from the save");
    expect(said(r.couldNotBring)).toContain(
      "rebuilt from your floors (2 shafts)",
    );
    expect(
      said(importReport(facts({ decoded: false, shafts: 1 })).couldNotBring),
    ).toContain("(1 shaft)");
  });

  it("counts offices, condos, hotel rooms, venues, services and rents", () => {
    const r = importReport(
      facts({
        counts: {
          rooms: 40,
          offices: 5,
          occupiedOffices: 3,
          condos: 2,
          soldCondos: 1,
          hotelRooms: 4,
          hotelAsleep: 1,
          hotelDirty: 2,
          twinRooms: 2,
          venues: 3,
          services: 1,
          rentsApplied: 6,
          parkingStalls: 9,
          construction: 2,
        },
        parkingConnected: 7,
      }),
    );
    const text = said(r.broughtOver);
    expect(r.unitsImported).toBe(40);
    expect(text).toContain("5 offices (3 with tenants).");
    expect(text).toContain("2 condos (1 sold).");
    expect(text).toContain(
      "4 hotel rooms (1 with sleeping guests, 2 awaiting housekeeping).",
    );
    expect(text).toContain(
      "Of those, 2 are twin rooms, which are Double Rooms here.",
    );
    expect(text).toContain("3 food, retail, and entertainment venues.");
    expect(text).toContain("1 service and special facility.");
    expect(text).toContain("Rent levels for 6 units");
    expect(text).toContain(
      "9 parking stalls (the save counted 7 connected to a ramp).",
    );
    expect(text).toContain(
      "2 rooms still under construction; work resumes now.",
    );
  });

  it("uses the singular forms of the same lines", () => {
    const text = said(
      importReport(
        facts({
          counts: {
            offices: 1,
            occupiedOffices: 1,
            condos: 1,
            hotelRooms: 1,
            twinRooms: 1,
            venues: 1,
            services: 2,
            rentsApplied: 1,
            parkingStalls: 1,
            construction: 1,
          },
          parkingConnected: 1,
        }),
      ).broughtOver,
    );
    expect(text).toContain("1 office (1 with tenants).");
    expect(text).toContain("1 condo (0 sold).");
    expect(text).toContain("1 hotel room, ready for guests.");
    expect(text).toContain(
      "Of those, 1 is a twin room, which is a Double Room here.",
    );
    expect(text).toContain("1 food, retail, and entertainment venue.");
    expect(text).toContain("2 service and special facilities.");
    expect(text).toContain("Rent levels for 1 unit,");
    expect(text).toContain("1 parking stall (");
    expect(text).toContain("1 room still under construction");
  });

  it("does not echo a corrupt connected-stall count", () => {
    expect(
      said(
        importReport(
          facts({ counts: { parkingStalls: 3 }, parkingConnected: 513 }),
        ).broughtOver,
      ),
    ).not.toContain("parking stall");
    expect(
      said(
        importReport(
          facts({ counts: { parkingStalls: 3 }, parkingConnected: null }),
        ).broughtOver,
      ),
    ).not.toContain("parking stall");
  });

  it("reports every loss and approximation, plural and singular", () => {
    const many = ZERO;
    const plural = said(
      importReport(
        facts({
          counts: {
            ...many,
            secom: 2,
            cathedral: 1,
            infested: 2,
            hotelBooked: 2,
            asleepConverted: 2,
            burned: 2,
            unknown: 2,
            droppedFloors: 2,
            offLot: 2,
            overlapping: 2,
            misplaced: 2,
            clamped: 2,
            widthMismatch: 2,
          },
          decodeStats: {
            droppedShafts: 2,
            adjustedShafts: 2,
            droppedFlights: 2,
          },
          peopleCount: 1234,
        }),
      ).couldNotBring,
    );
    for (const part of [
      "2 SECOM offices imported as Security",
      "Wedding Hall",
      "2 bug-infested rooms arrived as dirty rooms",
      "2 booked hotel rooms arrived empty",
      "2 rooms with guests asleep past checkout",
      "2 elevator shafts were corrupt",
      "2 elevator shafts were trimmed",
      "2 stairway/escalator flights past the 64-link limit",
      "2 burned-out areas were cleared",
      "2 rooms of a type we don't recognize",
      "2 reserved floor rows above floor 100",
      "2 rooms sat outside the lot",
      "2 rooms overlapped another room",
      "2 rooms were on a floor its kind can't occupy",
      "2 rooms were trimmed to fit the lot edge",
      "2 rooms keep the original's size",
      "The 1,234 people on the save's roster",
    ]) {
      expect(plural).toContain(part);
    }
    const single = said(
      importReport(
        facts({
          counts: {
            ...many,
            secom: 1,
            infested: 1,
            hotelBooked: 1,
            asleepConverted: 1,
            burned: 1,
            unknown: 1,
            droppedFloors: 1,
            offLot: 1,
            overlapping: 1,
            misplaced: 1,
            clamped: 1,
            widthMismatch: 1,
          },
          decodeStats: {
            droppedShafts: 1,
            adjustedShafts: 1,
            droppedFlights: 1,
          },
        }),
      ).couldNotBring,
    );
    for (const part of [
      "1 SECOM office imported",
      "1 bug-infested room arrived",
      "1 booked hotel room arrived",
      "1 room with guests asleep",
      "1 elevator shaft was corrupt",
      "1 elevator shaft was trimmed",
      "1 stairway/escalator flight past",
      "1 burned-out area was cleared",
      "1 room of a type",
      "1 reserved floor row",
      "1 room sat outside",
      "1 room overlapped",
      "1 room was on a floor",
      "1 room was trimmed",
      "1 room keeps the original's size",
    ]) {
      expect(single).toContain(part);
    }
  });

  it("says who is here now when the load seeded people, and falls back to the approximate line", () => {
    const seeded = importReport(
      facts({ counts: { occupiedOffices: 2, residentsSeeded: 1234 } }),
    );
    expect(said(seeded.couldNotBring)).toContain(
      "1,234 office workers and condo residents are here now",
    );
    expect(said(seeded.couldNotBring)).not.toContain(
      "Occupancy is approximate",
    );
    const approximate = importReport(facts({ counts: { soldCondos: 1 } }));
    expect(said(approximate.couldNotBring)).toContain(
      "Occupancy is approximate",
    );
    expect(said(importReport(facts()).couldNotBring)).not.toContain(
      "Occupancy is approximate",
    );
  });

  it("passes the header's notes through after its own lines", () => {
    const r = importReport(facts({ notes: ["note one", "note two"] }));
    expect(r.couldNotBring.slice(-2)).toEqual(["note one", "note two"]);
  });
});
