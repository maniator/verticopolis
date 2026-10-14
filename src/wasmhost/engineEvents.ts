import type { GameplayEvent } from "../engine/gameplayEvents";
import type { WasmEngine } from "../dualrun/binding";

/** One batch drained from the engine: the events read, and how many were
 *  lost because the batch's text could not be read. */
export interface EngineBatch {
  events: GameplayEvent[];
  lost: number;
}

/**
 * Drain the engine's gameplay events and parse them (#907). The binding hands
 * the batch over as JSON text and empties its buffer before anyone reads it,
 * so a batch that does not parse is gone either way: it comes back as no
 * events, with `lost` the number the engine held just before the drain, for
 * the caller to add to its drop count. An engine that throws (a trap) still
 * throws. The events are not checked against the catalog here; the analytics
 * bridge does that at egress.
 */
export function drainEngineBatch(engine: Pick<WasmEngine, "drainGameplayEvents" | "gameplayEventsPending">): EngineBatch {
  const pending = engine.gameplayEventsPending();
  const text = engine.drainGameplayEvents();
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return { events: parsed as GameplayEvent[], lost: 0 };
  } catch {
    // Unreadable: counted as lost below.
  }
  return { events: [], lost: pending };
}
