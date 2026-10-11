import { FACILITIES, facilityFloors, hasBusinessHours, isOpenAt } from "../../engine/facilities";
import { HOUSEHOLD_SIZES } from "../../engine/households";
import { hasHousehold } from "../../engine/residentialRentals";
import { subtypeListFor } from "../../engine/retailSubtypes";
import type { FacilityKind, UnitState } from "../../engine/types";
import { TILE, FLOOR } from "../scale";
import { CONSTRUCTION_FRAMES, FIRE_FRAMES, ROOM_VARIANTS } from "./schema";
import type { PaintSpec, UnitPaint } from "./paint";

/**
 * The room half of the atlas catalog: every facility kind in every unit state,
 * baked on the static inputs of the web's re-bake signature
 * (`excalibur/towerReconcile.ts`) and split from the inputs a frontend
 * composes at runtime. Pure data; the bake runs it.
 */

export type Keys = Record<string, string | number | boolean>;

/** A still frame, optionally carrying composed layers. */
export interface StillJob {
  type: "still";
  name: string;
  w: number;
  h: number;
  anchor: { x: number; y: number };
  keys: Keys;
  paint: PaintSpec;
  /** Ordered steps; layer `k` is what changes from step `k-1` to step `k`.
   *  Step 0 is the frame's own paint. */
  chains?: Record<string, { input: string; steps: PaintSpec[] }>;
  /** Single overlays: what changes from the frame's paint to this one. */
  overlays?: Record<string, PaintSpec>;
}

/** An animation: one frame per paint, `dt` seconds apart. */
export interface AnimJob {
  type: "anim";
  name: string;
  w: number;
  h: number;
  anchor: { x: number; y: number };
  keys: Keys;
  dt: number;
  loop: boolean;
  frames: PaintSpec[];
}

export type Job = StillJob | AnimJob;

/** Every state the engine names (engine-rs `UnitState::as_str`). Fire and
 *  construction ship as animations; the rest bake as stills. */
export const UNIT_STATES: readonly UnitState[] = [
  "construction",
  "empty",
  "occupied",
  "moving_in",
  "vacating",
  "asleep",
  "dirty",
  "infested",
  "fire",
  "gutted",
];

/** Kinds whose art ignores `occupants` entirely, so they carry no presence
 *  split and no occupant chain. */
export const OCCUPANT_FREE = new Set<FacilityKind>(["parking", "parkingRamp", "security", "medical", "housekeeping", "recycling", "metro"]);

/**
 * Kinds whose art seeds a detail from the DRAW origin instead of the room's
 * geography: the staff figures' shirts (security, medical, housekeeping hash
 * `Math.round(x)`), the sky bar's skyline windows and the fitness club's
 * climbing holds (absolute pixel coordinates). In the web these details follow
 * the room's offset inside its compositor region, which the atlas cannot know,
 * so the atlas carries the per-unit bake's look (origin 0, 0). Tracked as a backlog defer (sprite-origin-seeds).
 */
export const ORIGIN_SEEDED: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["security", "medical", "housekeeping", "skyBar", "fitnessClub"]);

/** Kinds whose art changes after 23:00 and before 06:00: the condo (its
 *  asleep scrim and its residents) and the two rentals, which share the
 *  condo's draw (`residentialRentalSprites.ts`) and its hidden-residents rule. */
export const LATE_NIGHT_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["condo", "rentalStudio", "rentalApartment"]);

export function isLateHour(hour: number): boolean {
  return hour >= 23 || hour < 6;
}

/** The web's re-bake bucket for the recycling pile (`r${round(fill * 8)}`). */
export const RECYCLE_STEPS = 8;

/** Parked car colors: `ACCENTS[id % 7]` in the garage art. */
export const PARKING_CAR_COLORS = 7;

/** The sampled per-footprint seeds for variant `v` of `kind`. Above-ground
 *  and basement kinds sample floors on their own side of the ground line, and
 *  a full-lot kind (the metro) has exactly one placement. */
export function variantPlacements(kind: FacilityKind): { floor: number; x: number; id: number }[] {
  const f = FACILITIES[kind];
  if (f.width >= 200) return [{ floor: -8, x: 0, id: 1 }];
  const floors = f.basement ? [-1, -2, -4, -6] : [5, 12, 27, 43];
  const xs = [17, 64, 131, 208];
  const ids = [3, 14, 25, 36];
  return Array.from({ length: ROOM_VARIANTS }, (_, v) => ({ floor: floors[v], x: xs[v], id: ids[v] }));
}

/** The kinds that bake as rooms: everything but structure and transport. */
export function roomKinds(): FacilityKind[] {
  return (Object.keys(FACILITIES) as FacilityKind[]).filter(
    (k) => k !== "floor" && k !== "lobby" && !FACILITIES[k].transport,
  );
}

/** An hour that realizes the requested open/closed and late-night bits for
 *  `kind`. `open` is ignored for kinds without business hours. */
export function hourFor(kind: FacilityKind, open: boolean, late: boolean): number {
  for (let i = 0; i < 24; i++) {
    const h = (12 + i) % 24;
    if (LATE_NIGHT_KINDS.has(kind) && isLateHour(h) !== late) continue;
    if (hasBusinessHours(kind) && isOpenAt(kind, h) !== open) continue;
    return h;
  }
  throw new Error(`no hour realizes ${kind} open=${open} late=${late}`);
}

/** The most occupants the engine can put in a room of `kind`, which is the
 *  occupant chain's length. Leases and stays fill to the catalog population,
 *  commercial customers stay under it (`crowd/visits.ts`), venues are clamped
 *  to their attendance (`census.syncAttendanceOccupants`), and a Modern
 *  household runs up to the largest family size. A frontend clamps a larger
 *  (forged) count to the chain's `max`. */
