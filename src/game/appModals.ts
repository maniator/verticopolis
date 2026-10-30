import { html } from "lit-html";
import type { GameApp } from "../main";
import { SaveGame, saveFailureMessage } from "../storage/SaveGame";
import { scheduleReviewEntry } from "../ui/templates/scheduleReview";
import { canCallExterminator, statsScreen, statsTemplate } from "../ui/templates/stats";
import { trackAppAction } from "../analytics";
import { outcome } from "../simport/portCodes";
import { statsReport } from "../simport/statsSheet";
import { catalogOf } from "./portAccess";
import { loadStored, saveText } from "./portLifecycle";

/**
 * The tower-statistics modal, its exterminator action, and the manual save-slot
 * commands, split out of the `GameApp` class as friend functions taking the app.
 * The stats screen and the exterminator talk to the engine port, which answers
 * at once; the save slots still read the live sim through `app`. The `GameAppPorts`
 * members (`showStats`/`showSaves`/`saveToSlot`/`loadFromSlot`/`deleteSlot`) stay
 * on `GameApp` as one-line delegators into these.
 */

/** Open (or redraw) the stats modal from the engine's `statsSheet` record,
 *  which the port answers at once, so the modal always shows the tower loaded
 *  now. The promise settles once the modal is drawn. When the engine fails to
 *  answer or the screen fails to draw, a toast says so and the promise
 *  rejects with the failure. The callers leave the rejection to the global
 *  error tracking's `unhandledrejection` listener, as a throw from the old
 *  synchronous read reached its `error` listener. */
export async function showStats(app: GameApp): Promise<void> {
  // NOTE: no `stats_open` here. `confirmExterminate` re-invokes `showStats` to
  // refresh the modal, so instrumenting this shared function would double-count.
  // The user-open telemetry lives on the `onShowStats` callback (uiCallbacks).
  try {
    const report = statsReport(app.enginePort.statsSheet(), app.portCodes);
    // The header's date as of now, not as of the last throttled UI pass.
    app.reader.update();
    const catalog = catalogOf(app);
    // The "Call exterminator" button only exists in the modal when it's
    // offerable (Modern, infested rooms, none already en route). Gate the
    // handler on the same predicate the template uses, since wireActions
    // throws if it binds to a button that was not rendered.
    const handlers: Record<string, () => void> = canCallExterminator(report, catalog)
      ? { exterminate: () => void confirmExterminate(app) }
      : {};
    // Older towers can hold elevators that run fewer cars than they have (#1548); the
    // entry to the review exists only then, so a tower without any reads as before.
    const idleCars = app.scheduleReview.findings().length;
    if (idleCars > 0) handlers.reviewSchedules = () => app.scheduleReview.open();
    const body = statsTemplate(statsScreen(report, app.reader, catalog));
    app.ui.showStats(idleCars > 0 ? html`${body}${scheduleReviewEntry(idleCars)}` : body, handlers);
  } catch (e) {
    app.ui.toast("Tower Statistics could not be shown.", "bad");
    throw e;
  }
}

/** Confirm and pay for a tower-wide exterminator dispatch (Modern), then reopen
 *  the stats modal so the player sees the "en route" state. The engine charges
 *  and logs the booking through the port; here we only confirm the spend and
 *  surface a refusal the gate above should already have prevented. The stats
 *  modal reopens once the engine has answered, so it shows the answer. The
 *  modal's button calls it; a failed coverage answer toasts and throws, as
 *  `showStats` does. */
export async function confirmExterminate(app: GameApp): Promise<void> {
  const asked = app.enginePort.generation();
  const bad = app.portCodes.code("logKinds", "bad");
  let infested: number;
  try {
    // Asked again rather than read off the drawn report: the tower can change
    // between drawing the modal and clicking the button.
    infested = app.portCodes.slot(app.enginePort.crewCoverage(), "crewCoverage", "infested");
  } catch (e) {
    app.ui.toast("The exterminator could not be booked right now.", "bad");
    throw e;
  }
  const recovery = catalogOf(app).economy.exterminator;
  if (!recovery || infested === 0) {
    // The tower can change between rendering the stats modal and clicking the
    // button (a fire or bulldoze clears the last infested room, or the mode
    // rule-set no longer offers an exterminator), so say why nothing happens
    // instead of a silent no-op.
    const why = recovery ? "No infested rooms left to treat." : "The exterminator is unavailable.";
    app.enginePort.logLine(why, bad);
    await showStats(app);
    return;
  }
  const cost = recovery.calloutFee + recovery.perRoomFee * infested;
  app.ui.confirmModal(
    "Call the exterminator?",
    `Clear ${infested} infested room(s) for $${cost.toLocaleString()}? The crew arrives tomorrow.`,
    () => {
      // A load while the confirm was open: the quote was for the old tower.
      if (app.enginePort.generation() !== asked) return;
      const rec = app.enginePort.bookExterminator();
      const res = outcome(app.enginePort, rec);
      // Surface every refusal, not just funds: the tower can change between
      // rendering the stats modal and confirming (rooms cleared, or another
      // dispatch already booked), so a silent no-op would leave the player
      // wondering why nothing happened.
      if (!res.ok) {
        let why: string;
        switch (res.reason) {
          case "funds":
            why = `Not enough funds to book the exterminator ($${(app.portCodes.slot(rec, "bookExterminator", "cost") || cost).toLocaleString()}).`;
            break;
          case "pending":
            why = "An exterminator is already on the way.";
            break;
          case "none":
            why = "No infested rooms left to treat.";
            break;
          default:
            why = "The exterminator is unavailable.";
        }
        app.enginePort.logLine(why, bad);
      }
      void showStats(app);
    },
    "Call exterminator",
  );
}

