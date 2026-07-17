/**
 * Pure schedule-authoring helpers for the Phase 3 dialog (elevator-scheduling #305):
 * the Modern intent presets, Auto-tune from measured load, the advice comparison,
 * and the Simulate staging summary. All DOM-free and string-free (the UI formats the
 * pinned copy); every function is a pure map from the shaft context and the current
 * working copy to data, so both the dialog and its tests share one definition.
 *
 * Positioning-first (spec §14): presets and Auto-tune set counts, but their real
 * value is the STAGING they seed; the count axis has no running cost, so nothing here
 * treats a lower count as an economy win. See `ux-elevator-schedule-dialog-2026-07-17.md`.
 */
import type { ElevatorSchedule } from "./elevatorSchedule";
import { SCHEDULE_HOURS, coerceSchedule } from "./elevatorSchedule";

/** The shaft facts the authoring helpers read. `servedLobbies` is the subset of
 *  served floors that carry a (sky) lobby, sorted ascending; it is the express home
 *  set and the staging target for every preset. `hourly` is the measured 24-hour
 *  demand curve (0..1 per hour-of-day) from `Simulation.elevatorHourlyLoad`, or
 *  undefined when the shaft has not warmed up yet. */
export interface ShaftContext {
  cars: number;
  bottom: number;
  top: number;
  servedLobbies: number[];
  hourly?: readonly number[];
}

export type SchedulePreset = "rush" | "balanced" | "feeder";

/** Morning up-rush and evening down-rush peak hours the Rush preset fills to the
 *  full fleet. */
const MORNING_PEAK = new Set([7, 8, 9]);
const EVENING_PEAK = new Set([17, 18, 19]);
const OVERNIGHT_CAP = 2; // cars kept on graveyard hours (22:00-05:59)

function isOvernight(h: number): boolean {
  return h >= 22 || h < 6;
}

function half(cars: number): number {
  return Math.max(1, Math.ceil(cars / 2));
}

/** The base (ground) lobby: the lowest served lobby, or the shaft bottom if it serves
 *  no lobby (a shaft with no lobby idles at its base, matching the dispatch fallback). */
function baseLobby(ctx: ShaftContext): number {
  return ctx.servedLobbies.length > 0 ? ctx.servedLobbies[0] : ctx.bottom;
}

/** The highest served lobby (a sky lobby if one exists): the up-tower staging target
 *  for the down-rush, and the express feeder home. */
function topLobby(ctx: ShaftContext): number {
  return ctx.servedLobbies.length > 0 ? ctx.servedLobbies[ctx.servedLobbies.length - 1] : ctx.top;
}

/** Split the fleet: the lower half homes at the base lobby, the upper half up-tower
 *  (the top lobby), staged for the evening down-rush. The one-press "stage upper half
 *  up-tower" play, as a preset seed. */
function splitStaging(ctx: ShaftContext): number[] {
  const base = baseLobby(ctx);
  const up = topLobby(ctx);
  const lower = Math.floor(ctx.cars / 2);
  return Array.from({ length: ctx.cars }, (_, i) => (i < lower ? base : up));
}

/** All cars home at one floor. */
function uniformStaging(ctx: ShaftContext, floor: number): number[] {
  return Array.from({ length: ctx.cars }, () => floor);
}

function fullRow(value: number): number[] {
  return Array(SCHEDULE_HOURS).fill(value);
}

/**
 * Build a Modern intent preset as a full, coerced schedule (spec §5.1, §5.4). Each
 * preset fills both day-type rows and the home floors; the player is then free to
 * hand-edit. Express staging resolves to lobby stops automatically because the home
 * targets are drawn from `servedLobbies`.
 */
export function presetSchedule(preset: SchedulePreset, ctx: ShaftContext): ElevatorSchedule {
  const { cars } = ctx;
  let weekday: number[];
  let weekend: number[];
  let homeFloors: number[];
  if (preset === "rush") {
    // Full fleet at the peaks, half midday and shoulders, a skeleton overnight; the
    // fleet is split-staged so the upper half waits up-tower for the down-rush.
    weekday = Array.from({ length: SCHEDULE_HOURS }, (_, h) => {
      if (MORNING_PEAK.has(h) || EVENING_PEAK.has(h)) return cars;
      if (isOvernight(h)) return Math.min(OVERNIGHT_CAP, cars);
      return half(cars);
    });
    weekend = fullRow(half(cars)); // the midday-half curve all weekend
    homeFloors = splitStaging(ctx);
  } else if (preset === "balanced") {
    // A daytime hump: full 08:00-18:00, half the shoulders, skeleton overnight; all
    // cars home at the base lobby. The safe default.
    weekday = Array.from({ length: SCHEDULE_HOURS }, (_, h) => {
      if (h >= 8 && h < 18) return cars;
      if (isOvernight(h)) return Math.min(OVERNIGHT_CAP, cars);
      return half(cars);
    });
    weekend = [...weekday];
    homeFloors = uniformStaging(ctx, baseLobby(ctx));
  } else {
    // Feeder: steady half-fleet all day and night, every car homed at the highest
    // served lobby to feed an express transfer. The natural express default.
    weekday = fullRow(half(cars));
    weekend = [...weekday];
    homeFloors = uniformStaging(ctx, topLobby(ctx));
  }
  // Coerce so the preset is guaranteed in range for this exact shaft.
  return coerceSchedule({ activeCars: { weekday, weekend }, homeFloors }, cars, ctx.bottom, ctx.top) ?? {};
}

