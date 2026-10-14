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
 * so whatever cannot be read is gone either way. `lost` counts it against the
 * number the engine held just before the drain: all of them for text that
 * does not parse or is not a list, and otherwise any the list falls short by,
 * including entries that are not shaped like an event (an object with a
 * string `name`), which are left out so they never take a ring slot. An engine
 * that throws (a trap) still throws. Payloads are not checked against the
 * catalog here; the analytics bridge does that at egress.
 */
export function drainEngineBatch(engine: Pick<WasmEngine, "drainGameplayEvents" | "gameplayEventsPending">): EngineBatch {
  const pending = engine.gameplayEventsPending();
  const text = engine.drainGameplayEvents();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { events: [], lost: pending };
  }
  if (!Array.isArray(parsed)) return { events: [], lost: pending };
  const events = parsed.filter(isEventShaped);
  return { events, lost: Math.max(0, pending - events.length) };
}

function isEventShaped(entry: unknown): entry is GameplayEvent {
  return typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string";
}
