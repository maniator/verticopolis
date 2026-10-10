import { FACILITIES, isElevatorKind } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import type { PersonBuild } from "../pixelSprites/common";
import { BUILDS as FIGURE_BUILDS, SHIRTS, moodTint } from "../pixelSprites/common";
import { FLOOR, TILE } from "../scale";
import {
  AWNING_W,
  CRANE_H,
  CRANE_W,
  ESCAPE_W,
  LOBBY_VARIANTS,
  type EntranceKind,
} from "../sprites";
import { GARBAGE_TRUCK_H, METRO_TRAIN_H } from "../sprites/facilities/vehicles";
import { CLOUD_COUNT, MOON_R, SUN_R, cloudRadius, cloudSeed } from "../sprites/sky";
import type { AnimJob, Job, Keys, StillJob } from "./catalog";
import { cloudOrigin, personSize, type PaintSpec } from "./paint";
import { CRANE_DT, CRANE_FRAMES } from "./schema";

/**
 * The non-room half of the atlas catalog: structure tiles and entrances,
 * shafts and cars, people, the exterior facade, vehicles and the sky.
 */

const lit2 = (lit: boolean): string => (lit ? "lit" : "unlit");

function still(name: string, w: number, h: number, paint: PaintSpec, keys: Keys, anchor = { x: 0, y: 0 }): StillJob {
  return { type: "still", name, w, h, anchor, keys, paint };
}

/** Floor and lobby tiles plus the four ground-floor entrance slices. */
export function structureJobs(): Job[] {
  const jobs: Job[] = [still("structure/floor", TILE, FLOOR, { p: "floor" }, { kind: "floor" })];
  for (const ground of [true, false]) {
    for (const lit of [false, true]) {
      for (let v = 0; v < LOBBY_VARIANTS; v++) {
        const style = ground ? "ground" : "sky";
        jobs.push(still(`structure/lobby/${style}/${lit2(lit)}/v${v}`, TILE, FLOOR, { p: "lobby", ground, variant: v, lit }, { kind: "lobby", style, lit, variant: v }));
      }
    }
  }
  const kinds: EntranceKind[] = ["grand-left", "grand-right", "grand-solo", "service"];
  for (const kind of kinds) {
    for (const lit of [false, true]) {
      for (const staffed of [true, false]) {
        // The doorman sways between two poses every 1.5 s (`entrance.ts`).
        const frames: PaintSpec[] = [0, 1.5].map((anim) => ({ p: "entrance", kind, lit, anim, staffed }));
        const anim: AnimJob = {
          type: "anim",
          name: `structure/entrance/${kind}/${lit2(lit)}/${staffed ? "staffed" : "unstaffed"}`,
          w: TILE,
          h: FLOOR,
          anchor: { x: 0, y: 0 },
          keys: { kind: "lobby", entrance: kind, lit, staffed },
          dt: 1.5,
          loop: true,
          frames,
        };
        jobs.push(anim);
      }
    }
  }
  return jobs;
}

/** Sampled car seeds (the web seeds a cab by `car index * 7 + shaft id`). */
export const CAR_SEEDS = [0, 7, 15, 22];

/** Rider chain length: a cab shows at most four riders (`carIndicator.ts`
 *  clamps the load to 0..4). */
export const RIDER_CAP = 4;

/** Elevator shafts as floor bands, the fixed-span stairs and escalators, and
 *  the cabs with their rider chains. */
export function transportJobs(): Job[] {
  const jobs: Job[] = [];
  for (const kind of Object.keys(FACILITIES) as FacilityKind[]) {
    const f = FACILITIES[kind];
    if (!f.transport) continue;
    const w = f.width * TILE;
    if (!isElevatorKind(kind)) {
      // Stairs and escalators always span exactly two floors.
      jobs.push(still(`transport/${kind}`, w, 2 * FLOOR, { p: "shaft", kind, floors: 2, band: 0, skip: [] }, { kind, floors: 2 }));
      continue;
    }
    const band = (piece: string, floors: number, b: number, skip: number[]): StillJob =>
      still(`shaft/${kind}/${piece}`, w, FLOOR, { p: "shaft", kind, floors, band: b, skip }, { kind, piece });
    // Bands are numbered from the top floor down; floor 2 of a 3-floor shaft
    // is its middle band.
    jobs.push(
      band("top", 3, 0, []),
      band("stop", 3, 1, []),
      band("skip", 3, 1, [2]),
      band("bottom", 3, 2, []),
      band("single", 1, 0, []),
      // A skipped end floor (a resized or loaded non-express shaft can keep
      // one in its skip list). The bottom loses its stop line; the top's is
      // already under the motor housing, so top-skip matches top.
      band("top-skip", 3, 0, [3]),
      band("bottom-skip", 3, 2, [1]),
      band("single-skip", 1, 0, [1]),
    );
    for (const arrow of [null, "up", "down"] as const) {
      for (const full of [false, true]) {
        CAR_SEEDS.forEach((seed, s) => {
          const car = (riders: number): PaintSpec => ({ p: "car", kind, seed, riders, arrow, full });
          const steps = Array.from({ length: RIDER_CAP + 1 }, (_, r) => car(r));
          jobs.push({
            ...still(`car/${kind}/${arrow ?? "idle"}/${full ? "full" : "notfull"}/s${s}`, w, FLOOR, car(0), { kind, arrow: arrow ?? "idle", full, variant: s }),
            chains: { riders: { input: "riders", steps } },
          });
        });
      }
    }
  }
  return jobs;
}

