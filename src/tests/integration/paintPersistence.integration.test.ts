import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { Simulation } from "../../engine/Simulation";
import { GRID, attendanceCap } from "../../engine/facilities";
import { FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../../engine/retailSubtypes";
import { drawRoom, type RoomCtx } from "../../render/pixelSprites";
import { buildTDT } from "../../storage/tdtExport";
import { parseTDT } from "../../storage/tdtImport";
import type { FacilityKind, Unit } from "../../engine/types";

/**
 * Shift-left contract for the visual variety system: EVERYTHING a room's art
 * derives from must live in the persisted save, so a reload paints the same
 * pixels. The inputs are `kind`, `subtype` (retail varieties), geography
 * (`floor`, `x`: the geo seed for layouts, mirroring, and tints), and `id`
 * (grandfathered accent/diner seeds). This suite paints every kind and every
 * canon variety, round-trips the tower through serialize/deserialize (the
 * .vctower path) and through the TDT format, then paints again and
 * byte-compares the full paint logs. If a future visual input is added
 * without surviving the save, these tests fail the same day the art lands.
 */

/** A recording 2D-context stand-in (mirrors the spyCtx in sprites.test.ts). */
function spyCtx() {
  const log: string[] = [];
  const grad = { addColorStop: (...a: unknown[]) => log.push("stop:" + JSON.stringify(a)) };
  const ctx: Record<string, unknown> = {};
  const methods = [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo",
    "quadraticCurveTo", "bezierCurveTo", "rect", "roundRect", "ellipse", "fill", "stroke",
    "fillRect", "strokeRect", "clearRect", "fillText", "strokeText", "translate", "scale",
    "rotate", "clip", "setLineDash", "drawImage",
  ];
  for (const m of methods) ctx[m] = (...a: unknown[]) => log.push(`${m}:${JSON.stringify(a)}`);
  ctx.createLinearGradient = (...a: unknown[]) => (log.push(`grad:${JSON.stringify(a)}`), grad);
  ctx.createRadialGradient = (...a: unknown[]) => (log.push(`rgrad:${JSON.stringify(a)}`), grad);
  ctx.measureText = () => ({ width: 10 });
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "font", "textAlign", "textBaseline", "lineCap", "lineJoin"]) {
    let v: unknown = "";
    Object.defineProperty(ctx, p, { get: () => v, set: (nv) => (log.push(`${p}=${String(nv)}`), void (v = nv)) });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log, sig: () => log.join("|") };
}

function paint(u: Unit, hour: number): string {
  const s = spyCtx();
  const d: RoomCtx = { ctx: s.ctx, lit: true, anim: 0.5, hour };
  drawRoom(d, u, 0, 0, 160, 26);
  return s.sig();
}

/** Paint hour per kind: inside business hours for commercial, evening else. */
function hourFor(kind: FacilityKind): number {
  if (kind === "shop") return 14;
  if (kind === "fastFood") return 12;
  if (kind === "restaurant") return 19;
  if (kind === "cinema") return 20;
  return 20;
}

describe("save round-trip paints identical pixels (.vctower serialize/deserialize)", () => {
  /** Rooms across kinds, positions, and every canon retail variety, spread
   *  over floors so the geo seed exercises different layouts and mirrors. */
  function buildFixture(): Simulation {
    const sim = new Simulation(2024, "modern", "realWorld");
    sim.money = 100_000_000;
    for (let x = 0; x < 120; x++) sim.tower.place("lobby", 1, x);
    for (let f = 2; f <= 14; f++) for (let x = 0; x < 120; x++) sim.tower.place("floor", f, x);
    // Offices and condos at varied positions (layout + mirror coverage).
    for (const [f, x] of [[2, 0], [2, 12], [2, 24], [3, 5], [3, 40], [4, 9]] as const) sim.tower.place("office", f, x);
    for (const [f, x] of [[5, 0], [5, 14], [6, 3], [6, 30]] as const) sim.tower.place("condo", f, x);
    for (const [f, x, k] of [[7, 0, "hotelSingle"], [7, 10, "hotelDouble"], [7, 30, "hotelSuite"]] as const) {
      sim.tower.place(k as FacilityKind, f, x);
    }
    // Every canon retail variety, one unit each.
    let f = 8;
    let x = 0;
    const placeRetail = (kind: FacilityKind, subtype: string) => {
      const width = kind === "restaurant" ? 24 : kind === "fastFood" ? 16 : 12;
      if (x + width >= 120) {
        f += 1;
        x = 0;
      }
      const r = sim.tower.place(kind, f, x);
      const u = sim.tower.units.find((q) => q.id === r.unitId)!;
      u.state = "occupied";
      u.subtype = subtype;
      x += width + 2;
    };
    for (const name of FASTFOOD_SUBTYPES) placeRetail("fastFood", name);
    for (const name of RESTAURANT_SUBTYPES) placeRetail("restaurant", name);
    for (const name of SHOP_SUBTYPES) placeRetail("shop", name);
    sim.tower.place("cinema", 13, 0);
    // Occupy everything so the art draws its lived-in state. Attendance
    // venues (the cinema here) are exempt from the occupants stamp: their
    // occupants mirrors the transient live-attendance tally and restores to
    // 0 on load by design, so a pinned nonzero value would (correctly) fail
    // the round-trip. Their empty-house paint is still compared.
    for (const u of sim.tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") continue;
      if (u.state === "empty" || u.state === "construction") u.state = "occupied";
      if (u.occupants === 0 && attendanceCap(u.kind) === undefined) u.occupants = 3;
    }
    return sim;
  }

  it("every room paints byte-identical after serialize -> deserialize", () => {
    const sim = buildFixture();
    const before = new Map<string, string>();
    for (const u of sim.tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") continue;
      before.set(`${u.floor}:${u.x}`, paint(u, hourFor(u.kind)));
    }
    expect(before.size).toBeGreaterThan(30);
    const restored = Simulation.deserialize(sim.serialize());
    let compared = 0;
    for (const u of restored.tower.units) {
      if (u.kind === "floor" || u.kind === "lobby") continue;
      const key = `${u.floor}:${u.x}`;
      const prior = before.get(key);
      expect(prior, `no pre-save paint recorded for ${u.kind} at ${key}`).toBeDefined();
      expect(paint(u, hourFor(u.kind)), `${u.kind} at ${key} paints differently after reload`).toBe(prior);
      compared++;
    }
    expect(compared).toBe(before.size);
  });
});

