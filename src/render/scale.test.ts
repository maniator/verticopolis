import { describe, it, expect } from "vitest";
import { FLOOR, TILE, TRANSPORT_BAND_FLOORS } from "./scale";
import { FACILITIES } from "../engine/facilities";

/**
 * The render-scale invariants: the world holds the 1994 original's 4.5 tiles per
 * floor, which makes the elevator car taller than it is wide, and no shaft
 * texture band may exceed the lowest common mobile GPU texture limit. Both lived
 * only in comments before; these guards make a drive-by change fail loudly.
 */
describe("render scale", () => {
  it("keeps both constants whole, because they are canvas dimensions", () => {
    // TILE and FLOOR size real bitmaps (a transport band is `floors * FLOOR` px
    // tall) and anchor pixel-art alignment. A fractional value would be rounded
    // or truncated by the canvas behind our back and show up as 1px seams and
    // drift rather than as a failure. 4.5 tiles per floor is only safe because
    // TILE is even; picking an odd TILE again would make FLOOR fractional, and
    // this is the guard that says so.
    expect(Number.isInteger(TILE)).toBe(true);
    expect(Number.isInteger(FLOOR)).toBe(true);
  });

  it("keeps the original's 4.5 tiles per floor", () => {
    // Measured off a retail SimTower render (Wine harness, TOWER13.TDT): nine
    // consecutive floor gaps of exactly 36px, shafts 31-32px wide for a 4-tile
    // car, so 8px tiles against a 36px floor.
    expect(FLOOR / TILE).toBe(4.5);
  });

  it("draws a standard car taller than it is wide, as the original does", () => {
    // Replaces an assertion that pinned a SQUARE car (FLOOR === width * TILE) on
    // the belief that the original's was square. Measurement says otherwise: the
    // original's 4-tile car is 32 x 36. The old pin locked in a car 12.5% too
    // wide for its height, and every sprite drawn against it inherited that.
    const carWidth = FACILITIES.elevatorStandard.width * TILE;
    expect(carWidth).toBeLessThan(FLOOR);
    expect(FLOOR / carWidth).toBeCloseTo(36 / 32, 5);
    // Canon: standard and service share the footprint (a service elevator is a
    // staff-only standard elevator), so the service car has the same shape.
    expect(FACILITIES.elevatorService.width).toBe(FACILITIES.elevatorStandard.width);
  });

  it("shaft texture bands stay under the 2048px mobile GPU limit", () => {
    expect(TRANSPORT_BAND_FLOORS * FLOOR).toBeLessThanOrEqual(2048);
  });
});
