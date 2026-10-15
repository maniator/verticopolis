import { describe, expect, it } from "vitest";
import { CATALOG_VERSION, catalogFor } from "../engine/catalog";
import type { GameMode } from "../engine/types";
import { readCatalog } from "./catalog";

const reply = (text: string) => ({ catalog: () => text });

describe("readCatalog", () => {
  it("parses the catalog the binding returns", () => {
    for (const mode of ["classic", "modern"] as const) {
      const want = catalogFor(mode);
      expect(readCatalog(reply(JSON.stringify(want)), mode)).toEqual(want);
    }
  });

  it("refuses a binding without the export", () => {
    expect(() => readCatalog({}, "classic")).toThrow(/exports no catalog/);
  });

  it("refuses a reply that is not a catalog", () => {
    for (const text of ["null", "[]", "3", '"catalog"']) {
      expect(() => readCatalog(reply(text), "classic"), text).toThrow(/returned no catalog/);
    }
    expect(() => readCatalog(reply("{truncated"), "classic")).toThrow(/returned no classic catalog/);
    const refusing = { catalog: () => { throw new Error("mode must be classic or modern"); } };
    expect(() => readCatalog(refusing, "classic")).toThrow(/returned no classic catalog: mode must be/);
    const { facilities: _f, ...partial } = catalogFor("classic");
    void _f;
    expect(() => readCatalog(reply(JSON.stringify(partial)), "classic")).toThrow(/without its world, economy, pools or facilities/);
  });

  it("refuses another shape version or another mode", () => {
    const classic = JSON.stringify(catalogFor("classic"));
    expect(() => readCatalog(reply(classic), "classic", CATALOG_VERSION + 1)).toThrow(/expected version/);
    expect(() => readCatalog(reply(JSON.stringify({ ...catalogFor("classic"), version: 99 })), "classic")).toThrow(/version 99/);
    expect(() => readCatalog(reply(classic), "modern")).toThrow(/asked for the modern catalog/);
  });

  // A stale or damaged binding of the same version: the top-level sections are
  // there, a field inside one is not what the shape says.
  describe("refuses a version 1 catalog whose nested shape is wrong", () => {
    type Json = Record<string, unknown>;
    const damaged = (mode: GameMode, damage: (c: Json) => void) => {
      const c = JSON.parse(JSON.stringify(catalogFor(mode))) as Json;
      damage(c);
      return reply(JSON.stringify(c));
    };
    const facility = (c: Json, key: string) => (c.facilities as Json[]).find((f) => f.key === key)!;
    const rent = (c: Json, key: string) => facility(c, key).rent as Json;
    const economy = (c: Json) => c.economy as Json;
    const cases: [string, GameMode, (c: Json) => void, RegExp][] = [
      ["a missing facility cost", "classic", (c) => delete facility(c, "office").cost, /missing facilities\[\d+\]\.cost/],
      ["a cost given as text", "classic", (c) => (facility(c, "office").cost = "40000"), /invalid facilities\[\d+\]\.cost: "40000"/],
      ["a negative resale refund", "modern", (c) => (facility(c, "office").resaleRefund = -1), /invalid facilities\[\d+\]\.resaleRefund/],
      ["a fractional build cap", "classic", (c) => (facility(c, "lobby").buildCap = 1.5), /invalid facilities\[\d+\]\.buildCap/],
      ["an elevator without a span", "classic", (c) => (facility(c, "elevatorStandard").maxSpan = null), /does not match its transport flag/],
      ["a kind listed twice", "classic", (c) => (c.facilities as Json[]).push(facility(c, "office")), /office is listed twice/],
      ["a pool naming an unknown kind", "classic", (c) => ((c.pools as Json[])[0].kinds as string[]).push("monorail"), /"monorail" is not a listed facility/],
      ["a facility naming a pool key that does not exist", "classic", (c) => (facility(c, "stairs").pool = "ramps"), /invalid facilities\[\d+\]\.pool: "ramps"/],
      ["a facility naming a pool the catalog does not list", "classic", (c) => (c.pools as Json[]).pop(), /facilities\[\d+\]\.pool: walkways is not a listed pool/],
      ["an unknown category", "classic", (c) => (facility(c, "office").category = "zoo"), /invalid facilities\[\d+\]\.category: "zoo"/],
      ["a rent without a shape", "classic", (c) => delete rent(c, "office").shape, /missing facilities\[\d+\]\.rent\.shape/],
      ["a pool with a zero cap", "classic", (c) => ((c.pools as Json[])[0].cap = 0), /invalid pools\[0\]\.cap/],
      ["a ladder without rungs", "classic", (c) => (rent(c, "office").rungs = []), /rent\.rungs: no rung/],
      ["a rung without a value", "classic", (c) => delete (rent(c, "office").rungs as Json[])[0].value, /missing facilities\[\d+\]\.rent\.rungs\[0\]\.value/],
      ["a band default outside the band", "modern", (c) => (rent(c, "office").default = 1e12), /default lies outside the band/],
      ["an unknown rent shape", "modern", (c) => (rent(c, "office").shape = "auction"), /rent\.shape: "auction"/],
      ["a missing economy constant", "modern", (c) => delete economy(c).addCarCost, /missing economy\.addCarCost/],
      ["a null overhead", "modern", (c) => (economy(c).overheadPerUnitMonthly = null), /invalid economy\.overheadPerUnitMonthly/],
      ["no calendar", "modern", (c) => (economy(c).calendars = []), /economy\.calendars: no calendar/],
      ["an unknown calendar", "modern", (c) => ((economy(c).calendars as Json[])[0].key = "lunar"), /invalid economy\.calendars\[0\]\.key/],
      ["a half-stated exterminator", "modern", (c) => delete (economy(c).exterminator as Json).perRoomFee, /missing economy\.exterminator\.perRoomFee/],
      ["a ground floor structure that is not a kind", "classic", (c) => ((c.world as Json).groundFloorStructure = "plaza"), /plaza is not a listed facility/],
      ["a ground floor outside the floor range", "classic", (c) => ((c.world as Json).groundFloor = 999), /ground floor lies outside the floor range/],
    ];
    for (const [name, mode, damage, message] of cases) {
      it(name, () => {
        expect(() => readCatalog(damaged(mode, damage), mode)).toThrow(message);
      });
    }
  });
});
