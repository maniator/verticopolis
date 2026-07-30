import { getPlatform } from "../platform";
import { migrateSavesToStore, type MigrationReport } from "../storage/saveMigration";
import {
  idsInScope,
  migrationTarget,
  openSaveStore,
  type SaveStoreSession,
} from "../storage/saveStoreSession";

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
let prepared = false;

/**
 * Resolve the shell's store and move any localStorage towers into it, once.
 *
 * NEVER REJECTS. This is awaited during boot, before the first paint, so a
 * shell that is slow, broken, or absent has to degrade to "no durable store
 * this session" rather than take the splash down. Every failure inside is
 * already swallowed by `openSaveStore` and `migrateSavesToStore`; the outer
 * guard is for the ones neither of them owns.
 */
export async function prepareSaveStore(): Promise<void> {
  if (prepared) return;
  prepared = true;
  try {
    const store = getPlatform().saveStore;
    if (!store) return;
    session = await openSaveStore(store);
    if (!session) return;

    // The migration may only ever write into the shell-marked SHARED scope, and
    // it comes from `migrationTarget` rather than from `defaultScope` so that
    // aiming it at an account is not expressible. Null means the shell marked
    // no shared scope, and the correct answer is to skip: localStorage keeps
    // the towers, and a later boot with a properly marked scope moves them.
    const target = migrationTarget(session);
    if (target === null) return;
    migration = await migrateSavesToStore(store, target, idsInScope(session, target));

    // Re-read the snapshot so the synchronous readers see what the migration
    // just wrote. Without this, everything it moved would be invisible for the
    // rest of the session and the next boot would find it "already present"
    // while the player saw an empty saves list.
    if (migration.migratedAny) session = (await openSaveStore(store)) ?? session;
  } catch {
    // A shell whose port throws synchronously, or any failure the inner guards
    // do not own. Boot continues on localStorage.
    session = null;
  }
}

/** The store as resolved at boot, or null when there is none this session.
 *  Synchronous by design: see the note above about the boot-time readers. */
export function saveStoreSession(): SaveStoreSession | null {
  return session;
}

/** What the migration did, or null when it did not run. Diagnostic only. */
export function saveMigrationReport(): MigrationReport | null {
  return migration;
}

/** Test seam. Boot calls `prepareSaveStore` exactly once per page load, so the
 *  module-level latch is what makes a second call a no-op in production. */
export function resetSaveStoreForTests(): void {
  session = null;
  migration = null;
  prepared = false;
}
