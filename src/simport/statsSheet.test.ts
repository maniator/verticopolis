import { describe, expect, it } from "vitest";
import { mockPort } from "../tests/portKit/mockPort";
import { PortCodes } from "./portCodes";
import { statsReport } from "./statsSheet";

/** A `statsSheet` record from the layout's own slot names: the header with
 *  the named slots set, then empty sections. */
function sheet(codes: PortCodes, slots: Record<string, number>): Float64Array {
  const head = codes.fields("statsSheet");
  const width = head.length + codes.fields("statsStrip").length + codes.fields("crewCoverage").length + codes.names("ledgerCats").length;
  const rec = new Float64Array(width);
  for (const [name, value] of Object.entries(slots)) {
    const at = head.indexOf(name);
    expect(at, name).toBeGreaterThanOrEqual(0);
    rec[at] = value;
  }
  return rec;
}

describe("statsReport's parking demand", () => {
  const codes = new PortCodes(mockPort());

  it("reads the engine's shortage flag from its own slot", () => {
    const short = statsReport(sheet(codes, { parkingTotal: 2, functionalParking: 5, parkingShort: 1, parkingCoverage: 0.5 }), codes);
    expect(short.parkingDemand.short).toBe(true);
    expect(short.parkingDemand.coverage).toBe(0.5);
    const covered = statsReport(sheet(codes, { parkingTotal: 2, functionalParking: 1, parkingShort: 0, parkingCoverage: NaN }), codes);
    expect(covered.parkingDemand.short).toBe(false);
    expect(covered.parkingDemand.coverage).toBeNull();
  });
});
