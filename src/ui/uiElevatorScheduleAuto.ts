import type { AutoTuneProposal } from "@verticopolis/engine/port/enginePort";
import type { SchedState } from "./templates/elevatorSchedule";

/**
 * Applying the engine's Auto-tune proposal to the dialog's working copy:
 * the one-time Auto-tune button and the Auto checkbox (Modern, daily
 * re-tune; owner, 2026-11-17) both fill the rows this way, so the grid shows
 * what the engine will run. The engine owns the tuning; this only copies its
 * answer in.
 */

/** Copy `res`'s rows, and its staging when `takeHomes`, into `schedule`. A
 *  day the engine left untuned (its ring unmeasured, #466) keeps its own
 *  working row; falling back to the visible day would copy it across. The
 *  Auto-tune button and the Auto checkbox take the staging only when the
 *  player has set none; the morning re-tune never changes it.
 *  Answers the day types that were tuned, or `null` when the engine
 *  proposed nothing. */
export function fillFromProposal(
  schedule: SchedState["schedule"],
  res: AutoTuneProposal,
  fullRow: () => number[],
  takeHomes = true,
): string[] | null {
  const p = res.proposal;
  if (res.status !== "available" || !p) return null;
  schedule.activeCars = {
    weekday: p.weekday ? [...p.weekday] : [...(schedule.activeCars?.weekday ?? fullRow())],
    weekend: p.weekend ? [...p.weekend] : [...(schedule.activeCars?.weekend ?? fullRow())],
  };
  if (takeHomes) schedule.homeFloors = [...p.homeFloors];
  return [res.weekday.warm ? "weekday" : null, res.weekend.warm ? "weekend" : null].filter(
    (d): d is string => d !== null,
  );
}

/** The announcement for a fill: name the days actually tuned, since on a
 *  cold Weekend tab a blanket "auto-tuned" would claim a change the visible
 *  row never shows (#466). */
export function tunedAnnouncement(days: readonly string[]): string {
  return `Auto-tuned the ${days.join(" and ")} ${days.length > 1 ? "schedules" : "schedule"} and staging to measured demand.`;
}

/** What the Auto checkbox announces when it changes. */
export function autoAnnouncement(on: boolean): string {
  return on
    ? "Auto on. The car counts re-tune every morning from measured traffic."
    : "Auto off. The car counts stay as you set them.";
}
