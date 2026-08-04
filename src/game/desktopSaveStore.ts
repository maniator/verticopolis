import { getPlatform } from "../platform";
import { hydrateFromStore, withTimeout } from "./desktopSaveHydrate";
import * as origin from "./desktopSaveOrigin";
import { nextSeq, resetSaveWriteForTests } from "./desktopSaveWrite";
import { migrateSavesToStore, type MigrationReport } from "../storage/saveMigration";
import {
  idsInScope,
  migrationTarget,
  openSaveStore,
  type SaveAddress,
  type SaveStoreSession,
} from "../storage/saveStoreSession";

// The write paths live in ./desktopSaveWrite (split at the 500-line guard);
// re-exported here so every consumer keeps one import site for the desktop
// save machinery.
export { writeTowerToStore, writeTowerToStoreSync, storeWriteStalled, type StoreWriteResult } from "./desktopSaveWrite";

/**
 * The one entry point the boot path uses to bring up a wrapper shell's save
 * store, and the ONLY module that reaches for both the platform port and the
 * migration.
 *
 * ## Why it is a module rather than a few lines in bootstrap
 *
 * Everything here must stay out of a browser bundle. A web player would
 * otherwise download a migration, a session model, and a store client that can
 * never do anything, and the migration alone is the larger half of it.
 *
 * The gate is `IS_WRAPPED_BUILD`, never `if (port.saveStore)`. Vite statically
 * replaces `import.meta.env.MODE`, so Rollup eliminates the branch and drops
 * every module only that branch referenced. A property check on the resolved
 * port reads the same to a human and folds nothing, because Rollup cannot prove
 * the property undefined. Concentrating the imports here means there is exactly
 * one place that has to stay behind the gate, and `scripts/verify-wrapper-seam`
 * checks the built artifact in both directions rather than trusting it.
 *
 * ## Why it resolves before the game constructs
 *
 * `SaveGame.load`, `hasSave`, `listSlots` and `hasSlot` run at boot and behind
 * the splash, and asyncifying them would push `await` through the boot path and
 * the splash controller for a question the shell can answer once. So the one
 * `await` happens here, before `GameApp` exists, and everything downstream
 * reads {@link saveStoreSession} synchronously.
 */

let session: SaveStoreSession | null = null;
let migration: MigrationReport | null = null;
let inflight: Promise<void> | null = null;

/**
 * Whether the store's records were materialized into localStorage this boot.
 *
 * False means every reader is looking at whatever localStorage already held, so
 * the store must not be treated as authoritative for reads OR writes: routing
 * writes to a store the readers cannot see is the split-brain the tripwire
 * exists to prevent.
 */
let hydrated = false;

/** Whether hydration RAN this boot, regardless of outcome. */
let hydrationAttempted = false;

/** Whether hydration failed because the BRIDGE failed, as opposed to a content
 *  disagreement. Only this reads as degraded: a bridge failure is transient
 *  and a restart may fix it, while a disagreement recurs every boot, so
 *  pausing saves over one would be a permanent lockout. */
let hydrationReadFailed = false;

/** Slot ids stashed-and-overwritten by a both-moved conflict this boot; the
 *  boot flow tells the player. */
let hydrationConflicts: readonly string[] = [];

/**
 * Resolve the shell's store and move any localStorage towers into it, once.
 *
 * NEVER REJECTS. This is awaited during boot, before the first paint, so a
 * shell that is slow, broken, or absent has to degrade to "no durable store
 * this session" rather than take the splash down. Every failure inside is
 * already swallowed by `openSaveStore` and `migrateSavesToStore`; the outer
 * guard is for the ones neither of them owns.
 */
export function prepareSaveStore(): Promise<void> {
  // The PROMISE is memoized, not a boolean. A boolean latch set before the
  // first await let a second caller during the in-flight window return
  // immediately with `session` still null, and take the localStorage fallback
  // for the whole page load. Sequential awaits in a test cannot tell the two
  // apart, which is why the old test passed.
  inflight ??= runPrepare();
  return inflight;
}

