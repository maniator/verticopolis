import { describe, it, expect, vi } from "vitest";
import { focus } from "./towerInputCamera";
import { FACILITIES } from "../../engine/facilitiesData";
import type { TowerEngine } from "./TowerEngine";

/**
 * The audio view-focus now carries the crowd layer's two live signals: `hour`
 * (sim clock as a float) and `crowd` (fill of the dominant kind in view, with
 * a drawn-crowd fallback for kinds that track no occupants). These tests pin
 * both against a structural engine stub: the same fields `focus()` reads,
 * nothing else.
 */

interface StubUnit {
  kind: string;
  floor: number;
  x: number;
  width: number;
  occupants: number;
  customersIn?: number;
}

function stubEngine(opts: {
  units: StubUnit[];
  people?: Array<{ floor: number; x: number }>;
  minuteOfDay?: number;
}): TowerEngine {
  return {
    viewWidth: 100,
    viewHeight: 100,
    // The viewport maps to tiles 0..10 and floors 0..10 (30/70 percent bands
    // land at tiles 3..7 and floors 3..7).
    screenToTile: (px: number) => px / 10,
    screenToFloor: (py: number) => 10 - py / 10,
    cam: { zoom: 1.2 },
    sim: {
      weather: "clear",
      clock: { isNight: () => false, minuteOfDay: opts.minuteOfDay ?? 810 },
      tower: { units: opts.units },
      crowd: { people: opts.people ?? [] },
    },
  } as unknown as TowerEngine;
}

describe("focus() crowd and hour plumbing", () => {
  it("reports the dominant kind's live fill against catalog capacity", () => {
    const cap = FACILITIES.office.population;
    const f = focus(
      stubEngine({
        units: [
          { kind: "office", floor: 5, x: 4, width: 4, occupants: cap }, // full
          { kind: "office", floor: 6, x: 4, width: 4, occupants: 0 }, // empty
        ],
      }),
    );
    expect(f.dominant).toBe("office");
    expect(f.crowd).toBeCloseTo(0.5); // one full office of two
  });

  it("clamps overfull venues to 1", () => {
    const f = focus(
      stubEngine({
        units: [{ kind: "condo", floor: 5, x: 4, width: 4, occupants: FACILITIES.condo.population * 3 }],
      }),
    );
    expect(f.crowd).toBe(1);
  });

  it("reads live customers, never the open-hour stamp, for commercial venues", () => {
    // The economy pass stamps an OPEN restaurant's `occupants` to the full
    // catalog population regardless of who is actually inside; the honest
    // fill for commercial kinds is the routed-customer tally `customersIn`.
    const cap = FACILITIES.restaurant.population;
    const empty = focus(
      stubEngine({
        units: [{ kind: "restaurant", floor: 5, x: 4, width: 6, occupants: cap, customersIn: 0 }],
      }),
    );
    expect(empty.dominant).toBe("restaurant");
    expect(empty.crowd).toBe(0); // open but nobody eating: quiet
    const half = focus(
      stubEngine({
        units: [
          { kind: "restaurant", floor: 5, x: 4, width: 6, occupants: cap, customersIn: Math.round(cap / 2) },
        ],
      }),
    );
    expect(half.crowd).toBeCloseTo(0.5, 1);
  });

  it("uses the attendance capacity for population-0 venues", () => {
    const att = FACILITIES.partyHall.attendance ?? 0;
    expect(att).toBeGreaterThan(0);
    const f = focus(
      stubEngine({
        units: [{ kind: "partyHall", floor: 5, x: 4, width: 6, occupants: Math.round(att / 2) }],
      }),
    );
    expect(f.dominant).toBe("partyHall");
    expect(f.crowd).toBeCloseTo(0.5, 1);
  });

  it("falls back to visible drawn-crowd density for occupant-less kinds", () => {
    const f = focus(
      stubEngine({
        units: [{ kind: "lobby", floor: 5, x: 4, width: 6, occupants: 0 }],
        people: Array.from({ length: 12 }, () => ({ floor: 5, x: 5 })),
      }),
    );
    expect(f.dominant).toBe("lobby");
    expect(f.crowd).toBeCloseTo(0.5); // 12 of the 24-person full house
  });

  it("ignores drawn people outside the viewed floors or tiles in the fallback", () => {
    const f = focus(
      stubEngine({
        units: [{ kind: "lobby", floor: 5, x: 4, width: 6, occupants: 0 }],
        people: [
          ...Array.from({ length: 30 }, () => ({ floor: 40, x: 5 })), // above the view
          ...Array.from({ length: 30 }, () => ({ floor: 5, x: 40 })), // off to the side
        ],
      }),
    );
    expect(f.crowd).toBe(0);
  });

  it("refreshes the occupancy census at most once per second", () => {
    const cap = FACILITIES.office.population;
    const unit = { kind: "office", floor: 5, x: 4, width: 4, occupants: cap };
    const engine = stubEngine({ units: [unit] });
    let clock = 10_000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      expect(focus(engine).crowd).toBeCloseTo(1);
      unit.occupants = 0; // the office empties...
      clock += 500; // ...but the census is half a second old
      expect(focus(engine).crowd).toBeCloseTo(1); // cached value holds
      clock += 600; // past the 1 s refresh window
      expect(focus(engine).crowd).toBeCloseTo(0); // fresh walk sees the truth
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("re-walks the census immediately when the dominant kind changes", () => {
    const cap = FACILITIES.office.population;
    const office = { kind: "office", floor: 5, x: 4, width: 2, occupants: cap };
    const shop = { kind: "shop", floor: 5, x: 6, width: 1, occupants: 0 };
    const engine = stubEngine({ units: [office, shop] });
    let clock = 20_000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      expect(focus(engine).dominant).toBe("office");
      office.width = 0; // the pan story: the shop becomes dominant next call
      clock += 100; // well inside the cache window
      const f = focus(engine);
      expect(f.dominant).toBe("shop");
      expect(f.crowd).toBe(0); // not the office's stale cached fill
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("carries the sim clock as a fractional hour", () => {
    const f = focus(stubEngine({ units: [], minuteOfDay: 810 }));
    expect(f.hour).toBeCloseTo(13.5);
  });
});
