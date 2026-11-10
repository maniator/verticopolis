import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";
import { GROUP_PATTERN, KIND_GROUP, SHAFT_FILL, UNKNOWN_KIND_STYLE, contrastRatio, hexLuminance, mapStyleFor, patternInk, type MapGroup } from "./style";
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

  it("uses the facility colors for rooms, lifting only the two too dark for the backdrop (#1803)", () => {
    const lifted: FacilityKind[] = ["parkingRamp", "security"];
    for (const kind of KINDS) {
      if (SHAFT_FILL[KIND_GROUP[kind]] !== undefined) continue;
      if (lifted.includes(kind)) expect(mapStyleFor(kind).fill, kind).not.toBe(FACILITY_PRESENTATION[kind].color);
      else expect(mapStyleFor(kind).fill, kind).toBe(FACILITY_PRESENTATION[kind].color);
    }
    expect(mapStyleFor("elevatorExpress").fill).not.toBe(FACILITY_PRESENTATION.elevatorExpress.color);
  });

  // A difference of 12 in CIELAB (CIE76) reads as another color side by side
  // at the map's few pixels a floor. Before #1803 the stairs, which share the
  // basements with parking, measured 8 against the parking ramp and 11.9
  // against parking, and the service elevator 5.5 against the restaurant.
  const MIN_SHAFT_ROOM_DIFFERENCE = 12;

  it("keeps every shaft fill clear of every room fill (#1803)", () => {
    const rooms = KINDS.filter((kind) => SHAFT_FILL[KIND_GROUP[kind]] === undefined);
    for (const [group, shaft] of Object.entries(SHAFT_FILL)) {
      for (const kind of rooms) {
        const room = mapStyleFor(kind).fill;
        expect(labDifference(shaft, room), `${group} ${shaft} against ${kind} ${room}`).toBeGreaterThanOrEqual(MIN_SHAFT_ROOM_DIFFERENCE);
      }
    }
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
  // margin. Non-text contrast (WCAG 1.4.11) asks 3 to 1, with no exception.
  it("gives every kind's fill at least 3 to 1 against the backdrop's sky and ground", () => {
    for (const kind of KINDS) {
      const fill = hexLuminance(mapStyleFor(kind).fill)!;
      for (const [where, color] of Object.entries(MAP_BACKDROP)) {
        expect(contrastRatio(fill, hexLuminance(color)!), `${kind} on the ${where}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gives a fill that is not a #rrggbb color dark ink", () => {
    expect(patternInk("rgba(1,2,3,0.5)")).toBe("#1c1c1c");
    expect(hexLuminance("red")).toBeNull();
  });
});

/** The CIE76 difference between two `#rrggbb` colors in CIELAB (D65). */
function labDifference(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function toLab(color: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(color.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
