import type { CalendarKind } from "../engine/calendar";
import type { GameplayEvent } from "../engine/gameplayEventBuffer";
import type { GameMode, SerializedView } from "../engine/types";
import type { Command, CommandResult } from "./commands";
import type { Query, QueryResult } from "./queries";
import type { SimView } from "./view";

export type SaveOptions = {
  /** Stamp the live view onto the sim before a save or export. */
  view?: () => SerializedView | null;
};

export type TowerSource =
  | { from: "history"; text: string }
  | { from: "stored"; saves: string[] }
  | { from: "legacy"; save: string }
  | {
      from: "found";
      seed: number;
      mode: GameMode;
      calendar?: CalendarKind;
      unbridged?: boolean;
    };

/**
 * The one interface the game drives the simulation through (spine AD-9; the
 * facade review's 5.1). An adapter over the TypeScript `Simulation`
 * (`createTsSim`) and, from slice 7, one over the Rust engine implement it,
 * so the code above it does not know which engine runs the tower.
 *
 * Ordering, which every adapter keeps:
 * - Commands, queries and saves are asynchronous so a worker can host the
 *   engine. They run in the order they were issued, and a command's effect
 *   is on `view` once its promise settles.
 * - `tick` and `drainEvents` are synchronous. They act after every command
 *   issued before them: an adapter that applies commands later applies the
 *   earlier ones first.
 * - A save holds everything issued before it. On a host that steps in the
 *   background it is taken once the host has caught up, so it may also hold
 *   steps and commands issued after it.
 * - A caller that reads `view` right after issuing a command awaits the
 *   command first. The TypeScript adapter applies a command at once, so code
 *   that skips the await works there and breaks on a worker.
 * - The lifecycle members below are for main-thread adapters only. They are
 *   sharp in the TypeScript host because the live tower is already in memory,
 *   but a worker host cannot answer them synchronously without a queued
 *   checkpoint or a stale restore point.
 */
export interface SimPort {
  /** The tower's current generation, so a load or replacement can be tracked. */
  readonly generation: number;
  /** Replace the live tower from a saved or newly founded source. */
  load(source: TowerSource): Promise<void>;
  /** The current state, read-only. Valid until the next tick or command. */
  readonly view: SimView;
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
  /** Write the tower's save as JSON right now, without waiting for a step gate. */
  saveNow(opts?: SaveOptions): string;
  /** The tower's save, as the engine-format JSON the game stores. */
  save(opts?: SaveOptions): Promise<string>;
  /** The fingerprint of the current player-mutable state. */
  undoSignature(): string;
  /** Every gameplay event since the last drain, oldest first. On the WASM
   *  host a command's events wait for the next restore point; `release`
   *  hands them over now, for the flush when the page closes. */
  drainEvents(opts?: { release?: boolean }): GameplayEvent[];
}
