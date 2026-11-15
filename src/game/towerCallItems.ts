import type { GameApp } from "../main";
import { statsReport } from "../simport/statsSheet";
import { canCallExterminator } from "../ui/templates/stats";
import { catalogOf } from "./portAccess";

/**
 * The Tower menu's two calls for help (party 2026-11-15,
 * `_bmad-output/party-mode/menu-bar-order-party-findings-2026-11-15.md`):
 * Call Fire Rescue… is lit only while a fire burns and no choice already
 * waits, the two cases the engine accepts it in (`call_fire_rescue`).
 * Call Exterminator… is Modern only: left out of a Classic tower's menu,
 * which has no exterminator, and lit in a Modern one only when a hotel room
 * is infested and no crew is booked yet, the rule the button in Tower
 * Statistics follows (`canCallExterminator`).
 *
 * Read once as the Tower menu opens, never per frame: a Classic tower asks
 * the HUD strip for its fire count, and a Modern one asks the stats sheet
 * the Statistics window reads, which also holds the infested count and the
 * booked crew (about half a millisecond on the maxed Modern tower).
 */

/** The menu items, by id. */
export const TOWER_CALL_ITEM = {
  fireRescue: "mb-fire-rescue",
  exterminator: "mb-exterminator",
} as const;

/** What the Tower menu shows for the two calls. `exterminator` is null when
 *  the tower's rules have no exterminator (Classic). */
export interface TowerCalls {
  readonly fireRescue: boolean;
  readonly exterminator: boolean | null;
}

type CallsApp = Pick<GameApp, "enginePort" | "portCodes" | "reader">;

/** Which calls the tower in play can make now. */
export function towerCalls(app: CallsApp): TowerCalls {
  const catalog = catalogOf(app);
  const choiceWaiting = app.reader.header.pendingChoice !== null;
  if (catalog.economy.exterminator === null) {
    const fires = app.portCodes.slot(app.enginePort.statsStrip(), "statsStrip", "fires");
    return { fireRescue: fires > 0 && !choiceWaiting, exterminator: null };
  }
  const report = statsReport(app.enginePort.statsSheet(), app.portCodes);
  return { fireRescue: report.stats.fires > 0 && !choiceWaiting, exterminator: canCallExterminator(report, catalog) };
}

function lit(item: HTMLElement | null, on: boolean): void {
  if (!item) return;
  if (on) item.removeAttribute("aria-disabled");
  else item.setAttribute("aria-disabled", "true");
}

/** Gray or light the two items, and show the exterminator only where the
 *  rules have one. */
export function showTowerCalls(calls: TowerCalls, doc: Document = document): void {
  lit(doc.getElementById(TOWER_CALL_ITEM.fireRescue), calls.fireRescue);
  const exterminator = doc.getElementById(TOWER_CALL_ITEM.exterminator);
  if (!exterminator) return;
  exterminator.hidden = calls.exterminator === null;
  lit(exterminator, calls.exterminator === true);
}
