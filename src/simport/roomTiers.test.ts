import { describe, expect, it } from "vitest";
import { EVAL_TIERS, NO_ROOM_TIERS, RENT_TIERS, RoomTierReader, roomTierShape, type RoomTierPort } from "./roomTiers";

/** A layout that lists the slots and both tables in an order of its own, so a
 *  reader that assumed the engine's order would misread every row. */
const SLOTS = ["rentTier", "id", "x", "evalTier", "floor"];
const EVAL_NAMES = ["excellent", "unrated", "good", "terrible"];
const RENT_NAMES = ["high", "average", "low", "veryLow", "noRate", "unpriced"];

function layout(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ records: { roomTier: SLOTS, unitCard: ["id"] }, evalTiers: EVAL_NAMES, rentTiers: RENT_NAMES, ...over });
}

/** One row in `SLOTS` order, from named fields and tier names. */
function row(id: number, floor: number, x: number, evalTier: string, rentTier: string): number[] {
  const values: Record<string, number> = { id, floor, x, evalTier: EVAL_NAMES.indexOf(evalTier), rentTier: RENT_NAMES.indexOf(rentTier) };
  return SLOTS.map((slot) => values[slot]);
}

function port(rows: number[][], text = layout()): RoomTierPort & { calls: number } {
  const p = {
    calls: 0,
    viewLayout: () => text,
    roomTiers: () => {
      p.calls++;
      return new Float64Array(rows.flat());
    },
  };
  return p;
}

