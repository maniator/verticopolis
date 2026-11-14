import { describe, expect, it } from "vitest";
import { tunnelSpans } from "./towerMetro";

describe("tunnelSpans", () => {
  it("lays the tunnel on both sides of one station, out to the lot's edges", () => {
    expect(tunnelSpans([{ x: 100, width: 30 }], 375)).toEqual([
      [0, 100],
      [130, 375],
    ]);
  });

  it("leaves every station of a Modern line out of the tunnel, in any order", () => {
    const stations = [
      { x: 300, width: 30 },
      { x: 0, width: 30 },
      { x: 172, width: 30 },
    ];
    expect(tunnelSpans(stations, 375)).toEqual([
      [30, 172],
      [202, 300],
      [330, 375],
    ]);
  });

  it("lays nothing between stations that touch or at a lot edge a station fills", () => {
    expect(
      tunnelSpans(
        [
          { x: 0, width: 30 },
          { x: 30, width: 30 },
          { x: 345, width: 30 },
        ],
        375,
      ),
    ).toEqual([[60, 345]]);
  });
});
