import { getPlatform } from "../platform";
import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { isSaveSlotId, localStorageKeyFor, toTowerFile } from "../storage/saveMigration";
import { clearAcked } from "../storage/saveStoreAcked";
import { forgetRecordAt, hydratedOriginFor } from "./desktopSaveOrigin";
import { withTimeout } from "./desktopSaveHydrate";
import { storeIsAuthoritative, writeTowerToStoreSync } from "./desktopSaveStore";

/**
 * The MANUAL half of desktop write routing: Quick Save, the slot saves, the
 * crash/update flush, and slot deletion. The periodic autosave routes through
 * `persistAutosave`; these paths cannot share it because their callers are
 * synchronous by contract (a manual save toasts success before its click
 * handler returns, and the pre-reload flush is the documented reason the save
 * codec is synchronous at all), so they ride the port's `writeSync` member.
 *
 * Every entry point here is called behind `IS_WRAPPED_BUILD` at the call site,
 * which is what keeps this module and everything under it out of a browser
 * bundle (`scripts/verify-wrapper-seam` checks the artifact rather than
 * trusting the comment).
 */

/**
 * Write a manual save through the store, or say why the caller should use its
 * localStorage path instead.
 *
 * `"fallback"` is not an error. It covers the browser-equivalent session (no
 * authoritative store this boot) and the shell that predates `writeSync`; in
 * both, `SaveGame`'s localStorage write is the correct behavior, and for the
 * old shell the coherence stamp reconciles the cache forward into the store on
 * the next boot.
 *
 * A store FAILURE throws, because both callers already own a throw contract
 * with honest wording (Quick Save's toast, the crash flush's "do not reload").
 * A `full` code throws a QuotaExceededError-named error on purpose: that is
 * the name `isStorageWriteError` recognizes, so the player gets the
 * storage-blame advice rather than a raw code.
 */
export function persistManualSave(sim: Simulation, slot: number | "auto"): "stored" | "fallback" {
  if (!storeIsAuthoritative()) return "fallback";
  // Membership-tested rather than cast: every production caller passes "auto"
  // or a slot from the closed 1..SLOT_COUNT list, but a number outside it must
  // not mint a store id the game does not own (it would poison the origin
  // bookkeeping). Falling back keeps browser equivalence: SaveGame accepts
  // any slot number, and always has.
  const id = slot === "auto" ? "auto" : `slot-${slot}`;
  if (!isSaveSlotId(id)) return "fallback";
  const converted = toTowerFile(SaveGame.packSync(sim));
  // packSync always emits a VCZ1 value, so this cannot fail today; if it ever
  // does, localStorage still holds the tower and the stamp heals the store.
  if (!converted.ok) return "fallback";
  const result = writeTowerToStoreSync(id, converted.text);
  if (result === "unsupported") return "fallback";
  if (result.ok) return "stored";
  if (result.refusal === "origin-gone") {
    // The tower's own scope disappeared mid-session. Falling back would write
    // it where every account on the machine can read it (the origin rule), so
    // the honest outcome is a refusal with the one action that works.
    throw new Error("This tower's save location is no longer available, so it was not saved. Export it to a file to keep it safe.");
  }
  if (result.refusal === "no-store") {
    // The store vanished after boot. When the tower was shared-headed (or
    // never stored), localStorage adds no exposure and the session is simply
    // browser-equivalent again; an account-scoped tower must refuse instead.
    if (result.localFallbackSafe) return "fallback";
    throw new Error("This tower's save location is no longer available, so it was not saved. Export it to a file to keep it safe.");
  }
  if (result.code === "unsupported") {
    // A writeSync-less shell with an account-headed tower: the localStorage
    // fallback would be the two-step leak (see writeTowerToStoreSync), so the
    // honest outcome is the same refusal as a vanished location.
    throw new Error("This tower's save location is no longer available, so it was not saved. Export it to a file to keep it safe.");
  }
  if (result.code === "stalled") {
    // The circuit breaker: an async write has been hanging past its
    // threshold, so a sendSync into the same main process would hang the
    // renderer (and the crash flush with it).
    throw new Error("The save store is not responding, so the tower was not saved. Try again in a moment.");
  }
  // `full` and `denied` read as STORAGE-blame: those are the names
  // `isStorageWriteError` recognizes, which routes the player to the "free up
  // space or allow site storage" advice instead of a raw code. `denied` rides
  // a real DOMException because the comparator only trusts SecurityError on
  // one (the name is too generic on arbitrary objects).
  if (result.code === "full") {
    throw Object.assign(new Error("The disk is full."), { name: "QuotaExceededError" });
  }
  if (result.code === "denied") {
    throw new DOMException("The save location refused the write.", "SecurityError");
  }
  throw new Error(`The tower could not be written to the save store${result.code !== undefined ? ` (${result.code})` : ""}. Try again.`);
}

