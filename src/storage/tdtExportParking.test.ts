import { describe, expect, it } from "vitest";
import { connectedStallCount } from "./tdtExportParking";
import type { GatheredRoom } from "./tdtExportGather";

/**
 * The parking block's connected-stall count must describe stalls that are IN
 * the exported file. A burned shell or an out-of-range footprint writes no
 * tenant record, so letting one chain a run (or stand in as the ramp a run links
 * back to) claims connected stalls the floor map cannot account for, and
 * disagrees with the header's own stall count.
 */
const room = (over: Partial<GatheredRoom> & Pick<GatheredRoom, "kind" | "x" | "width">): GatheredRoom =>
  ({
    id: 1,
    floor: -1,
    state: "empty",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: "",
    emitted: true,
    ...over,
  }) as GatheredRoom;

describe("connectedStallCount", () => {
  it("counts stalls chained back to a ramp on their floor", () => {
    expect(
      connectedStallCount([
        room({ kind: "parkingRamp", x: 100, width: 16 }),
        room({ kind: "parking", x: 116, width: 4 }),
        room({ kind: "parking", x: 120, width: 4 }),
      ]),
    ).toBe(2);
  });

  it("counts nothing when the run never reaches a ramp", () => {
    expect(
      connectedStallCount([room({ kind: "parking", x: 116, width: 4 }), room({ kind: "parking", x: 120, width: 4 })]),
    ).toBe(0);
  });

  it("does NOT let a non-emitting ramp connect the stalls behind it", () => {
    // Same geometry, same ramp, only `emitted` differs: with the ramp in the
    // file the stalls are connected; with it burned (or out of range, which
    // writes nothing either) they are orphans, because the file the 1994 game
    // reads has no ramp there at all.
    const withRamp = (emitted: boolean) => [
      room({ kind: "parkingRamp", x: 100, width: 16, emitted, state: emitted ? "empty" : "gutted" }),
      room({ kind: "parking", x: 116, width: 4 }),
      room({ kind: "parking", x: 120, width: 4 }),
    ];
    expect(connectedStallCount(withRamp(true))).toBe(2);
    expect(connectedStallCount(withRamp(false))).toBe(0);
  });

  it("does NOT let a non-emitting stall bridge a gap between runs", () => {
    // The burned stall at 120 is the only thing touching both sides, so with it
    // absent from the file the far stall is no longer chained back to the ramp.
    const bridge = (emitted: boolean) => [
      room({ kind: "parkingRamp", x: 100, width: 16 }),
      room({ kind: "parking", x: 116, width: 4 }),
      room({ kind: "parking", x: 120, width: 4, emitted, state: emitted ? "empty" : "gutted" }),
      room({ kind: "parking", x: 124, width: 4 }),
    ];
    expect(connectedStallCount(bridge(true))).toBe(3);
    expect(connectedStallCount(bridge(false))).toBe(1);
  });

  it("chains only within a floor", () => {
    expect(
      connectedStallCount([
        room({ kind: "parkingRamp", x: 100, width: 16, floor: -1 }),
        room({ kind: "parking", x: 116, width: 4, floor: -2 }),
      ]),
    ).toBe(0);
  });
});
