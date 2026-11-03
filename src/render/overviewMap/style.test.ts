import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";
import {
  CLASSIC_FILL,
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

  it("gives every group a pattern and a Classic fill", () => {
    expect(Object.keys(CLASSIC_FILL).sort()).toEqual([...GROUPS].sort());
    for (const g of GROUPS) expect(CLASSIC_FILL[g]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps groups apart in Classic by fill, pattern or both (no two groups look the same)", () => {
    const seen = new Map<string, MapGroup>();
    for (const g of GROUPS) {
      const key = `${GROUP_PATTERN[g]}|${CLASSIC_FILL[g]}`;
      expect(seen.get(key), `${g} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, g);
    }
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

  it("keeps the plain solid groups apart by lightness as well as hue", () => {
    const solid = GROUPS.filter((g) => GROUP_PATTERN[g] === "solid" && !g.startsWith("elevator"));
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = hexLuminance(CLASSIC_FILL[solid[i]])!;
        const b = hexLuminance(CLASSIC_FILL[solid[j]])!;
        expect(contrastRatio(a, b), `${solid[i]} vs ${solid[j]}`).toBeGreaterThanOrEqual(1.15);
      }
    }
  });

  it("draws Classic elevators by kind: express blue, standard gray, service red", () => {
    expect(mapStyleFor("elevatorExpress", "classic").fill).toBe("#2f6fdb");
    expect(mapStyleFor("elevatorStandard", "classic").fill).toBe("#8a8a8a");
    expect(mapStyleFor("elevatorService", "classic").fill).toBe("#d23c3c");
  });

  it("keeps the Classic tower gray (no hue outside the shafts)", () => {
    for (const kind of KINDS) {
      if (KIND_GROUP[kind].startsWith("elevator")) continue;
      const hex = mapStyleFor(kind, "classic").fill;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(r === g && g === b, `${kind} ${hex}`).toBe(true);
    }
  });

  it("uses the facility colors in Modern, with shafts kept clear of room colors", () => {
    expect(mapStyleFor("office", "modern").fill).toBe(FACILITY_PRESENTATION.office.color);
    expect(mapStyleFor("condo", "modern").fill).toBe(FACILITY_PRESENTATION.condo.color);
    expect(mapStyleFor("elevatorExpress", "modern").fill).not.toBe(FACILITY_PRESENTATION.elevatorExpress.color);
  });

  it("answers the same pattern in both themes", () => {
    for (const kind of KINDS) expect(mapStyleFor(kind, "classic").pattern).toBe(mapStyleFor(kind, "modern").pattern);
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
