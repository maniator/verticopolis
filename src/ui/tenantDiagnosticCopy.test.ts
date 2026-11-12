import { describe, expect, it } from "vitest";
import { VACATE_REASON_TEXT } from "../shared/vacateReasonText";
import { gripeCopy } from "./tenantDiagnosticCopy";

describe("service shortfall gripe copy", () => {
  it("names the recycling coverage as a whole percent (#1970)", () => {
    expect(gripeCopy({ cause: "trash", coverage: 0.5 })).toBe(
      "trash piling up: recycling handles 50% of the tower. Build another Recycling Center.",
    );
  });

  it("names office parking against the office workers (#1970)", () => {
    expect(gripeCopy({ cause: "parking", coverage: 0.25 })).toContain("cover 25% of the office workers");
  });

  it("names home parking against what offices and homes need together (#1973)", () => {
    const line = gripeCopy({ cause: "homeParking", coverage: 0.25000000000000006 });
    expect(line).toBe(
      "too little parking: the spaces left after hotel suites cover 25% of what offices and homes need. Add parking spaces chained to a ramp.",
    );
    expect(line).not.toContain("office workers");
  });

  it("says too little when the engine sends no coverage", () => {
    expect(gripeCopy({ cause: "homeParking", coverage: null })).toContain("cover too little of what");
  });

  it("has a vacate line for every shortfall cause", () => {
    expect(VACATE_REASON_TEXT.homeParking).toBe("too little parking for its households");
    expect(VACATE_REASON_TEXT.parking).toBe("too little parking for its workers");
  });
});
