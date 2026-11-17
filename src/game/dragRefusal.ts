import { trackAppAction } from "../analyticsActions";
import type { LogEntry } from "../shared/types";

/**
 * Why a drag stopped, said once when it is let go. A drag's steps keep their
 * refusals quiet while it moves, so a bulldoze sweep across tiles the engine
 * keeps (load-bearing floor, Classic's floor-end rule) does not repeat a toast
 * and an error sound for each one (#2046), and an elevator extend that stops
 * short of a floor the engine refuses keeps following the pointer (#1847).
 * The drag holds the latest reason instead, and its release says it with the
 * error sound and toast a refused press uses, and counts it as the
 * `drag_stopped` app action (docs/analytics-data-map.md).
 */

/** Which drag said why it stopped: the `drag_stopped` action's `detail`. */
export type StoppedDrag = "extend" | "bulldoze";

/** A drag that may hold a refusal. */
export interface HeldRefusal {
  /** The latest refusal a step of the drag met, until the release says it. */
  stoppedBy?: string;
  /** The refusal the press already said, which the release does not repeat. */
  said?: string;
}

/** What saying the reason needs. */
export interface DragRefusalDeps {
  readonly audio: { sfx(name: "error"): void };
  readonly ui: { toast(text: string, kind: LogEntry["kind"]): void };
}

/** A sink for a drag step's refusal that keeps it on `drag`. */
export function holdRefusal(drag: HeldRefusal): (reason: string) => void {
  return (reason) => {
    drag.stoppedBy = reason;
  };
}

/** A sink for the press that starts a drag: it says the refusal at once, as
 *  a refused press always has, and notes it so the release does not say the
 *  same words again. */
export function sayPressRefusal(deps: DragRefusalDeps, drag: HeldRefusal): (reason: string) => void {
  return (reason) => {
    drag.said = reason;
    say(deps, reason);
  };
}

/** Say the reason `drag` holds, once: the error sound and a toast, counted
 *  as `drag_stopped` with `what`. A drag that holds none, or only what its
 *  press already said, says nothing. */
export function sayHeldRefusal(deps: DragRefusalDeps, drag: HeldRefusal, what: StoppedDrag): void {
  const reason = drag.stoppedBy;
  drag.stoppedBy = undefined;
  if (reason === undefined || reason === drag.said) return;
  say(deps, reason);
  trackAppAction("drag_stopped", what);
}

function say(deps: DragRefusalDeps, reason: string): void {
  deps.audio.sfx("error");
  deps.ui.toast(reason, "bad");
}
