import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";
import {
  CLASSIC_SHAFT_FILL,
  CLASSIC_TOWER_FILL,
  drawsOnMap,
  GROUP_PATTERN,
  KIND_GROUP,
  UNKNOWN_KIND_STYLE,
  contrastRatio,
  hexLuminance,
  mapStyleFor,
  patternInk,
  type MapGroup,
  type MapTheme,
} from "./style";

const KINDS = Object.keys(FACILITY_PRESENTATION) as FacilityKind[];
const GROUPS = Object.keys(GROUP_PATTERN) as MapGroup[];

describe("overview map style table", () => {
  it("styles every facility kind the presentation table knows, and nothing else", () => {
    expect(Object.keys(KIND_GROUP).sort()).toEqual([...KINDS].sort());
  });

  it("gives every group a Modern pattern and every elevator group a Classic line color", () => {
    expect(Object.keys(GROUP_PATTERN).sort()).toEqual([...GROUPS].sort());
    // KIND_GROUP is the source of truth for which groups exist: the groups kinds use are exactly the groups with a pattern.
    expect([...new Set(Object.values(KIND_GROUP))].sort()).toEqual([...GROUPS].sort());
    expect(Object.keys(CLASSIC_SHAFT_FILL).sort()).toEqual(["elevatorExpress", "elevatorService", "elevatorStandard"]);
    for (const color of [CLASSIC_TOWER_FILL, ...Object.values(CLASSIC_SHAFT_FILL)]) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("separates the room groups by pattern, so the map reads without color", () => {
    const room: MapGroup[] = ["homes", "hotels", "foodAndRetail", "entertainment", "amenities", "services"];
    const patterns = room.map((g) => GROUP_PATTERN[g]);
    expect(new Set(patterns).size).toBe(room.length);
    expect(patterns).not.toContain("solid");
  });

  it("separates the three elevator kinds by pattern, since two of the Classic hues share a lightness", () => {
    const shafts: MapGroup[] = ["elevatorStandard", "elevatorService", "elevatorExpress"];
    expect(new Set(shafts.map((g) => GROUP_PATTERN[g])).size).toBe(3);
  });

  it("draws Classic as the retail Edit tab does: every room and floor run in one flat gray, with no pattern", () => {
    for (const kind of KINDS) {
      if (CLASSIC_SHAFT_FILL[KIND_GROUP[kind]]) continue;
      expect(mapStyleFor(kind, "classic"), kind).toEqual({ fill: CLASSIC_TOWER_FILL, pattern: "solid" });
    }
    expect(hexLuminance(CLASSIC_TOWER_FILL)).toBeGreaterThan(0.5);
  });

  it("draws Classic elevators as the retail map does (black standard, red service, blue express) and leaves stairs out", () => {
    expect(mapStyleFor("elevatorStandard", "classic").fill).toBe("#000000");
    expect(mapStyleFor("elevatorService", "classic").fill).toBe("#c41a1a");
    expect(mapStyleFor("elevatorExpress", "classic").fill).toBe("#2f4fd0");
    expect(drawsOnMap("stairs", "classic")).toBe(false);
    expect(drawsOnMap("escalator", "classic")).toBe(false);
    expect(drawsOnMap("stairs", "modern")).toBe(true);
    expect(drawsOnMap("elevatorExpress", "classic")).toBe(true);
    expect(drawsOnMap("notAKind" as FacilityKind, "classic")).toBe(true);
    const tower = hexLuminance(CLASSIC_TOWER_FILL)!;
    for (const kind of KINDS) {
      const { fill } = mapStyleFor(kind, "classic");
      if (fill === CLASSIC_TOWER_FILL) continue;
      expect(contrastRatio(tower, hexLuminance(fill)!), `${kind} ${fill}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses the facility colors in Modern, with shafts kept clear of room colors", () => {
    expect(mapStyleFor("office", "modern").fill).toBe(FACILITY_PRESENTATION.office.color);
    expect(mapStyleFor("condo", "modern").fill).toBe(FACILITY_PRESENTATION.condo.color);
    expect(mapStyleFor("elevatorExpress", "modern").fill).not.toBe(FACILITY_PRESENTATION.elevatorExpress.color);
  });

  it("keeps Modern's per-kind patterns and Classic plain", () => {
    for (const kind of KINDS) {
      expect(mapStyleFor(kind, "classic").pattern).toBe("solid");
      expect(mapStyleFor(kind, "modern").pattern).toBe(GROUP_PATTERN[KIND_GROUP[kind]]);
    }
  });

  it("falls back to a placeholder for a kind it has never heard of, in either theme", () => {
    expect(mapStyleFor("notAKind" as FacilityKind, "classic")).toBe(UNKNOWN_KIND_STYLE);
    expect(mapStyleFor("toString" as FacilityKind, "modern")).toBe(UNKNOWN_KIND_STYLE);
  });

  it("reads an unknown theme as Modern instead of throwing", () => {
    expect(mapStyleFor("office", "sepia" as MapTheme)).toEqual(mapStyleFor("office", "modern"));
  });

  it("styles every kind with a #rrggbb fill in both themes", () => {
    for (const kind of KINDS) {
      for (const theme of ["classic", "modern"] as const) expect(mapStyleFor(kind, theme).fill, `${kind} ${theme}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("picks ink that shows on the fill: at least 3 to 1 for every patterned kind in both themes", () => {
    for (const kind of KINDS) {
      for (const theme of ["classic", "modern"] as const) {
        const { fill, pattern } = mapStyleFor(kind, theme);
        if (pattern === "solid") continue;
        const ratio = contrastRatio(hexLuminance(fill)!, hexLuminance(patternInk(fill))!);
        expect(ratio, `${kind} ${theme} ${fill}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives a fill that is not a #rrggbb color dark ink", () => {
    expect(patternInk("rgba(1,2,3,0.5)")).toBe("#1c1c1c");
    expect(hexLuminance("red")).toBeNull();
  });
});
