import { getPlatform } from "../platform";
import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { localStorageKeyFor, toTowerFile, type SaveSlotId } from "../storage/saveMigration";
import { clearAcked } from "../storage/saveStoreAcked";
import { hydratedOriginFor } from "./desktopSaveOrigin";
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
  const converted = toTowerFile(SaveGame.packSync(sim));
  // packSync always emits a VCZ1 value, so this cannot fail today; if it ever
  // does, localStorage still holds the tower and the stamp heals the store.
  if (!converted.ok) return "fallback";
  const id = (slot === "auto" ? "auto" : `slot-${slot}`) as SaveSlotId;
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
  if (result.code === "full") {
    throw Object.assign(new Error("The disk is full."), { name: "QuotaExceededError" });
  }
  throw new Error(`The tower could not be written to the save store${result.code !== undefined ? ` (${result.code})` : ""}. Try again.`);
}

/** Slots with a store delete in flight; `saveToSlot` refuses these, because a
 *  sync save landing between a delete handler's awaits would be unlinked by
 *  the pending delete after "Saved to slot N" already toasted. */
const pendingDeletes = new Set<number>();

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
  const store = getPlatform().saveStore;
  const address = hydratedOriginFor(`slot-${slot}`);
  if (!store || !storeIsAuthoritative() || address === undefined) return Promise.resolve(true);
  pendingDeletes.add(slot);
  clearAcked(`slot-${slot}`);
  return store
    .delete(address.id, address.scope)
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      pendingDeletes.delete(slot);
    });
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
