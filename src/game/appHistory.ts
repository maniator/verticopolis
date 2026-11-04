import { UNDO_NOTHING_TO_STEP, UNDO_REFUSED, type EnginePort } from "../simport/enginePort";

interface HistoryApp {
  readonly enginePort: Pick<
    EnginePort,
    "undoCapture" | "undoCommit" | "undoDiscard" | "undoClear" | "undo" | "redo" | "undoNotice" | "lastReason"
  >;
  readonly ui: { toast(message: string, kind: "info"): void };
  /** Follow the restored tower, keeping the camera and the undo trail. */
  followSwap(keepHistory: boolean): void;
  /** Show how many steps the engine holds each way (the Undo and Redo
   *  buttons), after a call that may have changed them. */
  showSteps(): void;
}

/** The app's undo/redo history. The engine keeps the steps (the Rust engine's
 *  `undo.rs`); this forwards a gesture's capture, commit and discard, and
 *  follows a step the engine took the way the app follows any swap, keeping
 *  the trail. After each call that reaches the engine it shows the steps
 *  left, so the Undo and Redo buttons never wait for the HUD pump. The
 *  engine words the notice ("Undid: Bulldoze", "Nothing to undo.") and the
 *  reason it refused a step ("Not enough money to undo that."); both reach
 *  the player as a toast. Only an engine fault rejects. */
export interface AppHistory {
  capture(label: string): void;
  commit(): void;
  discard(): void;
  clear(): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The gesture under way: the number its capture gave it, or
   *  `NO_GESTURE` once it closed (a commit, a discard, a clear, an undo or
   *  a redo, or another capture over it). A drag keeps the number its press
   *  got and stops changing the tower when it no longer matches, since the
   *  engine records an edit only while its gesture is open. */
  gesture(): number;
}

/** What `gesture()` answers while no gesture is open. Captures count from 1. */
export const NO_GESTURE = 0;

/** What the toast says when the engine refused a step and gave no reason. */
const STEP_REFUSED_TEXT = "That step can't be taken right now.";

export function createAppHistory(app: HistoryApp): AppHistory {
  const step = (take: () => ReturnType<EnginePort["undo"]>): Promise<void> => {
    try {
      const rec = take();
      if (rec[0] === UNDO_REFUSED) {
        app.ui.toast(app.enginePort.lastReason() ?? STEP_REFUSED_TEXT, "info");
      } else {
        if (rec[0] !== UNDO_NOTHING_TO_STEP) app.followSwap(true);
        const notice = app.enginePort.undoNotice();
        if (notice !== undefined) app.ui.toast(notice, "info");
      }
      // Last, once the host follows the step, so the buttons read the tower
      // the player sees.
      app.showSteps();
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  };
  let captures = 0;
  let open = NO_GESTURE;
  const closing = <T>(close: () => T): T => {
    open = NO_GESTURE;
    return close();
  };
  /** Run the engine call `call`, then show the steps it left. */
  const shown = (call: () => unknown): void => {
    call();
    app.showSteps();
  };
  return {
    capture: (label) => {
      // A capture over a gesture still open keeps that gesture's step.
      app.enginePort.undoCapture(label);
      captures += 1;
      open = captures;
      app.showSteps();
    },
    commit: () => closing(() => shown(() => app.enginePort.undoCommit())),
    discard: () => closing(() => shown(() => app.enginePort.undoDiscard())),
    clear: () => closing(() => shown(() => app.enginePort.undoClear())),
    undo: () => closing(() => step(() => app.enginePort.undo())),
    redo: () => closing(() => step(() => app.enginePort.redo())),
    gesture: () => open,
  };
}