describe("TDT round-trip preserves the retail varieties' paint (geometry + subtype survive)", () => {
  it("each canon variety paints byte-identical after export -> import at its own spot", () => {
    // Classic tower (TDT refuses modern) with one venue per variety. The TDT
    // format preserves kind, floor, x, and the variant byte; unit ids are
    // renumbered on import, which is exactly why the geo seed keys the art.
    // Diner/shopper presence still reads the grandfathered hash(u.id), so the
    // comparison paints both sides with occupants pinned and the same id to
    // isolate the persisted inputs (subtype + geography).
    const sim = newSeededGame(3);
    sim.money = 1e12;
    // Anchor at the ensured starter lobby's left edge (the fixture lays 40
    // lobby tiles from mid - 20) and grow rightward: lobbies and floors must
    // connect to the existing tower, so a detached strip would be refused.
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 40; i < 110; i++) sim.tower.place("lobby", 1, x0 + i);
    for (let f = 2; f <= 8; f++) for (let i = 0; i < 110; i++) sim.tower.place("floor", f, x0 + i);
    sim.buildTransport("elevatorStandard", x0 + 100, 1, 8);
    let f = 2;
    let x = x0;
    const spots: { kind: FacilityKind; subtype: string; floor: number; x: number }[] = [];
    const placeRetail = (kind: FacilityKind, subtype: string) => {
      const width = kind === "restaurant" ? 24 : kind === "fastFood" ? 16 : 12;
      if (x + width >= x0 + 110) {
        f += 1;
        x = x0;
      }
      const r = sim.tower.place(kind, f, x);
      const u = sim.tower.units.find((q) => q.id === r.unitId)!;
      u.state = "occupied";
      u.subtype = subtype;
      spots.push({ kind, subtype, floor: f, x });
      x += width + 2;
    };
    for (const name of FASTFOOD_SUBTYPES) placeRetail("fastFood", name);
    for (const name of RESTAURANT_SUBTYPES) placeRetail("restaurant", name);
    for (const name of SHOP_SUBTYPES) placeRetail("shop", name);

    const { bytes } = buildTDT(sim.serialize());
    const back = parseTDT(bytes.buffer as ArrayBuffer, "R.TDT").save;
    for (const spot of spots) {
      const orig = sim.tower.units.find((q) => q.kind === spot.kind && q.floor === spot.floor && q.x === spot.x)!;
      const imported = back.units.find((q) => q.kind === spot.kind && q.floor === spot.floor && q.x === spot.x);
      expect(imported, `${spot.kind} "${spot.subtype}" lost its spot in the TDT round-trip`).toBeDefined();
      expect(imported!.subtype).toBe(spot.subtype);
      // Pin the transient inputs so only the persisted ones drive the compare.
      const a = { ...orig, id: 1, occupants: 3 } as Unit;
      const b = { ...(imported as unknown as Unit), id: 1, occupants: 3, state: "occupied" } as Unit;
      expect(paint(b, hourFor(spot.kind)), `${spot.kind} "${spot.subtype}" paints differently after TDT round-trip`).toBe(
        paint(a, hourFor(spot.kind)),
      );
    }
  });
});
