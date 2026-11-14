import { trackAppActionOnce } from "../analytics";
import { SAVE_WARNING_TITLE, saveFailureMessage, saveWarningText } from "../storage/saveFailureCopy";
import type { UI } from "../ui/UI";

/** The notice that stays up while saving is not working (src/ui/saveWarning.ts). */
export interface SaveWarningSurface {
  /** Put the notice up, or reword the one already up. */
  show(text: string): void;
  /** Take the notice down, if it is up. */
  clear(): void;
}

/** What the notice reaches: the toast rail, and the notice itself when the
 *  app wired one (headless tests leave it out). */
export interface SaveNoticeDeps {
  ui: Pick<UI, "toast" | "sayVisibly">;
  saveWarning?: SaveWarningSurface;
}

/**
 * What the player hears when saves fail, and when they work again. Analytics
 * showed autosaves failing on brand-new towers, where a blocked or full store
 * (a private window, site storage turned off) costs the whole tower on the
 * next visit. A 3.6-second toast was the only sign, so the failure now raises
 * a notice that stays up until it is dismissed or saving works again, with
 * the likely causes and an Export button.
 *
 * The notice goes up once per run of failures: the autosave fails every 30
 * seconds on a full store, and repeating it each tick would be noise. A
 * notice the player dismissed stays dismissed until a save works and a later
 * one fails. A save the player asked for (Quick Save, a slot) also toasts
 * every time, because they acted and are waiting for an answer.
 */
export class SaveFailureNotice {
  /** The notice is up, or was dismissed, for the current run of failures. */
  private warned = false;

  /** `deps` is read at each call, so the owner can build this before its own
   *  fields are assigned. */
  constructor(private readonly deps: () => SaveNoticeDeps) {}

  /** A slot save the player asked for failed: a line only, said inside the
   *  Saved Towers dialog the save came from (a toast would sit behind it).
   *  A slot is a separate copy, so a full store can refuse a slot while the
   *  autosave, written in place, still fits; the notice would then claim the
   *  tower is not being saved when it is. Storage blocked outright fails the
   *  autosave too, and that raises the notice. */
  slotFailed(err: unknown): void {
    trackAppActionOnce("autosave_failed", "manual");
    this.deps().ui.sayVisibly(saveFailureMessage(err));
  }

  /** A Quick Save failed. It writes the autosave, so the notice goes up too. */
  manualFailed(err: unknown): void {
    trackAppActionOnce("autosave_failed", "manual");
    this.deps().ui.toast(saveFailureMessage(err), "bad");
    this.warn(err, true);
  }

  /** An autosave failed. A hidden tab keeps the latch open for the player's
   *  return: the next tick they can see raises the notice. */
  backgroundFailed(err: unknown): void {
    if (document.visibilityState !== "hidden") this.warn(err, false);
  }

  /** A write to the autosave worked: take the notice down and say saving is
   *  back, but only to a player who was told it was not. */
  worked(): void {
    if (!this.warned) return;
    this.warned = false;
    const deps = this.deps();
    deps.saveWarning?.clear();
    deps.ui.toast("Saving works again.", "good");
  }

  /** Raise the notice once per run of failures. Without a notice surface
   *  (headless) the warning falls back to a toast, unless one was just shown. */
  private warn(err: unknown, toasted: boolean): void {
    if (this.warned) return;
    this.warned = true;
    const deps = this.deps();
    if (deps.saveWarning) deps.saveWarning.show(saveWarningText(err));
    else if (!toasted) deps.ui.toast(`${SAVE_WARNING_TITLE}. ${saveWarningText(err)}`, "bad");
  }
}
