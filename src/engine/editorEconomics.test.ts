import { describe, it, expect } from "vitest";
import { resaleRefund, carResaleRefund, extendBill, ECON } from "./econConfig";
import { FACILITIES } from "./facilities";
import type { FacilityKind } from "./types";

describe("resaleRefund", () => {
  it("is half the build cost (floored) for every facility kind", () => {
    for (const kind of Object.keys(FACILITIES) as FacilityKind[]) {
      // Asserted against the imported constant, never a magic number, so it
      // can't drift from FACILITIES.
      expect(resaleRefund(kind)).toBe(Math.floor(FACILITIES[kind].cost * 0.5));
    }
  });
});

describe("ECON constants", () => {
  it("names the add-car cost", () => {
    expect(ECON.addCarCost).toBe(40_000);
  });
});

describe("carResaleRefund", () => {
  it("pays back half the add-car cost, like the facility resale rule", () => {
    expect(carResaleRefund()).toBe(20_000);
    expect(carResaleRefund()).toBe(Math.floor(ECON.addCarCost * 0.5));
  });
});

describe("extendBill", () => {
  const PF = ECON.transportFloorCost;

  it("grows the dragged end and bills only floors past the high-water mark", () => {
    const r = extendBill({ bottom: 0, top: 5 }, { bottom: 0, top: 5 }, "up", 8, 1_000_000, PF);
    expect(r.nb).toBe(0);
    expect(r.nt).toBe(8);
    expect(r.added).toBe(3); // floors 6, 7, 8
  });

  it("clamps growth to what the player can afford", () => {
    const money = 2 * PF; // exactly two floors
    const r = extendBill({ bottom: 0, top: 5 }, { bottom: 0, top: 5 }, "up", 10, money, PF);
    expect(r.nt).toBe(7); // hwm.top(5) + min(5, 2)
    expect(r.added).toBe(2);
  });

  it("stops growing when a single floor is unaffordable", () => {
    const r = extendBill({ bottom: 0, top: 5 }, { bottom: 0, top: 5 }, "up", 9, 0, PF);
    expect(r.nt).toBe(5); // no growth
    expect(r.added).toBe(0);
  });

  it("re-bills nothing for a back-and-forth wiggle within the high-water mark", () => {
    // Already grown to 8; dragging the top end back down to 6 is within the HWM.
    const r = extendBill({ bottom: 0, top: 8 }, { bottom: 0, top: 8 }, "up", 6, 1_000_000, PF);
    expect(r.nt).toBe(6);
    expect(r.added).toBe(0);
  });

  it("bills the bottom end symmetrically", () => {
    const r = extendBill({ bottom: 0, top: 5 }, { bottom: 0, top: 5 }, "down", -3, 1_000_000, PF);
    expect(r.nb).toBe(-3);
    expect(r.added).toBe(3); // floors -1, -2, -3
  });

  it("in debt, an outward drag is a no-op — never a silent free shrink", () => {
    // A negative budget used to pull the end BELOW the high-water mark:
    // dragging up with -2 floors of money chopped 2 floors off the top.
    const up = extendBill({ bottom: 0, top: 5 }, { bottom: 0, top: 5 }, "up", 8, -2 * PF, PF);
    expect(up.nt).toBe(5); // unchanged, not 3
    expect(up.added).toBe(0);
    const down = extendBill({ bottom: 0, top: 5 }, { bottom: 0, top: 5 }, "down", -3, -2 * PF, PF);
    expect(down.nb).toBe(0); // unchanged, not 2
    expect(down.added).toBe(0);
  });
});
