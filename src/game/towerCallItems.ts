import type { GameApp } from "../main";
import { statsReport } from "@verticopolis/engine/port/statsSheet";
import { canCallExterminator } from "../ui/templates/stats";
import { catalogOf } from "./portAccess";
import type { MenuEntryState } from "./menuBarHost";

/**
 * The Tower menu's two calls for help (party 2026-11-15,
 * `_bmad-output/party-mode/menu-bar-order-party-findings-2026-11-15.md`):
 * Call Fire Rescue… is lit only while a fire burns, no choice already
 * waits and no helicopter is already on its way, the cases the engine
 * accepts it in (`call_fire_rescue`).
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
  const header = app.reader.header;
  const choiceWaiting = header.pendingChoice !== null || (header.fireResponse?.helicopter ?? null) !== null;
  if (catalog.economy.exterminator === null) {
    const fires = app.portCodes.slot(app.enginePort.statsStrip(), "statsStrip", "fires");
    return { fireRescue: fires > 0 && !choiceWaiting, exterminator: null };
  }
  const report = statsReport(app.enginePort.statsSheet(), app.portCodes);
  return { fireRescue: report.stats.fires > 0 && !choiceWaiting, exterminator: canCallExterminator(report, catalog) };
}

/** Fire Rescue grayed unless it can be called, and the exterminator grayed
 *  the same way and shown only where the rules have one. */
export function towerCallStates(calls: TowerCalls): Record<string, MenuEntryState> {
  return {
    [TOWER_CALL_ITEM.fireRescue]: { disabled: !calls.fireRescue },
    [TOWER_CALL_ITEM.exterminator]: { disabled: calls.exterminator !== true, hidden: calls.exterminator === null },
  };
}
