/**
 * The TypeScript `.TDT` exporter on forged input (#887): whatever JSON value
 * reaches `buildTDT`, it returns bytes or throws `LegacyExportError`, never a
 * bare `TypeError`, and never runs unbounded, wherever `JSON.stringify` can
 * write the value (past its stack, the stack error reaches the caller). The Rust codec's answers for the
 * same shapes are pinned in `conformance/tdt-cases.json` (the `forged-*`
 * export cases), and `conformanceWasmTdt` compares the two sides live; this
 * file holds the TypeScript side to the "refuse or write" rule over a wider
 * battery than the lock carries (parity over such a battery is the #885
 * fuzzer's), and pins what the lock cannot show: the report's filename and
 * dropped-transport count, and two refusals the lock cannot hold (a kind
 * with a lone surrogate, and JSON nested 128 levels deep), which the
 * differential test's edge saves also put through the engine.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SerializedGame } from "../../engine/types";
import { LegacyExportError, buildTDT } from "../../storage/tdtExport";
import { exportInputs } from "../fixtures/tdtExportCases";

const viaJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The file's hash: `toEqual` on two 65 KB arrays costs about 200 ms. */
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

let saves: Map<string, SerializedGame> | undefined;

/** A lock case's save, as the lock embeds it (a fresh copy each call). */
function input(id: string): SerializedGame {
  if (!saves) {
    saves = new Map();
    for (const [caseId, entry] of exportInputs()) {
      saves.set(caseId, "save" in entry ? viaJson(entry.save) : ({ ...saves.get(entry.base)!, ...viaJson(entry.patch) } as SerializedGame));
    }
  }
  const save = saves.get(id);
  if (!save) throw new Error(`no export case ${id}`);
  return structuredClone(save);
}

/** An object JavaScript cannot convert to a number or a string: its own
 *  `toString` is not a function. */
const NO_STRING = { toString: 0 };

/** Every kind of JSON value, plus the in-memory values JSON cannot carry. */
const VALUES: unknown[] = [undefined, null, true, false, 0, -1, 1.5, -0, 2 ** 53, -(2 ** 53), Number.MAX_VALUE, NaN, Infinity, -Infinity, "", "abc", "12", " 3 ", "0x10", [], [1], ["x"], [null], {}, { a: 1 }, { 0: 5 }, NO_STRING, [NO_STRING]];

/** One value of each shape JSON can carry, for the per-field sweep: a
 *  missing field, null (also what NaN and Infinity become), a boolean, a
 *  fraction (an index that misses every table), 2^53 (where `n + 1` is `n`)
 *  and its negative, a numeric string (which `+` joins as text), another
 *  string, an array and two objects. */
const SHAPES: unknown[] = [undefined, null, true, 1.5, 2 ** 53, -(2 ** 53), "1e5", "abc", [null], { 0: 5 }, NO_STRING];

/** "ok" for bytes, the message for a refusal; anything else fails the test. */
function outcome(save: unknown): string {
  try {
    buildTDT(save as SerializedGame);
    return "ok";
  } catch (e) {
    if (e instanceof LegacyExportError) return `refused: ${e.message}`;
    throw new Error(`buildTDT threw ${String(e)} instead of LegacyExportError`);
  }
}

/** Every key any lock tower's units (or transports) carry: a key the entry
 *  lacks is as much a forged input as one it has. */
function entryKeys(list: "units" | "transports"): string[] {
  const keys = new Set<string>();
  for (const [, entry] of exportInputs()) {
    const entries: unknown = ("save" in entry ? entry.save : entry.patch)[list as keyof SerializedGame];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) if (typeof e === "object" && e !== null && !Array.isArray(e)) for (const k of Object.keys(e)) keys.add(k);
  }
  return [...keys];
}

/** `n` arrays around a 0. */
function nested(n: number): unknown {
  let v: unknown = 0;
  for (let i = 0; i < n; i++) v = [v];
  return v;
}

function withValue(base: SerializedGame, path: (string | number)[], value: unknown): unknown {
  const save = structuredClone(base) as unknown as Record<string | number, unknown>;
  let at = save;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>;
  at[path[path.length - 1]] = value;
  return save;
}

