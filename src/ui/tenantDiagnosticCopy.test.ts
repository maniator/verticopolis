import { describe, expect, it } from "vitest";
import { VACATE_REASON_TEXT } from "@verticopolis/components/shared/vacateReasonText";
import {
  accessCopy,
  farWalkCopy,
  gripeCopy,
  lobbyWarningCopy,
  noticeCopy,
  wontLeaseCopy,
  type GripeCopyFacts,
} from "./tenantDiagnosticCopy";

describe("service shortfall gripe copy", () => {
  it("names the recycling coverage as a whole percent (#1970)", () => {
    expect(gripeCopy({ advises: true, cause: "trash", coverage: 0.5 })).toBe(
      "trash piling up: recycling handles 50% of the tower. Build another Recycling Center.",
    );
  });

  it("names office parking against the office workers (#1970)", () => {
    expect(gripeCopy({ advises: true, cause: "parking", coverage: 0.25 })).toContain("cover 25% of the office workers");
  });

  it("tells both parking lines that a garage can run past the tower (#2212)", () => {
    for (const cause of ["parking", "homeParking"] as const) {
      expect(gripeCopy({ advises: true, cause, coverage: 0.25 })).toMatch(
        /; basements can run wider than the tower above\.$/,
      );
    }
  });

  it("names home parking against what offices and homes need together (#1973)", () => {
    const line = gripeCopy({ advises: true, cause: "homeParking", coverage: 0.25000000000000006 });
    expect(line).toBe(
      "too little parking: the spaces left after hotel suites cover 25% of what offices and homes need. Add parking spaces chained to a ramp; basements can run wider than the tower above.",
    );
    expect(line).not.toContain("office workers");
  });

  it("says too little when the engine sends no coverage", () => {
    expect(gripeCopy({ advises: true, cause: "homeParking", coverage: null })).toContain("cover too little of what");
  });

  it("has a vacate line for every shortfall cause", () => {
    expect(VACATE_REASON_TEXT.homeParking).toBe("too little parking for its households");
    expect(VACATE_REASON_TEXT.parking).toBe("too little parking for its workers");
  });
});

describe("Classic names the cause only (#549)", () => {
  // Every gripe the card can word, in the shape the engine sends it.
  const GRIPES: Omit<GripeCopyFacts, "advises">[] = [
    { cause: "rent" },
    { cause: "noise" },
    { cause: "noise", club: true },
    { cause: "noise", club: true, adjacent: true },
    { cause: "congestion", binding: "elevator" },
    {
      cause: "congestion",
      binding: "elevator",
      roomyShaft: { name: "Standard Elevator", bottom: 1, top: 15, cars: 3, maxCars: 8 },
    },
    { cause: "congestion", binding: "none" },
    { cause: "congestion", binding: "walkways" },
    { cause: "congestion", binding: "walkways", elevatorHere: true },
    { cause: "congestion", binding: "stairs" },
    { cause: "congestion", binding: "stairs", elevatorHere: true },
    { cause: "congestion", binding: "escalator" },
    { cause: "congestion", binding: "escalator", elevatorHere: true },
    { cause: "unmetDemand", coverage: 0, floorReachable: true },
    { cause: "unmetDemand", coverage: 0.4 },
    { cause: "trash", coverage: 0.5 },
    { cause: "parking", coverage: 0.25 },
    { cause: "homeParking", coverage: 0.25 },
  ];
  /** The words a fix starts with in the Modern copy. */
  const FIX = /\b(Add|add|Build|Lower|Reconnect|give|put|move|shields)\b/;

  it("words every gripe in Classic without its fix, and Modern's as the cause plus the fix", () => {
    for (const facts of GRIPES) {
      const classic = gripeCopy({ ...facts, advises: false });
      const modern = gripeCopy({ ...facts, advises: true });
      expect(classic, JSON.stringify(facts)).toBeDefined();
      expect(classic, JSON.stringify(facts)).not.toMatch(FIX);
      expect(modern, JSON.stringify(facts)).toMatch(FIX);
      expect(modern!.length, JSON.stringify(facts)).toBeGreaterThan(classic!.length);
    }
  });

  it("keeps the facts a Classic gripe states", () => {
    expect(gripeCopy({ advises: false, cause: "rent" })).toBe("the rent is above the going rate.");
    expect(gripeCopy({ advises: false, cause: "trash", coverage: 0.5 })).toBe(
      "trash piling up: recycling handles 50% of the tower.",
    );
    expect(gripeCopy({ advises: false, cause: "congestion", binding: "stairs", elevatorHere: true })).toBe(
      "crowded stairs, jammed by the other floors they serve.",
    );
    expect(gripeCopy({ advises: false, cause: "homeParking", coverage: 0.25 })).toBe(
      "too little parking: the spaces left after hotel suites cover 25% of what offices and homes need.",
    );
  });

  it("drops the fix from the access, long walk, won't lease and notice lines", () => {
    expect(accessCopy("cutOff", false)?.text).toBe(
      "Access: no way to transportation from here. A gap cuts this section of the floor off from the elevators and stairs.",
    );
    expect(accessCopy("cutOff", true)?.text).toMatch(/Bridge the gap/);
    expect(accessCopy("noRoute", false)?.text).not.toMatch(/Add an elevator/);
    expect(accessCopy("noRoute", true)?.text).toMatch(/Add an elevator that reaches it\.$/);
    expect(farWalkCopy(false)).toBe("Long walk to transport. Tenants tire of the hike.");
    expect(farWalkCopy(true)).toMatch(/within reach\.$/);
    expect(wontLeaseCopy(undefined, 1200, false)).toBe(
      "Won't lease: a new tenant here would soon give notice. It still costs about $1,200 a month to hold empty.",
    );
    expect(wontLeaseCopy(undefined, 1200, true)).toBe(
      "Won't lease: a new tenant here would soon give notice. Fix the flagged problem to fill it. It still costs about $1,200 a month to hold empty, so fix the cause or bulldoze it to stop the loss.",
    );
    const notice = { reason: "noise" as const, minutesLeft: 600, satisfaction: 0.1, keepAt: 0.4 };
    expect(noticeCopy({ ...notice, advises: false })[1]).toBe("They stay if satisfaction reaches 40% (now 10%).");
    expect(noticeCopy({ ...notice, advises: true })[1]).toBe(
      "Fix the cause and get satisfaction to 40% to keep them (now 10%).",
    );
  });

  it("names a far lobby and what it does, without the sky lobby to build", () => {
    const far = { sinking: true, quotesDistance: false, distance: 18, slotFloor: 15 };
    expect(lobbyWarningCopy({ ...far, advises: false })).toBe(
      "Too far from any lobby. Satisfaction sinks until tenants give notice.",
    );
    expect(lobbyWarningCopy({ ...far, advises: true })).toBe(
      "Too far from any lobby. Satisfaction sinks until tenants give notice. Build the sky lobby on floor 15 to lift these tenants.",
    );
    expect(lobbyWarningCopy({ ...far, slotFloor: undefined, sinking: false, advises: false })).toBe(
      "Far from the nearest lobby. Satisfaction is capped here, so it never tops out.",
    );
  });
});
