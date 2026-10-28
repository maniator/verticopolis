import { facilityFloors } from "../../engine/facilities";
import { TsEngine } from "../../engine/port/tsEngine";
import type { Simulation } from "../../engine/Simulation";
import { towerCatalog } from "../../engine/towerCatalog";
import { PortCodes } from "../../simport/portCodes";
import { statsReport } from "../../simport/statsSheet";
import { ViewReader } from "../../simport/viewReader";
import { statsScreen, statsTemplate, type StatsScreen } from "./stats";
import type { TemplateResult } from "lit-html";

/** What the stats modal draws for `sim`, read through the engine port as the
 *  game reads it (`showStats`), so a template test draws the port's own
 *  answer. */
export async function statsScreenOf(sim: Simulation): Promise<StatsScreen> {
  const port = new TsEngine(sim);
  const report = statsReport(port.statsSheet(), new PortCodes(port));
  return statsScreen(report, new ViewReader(port, facilityFloors), towerCatalog(sim));
}

/** The stats modal body for `sim`, drawn from the port's answer. */
export async function statsBodyOf(sim: Simulation): Promise<TemplateResult> {
  return statsTemplate(await statsScreenOf(sim));
}
