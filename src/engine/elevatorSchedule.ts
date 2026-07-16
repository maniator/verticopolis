/**
 * A per-shaft manual elevator schedule (elevator-scheduling, #305). Every field
 * is optional so a sparse save stores only what the player set; an absent field
 * falls back to today's automatic behavior. Authored state, read deterministically
 * (no RNG). Defined here, the engine leaf, so the sim and (later) the TDT codec
 * share one definition; `types.ts` imports it for the `Transport.schedule` field.
 * See `_bmad-output/planning-artifacts/design/arch-elevator-scheduling-2026-07-16.md`.
 */
export interface ElevatorSchedule {
  /** Cars running each of the 24 hours, per day type. Each present row is a
   *  length-24 array; entry `h` is clamped to `[0, cars]` on read. An absent row
   *  (or hour) means "all cars run". */
  activeCars?: { weekday?: number[]; weekend?: number[] };
  /** Waiting Car Response: how many floors closer to a call an idle car must be
   *  than the assigned car before it answers. Absent = the dispatcher default. */
  waitingCarResponse?: number;
  /** Standard Floor Departure: seconds a car holds at a served floor before it
   *  departs. Absent = the global dwell default. */
  standardFloorDeparture?: number;
  /** Per-car home/waiting floor; index `i` is car `i`. An absent or short entry
   *  falls back to the derived lowest-lobby idle floor. */
  homeFloors?: number[];
}

/**
 * Pure helpers for the per-shaft elevator schedule (elevator-scheduling, #305).
 *
 * Phase 1 scope: the load-boundary coercion (`coerceSchedule`) that hardens an
 * untrusted saved schedule, plus the `scheduleIsEmpty` guard the serializer uses
 * to avoid persisting a schedule with nothing in it. The dispatch read accessors
 * (active-car count, home floor, dwell, response) land with Phase 2 when the
 * dispatcher first reads a schedule; keeping them out of Phase 1 avoids shipping
 * code nothing calls yet.
 *
 * No DOM, no RNG, no Simulation import: this is an engine leaf so both the sim and
 * (later) the TDT codec can share one definition of the schedule's meaning.
 */

/** Hours in a schedule row (a full day). */
export const SCHEDULE_HOURS = 24;

/**
 * Clamp bounds for the two response tunables. PROVISIONAL (the UI stepper ranges
 * are calibration, settled in the Phase 3 dialog PR); here they exist only so a
 * forged save cannot drive dispatch out of a sane range. Widen with the stepper
 * ranges if calibration needs more room.
 */
export const WAITING_CAR_RESPONSE_MAX = 30; // floors
export const STANDARD_FLOOR_DEPARTURE_MAX = 60; // seconds

/** Finite-number coercion with a fallback (a self-contained copy so the leaf
 *  pulls in nothing from the serialization layer). */
function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A schedule with no meaningful authored field: treated as absent, so it never
 *  persists (an empty object is not a schedule). */
export function scheduleIsEmpty(s: ElevatorSchedule | undefined): boolean {
  if (!s) return true;
  const noRows =
    !s.activeCars ||
    ((s.activeCars.weekday === undefined || s.activeCars.weekday.length === 0) &&
      (s.activeCars.weekend === undefined || s.activeCars.weekend.length === 0));
  return (
    noRows &&
    s.waitingCarResponse === undefined &&
    s.standardFloorDeparture === undefined &&
    (s.homeFloors === undefined || s.homeFloors.length === 0)
  );
}

/** Coerce one day-type row to a length-24 array of car counts in `[0, cars]`. A
 *  non-finite entry defaults to `cars` ("all cars run this hour"), which is the
 *  neutral fallback. */
function coerceRow(raw: unknown, cars: number): number[] {
  return Array.from({ length: SCHEDULE_HOURS }, (_, h) => {
    const arr = Array.isArray(raw) ? raw : [];
    return clamp(Math.floor(finite(arr[h], cars)), 0, cars);
  });
}

/**
 * Harden an untrusted saved schedule at the load boundary. Returns `undefined`
 * for anything that is not a real, non-empty schedule (so an absent or garbage
 * value loads as "no schedule", i.e. today's automatic behavior). `cars` bounds
 * the active-car counts; `[bottom, top]` bounds the home floors.
 *
 * Every present field is clamped so a forged save can never drive the dispatcher
 * out of range (a NaN/negative/huge active count, an absurd response value, a
 * home floor off the shaft). An absent field stays absent and falls back at read
 * time.
 *
 * A transport with no cars (a non-elevator: stairs/escalator have `cars` 0) never
 * has a schedule: it returns `undefined`, so a forged schedule attached to a
 * staircase is dropped rather than persisted. Non-finite `cars`/`bottom`/`top` are
 * rejected the same way, so a garbage bound can never poison a clamp (the callers
 * pass already-hardened values, but the guard keeps the leaf robust on its own).
 */
export function coerceSchedule(
  raw: unknown,
  cars: number,
  bottom: number,
  top: number,
): ElevatorSchedule | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  if (!Number.isFinite(cars) || cars <= 0 || !Number.isFinite(bottom) || !Number.isFinite(top)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ElevatorSchedule = {};

  const rawActive = r.activeCars;
  if (rawActive !== null && typeof rawActive === "object") {
    const a = rawActive as Record<string, unknown>;
    const active: { weekday?: number[]; weekend?: number[] } = {};
    // An empty input row means "no row authored" (falls back to all cars), so
    // only a non-empty array becomes a stored, coerced 24-hour row.
    if (Array.isArray(a.weekday) && a.weekday.length > 0) active.weekday = coerceRow(a.weekday, cars);
    if (Array.isArray(a.weekend) && a.weekend.length > 0) active.weekend = coerceRow(a.weekend, cars);
    if (active.weekday || active.weekend) out.activeCars = active;
  }

  if (typeof r.waitingCarResponse === "number" && Number.isFinite(r.waitingCarResponse)) {
    out.waitingCarResponse = clamp(Math.round(r.waitingCarResponse), 0, WAITING_CAR_RESPONSE_MAX);
  }
  if (typeof r.standardFloorDeparture === "number" && Number.isFinite(r.standardFloorDeparture)) {
    out.standardFloorDeparture = clamp(Math.round(r.standardFloorDeparture), 0, STANDARD_FLOOR_DEPARTURE_MAX);
  }

  if (Array.isArray(r.homeFloors)) {
    // Keep at most one entry per car, each a valid served floor. A non-finite
    // entry defaults to `bottom`; entries beyond the car count are dropped (a
    // read past the end falls back to the derived idle floor).
    const n = Math.max(0, Math.min(cars, r.homeFloors.length));
    if (n > 0) {
      out.homeFloors = Array.from({ length: n }, (_, i) =>
        clamp(Math.round(finite((r.homeFloors as unknown[])[i], bottom)), bottom, top),
      );
    }
  }

  return scheduleIsEmpty(out) ? undefined : out;
}

/** Deep-copy a schedule for a serialization snapshot, so a retained save object
 *  can't be mutated later by an in-place edit. */
export function cloneSchedule(s: ElevatorSchedule): ElevatorSchedule {
  return {
    activeCars: s.activeCars
      ? {
          weekday: s.activeCars.weekday ? [...s.activeCars.weekday] : undefined,
          weekend: s.activeCars.weekend ? [...s.activeCars.weekend] : undefined,
        }
      : undefined,
    waitingCarResponse: s.waitingCarResponse,
    standardFloorDeparture: s.standardFloorDeparture,
    homeFloors: s.homeFloors ? [...s.homeFloors] : undefined,
  };
}
