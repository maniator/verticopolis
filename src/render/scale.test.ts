import { describe, it, expect } from "vitest";
import { FLOOR, TILE, TRANSPORT_BAND_FLOORS } from "./scale";
import { FACILITIES } from "../engine/facilities";

/**
 * The two render-scale invariants behind the canon elevator dimensions change:
 * the elevator car must read square, and no shaft texture band may exceed the
 * lowest common mobile GPU texture limit. Both lived only in comments before;
 * these guards make a drive-by change to either constant fail loudly.
 */
describe("render scale", () => {
  it("a floor is exactly one standard-elevator width tall, so the car is square", () => {
    expect(FLOOR).toBe(FACILITIES.elevatorStandard.width * TILE);
    // Canon: standard and service share the footprint (a service elevator is a
    // staff-only standard elevator), so the service car is square too.
    expect(FACILITIES.elevatorService.width).toBe(FACILITIES.elevatorStandard.width);
  });

  it("shaft texture bands stay under the 2048px mobile GPU limit", () => {
    expect(TRANSPORT_BAND_FLOORS * FLOOR).toBeLessThanOrEqual(2048);
  });
});
