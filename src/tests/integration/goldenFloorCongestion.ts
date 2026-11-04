import { expect } from "vitest";
import type { EnginePort } from "../../simport/enginePort";

/** `floorCongestion` on both engines: the same answer for a handful of floors
 *  (none, ordinary, off the tower, not whole) and for the hotspot's floor,
 *  where the reading is the hotspot's ratio. */
export function sameFloorCongestion([rust, ts]: [EnginePort, EnginePort]): void {
  const [peak, peakFloor] = rust.hotspot();
  const floors = [0, 1, 2, 3, 5, 9999, 2.5, NaN, ...(Number.isNaN(peakFloor) ? [] : [peakFloor])];
  for (const floor of floors) expect(ts.floorCongestion(floor), `floorCongestion ${floor}`).toBe(rust.floorCongestion(floor));
  if (!Number.isNaN(peakFloor)) for (const [i, e] of [rust, ts].entries()) expect(e.floorCongestion(peakFloor), `peak floor ${i}`).toBe(peak);
}
