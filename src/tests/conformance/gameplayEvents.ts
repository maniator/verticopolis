import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalog, checkEvent } from "../../engine/gameplayCatalog";
import type { ScenarioEngine } from "./scenario";

/**
 * The gameplay events side of the conformance runner: what a checkpoint
 * drains and hashes (`conformance/README.md`, Checkpoints).
 */

// Resolved from this file: scenario.ts imports this module, so its
// CONFORMANCE_DIR is not set yet when this runs.
const CATALOG = resolve(dirname(fileURLToPath(import.meta.url)), "../../../conformance/events/catalog.json");
const catalog = checkCatalog(JSON.parse(readFileSync(CATALOG, "utf8")));

/** Drain an engine's gameplay events for hashing: none may have been pushed
 *  out of a full ring (the scenario must checkpoint more often), and each
 *  must be one the catalog describes, so a payload that drifts from the
 *  contract fails here by name, before it shows up as a moved hash. */
export function drainChecked(e: ScenarioEngine): unknown[] {
  if (e.eventsDropped() > 0) throw new Error("more than the ring's worth of gameplay events between two checkpoints; checkpoint more often");
  const events = e.drainEvents();
  for (const ev of events) checkEvent(catalog, ev);
  return events;
}

