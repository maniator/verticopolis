import { describe, it, expect } from "vitest";
import { Tower } from "../../engine/Tower";
import { Crowd } from "../../engine/Crowd";
import { CLASSIC_RULES, MODERN_RULES } from "../../engine/gameRules";
import type { FacilityKind, GameMode } from "../../engine/types";

/**
 * Walkway willingness (#384, parity GDD §8): the Classic passenger router gives
 * stairs/escalators their own contiguous-walk budget (stairs 4 / escalators 7,
 * reset by any elevator ride) SEPARATE from the elevator ride budget. Before
 * this, each stair flight was one ride against the 2-ride cap, so pure-stair
 * reach dead-ended at 2 floors, stricter than the 1994 original. The fix
 * LOOSENS Classic stair reach to 4; Modern is left unchanged by this story (its
 * comfort-penalty is a separate track), and the staff network stays uncapped.
 */

const TOWER_W = 30;

function placeOk(tower: Tower, kind: FacilityKind, floor: number, x: number): void {
  const r = tower.place(kind, floor, x);
  expect(r.ok, `place(${kind}, f${floor}, x${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
}

function shaftOk(tower: Tower, kind: FacilityKind, x: number, bottom: number, top: number): number {
  const r = tower.placeTransport(kind, x, bottom, top);
  expect(r.ok, `placeTransport(${kind}, x${x}, ${bottom}..${top}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  return r.transportId!;
}

/** Ground lobby on 1, plain floors 2..top. */
function baseTower(mode: GameMode, top: number): Tower {
  const tower = new Tower();
  tower.rules = mode === "modern" ? MODERN_RULES : CLASSIC_RULES;
  for (let x = 0; x < TOWER_W; x++) placeOk(tower, "lobby", 1, x);
  for (let f = 2; f <= top; f++) for (let x = 0; x < TOWER_W; x++) placeOk(tower, "floor", f, x);
  return tower;
}

/** A column of single walkway flights connecting each adjacent floor 1..top. */
function walkwayColumn(mode: GameMode, top: number, kind: "stairs" | "escalator"): Tower {
  const tower = baseTower(mode, top);
  for (let f = 1; f < top; f++) shaftOk(tower, kind, 2, f, f + 1);
  return tower;
}

const reaches = (tower: Tower, from: number, to: number) => new Crowd().route(tower, from, to) !== null;

describe("walkway willingness (#384)", () => {
  it("Classic: a pure-stair climb reaches 4 flights, refuses the 5th", () => {
    const tower = walkwayColumn("classic", 7, "stairs");
    expect(reaches(tower, 1, 2), "1 flight").toBe(true);
    expect(reaches(tower, 1, 4), "3 flights (was refused before the fix)").toBe(true);
    expect(reaches(tower, 1, 5), "4 flights").toBe(true);
    expect(reaches(tower, 1, 6), "5 flights").toBe(false);
  });

  it("Classic: a pure-escalator climb reaches 7 flights, refuses the 8th", () => {
    const tower = walkwayColumn("classic", 10, "escalator");
    expect(reaches(tower, 1, 8), "7 flights").toBe(true);
    expect(reaches(tower, 1, 9), "8 flights").toBe(false);
  });

  it("Classic: a mixed stair+escalator run is governed by the stricter (stairs=4) threshold", () => {
    // One contiguous walk run of escalators and stairs. As pure escalators this
    // many flights would pass (the cap is 7), but a single stair anywhere in the
    // run pulls the whole run's budget down to 4: floor 5 is the 4th flight (one
    // of them a stair) and reachable; floor 6 is the 5th and refused, even though
    // it is only two escalator flights past a reachable floor. This pins that the
    // stricter kind governs and that runCap ratchets down but never back up.
    const tower = baseTower("classic", 7);
    shaftOk(tower, "escalator", 2, 1, 2);
    shaftOk(tower, "escalator", 2, 2, 3);
    shaftOk(tower, "escalator", 2, 3, 4);
    shaftOk(tower, "stairs", 2, 4, 5); // the stair that tightens the run to 4
    shaftOk(tower, "escalator", 2, 5, 6);
    shaftOk(tower, "escalator", 2, 6, 7);
    expect(reaches(tower, 1, 5), "4 flights, one a stair (at the stricter cap)").toBe(true);
    expect(reaches(tower, 1, 6), "5th flight in a stair-tainted run (refused, though pure-escalator 5 would pass)").toBe(false);
  });

  it("Classic: an elevator ride resets the walk budget (stairs, car, stairs)", () => {
    // Stairs 1..5 (4 flights) is the cap; add a standard elevator 5..6 and
    // stairs 6..10 (4 more). Without the reset, floor 10 is 8 stair flights and
    // refused; with the car resetting the walk run, it is reachable.
    const tower = baseTower("classic", 10);
    for (let f = 1; f < 5; f++) shaftOk(tower, "stairs", 2, f, f + 1);
    shaftOk(tower, "elevatorStandard", 20, 5, 6);
    for (let f = 6; f < 10; f++) shaftOk(tower, "stairs", 2, f, f + 1);
    expect(reaches(tower, 1, 5), "first 4 stair flights").toBe(true);
    expect(reaches(tower, 1, 10), "4 stairs, a car ride, 4 more stairs").toBe(true);
  });

  it("Classic: a stair after a full two-ride elevator trip is admissible (a walk, not a third ride)", () => {
    // Two standard elevators 1..5 and 5..9 (a standard-to-standard transfer at a
    // plain floor is NOT express-gated, so this isolates the ride budget), then
    // one stair 9..10. Before the fix the stair was a third ride and refused;
    // now it is a walk off the ride budget.
    const tower = baseTower("classic", 10);
    shaftOk(tower, "elevatorStandard", 12, 1, 5);
    shaftOk(tower, "elevatorStandard", 20, 5, 9);
    shaftOk(tower, "stairs", 2, 9, 10);
    expect(reaches(tower, 1, 10)).toBe(true);
  });

  it("Modern reachability is uncapped and applies no hard walk budget (that is #502)", () => {
    // Modern uncaps reachability like Classic (the party ruled Modern must never
    // be more restrictive than Classic). Modern does NOT apply Classic's hard
    // walkway-willingness refusal: a long climb feeds the deferred #502 comfort
    // penalty instead, so it never blocks the trip. Modern therefore reaches a
    // long stair chain that Classic (walk budget 4) would refuse.
    const tower = walkwayColumn("modern", 12, "stairs");
    expect(reaches(tower, 1, 5), "Modern: 4 flights").toBe(true);
    expect(reaches(tower, 1, 11), "Modern: 10 flights, no walk-budget refusal").toBe(true);
    // Classic, by contrast, still refuses past 4 (the walk budget holds).
    const classic = walkwayColumn("classic", 12, "stairs");
    expect(reaches(classic, 1, 11), "Classic: 10 flights refused").toBe(false);
  });
});
