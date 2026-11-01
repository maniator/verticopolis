import { describe, expect, it } from "vitest";
import { html } from "lit-html";
import type { ServiceDiagnosticFacts } from "../simport/enginePort";
import { renderToFragment } from "../ui/testing/litTestUtils";
import { portServiceLines } from "./portServiceDiagnostics";

const base: ServiceDiagnosticFacts = {
  hotel: { rating: "notApplicable", condition: "other", infestDays: null, recovery: null },
  parking: { status: "notApplicable", shortage: null, have: null, total: null, offices: null, suites: null },
  retail: {
    active: false, today: null, barWidth: null, tier: "notApplicable",
    localDemandPct: null, advice: "none", profitYest: null, rainy: null,
  },
  housekeeping: {
    status: "notApplicable", crews: null, maids: null, rooms: null, maidsPerUnit: null,
    roomsPerMaid: null, cleaned: null, leftover: null, infested: null,
    outOfReach: null, hasInfested: null, hasOutOfReach: null, recovery: null,
  },
};
function printed(parts: {
  hotel?: Partial<ServiceDiagnosticFacts["hotel"]>;
  parking?: Partial<ServiceDiagnosticFacts["parking"]>;
  housekeeping?: Partial<ServiceDiagnosticFacts["housekeeping"]>;
  retail?: Partial<ServiceDiagnosticFacts["retail"]>;
} = {}): string {
  const facts: ServiceDiagnosticFacts = {
    hotel: { ...base.hotel, ...parts.hotel },
    parking: { ...base.parking, ...parts.parking },
    housekeeping: { ...base.housekeeping, ...parts.housekeeping },
    retail: { ...base.retail, ...parts.retail },
  };
  return renderToFragment(html`${portServiceLines(facts)}`).textContent ?? "";
}

describe("engine-owned keyed service diagnostic presentation", () => {
  it("renders hotel eligibility, dirty deadlines and recovery without recalculating game policy", () => {
    expect(printed({ hotel: { rating: "counts", condition: "dirty", infestDays: 3 } })).toContain("Left dirty for 3 days");
    const classic = printed({ hotel: { rating: "excluded", condition: "infested", recovery: false } });
    expect(classic).toContain("Counts toward stars: no");
    expect(classic).toContain("Bulldoze it and rebuild");
    expect(classic).not.toContain("Call an exterminator");
    expect(printed({ hotel: { rating: "counts", condition: "infested", recovery: true } })).toContain("Call an exterminator");
  });

  it("uses per-space parking connectivity even when other spaces work", () => {
    const shared = { have: 4, total: 6, offices: 5, suites: 1 };
    expect(printed({ parking: { ...shared, status: "disconnected" } })).toContain("Ramp access: none");
    expect(printed({ parking: { ...shared, status: "disconnected" } })).not.toContain("Demand:");
    expect(printed({ parking: { ...shared, status: "connected", shortage: true } })).toContain("Ramp access: connected");
    expect(printed({ parking: { ...shared, status: "ramp", shortage: true } })).toContain("Demand: 4/6 spaces");
  });

  it("does not compute new thresholds from contradictory engine figures", () => {
    const parking = printed({ parking: { status: "connected", shortage: false, have: 1, total: 9, offices: 9, suites: 0 } });
    expect(parking).toContain("Demand: 1/9 spaces");
    const adequate = printed({ housekeeping: {
      status: "adequate", crews: 2, maids: 12, rooms: 1000, maidsPerUnit: 6,
      roomsPerMaid: 19, cleaned: 10, leftover: 100,
    } });
    expect(adequate).not.toContain("Falling behind");
    expect(adequate).not.toContain("Likely under capacity");
  });

  it("renders the engine's housekeeping shortage, recovery and reachability facts", () => {
    const h: ServiceDiagnosticFacts["housekeeping"] = {
      status: "observedShortfall", crews: 2, maids: 12, rooms: 280, maidsPerUnit: 6,
      roomsPerMaid: 19, cleaned: 18, leftover: 3, infested: 1, outOfReach: 2,
      hasInfested: true, hasOutOfReach: true, recovery: true,
    };
    const observed = printed({ housekeeping: h });
    expect(observed).toContain("Fields 6 maids, each cleaning up to ~19 rooms");
    expect(observed).toContain("Falling behind: 3 room(s) went unserved yesterday (18 cleaned)");
    expect(observed).toContain("1 room(s) are infested");
    expect(observed).toContain("2 room(s) are out of staff reach");
    expect(printed({ housekeeping: { ...h, status: "nominalShortfall" } })).toContain("Likely under capacity");
    expect(printed({ housekeeping: { ...h, status: "nominalShortfall" } })).not.toContain("Falling behind");
    expect(printed({ housekeeping: { ...h, status: "adequate", hasInfested: false, hasOutOfReach: false } })).not.toContain("out of staff reach");
  });

  it("renders already-decided retail grades and demand advice without new policy", () => {
    const low = printed({ retail: {
      active: true, today: 17, barWidth: 17, tier: "low",
      localDemandPct: 30, advice: "overBuilt", profitYest: 500, rainy: true,
    } });
    expect(low).toContain("Today's patronage: 17 customers");
    expect(low).toContain("Local demand: 30% of capacity.");
    expect(low).toContain("Very few customers.");
    expect(low).toContain("hold off on new venues");
    expect(low).toContain("Yesterday's profit: $500.");
    expect(low).toContain("Rain might cause fewer customers.");
    const newVenue = printed({ retail: { active: true, today: 0, barWidth: 0, tier: "noData" } });
    expect(newVenue).toContain("Just opened, no data yet.");
    expect(newVenue).not.toContain("Local demand:");
    const plenty = printed({ retail: {
      active: true, today: 95, barWidth: 95, tier: "booming",
      localDemandPct: 100, advice: "underServed",
    } });
    expect(plenty).toContain("Business is booming.");
    expect(plenty).toContain("another venue would still sell");
    expect(printed({ retail: { active: false, tier: "low" } })).not.toContain("Very few customers.");
  });

  it("returns no warning for unrelated units or missing service data", () => {
    expect(printed()).toBe("");
  });
});
