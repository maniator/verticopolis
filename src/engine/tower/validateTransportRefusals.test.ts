import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import { INVALID_REQUEST, UNKNOWN_FACILITY } from "../request";
import type { FacilityKind } from "../types";

/** The refusals the Rust binding answers the same way (#1216), pinned here so a
 *  TypeScript-only run holds them too. */
describe("validateTransport and buildTransport refuse a bad request", () => {
  const sim = () => {
    const s = Simulation.newGame(5, "modern");
    s.money = 1e9;
    for (let x = 150; x < 190; x++) {
      expect(s.tower.place("lobby", 1, x).ok).toBe(true);
      expect(s.tower.place("floor", 2, x).ok).toBe(true);
    }
    return s;
  };

  it("an unknown kind is refused with a reason, never thrown", () => {
    const s = sim();
    for (const kind of ["", "ofice", "__proto__", "constructor", null, undefined, 5, {}]) {
      const k = kind as unknown as FacilityKind;
      expect(s.tower.validateTransport(k, 150, 1, 2)).toEqual({ ok: false, reason: UNKNOWN_FACILITY });
      expect(s.tower.placeTransportDryRun(k, 150, 1, 2)).toBe(false);
      expect(s.buildTransport(k, 150, 1, 2)).toEqual({ ok: false, reason: UNKNOWN_FACILITY });
      expect(s.previewRentBatch(k, "default")).toBeNull();
      expect(s.applyRentBatch(k, "default")).toBeNull();
    }
  });

  it("a coordinate that is not a whole number is refused before the tower is read", () => {
    const s = sim();
    const bad = [0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "3", null, undefined, 1n];
    for (const v of bad) {
      for (const args of [[v, 1, 2], [150, v, 2], [150, 1, v]]) {
        const [x, b, t] = args as number[];
        expect(s.tower.validateTransport("elevatorStandard", x, b, t)).toEqual({ ok: false, reason: INVALID_REQUEST });
        expect(s.tower.placeTransportDryRun("elevatorStandard", x, b, t)).toBe(false);
      }
    }
    // The last safe integer is whole: the tower refuses it for its own reason.
    const edge = s.tower.validateTransport("elevatorStandard", 2 ** 53 - 1, 1, 2);
    expect(edge.ok).toBe(false);
    expect(edge.reason).not.toBe(INVALID_REQUEST);
  });

  it("a whole request on built floors is accepted and writes nothing", () => {
    const s = sim();
    const revision = s.tower.revision;
    expect(s.tower.validateTransport("elevatorStandard", 160, 1, 2)).toEqual({ ok: true });
    expect(s.tower.placeTransportDryRun("elevatorStandard", 160, 1, 2)).toBe(true);
    expect(s.tower.revision).toBe(revision);
  });
});
