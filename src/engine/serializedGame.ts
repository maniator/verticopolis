// Type-only imports (erased at compile), mirroring the calendar.ts pattern:
// types.ts re-exports SerializedGame back so the 16-odd importers of the wire
// format keep their single "./types" doorway.
import type { CalendarKind } from "./calendar";
import type { GameMode, LogEntry, SerializedUnit, SerializedView, Transport } from "./types";

/**
 * The save-file wire format: what `Simulation.serialize()` writes and
 * `deserialize()` hardens on the way back in. Split from types.ts when that
 * file hit the size ceiling; import it from "./types" as before.
 */
export interface SerializedGame {
  version: number;
  seed: number;
  /** The RNG stream's founding seed (see RNG.initialSeed). Optional: saves
   *  written before it existed fall back to `seed` on load, which is just as
   *  stable an identity for an already-written file. */
  initialSeed?: number;
  money: number;
  star: number;
  minutes: number;
  /** Rule-set the tower was founded under. Absent in saves written before the
   *  mode fork (and never mutated after creation), so a missing value loads as
   *  `classic` — every legacy tower stays pixel-faithful with no migration. */
  mode?: GameMode;
  /** A Modern tower's calendar choice (`canon` short vs `realWorld` length),
   *  made at New Tower. Ignored for Classic (always canon). Absent on saves
   *  written before the calendar toggle, and on all legacy Modern saves, so a
   *  missing value loads as `realWorld` — the shipped 7/90/360 behavior. */
  modernCalendar?: CalendarKind;
  /** LEGACY: the former Modern "manual structure" option. No longer written; read
   *  only for migration, where a `true` loads the tower with bridging off (that
   *  option became the founding "no bridging" default). Rooms auto-lay their floor
   *  in every tower now, so the old "rooms won't auto-floor" behavior is retired. */
  manualStructure?: boolean;
  /** "Bridge floors between placements" toggle, flipped mid-game. Written only
   *  when turned OFF (default on), so an absent value loads as on, the shipped
   *  behavior that fills the walkway to a neighbor. Ignored for Classic (always
   *  on): a forged `false` on a Classic save is clamped back to on. */
  autoBridge?: boolean;
  /** Balance entering the current quarter (snapshotted at each quarter rollover
   *  before rent is collected), so the TDT exporter can write the header's
   *  `lastQuarterMoney` (0x10). `serialize()` always writes it (0 on a fresh
   *  tower that has not crossed a quarter boundary yet); only legacy saves
   *  written before this field omit it, and those load as 0. */
  lastQuarterMoney?: number;
  units: SerializedUnit[];
  transports: Transport[];
  nextId: number;
  towerName: string;
  builtWeddingHall: boolean;
  evaluatedTower: boolean;
  /** Scheduled day of the pending VIP inspection (-1 if none). Optional for
   * backward compatibility with saves written before it was persisted. */
  vipVisitDay?: number;
  /** Whether a VIP has given a favorable suite review (a 4★ gate). */
  vipFavorable?: boolean;
  /** How many VIP visits the player has been told about (suite stays, drive-offs,
   * TOWER inspections). Optional: saves written before the counter load as 0,
   * except that a favorable review implies at least one visit (a won tower two). */
  vipVisits?: number;
  /** Day of the last unfavorable-VIP bulletin, persisted so a save/reload can't
   * reopen the 5-day nag window early (which would also inflate `vipVisits`).
   * Optional: older saves load as -100, the fresh-tower default. */
  lastVipNagDay?: number;
  /** Seasonal-event state (Santa guard + dedicated RNG position). Optional for
   * backward compatibility with saves written before it was persisted. */
  events?: {
    lastSantaYear: number;
    rngState: number;
    pending?: { kind: "fireRescue" | "bombThreat"; cost: number; message: string } | null;
  };
  /** Buried-treasure finds so far (capped), persisted so reload can't reset it. */
  treasuresFound?: number;
  /** Modern only: the day a booked exterminator's treatment lands (persisted). */
  exterminationDueDay?: number;
  /** Basement tiles already excavated ("floor:x"), so buried treasure stays a
   * one-time find per tile across save/reload. Optional for older saves. */
  excavated?: string[];
  /** Cinema unit ids showing a blockbuster this month (paid at booking), so a
   * mid-month reload keeps the boost. Optional for older saves. */
  blockbusters?: number[];
  /** Ids of optional milestones already achieved, so reload doesn't
   * re-announce them. Optional for older saves. */
  milestones?: string[];
  /** Rolling income/expense ledger for the stats breakdown (today's running
   * totals + the trailing per-day window). Optional for pre-ledger saves. */
  ledger?: unknown;
  /** Where the player was looking when the save was written (see
   * {@link SerializedView}). Stamped by the UI layer at save/export time;
   * absent in older saves and fresh towers, which load centered as before. */
  view?: SerializedView;
  /** When this save was WRITTEN (epoch ms). Provenance of the file, not live
   * state: the storage layer stamps it on every write (localStorage and
   * .vctower alike), the engine never writes or reads it, and deserialize
   * does not carry it onto the sim (the next write re-stamps). */
  savedAt?: number;
  /** Which build wrote this save (the Vite-injected app version). Same
   * write-time provenance contract as {@link savedAt}: stamped by the
   * storage layer, inert on load, useful for debugging a moved file. */
  appVersion?: string;
  /** The tail of the bulletin log (newest last, capped at LOG_SAVE_CAP in
   * Simulation.ts), so a loaded tower keeps its message history instead of
   * opening with an empty panel. Absent in older saves (empty log). */
  log?: LogEntry[];
}