export function showSaves(app: GameApp): void {
  trackAppAction("saves_open"); // saves manager modal opening
  app.ui.showSaves(SaveGame.listSlots(), SaveGame.unreadableBackup());
}

/** Save the live tower into a manual slot, stamping the live camera view. */
export function saveToSlot(app: GameApp, slot: number): void {
  try {
    // Manual slots carry the view too: stamp the live camera the same way
    // SaveLoad does for the autosave and exports. Inside the try on purpose:
    // a disposed or context-lost engine can throw from viewState() too, and
    // that failure must reach the same honest toast, not the click handler.
    SaveGame.saveSlot(slot, saveText(app.enginePort, app.engine.viewState()));
  } catch (err) {
    // Same contract as Quick Save: a manual save must never fail silently or
    // toast success on a failed write (the throw would otherwise escape the
    // slot button's click handler with no player feedback at all).
    app.ui.toast(saveFailureMessage(err), "bad");
    return;
  }
  trackAppAction("save_slot"); // manual slot write succeeded
  app.ui.toast(`Saved to slot ${slot}.`, "good");
}

/** Load a manual slot (or the autosave) and adopt it as the live tower. */
export function loadFromSlot(app: GameApp, slot: number | "auto"): void {
  // The engine loads the save and the app follows the swap.
  const load = loadStored(app.enginePort, () => app.followSwap());
  if (slot === "auto" ? SaveGame.load(load) : SaveGame.loadSlot(slot, load)) {
    trackAppAction("load_slot"); // slot (or autosave) adopted as the live tower
    app.ui.toast("Tower loaded.", "good");
  } else {
    app.ui.toast("That slot is empty or corrupt.", "bad");
  }
}

/**
 * Open the title screen's load-only tower picker
 * (SPEC-splash-load-tower CAP-2 to CAP-5).
 *
 * `listSlots` is passed as a thunk, not a snapshot, so a re-render after a
 * failed load re-reads storage. It is guarded because `listSlots` reads
 * localStorage, which THROWS rather than returning null when storage is
 * disabled outright (a SecurityError), and the title screen must not die on
 * that. The failure is reported as `storageBlocked` rather than folded into an
 * empty list: "no towers saved" would be a claim we cannot make, since the
 * player may have four towers on this device that the browser simply will not
 * hand over. The file row stays either way, which is the actual way in.
 */
export function showTowerPicker(app: GameApp, onAdopted?: () => void): void {
  trackAppAction("splash_load_open"); // distinct from the in-game manager's saves_open
  app.ui.showTowerPicker({
    getSlots: () => {
      try {
        return { slots: SaveGame.listSlots(), storageBlocked: false };
      } catch {
        return { slots: [], storageBlocked: true };
      }
    },
    // `onAdopted` fires only when a tower actually arrives, never on a failed or
    // cancelled pick. The Ground floor welcome rides it: this picker is the only
    // route back for a fresh install or a new device, which is exactly the
    // returning player the badge exists for, so without this they got the badge
    // and never the thank-you.
    onLoad: (slot) => {
      const ok = loadFromSplash(app, slot);
      if (ok) onAdopted?.();
      return ok;
    },
  });
}

/**
 * Load a device slot from the TITLE SCREEN, reporting whether a tower was
 * actually adopted (SPEC-splash-load-tower CAP-5).
 *
 * Distinct from {@link loadFromSlot}, which runs mid-game: this one must NOT
 * toast its failure. It is raised from inside the picker, and the shared
 * <dialog>'s top layer paints over the toast rail, so a toast here is feedback
 * the player never sees. The picker renders the reason inline instead, which is
 * why the outcome comes back as a boolean.
 *
 * The read is guarded: the slot list is built from parsed metadata, but the
 * load itself re-reads localStorage, which throws outright when storage is
 * blocked. A throw here must read as "could not load", not escape the click
 * handler and leave the picker looking frozen.
 *
 * On success nothing here tears the splash down or re-pauses. The app's
 * `followSwap` owns both, so every arrival route behaves identically.
 */
export function loadFromSplash(app: GameApp, slot: number | "auto"): boolean {
  const load = loadStored(app.enginePort, () => app.followSwap());
  const before = app.enginePort.generation();
  let loaded: boolean;
  try {
    loaded = slot === "auto" ? SaveGame.load(load) : SaveGame.loadSlot(slot, load);
  } catch (e) {
    // A throw from the app's adoption, after the tower swapped, is not a
    // failed read: it reaches the caller as before.
    if (app.enginePort.generation() !== before) throw e;
    return false;
  }
  if (!loaded) return false;
  trackAppAction("load_slot"); // slot (or autosave) adopted as the live tower
  return true;
}

export function deleteSlot(app: GameApp, slot: number): void {
  SaveGame.deleteSlot(slot);
  trackAppAction("delete_save"); // slot cleared
  app.ui.toast(`Deleted slot ${slot}.`, "info");
}
