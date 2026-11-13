import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportCounts, ImportReportFacts } from "./storage/tdtImportReport";
import type { GameMode } from "./shared/types";

const trackEvent = vi.fn();
vi.mock("./analyticsCore", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

const { TDT_IMPORT_ANOMALIES, TDT_TRANSPORT_ANOMALIES, headerNow, tdtImportReadProps, trackFileExported, trackFileImported, trackTdtImportRead } = await import("./analyticsFiles");

const HEADER = { mode: "modern" as const, star: 4, population: 1234 };

/** Every import count zero, then the overrides. */
function counts(over: Partial<ImportCounts> = {}): ImportCounts {
  const zero = {} as Record<keyof ImportCounts, number>;
  for (const key of ["rooms", "offices", "occupiedOffices", "condos", "soldCondos", "hotelRooms", "hotelAsleep", "hotelDirty", "hotelBooked", "asleepConverted", "infested", "venues", "services", "parkingStalls", "construction", "rentsApplied", "twinRooms", "secom", "cathedral", "burned", "unknown", "droppedFloors", "offLot", "overlapping", "misplaced", "clamped", "widthMismatch", "residentsSeeded"] as const) zero[key] = 0;
  return { ...zero, ...over };
}

/** An import report's facts with a tower name and note text that must not travel. */
function facts(over: Partial<ImportReportFacts> = {}): ImportReportFacts {
  return {
    towerName: "Private Tower Name",
    counts: counts(),
    decoded: true,
    decodeStats: { droppedShafts: 0, adjustedShafts: 0, droppedFlights: 0 },
    parkingConnected: null,
    peopleCount: null,
    floors: 12,
    basements: 2,
    minutes: 600,
    shafts: 3,
    flights: 5,
    star: 3,
    money: 50_000,
    notes: [],
    ...over,
  };
}

beforeEach(() => trackEvent.mockReset());

describe("file import and export events", () => {
  it("sends the format with the header's mode, star and population", () => {
    trackFileImported("tdt", () => HEADER);
    trackFileExported("vctower", () => HEADER);
    expect(trackEvent.mock.calls).toEqual([
      ["file_imported", { format: "tdt", ...HEADER }],
      ["file_exported", { format: "vctower", ...HEADER }],
    ]);
  });

  it("sends nothing and does not throw when the header cannot be read", () => {
    const broken = () => {
      throw new Error("no tower");
    };
    expect(() => trackFileImported("vctower", broken)).not.toThrow();
    expect(() => trackFileExported("tdt", broken)).not.toThrow();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("sends only the header fields it names, even when the header carries more", () => {
    trackFileImported("vctower", () => ({ ...HEADER, towerName: "Private Tower Name" }) as typeof HEADER);
    expect(trackEvent.mock.calls[0]![1]).toEqual({ format: "vctower", ...HEADER });
  });
});

describe("the tdt_import_read event", () => {
  it("counts each workaround by its report name and totals them", () => {
    const props = tdtImportReadProps(
      facts({
        counts: counts({ rooms: 40, unknown: 2, droppedFloors: 1, offLot: 3, overlapping: 4, misplaced: 5, clamped: 6, widthMismatch: 7, asleepConverted: 8 }),
        decodeStats: { droppedShafts: 9, adjustedShafts: 10, droppedFlights: 11 },
      }),
    );
    expect(props).toMatchObject({ unknown: 2, droppedFloors: 1, offLot: 3, overlapping: 4, misplaced: 5, clamped: 6, widthMismatch: 7, asleepConverted: 8, droppedShafts: 9, adjustedShafts: 10, droppedFlights: 11 });
    expect(props.anomalies).toBe(66);
    expect(props.rooms).toBe(40);
  });

  it("names every anomaly it counts once, across both lists", () => {
    const names = [...TDT_IMPORT_ANOMALIES, ...TDT_TRANSPORT_ANOMALIES];
    expect(new Set(names).size).toBe(names.length);
  });

  it("sends the tower's size and flags, and a count of the notes, never their text or the tower name", () => {
    trackTdtImportRead(facts({ peopleCount: 312, decoded: false, notes: ["Private Tower Name had a note", "another"] }));
    const [name, props] = trackEvent.mock.calls[0]! as [string, Record<string, unknown>];
    expect(name).toBe("tdt_import_read");
    expect(props).toMatchObject({ star: 3, floors: 12, basements: 2, shafts: 3, flights: 5, decoded: false, hasRoster: true, notes: 2, anomalies: 0 });
    const sent = JSON.stringify(props);
    expect(sent).not.toContain("Private Tower Name");
    expect(sent).not.toContain("another");
    expect(Object.values(props).every((v) => typeof v === "number" || typeof v === "boolean")).toBe(true);
  });

  it("reads no roster as hasRoster false", () => {
    expect(tdtImportReadProps(facts({ peopleCount: null })).hasRoster).toBe(false);
    expect(tdtImportReadProps(facts({ peopleCount: 0 })).hasRoster).toBe(true);
  });
});

describe("a report it cannot read", () => {
  it("sends nothing and does not throw when the facts are malformed", () => {
    const broken = { ...facts(), decodeStats: undefined } as unknown as ImportReportFacts;
    expect(() => trackTdtImportRead(broken)).not.toThrow();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe("headerNow", () => {
  it("keeps the header read now, whatever the reader says later", () => {
    let current = HEADER;
    const later = headerNow(() => current);
    current = { ...HEADER, population: 9999 };
    expect(later()).toEqual(HEADER);
  });

  it("copies the three fields, so a header object changed in place later does not change them", () => {
    const reused: { mode: GameMode; star: number; population: number; towerName: string } = { ...HEADER, towerName: "Private Tower Name" };
    const later = headerNow(() => reused);
    reused.population = 9999;
    reused.star = 5;
    reused.mode = "classic";
    expect(later()).toStrictEqual(HEADER);
  });

  it("defers a failed read to the event, which sends nothing", () => {
    const broken = headerNow(() => {
      throw new Error("no tower");
    });
    expect(() => trackFileExported("tdt", broken)).not.toThrow();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
