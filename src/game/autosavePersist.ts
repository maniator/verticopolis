import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { IS_WRAPPED_BUILD } from "../platform";
import { saveStoreSession, storeIsAuthoritative, writeTowerToStore } from "./desktopSaveStore";

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
 * localStorage stays READABLE on desktop, because the migration has to read it.
 * It is simply never written there.
 *
 * ## The gate is IS_WRAPPED_BUILD
 *
 * Not `if (port.saveStore)`. Vite statically replaces `import.meta.env.MODE`,
 * so only the former lets Rollup drop the store, the session, and the migration
 * out of a browser bundle. `scripts/verify-wrapper-seam.ts` checks the built
 * artifact in both directions rather than trusting this comment.
 *
 * The session check is separate and load-bearing: a wrapped build whose shell
 * offers no store, or whose `list()` failed, still has to save somewhere, and
 * that somewhere is localStorage exactly as on the web.
 */
export async function persistAutosave(sim: Simulation): Promise<void> {
  // `storeIsAuthoritative()` is false until the READ path lands, and the check
  // is here rather than assumed. Writing to the store while `SaveGame` still
  // reads localStorage would put a player's progress somewhere nothing reads,
  // and the next launch would load the pre-migration copy as if the session had
  // never happened. The two halves ship together.
  if (IS_WRAPPED_BUILD && storeIsAuthoritative() && saveStoreSession()) {
    // `export` rather than `saveAsync`: the store holds `.vctower` text, the
    // same container the migration writes and `SaveGame.import` reads, so one
    // format crosses the bridge instead of two.
    const result = await writeTowerToStore("auto", await SaveGame.export(sim));
    if (result.ok) return;

    // ONLY `origin-gone` forbids a fallback, and conflating the refusals cost a
    // save. That one means the tower's own scope disappeared mid-session, and
    // the entire point of refusing is to avoid writing it somewhere every
    // account on the machine can read; falling back would do exactly that. A
    // periodic autosave is best effort, and the next tick retries once the
    // shell reports the scope again.
    //
    // Every other refusal is an ordinary failure with no privacy dimension. A
    // full disk, an IO error, or a store that vanished are all reasons to keep
    // the tower SOMEWHERE rather than nowhere, so they fall through to
    // localStorage exactly as a browser session would. Treating them like
    // `origin-gone` meant a disk-full desktop session wrote to neither store
    // and lost every autosave with no log and no UI.
    if (result.refusal === "origin-gone") return;
  }
  await SaveGame.saveAsync(sim);
}
