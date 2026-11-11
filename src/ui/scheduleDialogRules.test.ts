import { describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { makeRules } from "../engine/gameRules";
import { topOriginFloors } from "../engine/scheduleOrigins";
import { HOTSPOT_FLOORS, HOTSPOT_MIN_SHARE, hotspotFloors, scheduleDialogUX } from "./scheduleDialogRules";

describe("scheduleDialogUX", () => {
  it("offers Classic the raw grid alone and Modern every assisted tool", () => {
    expect(scheduleDialogUX(catalogFor("classic").rules)).toEqual({ presets: false, autoTune: false, advice: false, rawGridDefault: true });
    expect(scheduleDialogUX(catalogFor("modern").rules)).toEqual({ presets: true, autoTune: true, advice: true, rawGridDefault: false });
  });

  it("shows what the TypeScript rule set showed in each mode, while that engine exists", () => {
    for (const mode of ["classic", "modern"] as const) {
      expect(scheduleDialogUX(catalogFor(mode).rules), mode).toEqual(makeRules(mode).elevatorScheduleUX());
    }
  });
});

describe("hotspotFloors (#465)", () => {
  it("returns the busiest floors first, filtered by share and capped", () => {
    // 2 of 42 is under the share: left out.
    expect(hotspotFloors(new Map([[1, 10], [7, 30], [4, 2]]))).toEqual([7, 1]);
    expect(hotspotFloors(new Map([[1, 25], [2, 25], [3, 25], [4, 25]]))).toEqual([1, 2, 3]);
    expect(HOTSPOT_FLOORS).toBe(3);
  });

  it("keeps a floor exactly at the least share", () => {
    const share = HOTSPOT_MIN_SHARE * 100;
    expect(hotspotFloors(new Map([[2, share], [5, 100 - share]]))).toEqual([5, 2]);
  });

  it("is empty with no measured boardings", () => {
    expect(hotspotFloors(undefined)).toEqual([]);
    expect(hotspotFloors(new Map())).toEqual([]);
    expect(hotspotFloors(new Map([[3, 0]]))).toEqual([]);
  });

  it("breaks count ties toward the lower floor for a stable readout", () => {
    expect(hotspotFloors(new Map([[9, 10], [3, 10]]))).toEqual([3, 9]);
  });

  it("marks the floors the TypeScript engine's ranking marked, while that engine exists", () => {
    const slots = [new Map([[1, 10], [7, 30], [4, 2]]), new Map([[-2, 4], [12, 4], [30, 1]]), new Map([[5, 1]])];
    for (const slot of slots) expect(hotspotFloors(slot)).toEqual(topOriginFloors(slot));
  });
});
