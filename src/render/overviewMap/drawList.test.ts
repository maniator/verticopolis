import { describe, it, expect } from "vitest";
import type { FacilityKind } from "../../engine/types";
import { SKY_HEADROOM_FLOORS } from "../cameraBounds";
import { buildMapDrawList, type MapSource } from "./drawList";
import { extentFloors, fitLayout, mapExtent } from "./geometry";

const WORLD = { lotWidth: 375, minFloor: -9, maxFloor: 100 };
const EXTENT = mapExtent(WORLD, SKY_HEADROOM_FLOORS);
/** One map pixel per tile and three per floor, so expectations are plain numbers. */
const layout = fitLayout(EXTENT, 375, extentFloors(EXTENT) * 3);
/** The y of a floor line at that layout. */
const yOfLine = (line: number): number => (EXTENT.topLine - line) * 3;

const HEIGHTS: Partial<Record<FacilityKind, number>> = { weddingHall: 5, metro: 3 };
const floorsOf = (k: FacilityKind): number => HEIGHTS[k] ?? 1;

function source(over: Partial<MapSource> = {}): MapSource {
  return { structure: [], rooms: [], transports: [], floorsOf, ...over };
}

describe("buildMapDrawList", () => {
  it("is empty for an empty tower", () => {
    expect(buildMapDrawList(layout, source())).toEqual([]);
  });

  it("puts a floor run at its real tile and floor, one mark for the whole run", () => {
    const marks = buildMapDrawList(layout, source({ structure: [{ kind: "floor", floor: 3, x: 100, width: 5, count: 8 }] }));
    expect(marks).toEqual([{ layer: "structure", kind: "floor", rect: { x: 100, y: yOfLine(3), w: 40, h: 3 } }]);
  });

  it("draws a room on the floor it stands on", () => {
    const [m] = buildMapDrawList(layout, source({ rooms: [{ kind: "office", floor: 1, x: 10, width: 9 }] }));
    expect(m.rect).toEqual({ x: 10, y: yOfLine(1), w: 9, h: 3 });
  });

  it("draws a multi-floor room from its lowest floor up, using the catalog height", () => {
    const [hall] = buildMapDrawList(layout, source({ rooms: [{ kind: "weddingHall", floor: 100, x: 40, width: 28 }] }));
    expect(hall.rect).toEqual({ x: 40, y: yOfLine(104), w: 28, h: 15 });
  });

  it("draws basements below the ground floor with no gap, and above the map's bottom", () => {
    const [ground] = buildMapDrawList(layout, source({ rooms: [{ kind: "office", floor: 1, x: 0, width: 9 }] }));
    const [b1] = buildMapDrawList(layout, source({ rooms: [{ kind: "parking", floor: 0, x: 0, width: 9 }] }));
    const [b10] = buildMapDrawList(layout, source({ rooms: [{ kind: "parking", floor: -9, x: 0, width: 9 }] }));
    expect(ground.rect.y + ground.rect.h).toBe(b1.rect.y);
    expect(b10.rect.y + b10.rect.h).toBe(layout.height - 3);
  });

  it("draws a shaft over every floor it serves, bottom to top inclusive", () => {
    const [shaft] = buildMapDrawList(layout, source({ transports: [{ kind: "elevatorStandard", x: 10, width: 4, bottom: -2, top: 30 }] }));
    expect(shaft.layer).toBe("transport");
    expect(shaft.rect.h).toBe(33 * 3);
    expect(shaft.rect.y).toBe(yOfLine(30));
  });

  it("draws a shaft whose ends come the wrong way round over the same floors", () => {
    const upright = buildMapDrawList(layout, source({ transports: [{ kind: "stairs", x: 5, width: 2, bottom: 3, top: 4 }] }));
    const flipped = buildMapDrawList(layout, source({ transports: [{ kind: "stairs", x: 5, width: 2, bottom: 4, top: 3 }] }));
    expect(flipped).toEqual(upright);
  });

  it("paints structure, then rooms, then shafts, whatever order the source lists them in", () => {
    const marks = buildMapDrawList(
      layout,
      source({
        transports: [{ kind: "stairs", x: 5, width: 2, bottom: 1, top: 2 }],
        rooms: [{ kind: "office", floor: 2, x: 8, width: 9 }],
        structure: [{ kind: "lobby", floor: 1, x: 0, width: 5, count: 4 }],
      }),
    );
    expect(marks.map((m) => m.layer)).toEqual(["structure", "room", "transport"]);
  });

  it("groups rooms of one kind together so the painter changes style once per kind", () => {
    const kinds: FacilityKind[] = ["office", "condo", "office", "condo", "office"];
    const marks = buildMapDrawList(layout, source({ rooms: kinds.map((kind, i) => ({ kind, floor: 2, x: i * 10, width: 9 })) }));
    expect(marks.map((m) => m.kind)).toEqual(["office", "office", "office", "condo", "condo"]);
    // Order inside a kind is the source order.
    expect(marks.filter((m) => m.kind === "office").map((m) => m.rect.x)).toEqual([0, 20, 40]);
  });

  it("asks the catalog for each kind's height once, however many rooms there are", () => {
    const asked: FacilityKind[] = [];
    const rooms = Array.from({ length: 50 }, (_, i) => ({ kind: (i % 2 ? "office" : "condo") as FacilityKind, floor: 2, x: i * 7, width: 6 }));
    buildMapDrawList(layout, source({ rooms, floorsOf: (k) => (asked.push(k), 1) }));
    expect(asked.sort()).toEqual(["condo", "office"]);
  });

  it("draws a room of unknown or bad height as one floor", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3, 0.4]) {
      const [m] = buildMapDrawList(layout, source({ rooms: [{ kind: "office", floor: 5, x: 0, width: 9 }], floorsOf: () => bad }));
      expect(m.rect.h, String(bad)).toBe(3);
    }
  });

  it("leaves no seam or overlap between neighbors, at a scale where edges land on half pixels", () => {
    const half = fitLayout(EXTENT, 250, extentFloors(EXTENT) * 2.5);
    const rooms = Array.from({ length: 20 }, (_, i) => ({ kind: "office" as const, floor: 10, x: i * 9, width: 9 }));
    const marks = buildMapDrawList(half, source({ rooms }));
    expect(marks).toHaveLength(20);
    for (let i = 1; i < marks.length; i++) expect(marks[i].rect.x).toBe(marks[i - 1].rect.x + marks[i - 1].rect.w);
    const above = buildMapDrawList(half, source({ rooms: [{ kind: "office", floor: 11, x: 0, width: 9 }] }))[0].rect;
    const below = buildMapDrawList(half, source({ rooms: [{ kind: "office", floor: 10, x: 0, width: 9 }] }))[0].rect;
    expect(above.y + above.h).toBe(below.y);
  });

  it("keeps a narrow shaft one pixel wide at least, in the last column and the bottom row", () => {
    const small = fitLayout(EXTENT, 180, extentFloors(EXTENT));
    const [edge] = buildMapDrawList(small, source({ transports: [{ kind: "stairs", x: 374, width: 1, bottom: -9, top: -9 }] }));
    expect(edge.rect.w).toBeGreaterThanOrEqual(1);
    expect(edge.rect.x + edge.rect.w).toBeLessThanOrEqual(180);
    expect(edge.rect.y + edge.rect.h).toBeLessThanOrEqual(small.height);
  });

  it("drops what cannot be drawn: off the map, a bad number, or no width", () => {
    const marks = buildMapDrawList(
      layout,
      source({
        rooms: [
          { kind: "office", floor: 5000, x: 0, width: 9 },
          { kind: "office", floor: -5000, x: 0, width: 9 },
          { kind: "office", floor: 5, x: 9000, width: 9 },
          { kind: "office", floor: 5, x: -100, width: 9 },
          { kind: "office", floor: 5, x: Number.NaN, width: 9 },
          { kind: "office", floor: Number.NaN, x: 5, width: 9 },
          { kind: "office", floor: 5, x: 5, width: Number.NaN },
          { kind: "office", floor: 5, x: 5, width: 0 },
          { kind: "office", floor: 5, x: 5, width: -4 },
          { kind: "office", floor: 5, x: 10, width: 9 },
        ],
        structure: [
          { kind: "floor", floor: 2, x: 0, width: 5, count: Number.NaN },
          { kind: "floor", floor: 2, x: 0, width: 5, count: Number.POSITIVE_INFINITY },
          { kind: "floor", floor: 2, x: 0, width: 5, count: 0 },
        ],
        transports: [{ kind: "elevatorStandard", x: 10, width: 4, bottom: Number.NaN, top: 3 }],
      }),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].rect.x).toBe(10);
  });

  it("clips a unit that hangs over the lot edge to the map", () => {
    const [m] = buildMapDrawList(layout, source({ rooms: [{ kind: "office", floor: 5, x: 370, width: 9 }] }));
    expect(m.rect.x + m.rect.w).toBe(layout.width);
  });
});
