import { describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { HOTSPOT_FLOORS, HOTSPOT_MIN_SHARE, hotspotFloors, scheduleDialogUX } from "./scheduleDialogRules";

describe("scheduleDialogUX", () => {
  it("offers Classic the raw grid alone and Modern every assisted tool", () => {
    expect(scheduleDialogUX(catalogFor("classic").rules)).toEqual({ presets: false, autoTune: false, advice: false, rawGridDefault: true });
    expect(scheduleDialogUX(catalogFor("modern").rules)).toEqual({ presets: true, autoTune: true, advice: true, rawGridDefault: false });
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
    // A basement floor ranks like any other, and the thin top floor falls under the share.
    expect(hotspotFloors(new Map([[-2, 4], [12, 4], [30, 1]]))).toEqual([-2, 12]);
  });
});
