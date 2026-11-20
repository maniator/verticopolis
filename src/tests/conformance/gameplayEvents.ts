import { checkEvent } from "@verticopolis/engine/events/gameplayCatalog";
import { GAMEPLAY_EVENT_RULES } from "@verticopolis/engine/events/gameplayEventRules";
import type { ScenarioEngine } from "./scenario";

/**
 * The gameplay events side of the conformance runner: what a checkpoint
 * drains and hashes (`conformance/README.md`, Checkpoints).
 */

// The catalog's enums and payload fields, as the components package ships
// them (generated from the engine's catalog), without its prose.
const catalog = GAMEPLAY_EVENT_RULES;

/** Drain an engine's gameplay events for hashing: none may have been pushed
 *  out of a full ring (the scenario must checkpoint more often), and each
 *  must be one the catalog describes, so a payload that drifts from the
 *  contract fails here by name, before it shows up as a moved hash. */
export function drainChecked(e: ScenarioEngine): unknown[] {
  if (e.eventsDropped() > 0)
    throw new Error("more than the ring's worth of gameplay events between two checkpoints; checkpoint more often");
  const events = e.drainEvents();
  for (const ev of events) checkEvent(catalog, ev);
  return events;
}