async function runPrepare(): Promise<void> {
  const store = getPlatform().saveStore;
  if (!store) return;

  try {
    session = await withTimeout(openSaveStore(store));
  } catch {
    // A port that throws synchronously, or one that never answers.
    session = null;
  }
  if (!session) return;

  try {
    // The migration may only ever write into the shell-marked SHARED scope, and
    // it comes from `migrationTarget` rather than from `defaultScope` so that
    // aiming it at an account is not expressible. Null means the shell marked
    // no shared scope, and the correct answer is to skip.
    const target = migrationTarget(session);
    if (target === null) return;
    // Bounded too, and NOT covered by the `list()` timeout above. The migration
    // awaits a write and a read-back per slot, so a shell that answers `list()`
    // promptly and then hangs on the first write would still block boot on a
    // blank page: the exact failure the timeout exists to prevent, one call
    // deeper. Abandoning a half-finished migration is safe by construction,
    // because it never deletes localStorage, refuses an occupied destination,
    // and derives its done-marker from the store, so the next boot resumes it.
    migration = await withTimeout(migrateSavesToStore(store, target, idsInScope(session, target)));
    if (migration === null) return;

    // Re-read the snapshot so the synchronous readers see what the migration
    // just wrote. Without this, everything it moved would be invisible for the
    // rest of the session and the next boot would find it "already present"
    // while the player saw an empty saves list.
    if (migration.migratedAny) {
      const fresh = await withTimeout(openSaveStore(store));
      if (fresh === null) {
        // The snapshot in hand PREDATES the migration, so hydrating from it
        // would misread a healthy boot as disagreement: skip this boot.
        // Skipped AND marked DEGRADED (a review caught the omission): the
        // migration just copied towers into the store, so a localStorage save
        // now would put newer progress beside an older store copy for the next
        // boot's hydration to overwrite (#736 F1, made reachable right here).
        // The failed re-read is a bridge failure, so degraded is also honest.
        hydrationAttempted = true;
        hydrationReadFailed = true;
        return;
      }
      session = fresh;
    }

    // LAST, after the migration, so the snapshot being hydrated already
    // includes anything just moved. Hydrating first would materialize the
    // pre-migration view and the player would not see their own towers until
    // the following launch.
    hydrationAttempted = true;
    const outcome = await hydrateFromStore(store, session, nextSeq);
    hydrated = outcome.ok;
    // Only a BRIDGE failure reads as degraded. A disagreement recurs every
    // boot by construction (the same comparison runs each launch), so pausing
    // saves over it, behind copy promising a restart will fix it, was a
    // permanent lockout. Disagreement leaves the session browser-equivalent.
    hydrationReadFailed = !outcome.ok && outcome.reason === "read-failed";
    if (outcome.ok) {
      origin.recordHydratedOrigins(outcome.origins);
      hydrationConflicts = outcome.conflicts;
    }
  } catch {
    // A migration failure does NOT discard an already-resolved session. The
    // store is still readable and writable; only the one-time move failed, and
    // it retries on the next boot because localStorage is never cleared.
    // Nulling the session here would abandon a working store for the whole
    // page load over a recoverable problem.
    migration = null;
  }
}

/**
 * The store was reachable, and its towers could not be read.
 *
 * Distinct from "no store this session", which is normal and browser
 * equivalent. Degraded means the shell LISTED records and hydration failed, so
 * the game knows towers exist that it cannot show, and it must not write:
 *
 *  - Not to the store, which is not hydrated, so a write would land where no
 *    reader looks (the split-brain rule).
 *  - Not to localStorage either, and this is the subtle half. A fallback write
 *    would be OVERWRITTEN by the next boot's successful hydration, because
 *    hydration materializes the store over these very keys. The degraded
 *    session's progress would be resurrected-over by an older copy, which is
 *    the exact failure #736 F1 describes.
 *
 * So a degraded session refuses saves honestly rather than accepting them into
 * a location with no future. The refusal surfaces through the existing failure
 * wording: Quick Save toasts, `saveBeforeUpdate` throws so the caller does not
 * reload, and the crash screen says the tower was not saved.
 */
export function storeReadDegraded(): boolean {
  return hydrationAttempted && hydrationReadFailed;
}

/** Origin tracking lives in `./desktopSaveOrigin` (split at the 500-line
 *  guard); these bind the session's shared scope so call sites keep their
 *  one-argument shape. */
export function noteTowerOriginForSlot(slot: number | "auto" | undefined): void {
  origin.noteTowerOriginForSlot(slot, session?.sharedScope);
}
export function noteTowerOrigin(address: SaveAddress | undefined): void {
  origin.noteTowerOrigin(address, session?.sharedScope);
}
export const towerOrigin = origin.towerOrigin;

/** The store as resolved at boot, or null when there is none this session.
 *  Synchronous by design: see the note above about the boot-time readers. */
export function saveStoreSession(): SaveStoreSession | null {
  return session;
}

/** What the migration did, or null when it did not run. Diagnostic only. */
export function saveMigrationReport(): MigrationReport | null {
  return migration;
}

/**
 * Whether the store is the authoritative save location: a FACT (the store was
 * hydrated into the readers this boot), not a setting.
 *
 * The tripwire that used to sit here (`authoritative`, armed only by tests) is
 * DELETED, per D4's AC8. It existed so the write path could not go live while
 * the readers still served un-hydrated localStorage, and hydration itself now
 * carries that precondition: `hydrated` is true only when the readers and the
 * store are known to describe the same world.
 */
export function storeIsAuthoritative(): boolean {
  return hydrated;
}

/**
 * The write path's first-write read-back found the bridge lying or
 * unreachable: same posture as a failed hydration read, set through the same
 * flags so `storeReadDegraded` reports it. Not part of the app-facing
 * surface; exported for `./desktopSaveWrite` only.
 */
export function markStoreBridgeDegraded(): void {
  hydrationAttempted = true;
  hydrationReadFailed = true;
}

/** Slot ids where a both-moved conflict stashed the local value and the store
 *  won, for the boot flow's bulletin. Empty when hydration was clean. */
export function hydrationConflictIds(): readonly string[] {
  return hydrationConflicts;
}

/** Test seam. Boot calls `prepareSaveStore` exactly once per page load, so the
 *  module-level latch is what makes a second call a no-op in production. */
export function resetSaveStoreForTests(): void {
  session = null;
  migration = null;
  inflight = null;
  origin.resetOriginForTests();
  hydrated = false;
  hydrationAttempted = false;
  hydrationReadFailed = false;
  hydrationConflicts = [];
  resetSaveWriteForTests();
}
