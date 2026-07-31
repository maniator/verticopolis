import { getPlatform } from "../platform";
import { migrateSavesToStore, type MigrationReport } from "../storage/saveMigration";
import {
  idsInScope,
  migrationTarget,
  openSaveStore,
  resolveWriteTarget,
  type SaveAddress,
  type SaveStoreSession,
  type WriteRefusal,
} from "../storage/saveStoreSession";
import type { SaveSlotId } from "../storage/saveMigration";

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
 * Where the LIVE tower was opened from, or undefined for one that has never
 * been stored (a new game, or one imported from a file).
 *
 * This is the input to the origin rule. It is module state rather than
 * something threaded through every call site because there is exactly one live
 * tower, and a second source of truth for "which tower is loaded" is how the
 * two get to disagree.
 */
let loadedFrom: SaveAddress | undefined;

/**
 * Per-ADDRESS write counter. Session-scoped, and deliberately NOT persisted:
 * the port contract states the shell's high-water mark must not survive a
 * restart either, because a persisted mark would silently drop every write of
 * the next session once the game's counter started over.
 */
const seqByAddress = new Map<string, number>();

function nextSeq(address: SaveAddress): number {
  // Keyed by (id, scope), not by id. An id is unique only WITHIN a scope, which
  // is this module's whole thesis, so two different towers sharing an id
  // across scopes must not share one counter: whichever way the shell keys its
  // high-water mark, one of them would lose writes.
  const key = `${address.scope}|${address.id}`;
  const next = (seqByAddress.get(key) ?? 0) + 1;
  seqByAddress.set(key, next);
  return next;
}

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

  // The migration is gated on the SAME tripwire as the write path, and leaving
  // it ungated was a real defect rather than an oversight worth arguing about.
  //
  // Migrating while writes still go to localStorage produces exactly the
  // divergence the tripwire exists to prevent: boot 1 copies the towers into
  // the store, every autosave afterwards lands in localStorage, and boot 2 sees
  // the destinations already occupied and skips (correctly, per the derived
  // done-marker). The store is then frozen at boot 1 forever, and the day the
  // readers are routed the player loads a tower missing every session since.
  // Gating the harmless half and leaving the dangerous half open is worse than
  // gating neither.
  if (!storeIsAuthoritative()) return;

  try {
    // The migration may only ever write into the shell-marked SHARED scope, and
    // it comes from `migrationTarget` rather than from `defaultScope` so that
    // aiming it at an account is not expressible. Null means the shell marked
    // no shared scope, and the correct answer is to skip.
    const target = migrationTarget(session);
    if (target === null) return;
    migration = await migrateSavesToStore(store, target, idsInScope(session, target));

    // Re-read the snapshot so the synchronous readers see what the migration
    // just wrote. Without this, everything it moved would be invisible for the
    // rest of the session and the next boot would find it "already present"
    // while the player saw an empty saves list.
    if (migration.migratedAny) session = (await withTimeout(openSaveStore(store))) ?? session;
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
 * Bound anything that crosses the bridge during boot.
 *
 * "Never rejects" was not the same as "never hangs", and the difference is the
 * whole boot: this is awaited before first paint, so a shell that accepts a
 * call and never answers leaves the player on a blank page with no splash, no
 * message, and no reload button. A rejection at least degrades to localStorage.
 */
const BOOT_STORE_TIMEOUT_MS = 3000;

function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BOOT_STORE_TIMEOUT_MS)),
  ]);
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

/**
 * Whether the store is the authoritative save location yet.
 *
 * FALSE, deliberately, and this is a tripwire rather than a feature flag.
 *
 * The write path is finished and tested; the READ path is not. `SaveGame` still
 * answers `load`, `hasSave`, `listSlots` and `hasSlot` from localStorage across
 * twenty call sites. Writing autosaves to the store while reads come from
 * localStorage would mean a player's progress went somewhere nothing reads: the
 * game would load the pre-migration copy on the next launch and every session's
 * play would silently vanish.
 *
 * Nothing is broken today, because no shell implements `saveStore` and the
 * fallback keeps localStorage authoritative. The hazard is that implementing
 * the port, the obvious next step, is exactly what would trigger it, and the
 * shell author has no way to know that from their side.
 *
 * So the two halves ship together. Flipping this to true belongs in the change
 * that routes the readers, not before, and `persistAutosave` consults it rather
 * than assuming a store means a store worth writing to.
 */
export function storeIsAuthoritative(): boolean {
  return authoritative;
}

/** Production default. The read path is what flips it, and when that lands this
 *  whole tripwire goes away rather than becoming a setting. */
let authoritative = false;

/** Test seam, so the routing this gates stays covered while it is switched off
 *  in production. Pinned by a test asserting the default is false. */
export function setStoreAuthoritativeForTests(value: boolean): void {
  authoritative = value;
}

/**
 * Record where the live tower came from, so autosave writes it back there.
 *
 * `undefined` means a tower with no origin: a new game, or one imported from a
 * file. Those go to the default scope, which is what a first save is.
 */
export function noteTowerOrigin(address: SaveAddress | undefined): void {
  loadedFrom = address;
}

/** Where the live tower came from, for the saves UI and for tests. */
export function towerOrigin(): SaveAddress | undefined {
  return loadedFrom;
}

export type StoreWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: WriteRefusal }
  | { readonly ok: false; readonly refusal: "failed"; readonly code?: string };

/**
 * Write a tower to the store, honoring the origin rule.
 *
 * The ONLY write path on desktop. It never falls back to localStorage and never
 * falls back to a different scope: a refusal is returned, and the caller decides
 * what to tell the player.
 *
 * That no-fallback posture is the whole point. Writing a tower opened from one
 * account's directory into the shared namespace, because the account directory
 * went away mid-session, would put it where every account on the machine can
 * read it. Losing one autosave tick is recoverable; that is not.
 */
export async function writeTowerToStore(id: SaveSlotId, contents: string): Promise<StoreWriteResult> {
  const store = getPlatform().saveStore;
  if (!store || !session) return { ok: false, refusal: "no-store" };

  const resolved = resolveWriteTarget(session, id, loadedFrom);
  if (!resolved.ok) return { ok: false, refusal: resolved.refusal };

  try {
    await store.write(resolved.target.id, contents, resolved.target.scope, nextSeq(resolved.target));
  } catch (err) {
    const code = (err as { code?: unknown } | null | undefined)?.code;
    return { ok: false, refusal: "failed", ...(typeof code === "string" ? { code } : {}) };
  }
  // A tower that had no origin has one now, so the NEXT autosave targets the
  // scope this one landed in rather than re-deciding from the default. Without
  // this, a shell that changed its default scope mid-session would scatter one
  // tower's autosaves across two namespaces.
  loadedFrom = resolved.target;
  return { ok: true };
}

/** Test seam. Boot calls `prepareSaveStore` exactly once per page load, so the
 *  module-level latch is what makes a second call a no-op in production. */
export function resetSaveStoreForTests(): void {
  session = null;
  migration = null;
  inflight = null;
  loadedFrom = undefined;
  seqByAddress.clear();
  authoritative = false;
}
