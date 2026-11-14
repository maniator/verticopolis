import type { SimView } from "../simport/view";

/**
 * The Bulletin's first line when a tower arrives with no messages (party,
 * 2026-11-14). A loaded tower shows the log lines its save carried; one that
 * carried none (an older save, or a tower whose log was still empty) used to
 * open on a blank Bulletin. This line is the game's, not the engine's: the UI
 * writes it after it rebuilds the log (`uiStatus.resetLog`), only when that
 * log is empty, so it is never saved.
 *
 * Cost: two array lengths and one string, once per tower swap.
 */

/** How the tower arrived: through a load, an import or a new tower, or on a
 *  page reload of the tower the player left. */
export type Arrival = "entered" | "returned";

/** The line for a tower that just arrived. An empty lot is a tower just
 *  founded; any other is one loaded or, on a reload, the one the player left.
 *  The name is plain text (the Bulletin never parses a line as markup). */
export function arrivalLine(sim: Pick<SimView, "rooms" | "structure" | "tower">, arrival: Arrival): string {
  const name = sim.tower.towerName.trim();
  if (sim.rooms.length === 0 && sim.structure.length === 0) return `${name || "Your tower"} is open for business.`;
  const tower = name || "your tower";
  return arrival === "returned" ? `Welcome back to ${tower}.` : `Loaded ${tower}.`;
}