export function occupantCap(kind: FacilityKind): number {
  const f = FACILITIES[kind];
  const household = hasHousehold(kind) ? Math.max(...HOUSEHOLD_SIZES) : 0;
  return Math.max(f.population, f.attendance ?? 0, household);
}

/** Frame name token for a subtype: the engine's name, or `-` for none. */
function subtypeToken(s: string | undefined): string {
  if (s === undefined) return "-";
  if (s.includes("/")) throw new Error(`subtype ${s} would break the frame name`);
  return s;
}

/** All still and animated room jobs. */
export function roomJobs(): Job[] {
  const jobs: Job[] = [];
  for (const kind of roomKinds()) {
    const f = FACILITIES[kind];
    const w = f.width * TILE;
    const h = facilityFloors(kind) * FLOOR;
    jobs.push(...roomAnimations(kind, w, h));
    const subtypes: (string | undefined)[] = [undefined, ...(subtypeListFor(kind) ?? [])];
    const hoursSet = hasBusinessHours(kind) ? ["open", "closed"] : ["always"];
    const lateSet = LATE_NIGHT_KINDS.has(kind) ? ["late", "notlate"] : ["any"];
    const placements = variantPlacements(kind);
    for (const state of UNIT_STATES) {
      if (state === "fire" || state === "construction") continue;
      for (const subtype of subtypes) {
        for (const lit of [false, true]) {
          for (const hours of hoursSet) {
            for (const late of lateSet) {
              placements.forEach((pl, v) => {
                const base: UnitPaint = {
                  p: "unit",
                  kind,
                  state,
                  subtype,
                  floor: pl.floor,
                  x: pl.x,
                  id: pl.id,
                  width: f.width,
                  occupants: 0,
                  outForMeal: 0,
                  lit,
                  hour: hourFor(kind, hours === "open", late === "late"),
                  anim: 0,
                };
                const keys: Keys = { kind, state, subtype: subtypeToken(subtype), width: f.width, lit, hours, late, variant: v };
                const stem = `room/${kind}/${state}/${subtypeToken(subtype)}/w${f.width}/${lit ? "lit" : "unlit"}/${hours}/${late}/v${v}`;
                jobs.push(...roomStills(kind, stem, w, h, base, keys));
              });
            }
          }
        }
      }
    }
  }
  return jobs;
}

/** The still frames for one static signature: the presence split and the
 *  composed layers each kind carries. */
function roomStills(kind: FacilityKind, stem: string, w: number, h: number, base: UnitPaint, keys: Keys): StillJob[] {
  const anchor = { x: 0, y: 0 };
  if (kind === "parking") {
    const overlays: Record<string, PaintSpec> = { dead: { ...base, dead: true } };
    for (let c = 0; c < PARKING_CAR_COLORS; c++) overlays[`car${c}`] = { ...base, id: c, parkingUse: 1 };
    return [{ type: "still", name: stem, w, h, anchor, keys, paint: base, overlays }];
  }
  if (kind === "recycling") {
    const steps: PaintSpec[] = [];
    for (let k = 0; k <= RECYCLE_STEPS; k++) steps.push({ ...base, recycleFill: k / RECYCLE_STEPS });
    return [{ type: "still", name: stem, w, h, anchor, keys, paint: base, chains: { fill: { input: "recyclingFill", steps } } }];
  }
  if (OCCUPANT_FREE.has(kind)) return [{ type: "still", name: stem, w, h, anchor, keys, paint: base }];
  const away: StillJob = { type: "still", name: `${stem}/away`, w, h, anchor, keys: { ...keys, presence: "away" }, paint: base };
  // Present: raw occupants > 0. The chain walks the VISIBLE count (occupants
  // minus those out for a meal); step 0 is everyone out, which only a meal
  // origin can reach.
  const homeBase: UnitPaint = { ...base, occupants: 1, outForMeal: 1 };
  const steps: PaintSpec[] = [homeBase];
  for (let v = 1; v <= occupantCap(kind); v++) steps.push({ ...base, occupants: v, outForMeal: 0 });
  const home: StillJob = {
    type: "still",
    name: `${stem}/home`,
    w,
    h,
    anchor,
    keys: { ...keys, presence: "home" },
    paint: homeBase,
    chains: { occupants: { input: "visibleOccupants", steps } },
  };
  return [away, home];
}

/** Fire and construction loops for a kind (their art reads only the size and
 *  the animation clock). */
function roomAnimations(kind: FacilityKind, w: number, h: number): AnimJob[] {
  const base = (state: UnitState, anim: number): UnitPaint => ({
    p: "unit",
    kind,
    state,
    floor: 5,
    x: 17,
    id: 3,
    width: FACILITIES[kind].width,
    occupants: 0,
    outForMeal: 0,
    lit: false,
    hour: 12,
    anim,
  });
  // drawFlames: sin(anim * 6 + ...), period 2pi/6. drawConstruction: sin(anim).
  const firePeriod = (2 * Math.PI) / 6;
  const buildPeriod = 2 * Math.PI;
  const loop = (state: UnitState, period: number, n: number): AnimJob => ({
    type: "anim",
    name: `${state}/${kind}`,
    w,
    h,
    anchor: { x: 0, y: 0 },
    keys: { kind, state, width: FACILITIES[kind].width },
    dt: period / n,
    loop: true,
    frames: Array.from({ length: n }, (_, i) => base(state, (period * i) / n)),
  });
  return [loop("fire", firePeriod, FIRE_FRAMES), loop("construction", buildPeriod, CONSTRUCTION_FRAMES)];
}
