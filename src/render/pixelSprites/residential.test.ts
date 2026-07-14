import { describe, it, expect } from "vitest";
import type { Unit } from "../../engine/types";
import { drawRoom } from "../pixelSprites";
import { geoVariant, RESERVED_COLORS, type RoomCtx } from "./common";
import { CONDO_PICTURES, CONDO_WALLS, HOTEL_WALLS, OFFICE_WALLS, SUITE_WALLS } from "./residential.looks";

/**
 * Behavior coverage for the enriched tenant-room art (office, condo, and the
 * three hotel grades): the look tables hold their luminance and reserved-color
 * contracts, every kind and state draws without throwing, seated occupancy maps
 * one-to-one to `visibleOccupants(u)` with no ghost people, the empty and
 * for-sale reads fall back to the reserved `vacancy` shell, and the hotel state
 * cues render OUTSIDE the mirror (so a flipped room broadcasts them at identical
 * pixels). Pixel fidelity itself is the Playwright visual tier's job.
 */

/** A recording 2D-context stand-in: every draw call and style set is logged. */
function spyCtx() {
  const log: string[] = [];
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc",
    "fill", "stroke", "fillRect", "strokeRect", "fillText", "translate", "scale",
  ]) {
    ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  }
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "globalAlpha"]) {
    let v: unknown;
    Object.defineProperty(ctx, p, { get: () => v, set: (nv) => { v = nv; log.push(`${p}=${String(nv)}`); } });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const room = (ctx: CanvasRenderingContext2D, over: Partial<RoomCtx> = {}): RoomCtx =>
  ({ ctx, lit: false, anim: 0, hour: 12, ...over });

let nextId = 1;
function unit(over: Partial<Unit> = {}): Unit {
  return {
    id: nextId++, kind: "office", floor: 10, x: 20, width: 9, state: "occupied",
    satisfaction: 0.8, occupants: 4, ...over,
  } as Unit;
}

/** How many finalized figures were drawn: the seated/standing build stamps one
 *  unique contact-shadow literal per person and nothing else does. */
function peopleCount(log: string[]): number {
  return log.filter((l) => l === "fillStyle=rgba(0,0,0,0.24)").length;
}

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

describe("residential look tables", () => {
  const WALL_TABLES: Record<string, string[]> = { OFFICE_WALLS, CONDO_WALLS, HOTEL_WALLS, SUITE_WALLS };

  it("every wall variant holds within 10 per RGB channel of its anchor", () => {
    for (const [name, table] of Object.entries(WALL_TABLES)) {
      const anchor = hex(table[0]);
      for (const c of table) {
        const v = hex(c);
        for (let ch = 0; ch < 3; ch++) {
          expect(Math.abs(v[ch] - anchor[ch]), `${name} ${c} channel ${ch} vs anchor ${table[0]}`).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it("no wall or picture look equals a reserved state color", () => {
    const all = [...OFFICE_WALLS, ...CONDO_WALLS, ...HOTEL_WALLS, ...SUITE_WALLS, ...CONDO_PICTURES];
    for (const c of all) expect(RESERVED_COLORS as readonly string[]).not.toContain(c.toUpperCase());
  });
});

describe("residential rooms draw at representative states without throwing", () => {
  const cases: Array<[string, Partial<Unit>, Partial<RoomCtx>]> = [
    ["office occupied", { kind: "office", occupants: 5 }, {}],
    ["office empty (lease)", { kind: "office", state: "empty", occupants: 0 }, {}],
    ["office night empty", { kind: "office", occupants: 0 }, { lit: true }],
    ["condo home", { kind: "condo", width: 16, occupants: 3 }, { hour: 19 }],
    ["condo late-night asleep", { kind: "condo", width: 16, occupants: 3 }, { hour: 2, lit: true }],
    ["condo empty (sale)", { kind: "condo", width: 16, state: "empty", occupants: 0 }, {}],
    ["hotel single ready", { kind: "hotelSingle", width: 4, occupants: 1 }, { lit: true }],
    ["hotel double dirty", { kind: "hotelDouble", width: 6, state: "dirty", occupants: 0 }, {}],
    ["hotel suite asleep", { kind: "hotelSuite", width: 10, state: "asleep", occupants: 2 }, { hour: 2 }],
  ];
  for (const [label, uo, ro] of cases) {
    it(label, () => {
      const s = spyCtx();
      const w = (uo.width ?? 9) * 11;
      expect(() => drawRoom(room(s.ctx, ro), unit(uo), 0, 0, w, 44)).not.toThrow();
      expect(s.log.some((l) => l.startsWith("fillRect:"))).toBe(true);
    });
  }
});

describe("occupancy is honest (maps to visibleOccupants, no ghost people)", () => {
  it("an empty-STATE office draws the vacancy shell and no people", () => {
    const s = spyCtx();
    drawRoom(room(s.ctx), unit({ kind: "office", state: "empty", occupants: 0 }), 0, 0, 99, 44);
    expect(s.log).toContain("fillStyle=#C9CCC4"); // reserved vacancy gray
    expect(s.log.some((l) => l.includes("LEASE"))).toBe(true);
    expect(peopleCount(s.log)).toBe(0);
    expect(s.log.some((l) => l === "fillStyle=#ECDFC2")).toBe(false); // no warm interior
  });

  it("condo empty draws the SALE card, office empty the LEASE card", () => {
    const sale = spyCtx();
    drawRoom(room(sale.ctx), unit({ kind: "condo", width: 16, state: "empty", occupants: 0 }), 0, 0, 176, 44);
    expect(sale.log.some((l) => l.includes("SALE"))).toBe(true);
    expect(peopleCount(sale.log)).toBe(0);
  });

  it("a staffed office seats exactly min(visibleOccupants, seats), and out-for-meal removes figures", () => {
    // Cubicle-row office (a wide room seats plenty); 3 present seats 3.
    const three = spyCtx();
    drawRoom(room(three.ctx), unit({ kind: "office", floor: 10, x: 20, occupants: 3 }), 0, 0, 99, 44);
    expect(peopleCount(three.log)).toBe(3);
    // Two of the three step out for a meal: only the visible one remains.
    const oneOut = spyCtx();
    drawRoom(room(oneOut.ctx), unit({ kind: "office", floor: 10, x: 20, occupants: 3, outForMeal: 2 }), 0, 0, 99, 44);
    expect(peopleCount(oneOut.log)).toBe(1);
    // An empty office (occupied state, zero present) seats no one.
    const none = spyCtx();
    drawRoom(room(none.ctx), unit({ kind: "office", floor: 10, x: 20, occupants: 0 }), 0, 0, 99, 44);
    expect(peopleCount(none.log)).toBe(0);
  });

  it("a condo draws residents only when home, never in the small hours", () => {
    const home = spyCtx();
    drawRoom(room(home.ctx, { hour: 19 }), unit({ kind: "condo", width: 16, floor: 10, x: 20, occupants: 3 }), 0, 0, 176, 44);
    expect(peopleCount(home.log)).toBeGreaterThan(0);
    const lateNight = spyCtx();
    drawRoom(room(lateNight.ctx, { hour: 2, lit: true }), unit({ kind: "condo", width: 16, floor: 10, x: 20, occupants: 3 }), 0, 0, 176, 44);
    expect(peopleCount(lateNight.log)).toBe(0); // asleep: no one "up"
  });
});

describe("hotel state cues render outside the mirror", () => {
  /** A hotel unit whose geo mirror bit matches `flip`. */
  function hotelAt(flip: boolean): Unit {
    for (let x = 0; x < 200; x++) {
      const u = unit({ kind: "hotelDouble", width: 6, floor: 12, x });
      if ((geoVariant(u, 1, 2) === 1) === flip) return u;
    }
    throw new Error(`no hotelDouble column with flip=${flip}`);
  }

  it("finds both a flipped and an unflipped hotel column", () => {
    expect(geoVariant(hotelAt(true), 1, 2)).toBe(1);
    expect(geoVariant(hotelAt(false), 1, 2)).toBe(0);
  });

  it("the dirty tray and ready lamp draw after the mirror wrapper closes", () => {
    for (const flip of [false, true]) {
      const dirty = spyCtx();
      drawRoom(room(dirty.ctx, { hour: 10 }), { ...hotelAt(flip), state: "dirty", occupants: 0 }, 0, 0, 66, 44);
      const lastRestore = dirty.log.lastIndexOf("restore:[]");
      const trayAt = dirty.log.findIndex((l) => l === "fillStyle=#D4623A");
      expect(trayAt, "dirty tray painted").toBeGreaterThanOrEqual(0);
      expect(trayAt, "dirty tray is outside the mirror").toBeGreaterThan(lastRestore);

      const ready = spyCtx();
      drawRoom(room(ready.ctx, { hour: 20, lit: true }), { ...hotelAt(flip), state: "occupied", occupants: 1 }, 0, 0, 66, 44);
      const lampAt = ready.log.findIndex((l) => l === "fillStyle=#FFD86A");
      expect(lampAt, "ready lamp painted").toBeGreaterThanOrEqual(0);
      expect(lampAt, "ready lamp is outside the mirror").toBeGreaterThan(ready.log.lastIndexOf("restore:[]"));
    }
  });

  it("the asleep z is text drawn outside the mirror, and only when occupied", () => {
    const asleep = spyCtx();
    drawRoom(room(asleep.ctx, { hour: 2 }), { ...hotelAt(true), state: "asleep", occupants: 2 }, 0, 0, 66, 44);
    const zAt = asleep.log.findIndex((l) => l.startsWith("fillText:") && l.includes('"z"'));
    expect(zAt).toBeGreaterThanOrEqual(0);
    expect(zAt).toBeGreaterThan(asleep.log.lastIndexOf("restore:[]"));
  });
});

describe("no reserved color leaks into decoration", () => {
  // An occupied office and a home condo carry no state cue, so their entire
  // paint must be free of every reserved literal.
  it("occupied office and home condo paint no reserved color", () => {
    for (const uo of [
      { kind: "office" as const, occupants: 4 },
      { kind: "condo" as const, width: 16, occupants: 3 },
    ]) {
      const s = spyCtx();
      drawRoom(room(s.ctx, { hour: 19 }), unit(uo), 0, 0, (uo.width ?? 9) * 11, 44);
      for (const reserved of RESERVED_COLORS) {
        expect(s.log, `${uo.kind} leaked ${reserved}`).not.toContain(`fillStyle=${reserved}`);
      }
    }
  });
});
