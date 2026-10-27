import type { CalendarKind } from "../engine/calendar";
import type { GameplayEvent } from "../engine/gameplayEventBuffer";
import type { GameMode, SerializedGame, SerializedView } from "../engine/types";
import type { Command, CommandResult } from "./commands";
import type { Query, QueryResult } from "./queries";
import type { SimView } from "./view";

/**
 * Where a loaded tower comes from. Every source but `history` replaces the
 * tower and clears the undo history.
 * - `history`: an undo or a redo step, the text `saveNow` returned. The
 *   tower keeps the undo history, the camera and the live auto-bridge
 *   setting.
 * - `stored`: saves the game wrote and read back (the autosave and its
 *   legacy key, a slot, a `.vctower` file), tried in order. The first that
 *   loads becomes the tower; when none does, the load rejects with the first
 *   error. A save with no `appVersion` stamp predates 2.0, so its tower is a
 *   founder's.
 * - `legacy`: a 1994 `.TDT` import, already read and checked. No founder
 *   rule.
 * - `found`: a new tower under the chosen rule set.
 */
export type TowerSource =
  | { from: "history"; text: string }
  | { from: "stored"; saves: readonly SerializedGame[] }
  | { from: "legacy"; save: SerializedGame }
  | { from: "found"; seed: number; mode: GameMode; calendar: CalendarKind; unbridged: boolean };

export interface SaveOptions {
  /** The live camera, read right before the tower is written. A null keeps
   *  the view the tower already carries. */
  view?: () => SerializedView | null;
  /** The copy never leaves the page (an undo or a redo step), so the adapter
   *  may hand over its engine's own text. Without it the text is in the form
   *  the game's stored saves take. */
  memory?: boolean;
}

/**
 * The one interface the game drives the simulation through (spine AD-9; the
 * facade review's 5.1). An adapter over the TypeScript `Simulation`
 * (`createTsSim`) and, from slice 7, one over the Rust engine implement it,
 * so the code above it does not know which engine runs the tower.
 *
 * Ordering, which every adapter keeps:
 * - Commands, queries, loads and saves are asynchronous so a worker can host
 *   the engine. They run in the order they were issued, and a command's or a
 *   load's effect is on `view` once its promise settles.
 * - `tick`, `drainEvents`, `saveNow` and `undoSignature` are synchronous.
 *   They act after every command and load issued before them: an adapter
 *   that applies commands later applies the earlier ones first.
 * - A save holds everything issued before it. On a host that steps in the
 *   background it is taken once the host has caught up, so it may also hold
 *   steps and commands issued after it.
 * - A caller that reads `view` right after issuing a command awaits the
 *   command first. The TypeScript adapter applies a command at once, so code
 *   that skips the await works there and breaks on a worker.
 *
 * `saveNow` and `undoSignature` answer at once and current, so only an
 * adapter that runs the engine on the main thread can keep them (`TsSim`,
 * slice 7's `RustSim`). A worker adapter cannot: it needs an in-order
 * primitive in their place, which slice 12 (#1224) owes, and it must never
 * answer them from a stale restore point (the slice 5 story, D2).
 */
export interface SimPort {
  /** The current state, read-only. Valid until the next tick or command. */
  readonly view: SimView;
  /** Which tower the port holds. It moves on every load (undo and redo
   *  included) and on any swap the adapter sees, and stays across commands
   *  and ticks. */
  readonly generation: number;
  /** Advance the game clock by `dtMinutes`, the frame loop's step. */
  tick(dtMinutes: number): void;
  /** Run a player command. A refusal resolves with `ok: false`; the promise
   *  rejects only when the engine itself fails. */
  command<C extends Command>(c: C): Promise<CommandResult<C>>;
  /** Ask the engine a question it decides. */
  query<Q extends Query>(q: Q): Promise<QueryResult<Q>>;
  /** The last answer to an equal query, for a reader that cannot wait;
   *  `undefined` when there is none. It may be out of date, so ask again.
   *  Answers about a replaced tower are dropped, and the adapter may drop
   *  the least recently used placement answers. */
  cached<Q extends Query>(q: Q): QueryResult<Q> | undefined;
  /** Replace the tower (see {@link TowerSource}). A load that fails rejects
   *  and leaves the tower as it was. */
  load(source: TowerSource): Promise<void>;
  /** The tower's save, as the engine-format JSON the game stores. */
  save(opts?: SaveOptions): Promise<string>;
  /** The tower's save taken now, for a caller that reads it in the task
   *  that needs it (an undo step, the context-loss flush, the crash report).
   *  Main-thread adapters only; every other caller awaits `save`. */
  saveNow(opts?: SaveOptions): string;
  /** A fingerprint of everything a player can change and undo: every unit
   *  (floor and lobby tiles included), every transport and the money. Equal
   *  exactly when none of it changed. Main-thread adapters only. */
  undoSignature(): string;
  /** Every gameplay event since the last drain, oldest first. On the WASM
   *  host a command's events wait for the next restore point; `release`
   *  hands them over now, for the flush when the page closes. */
  drainEvents(opts?: { release?: boolean }): GameplayEvent[];
}
