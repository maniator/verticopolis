import type { CatalogRules } from "../catalog/catalogTypes";

/**
 * What the elevator schedule dialog (#305) shows, decided from the engine's
 * catalog rather than from the game mode's name: which assisted tools it
 * offers and which origin floors it marks. The engine answers each assisted
 * query only where the catalog's `rules.scheduleAssist` says so.
 */

/** The authoring tools the dialog shows (Phase 3). Classic offers the raw
 *  grid outright and no assisted tool (1994 fidelity: advice withheld,
 *  information not); Modern offers the presets, auto-tune and the advice
 *  line, with the raw grid behind Advanced. */
export interface ElevatorScheduleUX {
  /** The Rush, Balanced and Feeder intent presets. */
  readonly presets: boolean;
  /** Auto-tune from the measured load. */
  readonly autoTune: boolean;
  /** The raw manual grid shown outright (true) or behind Advanced (false). */
  readonly rawGridDefault: boolean;
  /** The "over-staffed 09-11, short at 17" advice line. */
  readonly advice: boolean;
}

/** The dialog's tools, from the rules a tower's catalog states. */
export function scheduleDialogUX(rules: Pick<CatalogRules, "scheduleAssist">): ElevatorScheduleUX {
  const assist = rules.scheduleAssist;
  return { presets: assist, autoTune: assist, advice: assist, rawGridDefault: !assist };
}

/** How many origin floors the dialog marks at most, and the least share of
 *  an hour's boardings a floor needs to be marked. Which floors get a marker
 *  is presentation of the engine's measured origins: the Rust engine applies
 *  no share threshold of its own. */
export const HOTSPOT_FLOORS = 3;
export const HOTSPOT_MIN_SHARE = 0.15;

/**
 * The origin floors the dialog marks for one hour's boarding counts, busiest
 * first: each floor with at least {@link HOTSPOT_MIN_SHARE} of the hour's
 * boardings, at most {@link HOTSPOT_FLOORS}, a tie going to the lower floor.
 * Empty when the hour has no measured boardings, so a caller can gate the
 * markers on its length.
 */
export function hotspotFloors(slot: ReadonlyMap<number, number> | undefined): number[] {
  if (!slot || slot.size === 0) return [];
  let total = 0;
  for (const n of slot.values()) total += n;
  if (total <= 0) return [];
  return [...slot.entries()]
    .filter(([, n]) => n / total >= HOTSPOT_MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, HOTSPOT_FLOORS)
    .map(([floor]) => floor);
}
