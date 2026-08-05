import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { IS_WRAPPED_BUILD } from "../platform";
import { saveStoreSession, storeIsAuthoritative, storeReadDegraded, writeTowerToStore } from "./desktopSaveStore";

/**
 * Where a periodic autosave actually lands.
 *
 * Its own module because the decision needs more explanation than it needs
 * code, and `saveLoad.ts` sits at the file-size ceiling.
 *
 * ## Desktop writes the file store and NOT localStorage
 *
 * Not a mirror, and the difference matters. Writing both would leave two copies
 * to reconcile at boot, and reconciliation between two stores is exactly how an
 * older copy resurrects over a newer one. It is also how one Steam account's
 * tower reaches another's: a localStorage copy carries no scope, so the origin
 * rule cannot see it, and a boot-time promote would write it wherever the
 * current default points.
 *
 * The boot-hydrated CACHE is refreshed by the write path itself, from the value
 * the store committed, which is a derived copy rather than a second save
 * target. This module never writes localStorage on a hydrated session, not
 * even when the store write FAILS: the failure paths that used to fall back
 * are covered by the coherence stamp's reconcile-forward at the next boot for
 * shared towers, and were a two-step account leak for account-scoped ones
 * (localStorage carries no scope, so the next boot's migration sweeps the copy
 * into the SHARED namespace). A periodic autosave is best effort; the next
 * tick retries.
 *
 * ## The gate is IS_WRAPPED_BUILD
 *
 * Not `if (port.saveStore)`. Vite statically replaces `import.meta.env.MODE`,
 * so only the former lets Rollup drop the store, the session, and the migration
 * out of a browser bundle. `scripts/verify-wrapper-seam.ts` checks the built
 * artifact in both directions rather than trusting this comment.
 *
 * The `storeIsAuthoritative()` check is separate and load-bearing: it is the
 * FACT that this boot's hydration materialized the store into the readers. A
 * wrapped build whose shell offers no store, or whose hydration found a
 * disagreement, is browser-equivalent and saves to localStorage exactly as on
 * the web; writing to the store there would put progress where nothing reads.
 */

/** Sims already told their autosaves are paused, so the bulletin fires once
 *  per tower rather than every tick. A WeakSet so a discarded sim does not
 *  pin itself here for the life of the page. */
const warnedDegraded = new WeakSet<Simulation>();

/** Sims told about the CURRENT failure streak. Cleared on the next success,
 *  so a new streak warns again: the spec's rule is that a failed store write
 *  in store mode says so honestly, and a per-streak latch is what keeps that
 *  from becoming a toast every thirty seconds while a disk stays full. */
const warnedFailed = new WeakSet<Simulation>();

export async function persistAutosave(sim: Simulation): Promise<void> {
  // A degraded session (the shell listed towers hydration could not read)
  // autosaves NOWHERE, deliberately. The store is not hydrated, so a store
  // write would land where no reader looks. And a localStorage write would be
  // OVERWRITTEN by the next boot's successful hydration, which materializes
  // the store over these very keys: the degraded session's progress would be
  // resurrected-over by an older copy, the exact failure #736 F1 names.
  // Said ONCE in the bulletin log, because manual saves refuse with modal
  // wording but a periodic autosave has no surface of its own, and silence
  // here would string the player along for a whole session.
  if (IS_WRAPPED_BUILD && storeReadDegraded()) {
    if (!warnedDegraded.has(sim)) {
      warnedDegraded.add(sim);
      sim.emit("Autosave is paused: the save store could not be read. Restart the game to retry.", "bad");
    }
    return;
  }
  if (IS_WRAPPED_BUILD && storeIsAuthoritative() && saveStoreSession()) {
    // `export` rather than `saveAsync`: the store holds `.vctower` text, the
    // same container the migration writes and `SaveGame.import` reads, so one
    // format crosses the bridge instead of two. A refusal or failure saves
    // nowhere this tick (see the module note), and `stale` never surfaces
    // here: the write path already reports it as success-by-supersession.
    const result = await writeTowerToStore("auto", await SaveGame.export(sim));
    if (result.ok) {
      warnedFailed.delete(sim);
      return;
    }
    // Said once per failure streak, in the bulletin channel ("bad" entries
    // toast). A read-back mismatch flips the session to degraded instead;
    // that case gets the degraded wording above on the next tick, so this
    // stays quiet for it rather than saying two different things.
    if (!storeReadDegraded() && !warnedFailed.has(sim)) {
      warnedFailed.add(sim);
      sim.emit("Autosave failed: the tower could not be written to the save store. It will keep retrying.", "bad");
    }
    return;
  }
  await SaveGame.saveAsync(sim);
}
