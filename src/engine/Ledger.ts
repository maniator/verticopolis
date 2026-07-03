/**
 * The tower's money ledger: a rolling per-category record of income and expense
 * so the Tower Statistics screen can answer "what's making (or costing) what,
 * on average?" — the original's income breakdown.
 *
 * Amounts are tagged by a small set of REPORT categories (not the facility
 * catalog's categories) so the readout stays short: offices, condos, hotels,
 * retail, food, entertainment plus an `upkeep` bucket for transport/service
 * maintenance. Each category's figure is NET — a room's operating overhead and a
 * cinema's film booking are charged against that room's own line — so "offices:
 * +$X/day" already accounts for their overhead.
 *
 * Averaging is over a trailing {@link WINDOW}-day window (a full quarter), which
 * is long enough that quarterly office rent lands in it exactly once and so
 * amortizes to a sensible per-day figure, while still reflecting a change made a
 * few weeks ago. One-off, non-operational money (buried treasure, resale
 * refunds) is deliberately NOT recorded — the breakdown is about the tower's
 * ongoing economics, not windfalls.
 */

import type { FacilityKind } from "./types";

export type LedgerCat =
  | "offices"
  | "condos"
  | "hotels"
  | "retail"
  | "food"
  | "entertainment"
  | "upkeep";

/** The report category a facility's income/overhead belongs to, or null for
 *  kinds with no operational money line (structure, transport, pure services).
 *  Transport and service upkeep is recorded directly against `upkeep`, not here. */
export function ledgerCatFor(kind: FacilityKind): LedgerCat | null {
  switch (kind) {
    case "office":
      return "offices";
    case "condo":
      return "condos";
    case "hotelSingle":
    case "hotelDouble":
    case "hotelSuite":
      return "hotels";
    case "shop":
      return "retail";
    case "fastFood":
    case "restaurant":
      return "food";
    case "cinema":
    case "partyHall":
      return "entertainment";
    default:
      return null;
  }
}

/** The report categories in display order. */
export const LEDGER_CATS: LedgerCat[] = [
  "offices",
  "condos",
  "hotels",
  "retail",
  "food",
  "entertainment",
  "upkeep",
];

/** Human labels for the readout. */
export const LEDGER_LABELS: Record<LedgerCat, string> = {
  offices: "Offices",
  condos: "Condos",
  hotels: "Hotels",
  retail: "Retail",
  food: "Food",
  entertainment: "Entertainment",
  upkeep: "Upkeep",
};

/** Trailing window over which a per-day average is taken, in in-game days.
 *  90 (a quarter) captures each quarterly office-rent collection exactly once. */
export const WINDOW = 90;

/** A day's per-category totals as a plain object (JSON-friendly for save/load). */
type DayTotals = Partial<Record<LedgerCat, number>>;

/**
 * Rolling income/expense record. `record()` accumulates into the current day;
 * `endDay()` (called once per in-game day) rolls the day into the trailing
 * window. {@link averagePerDay} reports the windowed per-day figure per category.
 */
export class Ledger {
  private today: DayTotals = {};
  /** Completed days, oldest first, capped at {@link WINDOW}. */
  private history: DayTotals[] = [];

  /** Tag an amount to a category (positive income, negative expense). */
  record(cat: LedgerCat, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.today[cat] = (this.today[cat] ?? 0) + amount;
  }

  /** Roll the current day into the trailing window and start a fresh day. */
  endDay(): void {
    this.history.push(this.today);
    if (this.history.length > WINDOW) this.history.shift();
    this.today = {};
  }

  /** Number of days the average is drawn from (completed days, or the current
   *  partial day before any has completed so a young tower still shows figures). */
  private observedDays(): number {
    return Math.max(1, this.history.length);
  }

  /** Average $/day per category over the trailing window (net; sign preserved).
   *  Before any full day completes, reports the current day's running totals so
   *  a brand-new tower isn't all zeros. */
  averagePerDay(): Record<LedgerCat, number> {
    const out = {} as Record<LedgerCat, number>;
    for (const cat of LEDGER_CATS) out[cat] = 0;
    const source = this.history.length > 0 ? this.history : [this.today];
    const days = this.history.length > 0 ? this.observedDays() : 1;
    for (const day of source) {
      for (const cat of LEDGER_CATS) out[cat] += day[cat] ?? 0;
    }
    for (const cat of LEDGER_CATS) out[cat] /= days;
    return out;
  }

  /** True once any money at all has been recorded (so the UI can hide an empty
   *  breakdown on a freshly-founded tower). */
  hasData(): boolean {
    if (this.history.length > 0) return true;
    return Object.keys(this.today).length > 0;
  }

  /** Snapshot for save/load. */
  serialize(): { today: DayTotals; history: DayTotals[] } {
    return { today: { ...this.today }, history: this.history.map((d) => ({ ...d })) };
  }

  /** Restore from a snapshot, hardening every value against a hand-edited save. */
  static restore(data: unknown): Ledger {
    const l = new Ledger();
    if (!data || typeof data !== "object") return l;
    const d = data as { today?: unknown; history?: unknown };
    l.today = sanitizeDay(d.today);
    if (Array.isArray(d.history)) {
      l.history = d.history.slice(-WINDOW).map(sanitizeDay);
    }
    return l;
  }
}

/** Coerce untrusted save data into a clean {@link DayTotals} (finite numbers on
 *  known categories only). */
function sanitizeDay(raw: unknown): DayTotals {
  const out: DayTotals = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const cat of LEDGER_CATS) {
    const v = r[cat];
    if (typeof v === "number" && Number.isFinite(v)) out[cat] = v;
  }
  return out;
}
