import type { TemplateResult } from "lit-html";
import { portOf } from "../../game/cardKit.fixture";
import { catalogOf, newViewReader } from "../../game/portAccess";
import { PortCodes } from "../../simport/portCodes";
import { statsReport } from "../../simport/statsSheet";
import type { Draft } from "../../tests/portKit/drafts";
import { statsScreen, statsTemplate, type StatsScreen } from "./stats";

/** What the stats modal draws for the draft, read through its engine's port
 *  as the game reads it (`showStats`), so a template test draws the Rust
 *  engine's own answer. */
export function statsScreenOf(sim: Draft): StatsScreen {
  const port = portOf(sim);
  const reader = newViewReader(port);
  const report = statsReport(port.statsSheet(), new PortCodes(port));
  return statsScreen(report, reader, catalogOf({ enginePort: port, reader }));
}

/** The stats modal body for the draft, drawn from the engine's answer. */
export function statsBodyOf(sim: Draft): TemplateResult {
  return statsTemplate(statsScreenOf(sim));
}
