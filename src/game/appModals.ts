import type { GameApp } from "../main";
import type { Simulation } from "../engine/Simulation";
import { SaveGame, saveFailureMessage } from "../storage/SaveGame";
import { canCallExterminator, statsTemplate } from "../ui/templates/stats";
import { trackAppAction } from "../analytics";
import { IS_WRAPPED_BUILD } from "../platform";
import { noteTowerOriginForSlot, storeReadDegraded } from "./desktopSaveStore";
import { deleteSlotRouted, persistManualSave, slotDeletePending } from "./manualSavePersist";
import { saveScopeCaption } from "./desktopScopeCaption";

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
  // The scope caption is DATA from the shell's own scope label (the D2
  // labeling ruling: rendered from data, never a constant), so only a
  // wrapped build can have one; the fold keeps the desktop modules out of a
  // browser bundle.
  app.ui.showSaves(SaveGame.listSlots(), IS_WRAPPED_BUILD ? saveScopeCaption() : undefined);
}

/** Save the live tower into a manual slot, stamping the live camera view. */
export function saveToSlot(app: GameApp, slot: number): void {
  try {
    // Same degraded-session refusal as Quick Save, inside the try so it
    // reaches the same honest toast. A localStorage write in a degraded
    // session would be overwritten by the next boot's successful hydration.
    if (IS_WRAPPED_BUILD && storeReadDegraded()) {
      throw new Error("Saved towers could not be read this session, so saving is paused. Restart to try again.");
    }
    // A slot with a store delete still in flight is refused: a save landing
    // between the delete's dispatch and its answer would be unlinked by the
    // pending delete right after "Saved to slot N" toasted.
    if (IS_WRAPPED_BUILD && slotDeletePending(slot)) {
      throw new Error(`Slot ${slot} is still being deleted. Try again in a moment.`);
    }
    // Manual slots carry the view too: stamp the live camera the same way
    // SaveLoad does for the autosave and exports. Inside the try on purpose:
    // a disposed or context-lost engine can throw from viewState() too, and
    // that failure must reach the same honest toast, not the click handler.
    app.sim.view = app.engine.viewState();
    // Same routing contract as Quick Save (see SaveLoad.save): store on a
    // hydrated desktop session, SaveGame's localStorage write otherwise, and
    // a store failure throws into the honest toast below.
    if (!(IS_WRAPPED_BUILD && persistManualSave(app.sim, slot) === "stored")) {
      SaveGame.saveSlot(slot, app.sim);
    }
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
    // AFTER adoption, matching importGame's stated rule: a load that fails to
    // adopt must leave the live tower's origin untouched, or the still-live
    // previous tower autosaves toward a scope it never came from.
    if (IS_WRAPPED_BUILD) noteTowerOriginForSlot(slot);
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
  // Same caption injection as showSaves, and the same fold; the value is
  // spread conditionally so the optional property is absent rather than
  // explicitly undefined (exactOptionalPropertyTypes).
  const scope = IS_WRAPPED_BUILD ? saveScopeCaption() : undefined;
  app.ui.showTowerPicker({
    ...(scope ? { scope } : {}),
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
  // Same origin note as loadFromSlot, and in the same AFTER-adoption position:
  // the two are the same operation from different screens.
  if (IS_WRAPPED_BUILD) noteTowerOriginForSlot(slot);
  trackAppAction("load_slot"); // slot (or autosave) adopted as the live tower
  return true;
}

export function deleteSlot(app: GameApp, slot: number): void {
  if (IS_WRAPPED_BUILD) {
    // Cache row goes now, store record in the background; a store refusal
    // restores the cache, toasts, and re-renders the saves list (see
    // deleteSlotRouted). The optimistic toast below is honest either way:
    // the failure path SAYS the restore happened.
    deleteSlotRouted(slot, app.ui, () => showSaves(app));
  } else {
    SaveGame.deleteSlot(slot);
  }
  trackAppAction("delete_save"); // slot cleared
  app.ui.toast(`Deleted slot ${slot}.`, "info");
}