describe("buildTDT on forged input: bytes or LegacyExportError wherever JSON.stringify can write it (#887)", () => {
  it("any value in place of the whole save", () => {
    for (const v of VALUES) outcome(v);
    expect(outcome(null)).toBe("refused: save.units is not an array");
    expect(outcome("tower")).toBe("refused: save.units is not an array");
  });

  it("any value in any top-level field", () => {
    // Every top-level key any lock tower carries, forged on one small tower:
    // a key the tower lacks is as much a forged input as one it has.
    const keys = new Set<string>();
    for (const [, entry] of exportInputs()) for (const k of Object.keys("save" in entry ? entry.save : entry.patch)) keys.add(k);
    const base = input("census");
    for (const key of keys) for (const v of VALUES) outcome(withValue(base, [key], v));
  });

  it("any value in place of a unit or a transport", () => {
    for (const v of VALUES) outcome(withValue(input("census"), ["units", 0], v));
    for (const v of VALUES) outcome(withValue(input("transports"), ["transports", 0], v));
  });

  // One entry per family the gather and the encoder branch on. The kinds left
  // out run the same code as their family's pick: the other two hotel kinds,
  // fast food and restaurants (shops), the service elevator (standard) and
  // escalators (stairs). Each export costs about 2 ms, and the two sweeps
  // below run about 2,100 of them.
  const UNIT_PICKS = [
    ["census", "office"],
    ["census", "condo"],
    ["census", "hotelSingle"],
    ["census", "shop"],
    ["census", "cinema"],
    ["states", "lobby"],
    ["wedding-hall", "weddingHall"],
    ["parking", "parking"],
    ["parking", "parkingRamp"],
  ] as const;
  const TRANSPORT_PICKS = ["elevatorStandard", "elevatorExpress", "stairs"] as const;

  it("any value in any field of a unit", () => {
    const keys = entryKeys("units");
    for (const [id, kind] of UNIT_PICKS) {
      const base = input(id);
      const i = base.units.findIndex((u) => u.kind === kind);
      expect(i, `${id} ${kind}`).toBeGreaterThanOrEqual(0);
      for (const key of keys) for (const v of SHAPES) outcome(withValue(base, ["units", i, key], v));
    }
  });

  it("any value in any field of a transport", () => {
    const save = input("transports");
    for (const kind of TRANSPORT_PICKS) {
      // Forged on its own: the tower's other 17 shafts and flights triple
      // the cost of each export.
      const base = { ...save, transports: [save.transports.find((t) => t.kind === kind)!] };
      for (const key of entryKeys("transports")) for (const v of SHAPES) outcome(withValue(base, ["transports", 0, key], v));
    }
  });

  it("refuses forged lists and kinds with the Rust codec's messages", () => {
    const base = input("census");
    expect(outcome({ ...base, units: "" })).toBe("refused: save.units is not an array");
    expect(outcome({ ...base, units: { 0: base.units[0] } })).toBe("refused: save.units is not an array");
    expect(outcome({ ...base, transports: "shaft" })).toBe("refused: save.transports is not an array");
    for (const entry of [null, 7, "office", ["office"], { floor: 2 }, { kind: 5 }]) {
      expect(outcome({ ...base, units: [entry] }), JSON.stringify(entry)).toBe('refused: unit kind "" is not in the catalog');
    }
    expect(outcome({ ...base, units: [{ kind: "toString", floor: 2, x: 0, width: 9 }] })).toBe('refused: unit kind "toString" is not in the catalog');
    // A lone surrogate is quoted as U+FFFD, which is how the engine reads the
    // JSON text the host hands it (`load::parse_save_json`).
    expect(outcome({ ...base, units: [{ kind: "x\uD800", floor: 2, x: 0, width: 9 }] })).toBe('refused: unit kind "x�" is not in the catalog');
  });

  it("drops and counts every transport entry with no kind", () => {
    // null, 7, "shaft", [1, 2], {} and true, beside one real shaft.
    const { report } = buildTDT(input("forged-transport-entries"));
    expect(report.staysBehind).toContain("6 transports couldn't be represented in a 1994 save and stayed behind.");
  });

  it("reads a non-array skipFloors or carPositions as an empty list, as the Rust encoder does", () => {
    const base = input("forged-skip-floors-true");
    const plain = sha(buildTDT(withValue(base, ["transports", 0, "skipFloors"], []) as SerializedGame).bytes);
    for (const v of [true, 4, { 0: 4 }, "45", null]) {
      expect(sha(buildTDT(withValue(base, ["transports", 0, "skipFloors"], v) as SerializedGame).bytes), JSON.stringify(v)).toBe(plain);
    }
    const cars = input("forged-car-positions-null");
    const empty = sha(buildTDT(withValue(cars, ["transports", 0, "carPositions"], []) as SerializedGame).bytes);
    for (const v of [true, { 0: 5, 1: 7 }, "57", 5]) {
      expect(sha(buildTDT(withValue(cars, ["transports", 0, "carPositions"], v) as SerializedGame).bytes), JSON.stringify(v)).toBe(empty);
    }
  });

  it("ends the story walk past 2^53 and at a string floor", () => {
    // Before #887 this loop never ended: `fl++` is a no-op at 2^53. A string
    // floor joins the bound as text ("1e5" + 2 is "1e52"), so the bound alone
    // ran for minutes and then overflowed the extents map.
    for (const floor of [2 ** 53, 2 ** 60, Number.MAX_VALUE]) {
      expect(outcome(input(`forged-two-story-floor-${floor}`))).toBe("ok");
    }
    const base = input("forged-two-story-floor-9007199254740992");
    for (const floor of ["1e5", ["1e5"], "1000000", "30000"]) outcome(withValue(base, ["units", 1, "floor"], floor));
  });

  it("reads non-finite numbers as the null JSON writes for them, the input the engine's exporter gets", () => {
    const base = input("rent-classes");
    const hotel = base.units.findIndex((u) => u.kind === "hotelSuite");
    expect(hotel).toBeGreaterThanOrEqual(0);
    // Asleep, so the exporter reads its occupants.
    base.units[hotel] = { ...base.units[hotel], state: "asleep" };
    for (const path of [["minutes"], ["money"], ["units", hotel, "occupants"], ["units", 0, "rent"], ["units", 1, "x"], ["units", 1, "width"]] as (string | number)[][]) {
      for (const bad of [NaN, Infinity, -Infinity]) {
        const live = withValue(base, path, bad) as SerializedGame;
        const read = outcome(live);
        expect(read, `${path.join(".")}=${bad}`).toBe(outcome(viaJson(live)));
        if (read === "ok") expect(sha(buildTDT(live).bytes), `${path.join(".")}=${bad}`).toBe(sha(buildTDT(viaJson(live)).bytes));
      }
    }
  });

  it("refuses JSON nested 128 levels deep with the engine reader's message", () => {
    const small = { units: [], transports: [] };
    // The root object is the first level.
    expect(outcome({ ...small, extra: nested(126) })).toBe("ok");
    // `{"units":[],"transports":[],"extra":` is 36 bytes, so the 127th array
    // opens at column 163. The column counts UTF-8 bytes: `"towerName":"é塔🏢",`
    // is 15 ASCII bytes and 2 + 3 + 4 for the three characters, 24 in all.
    expect(outcome({ ...small, extra: nested(127) })).toBe("refused: save: recursion limit exceeded at line 1 column 163");
    expect(outcome({ towerName: "é塔🏢", ...small, extra: nested(127) })).toBe("refused: save: recursion limit exceeded at line 1 column 187");
    // Brackets inside a string do not nest.
    expect(outcome({ towerName: "[".repeat(200), ...small, extra: nested(126) })).toBe("ok");
    // Past 2,048 levels and inside the stack, the column is still the
    // engine's (a walk before the stringify once answered column 1 here).
    expect(outcome({ ...small, extra: nested(2500) })).toBe("refused: save: recursion limit exceeded at line 1 column 163");
    // Deep in fields the exporter reads, and beside a `toString` key that
    // brings in the reviver.
    const base = input("census");
    expect(outcome({ ...base, minutes: nested(1000), extra: NO_STRING })).toMatch(/^refused: save: recursion limit exceeded at line 1 column \d+$/);
    expect(outcome(withValue(base, ["units", 0, "x"], nested(1000)))).toMatch(/^refused: save: recursion limit exceeded at line 1 column \d+$/);
    // Where `JSON.stringify` recurses (V8 before 13.8, as in Node 22) it runs
    // out of stack first and its stack error reaches the caller; the engine,
    // which takes text, could not be handed this value. V8 13.8 and later
    // write the text, and the depth scan refuses it.
    let deepest: unknown;
    try {
      deepest = buildTDT({ ...base, extra: nested(100_000) } as SerializedGame);
    } catch (e) {
      deepest = e;
    }
    if (deepest instanceof LegacyExportError) expect(deepest.message).toMatch(/^save: recursion limit exceeded at line 1 column \d+$/);
    else expect(String(deepest)).toBe("RangeError: Maximum call stack size exceeded");
  });

  it("names the download TOWER1.TDT when the save has no string tower name", () => {
    for (const id of ["forged-name-missing", "forged-name-number"]) {
      const { report } = buildTDT(input(id));
      expect(report.towerName).toBe("");
      expect(report.filename).toBe("TOWER1.TDT");
    }
  });
});
