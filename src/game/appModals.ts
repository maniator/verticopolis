import type { GameApp } from "../main";
import type { Simulation } from "../engine/Simulation";
import { SaveGame, saveFailureMessage } from "../storage/SaveGame";
import { canCallExterminator, statsTemplate } from "../ui/templates/stats";
import { trackAppAction } from "../analytics";

/**
 * The tower-statistics modal, its exterminator action, and the manual save-slot
 * commands, split out of the `GameApp` class as friend functions taking the app.
 * They read the live sim through `app` (never captured). The `GameAppPorts`
 * members (`showStats`/`showSaves`/`saveToSlot`/`loadFromSlot`/`deleteSlot`) stay
 * on `GameApp` as one-line delegators into these. Behavior unchanged.
 */

export function showStats(app: GameApp): void {
  // NOTE: no `stats_open` here. `confirmExterminate` re-invokes `showStats` to
  // refresh the modal, so instrumenting this shared function would double-count.
  // The user-open telemetry lives on the `onShowStats` callback (uiCallbacks).
  // The "Call exterminator" button only exists in the modal when it's offerable
  // (Modern, infested rooms, none already en route). Gate the handler on the
  // same predicate the template uses, since wireActions throws if it binds to a
  // button that was not rendered.
  const handlers: Record<string, () => void> = canCallExterminator(app.sim)
    ? { exterminate: () => confirmExterminate(app) }
    : {};
  app.ui.showStats(statsTemplate(app.sim), handlers);
}

/** Confirm and pay for a tower-wide exterminator dispatch (Modern), then reopen
 *  the stats modal so the player sees the "en route" state. The engine charges
 *  and logs the booking; here we only confirm the spend and surface a refusal
 *  the gate above should already have prevented. */
function confirmExterminate(app: GameApp): void {
  const cov = app.sim.housekeepingCoverage();
  const recovery = app.sim.rules.infestationRecovery();
  if (!recovery || cov.infested === 0) {
    // The tower can change between rendering the stats modal and clicking the
    // button (a fire or bulldoze clears the last infested room, or the mode
    // rule-set no longer offers an exterminator), so say why nothing happens
    // instead of a silent no-op.
    app.sim.emit(recovery ? "No infested rooms left to treat." : "The exterminator is unavailable.", "bad");
    showStats(app);
    return;
  }
  const cost = recovery.calloutFee + recovery.perRoomFee * cov.infested;
  app.ui.confirmModal(
    "Call the exterminator?",
    `Clear ${cov.infested} infested room(s) for $${cost.toLocaleString()}? The crew arrives tomorrow.`,
    () => {
      const res = app.sim.callExterminator();
      // Surface every refusal, not just funds: the tower can change between
      // rendering the stats modal and confirming (rooms cleared, or another
      // dispatch already booked), so a silent no-op would leave the player
      // wondering why nothing happened.
      if (!res.ok) {
        const why =
          res.reason === "funds"
            ? `Not enough funds to book the exterminator ($${(res.cost ?? cost).toLocaleString()}).`
            : res.reason === "pending"
              ? "An exterminator is already on the way."
              : res.reason === "none"
                ? "No infested rooms left to treat."
                : "The exterminator is unavailable.";
        app.sim.emit(why, "bad");
      }
      showStats(app);
    },
    "Call exterminator",
  );
}

export function showSaves(app: GameApp): void {
  trackAppAction("saves_open"); // saves manager modal opening
  app.ui.showSaves(SaveGame.listSlots());
}

/** Save the live tower into a manual slot, stamping the live camera view. */
export function saveToSlot(app: GameApp, slot: number): void {
  try {
    // Manual slots carry the view too: stamp the live camera the same way
    // SaveLoad does for the autosave and exports. Inside the try on purpose:
    // a disposed or context-lost engine can throw from viewState() too, and
    // that failure must reach the same honest toast, not the click handler.
    app.sim.view = app.engine.viewState();
    SaveGame.saveSlot(slot, app.sim);
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
  const loaded = slot === "auto" ? SaveGame.load() : SaveGame.loadSlot(slot);
  if (loaded) {
    app.adoptSim(loaded);
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
export function showTowerPicker(app: GameApp): void {
  trackAppAction("splash_load_open"); // distinct from the in-game manager's saves_open
  app.ui.showTowerPicker({
    getSlots: () => {
      try {
        return { slots: SaveGame.listSlots(), storageBlocked: false };
      } catch {
        return { slots: [], storageBlocked: true };
      }
    },
    onLoad: (slot) => loadFromSplash(app, slot),
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
 * On success nothing here tears the splash down or re-pauses. `adoptSim` owns
 * both, so every arrival route behaves identically.
 */
export function loadFromSplash(app: GameApp, slot: number | "auto"): boolean {
  let loaded: Simulation | null = null;
  try {
    loaded = slot === "auto" ? SaveGame.load() : SaveGame.loadSlot(slot);
  } catch {
    return false;
  }
  if (!loaded) return false;
  app.adoptSim(loaded);
  trackAppAction("load_slot"); // slot (or autosave) adopted as the live tower
  return true;
}

export function deleteSlot(app: GameApp, slot: number): void {
  SaveGame.deleteSlot(slot);
  trackAppAction("delete_save"); // slot cleared
  app.ui.toast(`Deleted slot ${slot}.`, "info");
}
