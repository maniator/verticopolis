import { html } from "lit-html";
import type { GameApp } from "../main";
import { SaveGame, type SlotInfo } from "../storage/SaveGame";
import { scheduleReviewEntry } from "../ui/templates/scheduleReview";
import { canCallExterminator, statsScreen, statsTemplate } from "../ui/templates/stats";
import { trackAppAction } from "../analytics";
import { outcome } from "../simport/portCodes";
import { statsReport } from "../simport/statsSheet";
import { catalogOf } from "./portAccess";
import { NEWER_SAVE_REFUSAL, loadStored, newerSaveRefused, saveText } from "./portLifecycle";
import { groupDigits } from "../ui/format";
import { dropUndo, homeSlot, keepForUndo, pendingUndo, rememberHome, rememberHomePrint, slotFingerprint } from "../storage/slotGuard";
import { saveFailureMessage } from "../storage/saveFailureCopy";
import type { SavesGuard, UndoResult } from "../ui/templates/saves";

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
    `Clear ${infested} infested room(s) for $${groupDigits(cost)}? The crew arrives tomorrow.`,
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
            why = `Not enough funds to book the exterminator ($${groupDigits(app.portCodes.slot(rec, "bookExterminator", "cost") || cost)}).`;
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
  const rows = SaveGame.listSlots();
  app.ui.showSaves(rows, SaveGame.unreadableBackup(), savesGuard(app, rows));
}

/** The overwrite guard's view for the Saved Towers dialog: the live tower's
 *  own slot, its name, and the one step of Undo (`storage/slotGuard`).
 *  `rows` is the listing the dialog draws, read once per open. */
function savesGuard(app: GameApp, rows: readonly SlotInfo[]): SavesGuard {
  const undo = pendingUndo(SaveGame.slotRaw);
  return {
    home: liveHome(app, rows),
    liveName: liveName(app),
    undo: undo && { slot: undo.slot, towerName: undo.towerName, action: undo.action, run: () => undoSlot(app) },
    replaceTarget: (slot) => replaceTarget(app, slot),
  };
}

/** Whether a save into `slot` must ask first, read from storage at the click
 *  (the dialog's list may be stale when another tab wrote since): the slot's
 *  row when it holds anything other than the live tower, null when it is
 *  empty or the live tower's own. A save this version can't read comes back
 *  as a row that does not `exist`, and the dialog refuses to save over it, as
 *  the list does (`SaveGame.hasSlot`). */
function replaceTarget(app: GameApp, slot: number): SlotInfo | null {
  if (SaveGame.slotRaw(slot) === null) return null;
  const rows = SaveGame.listSlots();
  if (liveHome(app, rows) === slot) return null;
  return rows.find((s) => s.slot === slot) ?? { slot, exists: false, present: true };
}

/** The live tower's name as the dialogs show it. */
const liveName = (app: GameApp): string => app.reader.tower.towerName || "Tower";

/** The name the tower in `slot` was saved under, from a listing the caller
 *  read once for its whole command (`SaveGame.listSlots`). */
function savedName(rows: readonly SlotInfo[], slot: number): string {
  return rows.find((s) => s.slot === slot)?.towerName || "Tower";
}

/** The live tower's own slot: the one this page remembers, and only while
 *  the tower saved there has the live tower's name, as a second check on the
 *  fingerprint. A renamed tower asks once, and its next save makes the slot
 *  home again. */
function liveHome(app: GameApp, rows: readonly SlotInfo[]): number | null {
  const home = homeSlot(SaveGame.slotRaw);
  return home !== null && savedName(rows, home) === liveName(app) ? home : null;
}

/** Put back the tower the last replace or delete took out of its slot.
 *  "gone" when the slot has changed since, so there is nothing to put back.
 *  A refused write is said inside the open dialog, since a toast would sit
 *  behind it, and the step stays for another try. */
export function undoSlot(app: GameApp): UndoResult {
  const undo = pendingUndo(SaveGame.slotRaw);
  if (!undo) return "gone";
  try {
    SaveGame.restoreSlotRaw(undo.slot, undo.raw);
  } catch (err) {
    app.ui.sayVisibly(saveFailureMessage(err));
    return "failed";
  }
  dropUndo();
  app.ui.toast(`${undo.towerName} is back in slot ${undo.slot}.`, "good");
  return "back";
}

/** Save the live tower into a manual slot, stamping the live camera view. A
 *  save over a slot that held another tower keeps that tower for one Undo;
 *  either way the slot becomes the live tower's own. False when the write
 *  failed, which is said where the player can see it (inside the open
 *  Saved Towers dialog, which then stays as it is). */
export function saveToSlot(app: GameApp, slot: number): boolean {
  const before = SaveGame.slotRaw(slot);
  let replaced: string | null = null;
  if (before !== null) {
    const rows = SaveGame.listSlots();
    if (liveHome(app, rows) !== slot) replaced = savedName(rows, slot);
  }
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
    app.saveLoad.notice.slotFailed(err);
    return false;
  }
  trackAppAction("save_slot"); // manual slot write succeeded
  const after = SaveGame.slotRaw(slot);
  const print = after === null ? null : slotFingerprint(after);
  if (replaced !== null && before !== null && print !== null)
    keepForUndo({ slot, towerName: replaced, action: "replaced", raw: before, left: print });
  rememberHomePrint(slot, print);
  app.ui.toast(`Saved to slot ${slot}.`, "good");
  return true;
}

/** Load a manual slot (or the autosave) and adopt it as the live tower. */
export function loadFromSlot(app: GameApp, slot: number | "auto"): void {
  // The engine loads the save and the app follows the swap.
  const swap = loadStored(app.enginePort, () => app.followSwap());
  let newer = false;
  const load = (text: string): boolean => {
    const loaded = swap(text);
    if (!loaded && newerSaveRefused(app.enginePort)) newer = true;
    return loaded;
  };
  if (slot === "auto" ? SaveGame.load(load) : SaveGame.loadSlot(slot, load)) {
    loadedFrom(slot);
    trackAppAction("load_slot"); // slot (or autosave) adopted as the live tower
    app.ui.toast("Tower loaded.", "good");
  } else {
    trackAppAction("load_failed");
    app.ui.toast(newer ? NEWER_SAVE_REFUSAL : "That slot is empty or corrupt.", "bad");
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
    trackAppAction("load_failed");
    return false;
  }
  if (!loaded) {
    trackAppAction("load_failed");
    return false;
  }
  loadedFrom(slot);
  trackAppAction("load_slot"); // slot (or autosave) adopted as the live tower
  return true;
}

/** After a load, a manual slot is the loaded tower's home. The autosave names
 *  none: the swap already forgot the old home (`followEngineTower`), and the
 *  autosave, which every tab shares and which trails the live tower by up to
 *  30 seconds, may hold another tower than the one that slot had. */
function loadedFrom(slot: number | "auto"): void {
  if (slot !== "auto") rememberHome(slot, SaveGame.slotRaw(slot));
}

/** Delete a manual slot, keeping its tower for one Undo. */
export function deleteSlot(app: GameApp, slot: number): void {
  const before = SaveGame.slotRaw(slot);
  const name = before === null ? null : savedName(SaveGame.listSlots(), slot);
  SaveGame.deleteSlot(slot);
  if (before !== null && name !== null) keepForUndo({ slot, towerName: name, action: "deleted", raw: before, left: null });
  trackAppAction("delete_save"); // slot cleared
  app.ui.toast(`Deleted slot ${slot}.`, "info");
}
