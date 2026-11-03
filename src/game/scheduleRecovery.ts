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
 *  answer. Only the exact canonical (mode, seed, shaft id, kind, x) or known legacy six-part shape is rewritten,
 *  so unrelated or malformed storage keys stay distinct. */
function canonicalKey(key: string): string | null {
  const parts = key.split(":");
  const isNumeric = (value: string): boolean => /^-?\d+$/.test(value);
  const hasCanonicalShape = (fields: readonly string[]): boolean =>
    fields.length === 5 &&
    fields[0].length > 0 &&
    fields[3].length > 0 &&
    isNumeric(fields[1]) &&
    isNumeric(fields[2]) &&
    isNumeric(fields[4]);

  if (hasCanonicalShape(parts)) return key;
  if (parts.length === 6 && hasCanonicalShape(parts.slice(0, 5)) && isNumeric(parts[5])) {
    return parts.slice(0, 5).join(":");
  }
  return null;
}

const isDecision = (value: unknown): value is Decision => value === "kept" || value === "told";

/** The player's choice to keep a schedule outranks the one-time notice flag, so when two answers meet for one shaft
 *  (a legacy key and its canonical form, or a notice written after a Keep) the kept one stays. */
const strongerDecision = (a: Decision | undefined, b: Decision): Decision => (a === "kept" || b === "kept" ? "kept" : b);

/** Rewrites the known legacy shaft keys to their canonical form, at the position of the first entry for that shaft.
 *  Every other entry stays where and as it is: this slot is the game's own, but a newer build or another tab may
 *  write shapes this one does not know, and an upgrade must not erase what it cannot read. (The slot is still
 *  capped, so the oldest entries go first once it is full.) */
function canonicalize(entries: Record<string, unknown>): Record<string, unknown> {
  // The canonical key a decision entry belongs under, or null when the entry is left as it is. A legacy key never
  // overwrites a canonical key that holds something this build cannot read.
  const target = (key: string, value: unknown): string | null => {
    if (!isDecision(value)) return null;
    const canonical = canonicalKey(key);
    if (canonical === null) return null;
    if (canonical !== key && Object.prototype.hasOwnProperty.call(entries, canonical) && !isDecision(entries[canonical])) return null;
    return canonical;
  };
  const merged = new Map<string, Decision>();
  for (const [key, value] of Object.entries(entries)) {
    const canonical = target(key, value);
    if (canonical !== null) merged.set(canonical, strongerDecision(merged.get(canonical), value as Decision));
  }
  const out: [string, unknown][] = [];
  const placed = new Set<string>();
  for (const [key, value] of Object.entries(entries)) {
    const canonical = target(key, value);
    if (canonical === null) {
      out.push([key, value]);
    } else if (!placed.has(canonical)) {
      placed.add(canonical);
      out.push([canonical, merged.get(canonical)]);
    }
  }
  return Object.fromEntries(out); // not indexed assignment, so a stored "__proto__" entry survives as an own key
}

/** The decisions as the browser keeps them. Storage can be blocked or full; every read and write is best effort.
 *  An answer storage would not take is held in memory instead, so within this session Keep still sticks and the
 *  one-time notice does not come back; only a reload forgets it. */
export function browserAcknowledgements(storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage()): Acknowledgements {
  const unsaved = new Map<string, Decision>();
  const read = (): Record<string, unknown> => {
    try {
      const raw = JSON.parse(storage?.getItem(STORE_KEY) ?? "{}") as unknown;
      const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
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
  // What is held for a shaft: a Keep outranks the notice, and an answer storage refused counts like one it took.
  const held = (canonical: string, stored: Record<string, unknown>): Decision | undefined => {
    const kept = stored[canonical];
    const fromStorage = isDecision(kept) ? kept : undefined;
    const fromMemory = unsaved.get(canonical);
    return fromMemory !== undefined && fromStorage !== undefined ? strongerDecision(fromMemory, fromStorage) : (fromMemory ?? fromStorage);
  };
  return {
    get: (key) => {
      const canonical = canonicalKey(key) ?? key;
      return held(canonical, read());
    },
    set: (key, decision) => {
      const canonical = canonicalKey(key) ?? key;
      const stored = read();
      // The one-time notice never overwrites a Keep: the notice can go out after the player has already decided.
      const answer = strongerDecision(held(canonical, stored), decision);
      // The key goes last, so the oldest entries are the ones trimmed.
      const others = Object.entries(stored).filter(([k]) => k !== canonical);
      const all = Object.fromEntries([...others, [canonical, answer]].slice(-MAX_REMEMBERED));
      try {
        storage?.setItem(STORE_KEY, JSON.stringify(all));
        unsaved.delete(canonical);
      } catch {
        unsaved.set(canonical, answer);
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