/** The preset the dialog highlights as recommended (spec §5.4): Feeder for an express
 *  trunk (a lobby-only feeder), Rush for a busy local. */
export function recommendedPreset(isExpress: boolean): SchedulePreset {
  return isExpress ? "feeder" : "rush";
}

/**
 * Auto-tune (spec §5.2): set each hour's active count proportional to the measured
 * load, floored at 1 (never fully off the air), for both day-type rows from the one
 * measured curve. Also SEED staging toward the busiest served lobby WHEN the player
 * has not authored home floors, so the assist helps positioning too; it never
 * overwrites a hand-set staging. Returns the current schedule unchanged when there is
 * no measured history yet (the caller shows the "needs measured traffic" note).
 */
export function autoTuneSchedule(current: ElevatorSchedule | undefined, ctx: ShaftContext): ElevatorSchedule | undefined {
  const hourly = ctx.hourly;
  if (!hourly || hourly.length === 0 || hourly.every((v) => v <= 0)) return current;
  const row = Array.from({ length: SCHEDULE_HOURS }, (_, h) => {
    const frac = hourly[h] ?? 0;
    return Math.max(1, Math.min(ctx.cars, Math.round(frac * ctx.cars)));
  });
  const homesAuthored = !!current?.homeFloors && current.homeFloors.length > 0;
  const next: ElevatorSchedule = {
    ...current,
    activeCars: { weekday: [...row], weekend: [...row] },
    homeFloors: homesAuthored ? current!.homeFloors : busiestLobbyStaging(ctx, hourly),
  };
  return coerceSchedule(next, ctx.cars, ctx.bottom, ctx.top);
}

/** Seed staging toward the busiest served lobby: without per-floor demand history we
 *  stage the upper half up-tower for the evening down-rush (the split), which is the
 *  measured-demand-agnostic best default and matches the one-press play. */
function busiestLobbyStaging(ctx: ShaftContext, _hourly: readonly number[]): number[] {
  return splitStaging(ctx);
}

/**
 * The advice comparison (spec §5.3, §14.3): name hours where the authored count is
 * well below or well above the measured demand for the live day type. Suppresses the
 * "short at H" call whenever that hour already runs the full fleet (you cannot add a
 * car you do not have). Returns null when nothing is notably off, or when there is no
 * measured history. Data only; the UI formats the sentence.
 */
export function scheduleAdvice(
  schedule: ElevatorSchedule | undefined,
  ctx: ShaftContext,
  isWeekend: boolean,
): { over: number[]; short: number[] } | null {
  const hourly = ctx.hourly;
  if (!hourly || hourly.length === 0 || hourly.every((v) => v <= 0)) return null;
  const row = (isWeekend ? schedule?.activeCars?.weekend : schedule?.activeCars?.weekday) ?? undefined;
  const over: number[] = [];
  const short: number[] = [];
  for (let h = 0; h < SCHEDULE_HOURS; h++) {
    const active = row && Number.isFinite(row[h]) ? Math.max(0, Math.min(ctx.cars, Math.floor(row[h]))) : ctx.cars;
    const want = Math.max(1, Math.min(ctx.cars, Math.round((hourly[h] ?? 0) * ctx.cars)));
    if (active >= want + 2) over.push(h);
    // Do not nag "short" when the hour already runs the whole fleet: there is no car left to add.
    else if (active <= want - 2 && active < ctx.cars) short.push(h);
  }
  return over.length === 0 && short.length === 0 ? null : { over, short };
}

/**
 * The Simulate staging summary (spec §6, §14.2): score POSITIONING, not counts. Reports
 * the shaft's busiest measured hour (or, with no history, the evening down-rush hour as
 * a sane default), the active count then, and how the fleet is staged (how many cars
 * wait up-tower vs at the base lobby). Data only; the UI turns it into the pinned
 * sentence. Never promises a routed wait time (§6 constraint).
 */
export function stagingSummary(
  schedule: ElevatorSchedule | undefined,
  ctx: ShaftContext,
  isWeekend: boolean,
): { peakHour: number; activeAtPeak: number; upTowerCars: number; lobbyCars: number; topLobby: number; baseLobby: number } {
  const hourly = ctx.hourly;
  let peakHour = 17; // the evening down-rush, the default when there is no measured curve
  if (hourly && hourly.length === SCHEDULE_HOURS) {
    let best = -1;
    for (let h = 0; h < SCHEDULE_HOURS; h++) if ((hourly[h] ?? 0) > best) { best = hourly[h] ?? 0; peakHour = h; }
  }
  const row = (isWeekend ? schedule?.activeCars?.weekend : schedule?.activeCars?.weekday) ?? undefined;
  const activeAtPeak = row && Number.isFinite(row[peakHour]) ? Math.max(0, Math.min(ctx.cars, Math.floor(row[peakHour]))) : ctx.cars;
  const up = topLobby(ctx);
  const base = baseLobby(ctx);
  const homes = schedule?.homeFloors;
  // A car counts as "staged up-tower" when its home is above the midpoint between the
  // base and top lobby; unassigned cars fall back to the base (dispatch's idle floor).
  const mid = (base + up) / 2;
  let upTowerCars = 0;
  for (let i = 0; i < activeAtPeak; i++) {
    const home = homes && Number.isFinite(homes[i]) ? homes[i] : base;
    if (home > mid && up > base) upTowerCars++;
  }
  return { peakHour, activeAtPeak, upTowerCars, lobbyCars: activeAtPeak - upTowerCars, topLobby: up, baseLobby: base };
}