/** Figure builds and their sizes, from the game's own build table: the build's
 *  width and its height (head, torso and legs). */
export const BUILDS = Object.fromEntries(
  (Object.keys(FIGURE_BUILDS) as PersonBuild[]).map((b) => {
    const spec = FIGURE_BUILDS[b];
    return [b, { w: spec.width, h: spec.head + spec.torso + spec.legs }];
  }),
) as Record<PersonBuild, { w: number; h: number }>;

/** Every figure build in every fill the game paints it in. */
export function peopleJobs(): Job[] {
  const fills: [string, string][] = SHIRTS.map((c, i) => [`shirt${i}`, c]);
  fills.push(["staff", "#E8E4DA"], ["impatient", moodTint("impatient", 0)], ["fedUp", moodTint("fedUp", 0)]);
  const jobs: Job[] = [];
  for (const build of Object.keys(BUILDS) as PersonBuild[]) {
    const size = personSize(BUILDS[build].w, BUILDS[build].h);
    for (const [name, fill] of fills) {
      const anchor = { x: Math.floor(size.w / 2), y: size.h - 1 };
      jobs.push(still(`person/${build}/${name}`, size.w, size.h, { p: "person", build, fill }, { build, fill: name, color: fill }, anchor));
    }
  }
  return jobs;
}

/** Fire escapes, ground-floor awnings and the rooftop crane. */
export function facadeJobs(): Job[] {
  const jobs: Job[] = [];
  for (const side of ["left", "right"] as const) {
    for (const parity of [0, 1] as const) {
      jobs.push(still(`facade/escape/${side}/${parity}`, ESCAPE_W, FLOOR, { p: "escape", side, parity }, { piece: "escape", side, parity }));
    }
    jobs.push(still(`facade/awning/${side}`, AWNING_W, FLOOR, { p: "awning", side }, { piece: "awning", side }));
  }
  for (const lit of [false, true]) {
    jobs.push({
      type: "anim",
      name: `facade/crane/${lit2(lit)}`,
      w: CRANE_W,
      h: CRANE_H,
      anchor: { x: CRANE_W / 2, y: CRANE_H },
      keys: { piece: "crane", lit },
      dt: CRANE_DT,
      loop: false,
      frames: Array.from({ length: CRANE_FRAMES }, (_, i) => ({ p: "crane", t: i * CRANE_DT, lit })),
    });
  }
  return jobs;
}

/** Sampled garage-sedan seeds (the web seeds one per parking floor). */
export const STREET_CAR_SEEDS = [0, 97, 401, 1213];

/** The moving vehicles: garage sedans, the garbage truck, the metro train. */
export function vehicleJobs(): Job[] {
  const jobs: Job[] = STREET_CAR_SEEDS.map((seed, s) =>
    still(`vehicle/streetcar/s${s}`, 16, 8, { p: "streetCar", seed }, { vehicle: "streetcar", variant: s }),
  );
  jobs.push(still("vehicle/garbagetruck", 68, GARBAGE_TRUCK_H, { p: "garbageTruck", w: 68 }, { vehicle: "garbagetruck" }));
  const trainW = FACILITIES.metro.width * TILE - 6;
  for (const headlight of [true, false]) {
    jobs.push(
      still(`vehicle/metrotrain/${headlight ? "headlight" : "dark"}`, trainW, METRO_TRAIN_H, { p: "metroTrain", w: trainW, headlight }, { vehicle: "metrotrain", headlight }),
    );
  }
  return jobs;
}

/** Skyline fills (`excalibur/towerScenery.ts`): far, then near. */
export const SKYLINE_FILLS = ["rgba(70, 86, 120, 0.55)", "rgba(52, 66, 96, 0.75)"];

/** Columns in the sky strip: one per quarter hour. */
export const SKY_COLUMNS = 96;

/** The day's sky strip, the sun and moon, every cloud, and the skyline. */
export function skyJobs(): Job[] {
  const jobs: Job[] = [still("sky/gradient", SKY_COLUMNS, 1, { p: "skyGradient" }, { piece: "gradient", columnsPerHour: SKY_COLUMNS / 24 })];
  for (const [name, day, r] of [["sun", true, SUN_R], ["moon", false, MOON_R]] as const) {
    const d = 2 * r + 2;
    jobs.push(still(`sky/${name}`, d, d, { p: "disc", day, r }, { piece: name }, { x: d / 2, y: d / 2 }));
  }
  for (const weather of ["overcast", "rain"] as const) {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const r = cloudRadius(cloudSeed(i));
      const o = cloudOrigin(r);
      jobs.push(still(`sky/cloud/${weather}/${i}`, o.w, o.h, { p: "cloud", weather, r }, { piece: "cloud", weather, index: i }, { x: o.x, y: o.y }));
    }
  }
  SKYLINE_FILLS.forEach((css, i) => {
    const depth = i === 0 ? "far" : "near";
    jobs.push(still(`sky/skyline/${depth}`, 2, 2, { p: "solid", css }, { piece: "skyline", depth }));
  });
  return jobs;
}
