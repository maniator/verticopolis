import type { GameplayEvent } from "../engine/gameplayEventBuffer";
import type { Command, CommandResult } from "./commands";
import type { Query, QueryResult } from "./queries";
import type { SimView } from "./view";

/**
 * The one interface the game drives the simulation through (spine AD-9; the
 * facade review's 5.1). An adapter over the TypeScript `Simulation`
 * (`createTsSim`) and, from slice 7, one over the Rust engine implement it,
 * so the code above it does not know which engine runs the tower.
 *
 * Reads are synchronous: `view` is what the renderer and the HUD draw from.
 * Commands, queries and saves are asynchronous so a worker can host the
 * engine, and they run in the order they were issued. A command's effect is
 * on `view` once its promise settles.
 *
 * Not here yet: `load` (slice 5, the lifecycle) and the engine's change
 * counter (slice 6a). Their first callers arrive with those slices, and the
 * TypeScript adapter could not give them today's behavior exactly.
 */
export interface SimPort {
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
   *  `undefined` before the first. It may be out of date: ask again. */
  cached<Q extends Query>(q: Q): QueryResult<Q> | undefined;
  /** The tower's save, as the engine-format JSON the game stores. */
  save(): Promise<string>;
  /** Every gameplay event since the last drain, oldest first. */
  drainEvents(): GameplayEvent[];
}
