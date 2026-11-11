import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogFacility } from "../catalog/catalogTypes";
import { catalogFor } from "../tests/catalogFixture";
import { towerCatalog, useTowerCatalogSource } from "../catalog/towerCatalog";
import { PortCodes } from "../simport/portCodes";
import { PortRenderSim } from "../simport/portRenderSim";
import type { SimView } from "../simport/view";
import type { ViewReader } from "../simport/viewReader";
import { catalogOf, floorsOfPort, isUnlocked, newRenderSim, newViewReader, quoteBuild, quoteShaft } from "./portAccess";
import { bindViewKinds, isHotelKind, resetViewKindsForTests } from "../presentation/viewKinds";
import { code, frame, mockPort, record, structure } from "../tests/portKit/mockPort";

/**
 * The port's read helpers over a mock port: the calls they make and what
 * they make of the answers. The engine's own answers (a build quote and its
 * refusal text, a shaft check, the unlocked mask) are its tests:
 * `lobbyFloorCharge.integration.test.ts` quotes builds on the Rust engine, and
 * `the_unlocked_mask_follows_the_star` (engine-rs/src/view/frame_tests.rs)
 * pins the mask the reader decodes.
 */

const REFUSAL = "Needs a floor below.";

/** A port whose view holds one office, which the reader's first update sizes. */
function viewPort() {
  return mockPort({
    generation: () => 1,
    view: () => undefined,
    towerName: () => "Tower One",
    unitLabel: () => undefined,
    unitSubtype: () => undefined,
    unitMetaChanged: () => Float64Array.of(0, 0),
    viewStructure: () => structure({ header: { revision: 1, highestFloor: 1, lowestFloor: 1 }, rooms: [{ id: 10, kind: "office", floor: 1, x: 12, width: 9 }] }),
    viewFrame: (full: boolean) => frame({ header: { frameSeq: 1, full: full ? 1 : 0, rooms: 1, towerRevision: 1, metaRevision: 0 }, units: [{ slot: 0, state: code("unitStates", "occupied") }] }),
  });
}

describe("quoteBuild", () => {
  it("passes the kind's code and the spot, and reads the cost and the ok flag", () => {
    const port = mockPort({ quoteBuild: () => record("quoteBuild", { ok: 1, cost: 5_000 }), lastReason: () => REFUSAL });
    expect(quoteBuild(port, new PortCodes(port), "floor", 2, 12)).toEqual({ ok: true, cost: 5_000, reason: undefined });
    expect(port.quoteBuild).toHaveBeenCalledExactlyOnceWith(code("kinds", "floor"), 2, 12);
    expect(port.lastReason, "an accepted quote reads no reason").not.toHaveBeenCalled();
  });

  it("carries the engine's own refusal text with the cost it quoted", () => {
    const port = mockPort({ quoteBuild: () => record("quoteBuild", { ok: 0, cost: 40_000 }), lastReason: () => REFUSAL });
    expect(quoteBuild(port, new PortCodes(port), "office", 9, 12)).toEqual({ ok: false, cost: 40_000, reason: REFUSAL });
    expect(port.lastReason).toHaveBeenCalledOnce();
  });
});

describe("quoteShaft", () => {
  it("answers the placement check, and a refusal carries its reason", () => {
    let ok = 1;
    const port = mockPort({ quoteShaft: () => record("quoteShaft", { ok }), lastReason: () => REFUSAL });
    const codes = new PortCodes(port);
    expect(quoteShaft(port, codes, "elevatorStandard", 12, 1, 2)).toEqual({ ok: true, reason: undefined });
    expect(port.quoteShaft).toHaveBeenLastCalledWith(code("kinds", "elevatorStandard"), 12, 1, 2);
    expect(port.lastReason).not.toHaveBeenCalled();
    ok = 0;
    expect(quoteShaft(port, codes, "elevatorStandard", 12, 1, 6)).toEqual({ ok: false, reason: REFUSAL });
    expect(port.quoteShaft).toHaveBeenLastCalledWith(code("kinds", "elevatorStandard"), 12, 1, 6);
  });
});

/** A reader as `catalogOf` reads it: the header's mode. */
const readerIn = (mode: "classic" | "modern") => ({ header: { mode } }) as unknown as Pick<SimView, "header">;

