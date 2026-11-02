import type { FacilityKind } from "../engine/types";
import type { ElevatorSchedule } from "../engine/elevatorSchedule";

/**
 * Older towers can hold an elevator with more cars than its schedule runs:
 * before 2.74.3, buying a car left an authored schedule's hourly counts alone,
 * so the new car never went on shift (#1546, #1548). This module finds those
 * shafts, builds the one-step recovery, and remembers what the player decided.
 * It reads facts the port already gives and changes nothing itself; the review
 * dialog applies a recovery through the ordinary schedule command, so Undo and
 * the save work as they do for any schedule edit.
 *
 * Detection is conservative on purpose. A shaft is only offered the one-click
 * recovery when its schedule is flat: every hour of both day types runs the
 * same nonzero count, below the cars installed. A staggered schedule, one with
 * off-duty hours, or one that leaves a day type to the full fleet is never
 * called a mistake. Those shafts are still listed for a manual review, where
 * the player opens the schedule dialog and decides.
 */

/** The hours a schedule row covers, one count per hour of the day. A test pins it to the engine's `SCHEDULE_HOURS`. */
const SCHEDULE_HOURS = 24;

/** The kinds that are elevators; a test pins this to the engine's `isElevatorKind`. */
const ELEVATOR_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["elevatorStandard", "elevatorService", "elevatorExpress"]);
export const isElevator = (kind: FacilityKind): boolean => ELEVATOR_KINDS.has(kind);

/** What the review needs of a shaft: the card's facts, nothing from the engine's records. */
export interface ShaftFacts {
  readonly id: number;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly bottom: number;
  readonly top: number;
  readonly cars: number;
}

/** An elevator whose schedule leaves some installed car off shift in some hour. */
export interface ShortFleet {
  readonly shaft: ShaftFacts;
  readonly schedule: ElevatorSchedule;
  /** Fewest and most cars on shift in any hour of either day type; a day type with no row runs every car. */
  readonly least: number;
  readonly most: number;
  /** The one count every hour of both day types runs, when the schedule is flat, nonzero and short. */
  readonly flatAt: number | null;
}

/** The authored rows of a schedule, clamped to the cars installed. */
function rowsOf(schedule: ElevatorSchedule, cars: number): number[][] {
  const { weekday, weekend } = schedule.activeCars ?? {};
  return [weekday, weekend]
    .filter((row): row is number[] => Array.isArray(row) && row.length > 0)
    .map((row) => row.map((n) => Math.min(n, cars)));
}

/** The elevators a schedule leaves short, in the order given. `scheduleOf` is the port's `currentSchedule`. */
export function shortFleets(shafts: readonly ShaftFacts[], scheduleOf: (id: number) => ElevatorSchedule | undefined): ShortFleet[] {
  const found: ShortFleet[] = [];
  for (const shaft of shafts) {
    if (!isElevator(shaft.kind)) continue;
    const schedule = scheduleOf(shaft.id);
    if (!schedule) continue;
    const rows = rowsOf(schedule, shaft.cars);
    if (rows.length === 0) continue;
    const counts = rows.flat();
    const least = Math.min(...counts);
    const unscheduledDay = rows.length < 2; // a day type with no row runs every car
    const most = unscheduledDay ? shaft.cars : Math.max(...counts);
    if (least >= shaft.cars) continue;
    const flat = !unscheduledDay && rows.every((row) => row.length === SCHEDULE_HOURS) && least === most && least > 0;
    found.push({ shaft, schedule, least, most, flatAt: flat ? least : null });
  }
  return found;
}

/** The schedule with every on-shift hour running the whole fleet. Off-duty hours stay off, a day type with no row stays
 *  without one, and the staging, stops and timings are untouched. */
