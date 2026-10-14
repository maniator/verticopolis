import { describe, expect, it } from "vitest";
import { FACILITIES } from "../../engine/facilitiesData";
import { hasBusinessHours } from "../../engine/facilities";
import { subtypeListFor } from "../../engine/retailSubtypes";
import type { FacilityKind, Unit, UnitState } from "../../engine/types";
import { LATE_NIGHT_KINDS } from "../lateNight";
import { paintSettledUnit } from "../regionPaint";
import { FLOOR, TILE } from "../scale";
import type { DrawCtx } from "../sprites";
import { isDeadParking, roomSignature, type RoomSigScene } from "./roomSignature";

/**
 * The re-bake signature must change whenever the room's art does, or a room
 * baked under one look keeps it until an unrelated bit flips (GH #916: a
 * rental baked in the evening stayed lit and occupied past 23:00, because the
 * late-night bit keyed on `condo` only).
 */

/** A recording 2D-context stand-in. Every method call and style set is
 *  logged, gradient stops included, and any method the art reaches for
 *  exists. The style state the room art sets and reads back (alpha, line
 *  width, font, fill and stroke, text alignment) starts at canvas defaults;
 *  any other property reads as a method. */
function spyCtx(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  let objects = 0;
  const made = () => {
    const id = objects++;
    return {
      id,
      width: 0,
      addColorStop: (...a: unknown[]) => log.push(`stop#${id}:${JSON.stringify(a)}`),
    };
  };
  const state: Record<string | symbol, unknown> = {
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    fillStyle: "#000000",
    strokeStyle: "#000000",
    textAlign: "start",
    textBaseline: "alphabetic",
    canvas: { width: 0, height: 0 },
  };
  const ctx = new Proxy(state, {
    get(target, p) {
      if (p in target) return target[p];
      // Not a context method: keep symbol lookups and thenable probes inert.
      if (typeof p === "symbol" || p === "then") return undefined;
      return (...a: unknown[]) => {
        const out = made();
        log.push(`${String(p)}#${out.id}:${JSON.stringify(a)}`);
        return out;
      };
    },
    set(target, p, v) {
      target[p] = v;
      const shown = typeof v === "object" && v !== null && "id" in v ? `#${String(v.id)}` : String(v);
      log.push(`${String(p)}=${shown}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

let nextId = 1;
function unit(kind: FacilityKind, over: Partial<Unit> = {}): Unit {
  return {
    id: nextId++, kind, floor: 10, x: 20, width: FACILITIES[kind].width, state: "occupied",
    satisfaction: 0.8, occupants: 3, ...over,
  } as Unit;
}

const scene = (hour: number, over: Partial<RoomSigScene> = {}): RoomSigScene =>
  ({ hour, lit: true, unchained: false, parkingUse: 0, recycleFill: 0, ...over });

/** The draw log for `u` at `hour` under fixed lighting, painted the way the
 *  region compositor bakes a settled room (`paintSettledUnit`, so the same
 *  dispatch: room art, service interiors, the gutted shell). */
function art(u: Unit, hour: number, lit = true): string {
  const { ctx, log } = spyCtx();
  const d: DrawCtx = { ctx, lit, anim: 0, hour, staffed: true, parkingUse: 0, recycleFill: 0 };
  paintSettledUnit(d, u, 0, 0, u.width * TILE, FLOOR, false);
  return log.join("\n");
}

const RENTALS: FacilityKind[] = ["rentalStudio", "rentalApartment"];

describe("roomSignature late-night bit (GH #916)", () => {
  for (const kind of RENTALS) {
    it(`${kind} re-bakes at the 23:00 flip and again at 06:00`, () => {
      const u = unit(kind);
      // The art really changes across both edges (residents go to bed and get up)...
      expect(art(u, 23)).not.toBe(art(u, 22));
      expect(art(u, 6)).not.toBe(art(u, 5));
      // ...so the signature must change with it.
      expect(roomSignature(u, scene(23))).not.toBe(roomSignature(u, scene(22)));
      expect(roomSignature(u, scene(6))).not.toBe(roomSignature(u, scene(5)));
      // Inside one window the signature holds, so no hourly churn.
      expect(roomSignature(u, scene(2))).toBe(roomSignature(u, scene(23)));
      expect(roomSignature(u, scene(14))).toBe(roomSignature(u, scene(6)));
    });
  }

  it("keeps the condo's existing late-night bit", () => {
    const u = unit("condo");
    expect(roomSignature(u, scene(23))).not.toBe(roomSignature(u, scene(22)));
    expect(roomSignature(u, scene(6))).not.toBe(roomSignature(u, scene(5)));
    expect(roomSignature(u, scene(2))).toBe(roomSignature(u, scene(23)));
    expect(roomSignature(u, scene(14))).toBe(roomSignature(u, scene(6)));
  });

  it("covers the condo and both rentals in LATE_NIGHT_KINDS", () => {
    expect([...LATE_NIGHT_KINDS].sort()).toEqual(["condo", "rentalApartment", "rentalStudio"]);
  });
});

describe("roomSignature dead-parking bit", () => {
  it("marks only a settled, unchained parking space", () => {
    expect(isDeadParking(unit("parking"), true)).toBe(true);
    expect(isDeadParking(unit("parking"), false)).toBe(false);
    expect(isDeadParking(unit("parking", { state: "construction" }), true)).toBe(false);
    expect(isDeadParking(unit("parking", { state: "fire" }), true)).toBe(false);
    expect(isDeadParking(unit("condo"), true)).toBe(false);
    const p = unit("parking");
    expect(roomSignature(p, scene(12, { unchained: true }))).not.toBe(roomSignature(p, scene(12)));
    const c = unit("condo");
    expect(roomSignature(c, scene(12, { unchained: true }))).toBe(roomSignature(c, scene(12)));
  });
});

/** Which states a settled room can bake in. A `Record` so a new `UnitState`
 *  fails to compile here until it is placed. Fire and construction are
 *  animated per frame, never baked. */
const BAKED: Record<UnitState, boolean> = {
  construction: false,
  fire: false,
  empty: true,
  occupied: true,
  moving_in: true,
  vacating: true,
  asleep: true,
  dirty: true,
  infested: true,
  gutted: true,
};
const SETTLED = (Object.keys(BAKED) as UnitState[]).filter((s) => BAKED[s]);
const SPOTS = [{ floor: 10, x: 20 }, { floor: 11, x: 37 }, { floor: 23, x: 58 }] as const;

/** Nobody home, a full room, and a full room with two out for a meal. */
const CROWDS: Partial<Unit>[] = [{ occupants: 0 }, { occupants: 3 }, { occupants: 3, outForMeal: 2 }];
/** Kinds whose art must show an hour-driven change, so the guard's empty miss
 *  list is not vacuous: all three homes' late-night look and every kind with
 *  business hours (its closed look). The party hall and aquatic center keep
 *  hours but draw the same interior open or closed. */
const HOURS_WITHOUT_CLOSED_ART: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["partyHall", "aquaticCenter"]);
const CONTROLS: ReadonlySet<FacilityKind> = new Set<FacilityKind>([
  ...LATE_NIGHT_KINDS,
  ...(Object.keys(FACILITIES) as FacilityKind[]).filter((k) => hasBusinessHours(k) && !HOURS_WITHOUT_CLOSED_ART.has(k)),
]);
const ROOM_KINDS = (Object.keys(FACILITIES) as FacilityKind[]).filter((k) => k !== "floor" && k !== "lobby");

// The general guard: for every room kind (the reconcile loop bakes everything
// but floor and lobby tiles), every settled state, both lighting states,
// every retail subtype and three spots (so the geo-seeded layouts and mirrors
// vary), any hour-to-hour change in the art must come with a signature
// change. The other signature inputs are held fixed: this guards the hour
// bits only. One test per kind keeps each well inside the timeout.
describe("roomSignature hour bits", () => {
  it.each(ROOM_KINDS)("%s: change whenever a settled room's art changes from one hour to the next", (kind) => {
    const misses: string[] = [];
    let changes = 0;
    for (const subtype of [undefined, ...(subtypeListFor(kind) ?? [])]) {
      for (const state of SETTLED) {
        for (const crowd of CROWDS) {
          for (const at of SPOTS) {
            const u = unit(kind, { state, subtype, ...at, ...crowd });
            for (const lit of [true, false]) {
              const logs = Array.from({ length: 24 }, (_, h) => art(u, h, lit));
              for (let h = 0; h < 24; h++) {
                const next = (h + 1) % 24;
                if (logs[h] === logs[next]) continue;
                changes++;
                if (roomSignature(u, scene(h, { lit })) !== roomSignature(u, scene(next, { lit }))) continue;
                const who = `${subtype ?? "-"}/${state}/${u.occupants}/${u.outForMeal ?? 0}@${u.floor},${u.x}`;
                misses.push(`${who}/${lit ? "lit" : "unlit"} ${h}->${next}`);
              }
            }
          }
        }
      }
    }
    if (CONTROLS.has(kind)) expect(changes).toBeGreaterThan(0);
    expect(misses).toEqual([]);
  });
});
