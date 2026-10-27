import type { Simulation } from "../../engine/Simulation";
import { towerCatalog } from "../../engine/towerCatalog";
import { createTsSim } from "../../simport/tsSim";
import { statsScreen, statsTemplate, type StatsScreen } from "./stats";
import type { TemplateResult } from "lit-html";

/** What the stats modal draws for `sim`, asked through the TypeScript
 *  adapter as the game asks it (`showStats`), so a template test draws the
 *  port's own answer. */
export async function statsScreenOf(sim: Simulation): Promise<StatsScreen> {
  const port = createTsSim(() => sim);
  return statsScreen(await port.query({ op: "statsReport" }), port.view, towerCatalog(sim));
}

/** The stats modal body for `sim`, drawn from the port's answer. */
export async function statsBodyOf(sim: Simulation): Promise<TemplateResult> {
  return statsTemplate(await statsScreenOf(sim));
}