export function recoveredSchedule(finding: Pick<ShortFleet, "schedule" | "shaft">): ElevatorSchedule {
  const { schedule, shaft } = finding;
  const fill = (row: number[] | undefined): number[] | undefined => row?.map((n) => (n > 0 ? shaft.cars : 0));
  const { weekday, weekend } = schedule.activeCars ?? {};
  return {
    ...schedule,
    activeCars: {
      ...(weekday ? { weekday: fill(weekday) } : {}),
      ...(weekend ? { weekend: fill(weekend) } : {}),
    },
  };
}

/** What the player did with a shaft's notice. "kept" is their choice to leave the schedule as it is;
 *  "told" means the one-time notice already went out, so a reload says nothing more. */
export type Decision = "kept" | "told";

export interface Acknowledgements {
  get(key: string): Decision | undefined;
  set(key: string, decision: Decision): void;
}

/** One key per tower and shaft: the founding seed and mode name the tower (they survive saving, loading and
 *  importing a copy), and the shaft's id, kind and column name the shaft. The span ends move as the player edits
 *  the shaft, so they are not part of the remembered answer: a geometry change that keeps the same logical shaft
 *  must not re-ask the same decision. */
export function acknowledgementKey(tower: { readonly seed: number; readonly mode: string }, shaft: ShaftFacts): string {
  return [tower.mode, tower.seed, shaft.id, shaft.kind, shaft.x].join(":");
}

const STORE_KEY = "vc-elevator-schedule-review";
const MAX_REMEMBERED = 400;

/** Old keys used to include the shaft's mutable bottom floor; a geometry-only resize should still match the same
 *  answer. The canonical form drops legacy suffixes that only change with a valid resize, but keeps the rest of the
 *  shaft identity and tower identity intact. */
function canonicalKey(key: string): string | null {
  const parts = key.split(":");
  if (parts.length === 5 && parts.every(Boolean)) return key;
  if (parts.length > 5 && parts.slice(0, 5).every(Boolean) && parts.slice(5).every((part) => /^-?\d+$/.test(part))) {
    return parts.slice(0, 5).join(":");
  }
  return null;
}

function canonicalize(entries: Record<string, Decision>): Record<string, Decision> {
  const migrated: Record<string, Decision> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== "kept" && value !== "told") continue;
    const next = canonicalKey(key) ?? key;
    migrated[next] = value;
  }
  return migrated;
}

/** The decisions as the browser keeps them. Storage can be blocked or full; every read and write is best effort.
 *  An answer storage would not take is held in memory instead, so within this session Keep still sticks and the
 *  one-time notice does not come back; only a reload forgets it. */
export function browserAcknowledgements(storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage()): Acknowledgements {
  const unsaved = new Map<string, Decision>();
  const read = (): Record<string, Decision> => {
    try {
      const raw = JSON.parse(storage?.getItem(STORE_KEY) ?? "{}") as unknown;
      const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Decision>) : {};
      const migrated = canonicalize(base);
      if (JSON.stringify(base) !== JSON.stringify(migrated)) {
        try {
          storage?.setItem(STORE_KEY, JSON.stringify(migrated));
        } catch {
          // ignore a blocked browser store; the in-memory copy still reflects the canonical values
        }
      }
      return migrated;
    } catch {
      return {};
    }
  };
  return {
    get: (key) => {
      const canonical = canonicalKey(key) ?? key;
      const v = unsaved.get(canonical) ?? read()[canonical]; // a newer answer storage refused beats an older one it took
      return v === "kept" || v === "told" ? v : undefined;
    },
    set: (key, decision) => {
      const canonical = canonicalKey(key) ?? key;
      // The key goes last, so the oldest entries are the ones trimmed.
      const others = Object.entries(read()).filter(([k]) => k !== canonical);
      const all = Object.fromEntries([...others, [canonical, decision]].slice(-MAX_REMEMBERED));
      try {
        storage?.setItem(STORE_KEY, JSON.stringify(all));
        unsaved.delete(canonical);
      } catch {
        unsaved.set(canonical, decision);
      }
    },
  };
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
