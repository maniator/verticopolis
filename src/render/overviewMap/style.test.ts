import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";
import { GROUP_PATTERN, KIND_GROUP, UNKNOWN_KIND_STYLE, contrastRatio, hexLuminance, mapStyleFor, patternInk, type MapGroup } from "./style";
import { MAP_BACKDROP } from "./viewMark";

const KINDS = Object.keys(FACILITY_PRESENTATION) as FacilityKind[];
const GROUPS = Object.keys(GROUP_PATTERN) as MapGroup[];

describe("overview map style table", () => {
  it("styles every facility kind the presentation table knows, and nothing else", () => {
    expect(Object.keys(KIND_GROUP).sort()).toEqual([...KINDS].sort());
  });

  it("gives every group a pattern", () => {
    expect(Object.keys(GROUP_PATTERN).sort()).toEqual([...GROUPS].sort());
    // KIND_GROUP is the source of truth for which groups exist: the groups kinds use are exactly the groups with a pattern.
    expect([...new Set(Object.values(KIND_GROUP))].sort()).toEqual([...GROUPS].sort());
  });

  it("separates the room groups by pattern, so the map reads without color", () => {
    const room: MapGroup[] = ["homes", "hotels", "foodAndRetail", "entertainment", "amenities", "services"];
    const patterns = room.map((g) => GROUP_PATTERN[g]);
    expect(new Set(patterns).size).toBe(room.length);
    expect(patterns).not.toContain("solid");
  });

  it("separates the three elevator kinds by pattern, so they read without color", () => {
    const shafts: MapGroup[] = ["elevatorStandard", "elevatorService", "elevatorExpress"];
    expect(new Set(shafts.map((g) => GROUP_PATTERN[g])).size).toBe(3);
  });

  it("uses the facility colors, with shafts kept clear of room colors", () => {
    expect(mapStyleFor("office").fill).toBe(FACILITY_PRESENTATION.office.color);
    expect(mapStyleFor("condo").fill).toBe(FACILITY_PRESENTATION.condo.color);
    expect(mapStyleFor("elevatorExpress").fill).not.toBe(FACILITY_PRESENTATION.elevatorExpress.color);
  });

  it("gives every kind its group's pattern, stairs and escalators included", () => {
    for (const kind of KINDS) expect(mapStyleFor(kind).pattern, kind).toBe(GROUP_PATTERN[KIND_GROUP[kind]]);
    expect(mapStyleFor("stairs").pattern).toBe("diagonal");
    expect(mapStyleFor("escalator")).toEqual(mapStyleFor("stairs"));
  });

  it("falls back to a placeholder for a kind it has never heard of", () => {
    expect(mapStyleFor("notAKind" as FacilityKind)).toBe(UNKNOWN_KIND_STYLE);
    expect(mapStyleFor("toString" as FacilityKind)).toBe(UNKNOWN_KIND_STYLE);
  });

  it("styles every kind with a #rrggbb fill", () => {
    for (const kind of KINDS) expect(mapStyleFor(kind).fill, kind).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("picks ink that shows on the fill: at least 3 to 1 for every patterned kind", () => {
    for (const kind of KINDS) {
      const { fill, pattern } = mapStyleFor(kind);
      if (pattern === "solid") continue;
      const ratio = contrastRatio(hexLuminance(fill)!, hexLuminance(patternInk(fill))!);
      expect(ratio, `${kind} ${fill}`).toBeGreaterThanOrEqual(3);
    }
  });

  // Every kind can sit on both backdrop colors: a top floor or a setback meets
  // the sky, a ground-floor room meets the ground under it, a basement room
  // meets the ground beside it and the sky above it where floor 1 is unbuilt,
  // and a shaft can run past the top floor or over the lot's edge into the
  // margin. Non-text contrast (WCAG 1.4.11) asks 3 to 1.
  // These two keep the facility colors the main view's sprites share
  // (`FACILITY_PRESENTATION`), so lifting them is a palette call outside the
  // map; the test fails once either passes, so the entry is then dropped.
  const BELOW_BACKDROP_CONTRAST: ReadonlySet<FacilityKind> = new Set(["parkingRamp", "security"]);

  it("gives every kind's fill at least 3 to 1 against the backdrop's sky and ground", () => {
    for (const kind of KINDS) {
      const fill = hexLuminance(mapStyleFor(kind).fill)!;
      for (const [where, color] of Object.entries(MAP_BACKDROP)) {
        const ratio = contrastRatio(fill, hexLuminance(color)!);
        if (BELOW_BACKDROP_CONTRAST.has(kind)) expect(ratio, `${kind} on the ${where}`).toBeLessThan(3);
        else expect(ratio, `${kind} on the ${where}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const kind of BELOW_BACKDROP_CONTRAST) expect(mapStyleFor(kind).fill, kind).toBe(FACILITY_PRESENTATION[kind].color);
  });

  it("gives a fill that is not a #rrggbb color dark ink", () => {
    expect(patternInk("rgba(1,2,3,0.5)")).toBe("#1c1c1c");
    expect(hexLuminance("red")).toBeNull();
  });
});
