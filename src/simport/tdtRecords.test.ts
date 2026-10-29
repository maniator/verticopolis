import { describe, expect, it } from "vitest";
import type { PortCodes } from "./portCodes";
import { exportFacts, importFacts } from "./tdtRecords";

const LOAD_FIELDS = [
  "ok",
  "decoded",
  "notes",
  "warnings",
  "droppedShafts",
  "adjustedShafts",
  "droppedFlights",
  "parkingConnected",
  "peopleCount",
  "floors",
  "basements",
  "minutes",
  "shafts",
  "flights",
  "star",
  "money",
  "rooms",
  "residentsSeeded",
];

const codes = (fields: readonly string[]): PortCodes =>
  ({ fields: () => fields }) as unknown as PortCodes;

describe("importFacts", () => {
  const record = (over: Record<string, number>) =>
    Float64Array.from(LOAD_FIELDS.map((name) => over[name] ?? 0));

  it("reads the slots by name and gathers the notes", () => {
    const rec = record({
      decoded: 1,
      notes: 1,
      warnings: 2,
      floors: 12,
      basements: 1,
      minutes: 99,
      shafts: 3,
      flights: 4,
      star: 5,
      money: 7,
      rooms: 40,
      residentsSeeded: 8,
      parkingConnected: 6,
      peopleCount: 9,
      droppedFlights: 2,
    });
    const asked: number[] = [];
    const port = {
      tdtNote: (i: number) => (
        asked.push(i),
        i === 1 ? undefined : `note ${i}`
      ),
      tdtTowerName: () => "Name",
    };
    const facts = importFacts(rec, codes(LOAD_FIELDS), port);
    expect(facts).toMatchObject({
      towerName: "Name",
      decoded: true,
      floors: 12,
      basements: 1,
      minutes: 99,
      shafts: 3,
      flights: 4,
      star: 5,
      money: 7,
      parkingConnected: 6,
      peopleCount: 9,
    });
    expect(facts.counts.rooms).toBe(40);
    expect(facts.counts.residentsSeeded).toBe(8);
    expect(facts.decodeStats.droppedFlights).toBe(2);
    expect(facts.notes).toEqual(["note 0", "", "note 2"]);
    expect(asked).toEqual([0, 1, 2]);
  });

  it("turns an absent count into null and a missing name into an empty one", () => {
    const rec = record({ parkingConnected: NaN, peopleCount: NaN });
    const facts = importFacts(rec, codes(LOAD_FIELDS), {
      tdtNote: () => undefined,
      tdtTowerName: () => undefined,
    });
    expect(facts.parkingConnected).toBeNull();
    expect(facts.peopleCount).toBeNull();
    expect(facts.towerName).toBe("");
    expect(facts.decoded).toBe(false);
    expect(facts.notes).toEqual([]);
  });
});

describe("exportFacts", () => {
  it("reads the counts, the encode stats and the extent by name", () => {
    const fields = [
      "ok",
      "rooms",
      "burnedOut",
      "balance",
      "money",
      "star",
      "expressLen",
      "topFloor",
      "basements",
    ];
    const facts = exportFacts(
      Float64Array.from([1, 40, 2, 500, 50000, 4, 3, 30, 2]),
      codes(fields),
      "Tower",
    );
    expect(facts.towerName).toBe("Tower");
    expect(facts.counts.rooms).toBe(40);
    expect(facts.counts.burnedOut).toBe(2);
    expect(facts.stats).toMatchObject({
      balance: 500,
      money: 50000,
      star: 4,
      expressLen: 3,
    });
    expect(facts.topFloor).toBe(30);
    expect(facts.basements).toBe(2);
    expect(
      exportFacts(Float64Array.from([1]), codes(["ok"]), undefined).towerName,
    ).toBe("");
  });
});