describe("catalogOf", () => {
  it("is the catalog of the reader's mode, kept across header updates", () => {
    const c = { enginePort: {}, reader: readerIn("classic") };
    const m = { enginePort: {}, reader: readerIn("modern") };
    expect(catalogOf(c).mode).toBe("classic");
    expect(catalogOf(m).mode).toBe("modern");
    const first = catalogOf(c);
    c.reader = readerIn("classic");
    expect(catalogOf(c)).toBe(first);
  });

  it("follows the catalog source installed on the engine port", () => {
    const enginePort = {};
    const reader = readerIn("classic");
    const base = catalogOf({ enginePort, reader });
    const office = catalogFacility(base, "office");
    const hosted = {
      ...base,
      facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, width: f.width + 2, cost: f.cost + 1000 } : f)),
    };
    useTowerCatalogSource(enginePort, () => hosted);
    const read = catalogFacility(catalogOf({ enginePort, reader }), "office");
    expect(read.width).toBe(office.width + 2);
    expect(read.cost).toBe(office.cost + 1000);
    useTowerCatalogSource(enginePort, null);
    expect(catalogFacility(catalogOf({ enginePort, reader }), "office").width).toBe(office.width);
  });
});

describe("isUnlocked", () => {
  it("answers what the reader decodes for the kind, as of its last update", () => {
    const unlocked = vi.fn((kind: string) => kind === "office");
    const reader = { unlocked } as unknown as Pick<ViewReader, "unlocked">;
    expect(isUnlocked({ reader }, "office")).toBe(true);
    expect(isUnlocked({ reader }, "elevatorExpress")).toBe(false);
    expect(unlocked.mock.calls).toEqual([["office"], ["elevatorExpress"]]);
  });
});

describe("newRenderSim", () => {
  it("reads its catalog from the engine's source, so the renderer sizes rooms as the engine does", () => {
    const engine = viewPort();
    const reader = newViewReader(engine);
    // A source whose wedding hall no catalog states: seven stories.
    const marked = (mode: "classic" | "modern") => {
      const c = catalogFor(mode);
      return { ...c, facilities: c.facilities.map((f) => (f.key === "weddingHall" ? { ...f, floors: 7 } : f)) };
    };
    useTowerCatalogSource(engine, marked);
    const hall = (sim: object) => towerCatalog(sim as { mode: "classic" | "modern" }).facilities.find((f) => f.key === "weddingHall")?.floors;
    expect(hall(newRenderSim(engine, reader))).toBe(7);
    // A render sim built bare reads the fallback, not the engine's source.
    expect(hall(new PortRenderSim(engine, reader))).toBe(catalogFacility(catalogFor("classic"), "weddingHall").floors);
  });
});

/** Some tests rebind the view's kind facts; leave them bound to the Modern tables for the next. */
afterEach(() => bindViewKinds(catalogFor("modern")));

describe("newViewReader", () => {
  it("binds the view's kind facts before the reader's first update asks a kind's height", () => {
    const engine = viewPort();
    resetViewKindsForTests();
    expect(() => newViewReader(engine)).not.toThrow();
    expect(isHotelKind("hotelSingle")).toBe(true);
  });
});

describe("floorsOfPort", () => {
  /** A source whose wedding hall no catalog states: seven stories. */
  const tallHall = (mode: "classic" | "modern") => {
    const c = catalogFor(mode);
    return { ...c, facilities: c.facilities.map((f) => (f.key === "weddingHall" ? { ...f, floors: 7 } : f)) };
  };

  it("answers from the port's own catalog, whatever the view's kind facts were last bound to", () => {
    const engine = mockPort();
    const floors = floorsOfPort(engine);
    useTowerCatalogSource(engine, tallHall);
    expect(floors("weddingHall")).toBe(7);
    expect(floors("office")).toBe(1);
    // Something else rebinds the view's facts to another catalog: this port's heights stay.
    bindViewKinds(catalogFor("classic"));
    expect(floors("weddingHall")).toBe(7);
    // The port is pointed back at the fallback, as a swapped-in tower would be.
    useTowerCatalogSource(engine, null);
    expect(floors("weddingHall")).toBe(catalogFor("modern").facilities.find((f) => f.key === "weddingHall")!.floors);
  });
});