describe("RoomTierReader", () => {
  it("reads each row by the layout's slot names and tier tables", () => {
    const p = port([row(11, 2, 160, "good", "average"), row(12, -1, 40, "unrated", "noRate"), row(13, 30, 200, "excellent", "veryLow")]);
    const tiers = new RoomTierReader(p).read();
    expect(p.calls).toBe(1);
    expect(tiers.size).toBe(3);
    const read = Array.from({ length: tiers.size }, (_, i) => [tiers.id(i), tiers.floor(i), tiers.x(i), tiers.evalTier(i), tiers.rentTier(i)]);
    expect(read).toEqual([
      [11, 2, 160, "good", "average"],
      [12, -1, 40, "unrated", "noRate"],
      [13, 30, 200, "excellent", "veryLow"],
    ]);
  });

  it("reads every tier name the engine can send", () => {
    const rows = EVAL_TIERS.flatMap((e, i) => RENT_TIERS.map((r, j) => row(i * 10 + j, 1, 0, e, r)));
    const tiers = new RoomTierReader(port(rows)).read();
    const pairs = Array.from({ length: tiers.size }, (_, i) => `${tiers.evalTier(i)}/${tiers.rentTier(i)}`);
    expect(pairs).toEqual(EVAL_TIERS.flatMap((e) => RENT_TIERS.map((r) => `${e}/${r}`)));
  });

  it("reads a code the layout does not name as unrated and unpriced", () => {
    const at = (slot: string) => SLOTS.indexOf(slot);
    const bad = row(5, 1, 0, "good", "high");
    bad[at("evalTier")] = 9;
    bad[at("rentTier")] = Number.NaN;
    const tiers = new RoomTierReader(port([bad])).read();
    expect([tiers.evalTier(0), tiers.rentTier(0)]).toEqual(["unrated", "unpriced"]);
  });

  it("answers no rows when the engine has no such read", () => {
    const tsLike: RoomTierPort = { viewLayout: () => layout() };
    const reader = new RoomTierReader(tsLike);
    expect(reader.available).toBe(false);
    expect(reader.read()).toBe(NO_ROOM_TIERS);
    expect(NO_ROOM_TIERS.size).toBe(0);
  });

  it("answers no rows, and never calls the engine, when the layout lacks the record or a table", () => {
    for (const over of [{ records: { unitCard: ["id"] } }, { evalTiers: undefined }, { rentTiers: [] }]) {
      const p = port([row(1, 1, 0, "good", "high")], layout(over));
      const reader = new RoomTierReader(p);
      expect(reader.available).toBe(false);
      expect(reader.read().size).toBe(0);
      expect(p.calls).toBe(0);
    }
  });

  it("refuses a tier table with a name it does not know, a missing name or a repeat", () => {
    expect(roomTierShape(layout())).not.toBeNull();
    expect(roomTierShape(layout({ evalTiers: ["unrated", "terrible", "good", "superb"] }))).toBeNull();
    expect(roomTierShape(layout({ evalTiers: ["unrated", "terrible", "good"] }))).toBeNull();
    expect(roomTierShape(layout({ rentTiers: ["high", "high", "low", "veryLow", "noRate", "unpriced"] }))).toBeNull();
    expect(roomTierShape(layout({ records: { roomTier: ["id", "floor", "x", "evalTier"] } }))).toBeNull();
  });

  it("answers null for a layout that is not JSON or carries the record in the wrong form", () => {
    for (const text of ["", "{", "not json", "null", "7", '"text"', "[]"]) expect(roomTierShape(text), JSON.stringify(text)).toBeNull();
    const bad: Record<string, unknown>[] = [
      { records: { roomTier: "id,floor,x,evalTier,rentTier" } },
      { records: { roomTier: { id: 0 } } },
      { records: null },
      { records: 3 },
      { evalTiers: "unrated,terrible,good,excellent" },
      { evalTiers: { length: 4 } },
      { rentTiers: 6 },
      { records: { roomTier: [...SLOTS, "id"] } },
      { records: { roomTier: ["id", "floor", "x", "evalTier", "rentTier", "pad", "pad"] } },
    ];
    for (const over of bad) {
      expect(roomTierShape(layout(over)), JSON.stringify(over)).toBeNull();
      const p = port([row(1, 1, 0, "good", "high")], layout(over));
      expect(new RoomTierReader(p).available).toBe(false);
      expect(p.calls).toBe(0);
    }
  });

  it("throws a RangeError for a row index that is not a whole number in 0..size-1", () => {
    const tiers = new RoomTierReader(port([row(1, 1, 0, "good", "high"), row(2, 2, 9, "terrible", "low")])).read();
    expect(tiers.id(1)).toBe(2);
    for (const i of [-1, 2, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tiers.id(i), `id(${i})`).toThrow(RangeError);
      expect(() => tiers.floor(i), `floor(${i})`).toThrow(RangeError);
      expect(() => tiers.x(i), `x(${i})`).toThrow(RangeError);
      expect(() => tiers.evalTier(i), `evalTier(${i})`).toThrow(RangeError);
      expect(() => tiers.rentTier(i), `rentTier(${i})`).toThrow(RangeError);
    }
    expect(() => NO_ROOM_TIERS.id(0)).toThrow(RangeError);
  });

  it("answers no rows for a record that is not whole rows", () => {
    const p = port([row(1, 1, 0, "good", "high"), [7, 7]]);
    expect(new RoomTierReader(p).read()).toBe(NO_ROOM_TIERS);
    expect(p.calls).toBe(1);
  });

  it("answers no rows for a missing answer, which a valid empty answer is not", () => {
    for (const missing of [undefined, null]) {
      const stub = { viewLayout: () => layout(), roomTiers: () => missing } as unknown as RoomTierPort;
      const reader = new RoomTierReader(stub);
      expect(reader.available).toBe(true);
      expect(reader.read()).toBe(NO_ROOM_TIERS);
    }
    // A tower with no rated or priced room (a lobby only) is a read, not a failure.
    const empty = new RoomTierReader(port([])).read();
    expect(empty).not.toBe(NO_ROOM_TIERS);
    expect(empty.size).toBe(0);
  });

  it("reads a layout wider than the five slots, wherever the slot it does not know sits", () => {
    const tierRow = (id: number) => row(id, id + 2, id * 4, "terrible", "low");
    // The unknown slot first, with five rows so a row count that divided by
    // the reader's own five slots would read six.
    const first = ["pad", ...SLOTS];
    const rows = [1, 2, 3, 4, 5].map((id) => [99, ...tierRow(id)]);
    const tiers = new RoomTierReader(port(rows, layout({ records: { roomTier: first } }))).read();
    expect(tiers.size).toBe(5);
    expect([tiers.id(1), tiers.floor(1), tiers.x(1), tiers.evalTier(1), tiers.rentTier(1)]).toEqual([2, 4, 8, "terrible", "low"]);
    // The unknown slot last.
    const last = [...SLOTS, "pad"];
    const lastTiers = new RoomTierReader(port([1, 2].map((id) => [...tierRow(id), 99]), layout({ records: { roomTier: last } }))).read();
    expect(lastTiers.size).toBe(2);
    expect([lastTiers.id(1), lastTiers.x(1), lastTiers.rentTier(1)]).toEqual([2, 8, "low"]);
  });

  it("answers no rows when the port's member is not a function", () => {
    const odd = { viewLayout: () => layout(), roomTiers: 7 } as unknown as RoomTierPort;
    const reader = new RoomTierReader(odd);
    expect(reader.available).toBe(false);
    expect(reader.read()).toBe(NO_ROOM_TIERS);
  });
});