/** Store deletes in flight, keyed by slot; `saveToSlot` refuses these,
 *  because a sync save landing between a delete handler's awaits would be
 *  unlinked by the pending delete after "Saved to slot N" already toasted.
 *  The VALUE is the in-flight promise, so a second delete request for the
 *  same slot observes the first instead of racing it: with a bare set, the
 *  first delete's cleanup cleared the pending flag while the second was
 *  still in flight, reopening the save window this exists to close. */
const pendingDeletes = new Map<number, Promise<boolean>>();

export function slotDeletePending(slot: number): boolean {
  return pendingDeletes.has(slot);
}

/**
 * Route a slot deletion to the store: the record at the slot's HYDRATED origin
 * scope (never `defaultScope`, where a clean-looking delete would leave the
 * real record to resurrect), dispatched with NO pre-await since delete carries
 * no seq and its ordering rests on IPC dispatch order. A slot with no store
 * record resolves immediately: the caller's localStorage removal was the whole
 * job, and calling the store would make an unreadable stray permanently
 * undeletable via the not-found restore dance.
 *
 * Resolves `true` when the store state matches the deletion (or there was
 * nothing to delete), `false` when the store refused and the caller should
 * restore its localStorage removal and say so.
 */
export function deleteSlotFromStore(slot: number): Promise<boolean> {
  // A second request while one is in flight OBSERVES the first rather than
  // racing it (see pendingDeletes): both callers get the same outcome, and
  // the pending flag holds until the one real delete settles.
  const inFlight = pendingDeletes.get(slot);
  if (inFlight !== undefined) return inFlight;
  const store = getPlatform().saveStore;
  const address = hydratedOriginFor(`slot-${slot}`);
  if (!store || !storeIsAuthoritative() || address === undefined) return Promise.resolve(true);
  clearAcked(`slot-${slot}`);
  // Bounded like every other bridge call: "never rejects" is not "never
  // hangs", and a delete that never settled kept `pendingDeletes` armed for
  // the whole session, so `saveToSlot` refused the slot forever while the
  // restore path never fired. A timeout reads as failure (`withTimeout`
  // resolves null), the caller restores the cache row, and if the delete
  // actually landed late the next boot simply finds nothing to resurrect.
  const run = withTimeout(store.delete(address.id, address.scope).then(() => true as const))
    .then((settled) => {
      if (settled !== true) return false;
      // The record is GONE, and the session must know it: a review found
      // that leaving the boot snapshot in place made a later save to this
      // slot target the dead record's scope instead of following the live
      // tower's origin.
      forgetRecordAt(`slot-${slot}`);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      pendingDeletes.delete(slot);
    });
  pendingDeletes.set(slot, run);
  return run;
}

/** Test seam, mirroring `resetSaveStoreForTests` for this module's state. */
export function resetManualSaveForTests(): void {
  pendingDeletes.clear();
}

/**
 * Delete a slot from the cache NOW and from the store in the background,
 * restoring the cache (and saying so) if the store refuses.
 *
 * The immediate cache removal is what makes the saves UI honest without an
 * await: the row disappears when the player clicks. The store delete carries
 * no seq (its ordering rests on IPC dispatch order, which is why
 * `deleteSlotFromStore` dispatches with no pre-await), so the failure surface
 * is the restore below, plus `slotDeletePending` guarding a save into the
 * window while the delete is in flight.
 */
export function deleteSlotRouted(
  slot: number,
  ui: { toast(message: string, kind: "good" | "bad" | "info"): void },
  rerender: () => void,
): void {
  const key = localStorageKeyFor(`slot-${slot}`);
  let stashed: string | null = null;
  try {
    stashed = key === undefined ? null : localStorage.getItem(key);
  } catch {
    stashed = null;
  }
  SaveGame.deleteSlot(slot);
  void deleteSlotFromStore(slot).then((ok) => {
    if (ok) return;
    // The store still holds the record, so the honest state is "not deleted":
    // put the cache row back to match, tell the player, and let the caller
    // re-render whatever surface is showing slots. If the restore itself fails
    // (quota), the next boot's hydration re-materializes the record anyway.
    if (key !== undefined && stashed !== null) {
      try {
        localStorage.setItem(key, stashed);
      } catch {
        /* the next boot's hydration restores it */
      }
    }
    ui.toast(`Slot ${slot} could not be deleted from the save store, so it was restored.`, "bad");
    rerender();
  });
}
