import { pageLifeId } from "./analyticsEngineStatus";

/**
 * Which tower of this page life a funnel event belongs to (#2392). The
 * first-tower funnel (`new_game_started`, then `first_build`, then
 * `star_reached`) carries `tower_n` and `page_life`, so a reader can count it
 * per tower: a second tower's stars can no longer finish the first tower's
 * funnel just because one tab played both.
 *
 * The number is an ordinal held in memory for the page life and never stored,
 * so a reload starts it over; `page_life` (the same in-memory id the engine
 * status rows carry) keeps two page lives of one tab apart. Neither can link a
 * page life to another visit, a device or a person.
 *
 * It moves on to the next tower on every tower the game takes up: another
 * tower the app follows (a New, an Open, an import) and each founding the
 * engine reports, sent or held back by the rate limit. One New moves it twice
 * (the app follows the new tower, then its founding drains), so the numbers
 * have gaps; only equality matters. Events drained after a swap but made by
 * the tower before it land on a number no founding carries, so they finish no
 * funnel. An undo or redo step is the same tower and keeps the number.
 */

/** The highest number sent. It stands for "this tower or a later one", so a
 *  per-tower count leaves it out; no real tab reaches it. */
export const TOWER_N_CAP = 50;

let towerN = 1;

/** The game took up another tower: later funnel events belong to it. */
export function nextAnalyticsTower(): void {
  if (towerN < TOWER_N_CAP) towerN += 1;
}

/** The funnel events' tower fields. */
export function analyticsTowerProps(): { tower_n: number; page_life: string } {
  return { tower_n: towerN, page_life: pageLifeId() };
}

/** Test hook: start the page life's count over. */
export function resetAnalyticsTower(): void {
  towerN = 1;
}
