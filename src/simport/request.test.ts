import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  INVALID_COMMAND,
  MAX_BRUSH_TILES,
  MAX_TEXT,
  NOT_ENOUGH_MONEY,
  wellFormed,
} from "./request";

describe("the refusal texts the web compares against", () => {
  // The engine refuses with these exact words (`INVALID_REQUEST` and
  // `NOT_ENOUGH_MONEY` in `engine-rs/src/charges.rs`, which its own test pins
  // to the same literals). Change both sides together.
  it("match the engine's", () => {
    expect(INVALID_COMMAND).toBe("That request is not valid.");
    expect(NOT_ENOUGH_MONEY).toBe("Not enough money.");
  });
});

describe("wellFormed, the port's shape check", () => {
  const isKind = (k: unknown) => k === "office" || k === "elevatorStandard";
  const ok = (c: unknown) => wellFormed(c, isKind);

  // One well-formed command per op, so a check that refuses a good command fails here.
  const good: Command[] = [
    { op: "build", kind: "office", floor: 3, x: 10 },
    { op: "paintBrush", kind: "floor", floor: 2, tiles: [1, 2, 3] },
    { op: "buildTransport", kind: "elevatorStandard", x: 4, bottom: 0, top: 9 },
    { op: "removeFacility", id: 7, method: "sell" },
    { op: "beginExtend", id: 7 },
    { op: "extendTransport", id: 7, end: "up", targetFloor: 12 },
    { op: "endExtend" },
    { op: "addCar", id: 7 },
    { op: "removeCar", id: 7 },
    { op: "setStop", id: 7, floor: 3, stop: true },
    { op: "setExpressStops", id: 7 },
    { op: "clearStops", id: 7 },
    {
      op: "setSchedule",
      id: 7,
      schedule: { rows: [[1, 2], [3]], home: null, mode: "busy" },
    },
    { op: "setLabel", id: 7, label: "North bank" },
    { op: "adjustRent", id: 7, dir: -1 },
    { op: "setNoRate", id: 7 },
    { op: "priceUnit", id: 7, target: 1500.5 },
    {
      op: "applyRentBatch",
      kind: "office",
      target: "noRate",
      onlyDefaultPriced: true,
    },
    { op: "applyRentBatch", kind: "office", target: 2000 },
    { op: "setFilmPolicy", id: 7, policy: "blockbuster" },
    { op: "rerollSubtype", id: 7 },
    { op: "callExterminator" },
    { op: "resolveChoice", accept: false },
    { op: "toggleAutoBridge" },
    { op: "setAutoBridge", value: true },
    { op: "setTowerName", name: "Tower" },
    { op: "setView", view: null },
    { op: "setView", view: { tile: 4, floor: 2, zoom: 2 } },
    { op: "emit", text: "hello", kind: "good" },
    { op: "emit", text: "hello" },
  ];
  it.each(good.map((c) => [c.op, c] as const))(
    "accepts a well-formed %s",
    (_, c) => {
      expect(ok(c)).toBe(true);
    },
  );

  it("reads a null zoom as absent, as a load does", () => {
    expect(ok({ op: "setView", view: { tile: 4, floor: 2, zoom: null } })).toBe(
      true,
    );
  });

  const bad: [string, unknown][] = [
    ["a non-object", "build"],
    ["null", null],
    ["an unknown op", { op: "launch" }],
    ["an inherited op name", { op: "toString" }],
    [
      "a kind outside the catalog",
      { op: "build", kind: "castle", floor: 3, x: 10 },
    ],
    ["a fractional floor", { op: "build", kind: "office", floor: 2.5, x: 10 }],
    [
      "a floor past 32 bits",
      { op: "build", kind: "office", floor: 2 ** 31, x: 10 },
    ],
    [
      "an unknown brush kind",
      { op: "paintBrush", kind: "roof", floor: 2, tiles: [1] },
    ],
    [
      "too many brush tiles",
      {
        op: "paintBrush",
        kind: "floor",
        floor: 2,
        tiles: Array.from({ length: MAX_BRUSH_TILES + 1 }, (_, i) => i),
      },
    ],
    [
      "a hole in the tiles",
      {
        op: "paintBrush",
        kind: "floor",
        floor: 2,
        tiles: Object.assign(new Array<number>(3), { 0: 1, 2: 3 }),
      },
    ],
    [
      "a tile behind a getter",
      {
        op: "paintBrush",
        kind: "floor",
        floor: 2,
        tiles: Object.defineProperty([1, 2], 1, { get: () => 2 }),
      },
    ],
    [
      "tiles that are not an array",
      { op: "paintBrush", kind: "floor", floor: 2, tiles: "1,2" },
    ],
    [
      "an unknown removal method",
      { op: "removeFacility", id: 7, method: "explode" },
    ],
    [
      "an unknown extend end",
      { op: "extendTransport", id: 7, end: "sideways", targetFloor: 1 },
    ],
    ["a string id", { op: "addCar", id: "7" }],
    ["a non-boolean stop", { op: "setStop", id: 7, floor: 3, stop: 1 }],
    ["a rent step of 2", { op: "adjustRent", id: 7, dir: 2 }],
    ["an infinite price", { op: "priceUnit", id: 7, target: Infinity }],
    [
      "an unknown batch target",
      { op: "applyRentBatch", kind: "office", target: "free" },
    ],
    [
      "a non-boolean batch flag",
      {
        op: "applyRentBatch",
        kind: "office",
        target: "default",
        onlyDefaultPriced: "yes",
      },
    ],
    ["an unknown film policy", { op: "setFilmPolicy", id: 7, policy: "indie" }],
    ["a missing answer", { op: "resolveChoice" }],
    ["a non-boolean bridge", { op: "setAutoBridge", value: "on" }],
    [
      "a name past the text cap",
      { op: "setTowerName", name: "x".repeat(MAX_TEXT + 1) },
    ],
    ["a numeric label", { op: "setLabel", id: 7, label: 5 }],
    ["an unknown log kind", { op: "emit", text: "hi", kind: "loud" }],
    ["a view that is an array", { op: "setView", view: [1, 2] }],
    [
      "a view with a text zoom",
      { op: "setView", view: { tile: 1, floor: 2, zoom: "far" } },
    ],
    ["a view missing its floor", { op: "setView", view: { tile: 1 } }],
  ];
  it.each(bad)("refuses %s", (_, c) => {
    expect(ok(c)).toBe(false);
  });

  // A schedule is checked only for being plain data the host can copy as JSON.
  const schedule = (s: unknown) =>
    ok({ op: "setSchedule", id: 7, schedule: s });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  class Box {
    v = 1;
  }
  class List extends Array<number> {}
  const unplain: [string, unknown][] = [
    ["a BigInt", 1n],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a class instance", new Box()],
    ["an array subclass", List.from([1])],
    ["an own toJSON", { toJSON: () => ({}) }],
    [
      "a getter",
      Object.defineProperty({}, "rows", { get: () => [], enumerable: true }),
    ],
    ["a cycle", cyclic],
    ["nesting past four levels", { a: { b: { c: { d: { e: 1 } } } } }],
    ["more values than the budget", Array.from({ length: 300 }, () => 0)],
    ["a huge sparse array", Object.assign([], { length: 1e6 })],
    ["a lone surrogate", { name: "\uD800" }],
    ["a lone surrogate in a key", { ["k\uDC00"]: 1 }],
    ["more text than the budget", ["x".repeat(MAX_TEXT), "y"]],
  ];
  it.each(unplain)("refuses a schedule holding %s", (_, s) => {
    expect(schedule(s)).toBe(false);
  });

  it("accepts a schedule of plain data, a null-prototype object and a surrogate pair", () => {
    expect(
      schedule({
        rows: [[1, 2, 3]],
        on: true,
        note: "ok",
        gone: undefined,
        none: null,
      }),
    ).toBe(true);
    expect(
      schedule(Object.assign(Object.create(null) as object, { a: 1 })),
    ).toBe(true);
    expect(schedule({ name: "😀" })).toBe(true);
    expect(schedule({ a: { b: { c: { d: 1 } } } })).toBe(true);
  });
});
