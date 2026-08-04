import { getPlatform } from "../platform";
import { saveStoreErrorCode, type SaveScopeToken } from "../platform/saveStore";
import { hydrateFromStore, withTimeout } from "./desktopSaveHydrate";
import {
  fromTowerFile,
  isSaveSlotId,
  localStorageKeyFor,
  migrateSavesToStore,
  type MigrationReport,
  type SaveSlotId,
} from "../storage/saveMigration";
import {
  idsInScope,
  migrationTarget,
  openSaveStore,
  resolveWriteTarget,
  type SaveAddress,
  type SaveStoreSession,
  type WriteRefusal,
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

/** Whether {@link loadedFrom}'s scope was the shared one, remembered at the
 *  moment it was resolved so the question survives the session going away. */
let loadedFromShared = false;

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

/** Whether hydration failed because the BRIDGE failed (a read rejected, timed
 *  out, or broke its contract), as opposed to a content disagreement. Only
 *  this reads as degraded: a bridge failure is transient and a restart may
 *  genuinely fix it, while a disagreement recurs every boot by construction,
 *  so pausing saves over one would be a permanent lockout behind copy that
 *  promises a remedy. */
let hydrationReadFailed = false;

/** Where each hydrated slot came from, keyed by slot id. What
 *  {@link noteTowerOriginForSlot} consults, captured during hydration because
 *  that is the one moment the store's answer and localStorage's contents are
 *  known to agree. */
const hydratedOrigins = new Map<string, SaveAddress>();

/**
 * Per-ADDRESS write counter. Session-scoped, and deliberately NOT persisted:
 * the port contract states the shell's high-water mark must not survive a
 * restart either, because a persisted mark would silently drop every write of
 * the next session once the game's counter started over.
 */
const seqByScope = new Map<SaveScopeToken, Map<string, number>>();

function nextSeq(address: SaveAddress): number {
  // Keyed by (id, scope), not by id: an id is unique only WITHIN a scope, so
  // two towers sharing an id across scopes must not share one counter. NESTED
  // maps rather than a `${scope}|${id}` composite, because scope tokens are
  // opaque and shell-controlled and may legitimately contain the separator;
  // nesting removes the question instead of answering it.
  let byId = seqByScope.get(address.scope);
  if (!byId) {
    byId = new Map<string, number>();
    seqByScope.set(address.scope, byId);
  }
  const next = (byId.get(address.id) ?? 0) + 1;
  byId.set(address.id, next);
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
  if (!migrationEnabled()) return;

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
        // The re-read failed, so the snapshot in hand PREDATES the migration.
        // Hydrating from it would find the just-migrated localStorage keys
        // "not in the store" and misread a healthy boot as disagreement, so
        // skip hydration entirely this boot; the next one hydrates from a
        // fresh snapshot. An earlier revision fell back to the stale snapshot
        // and hydrated anyway, under a comment claiming the opposite.
        return;
      }
      session = fresh;
    }

    // LAST, after the migration, so the snapshot being hydrated already
    // includes anything just moved. Hydrating first would materialize the
    // pre-migration view and the player would not see their own towers until
    // the following launch.
    hydrationAttempted = true;
    const outcome = await hydrateFromStore(store, session);
    hydrated = outcome.ok;
    // Only a BRIDGE failure reads as degraded. A disagreement recurs every
    // boot by construction (the same comparison runs each launch), so pausing
    // saves over it, behind copy promising a restart will fix it, was a
    // permanent lockout. Disagreement leaves the session browser-equivalent.
    hydrationReadFailed = !outcome.ok && outcome.reason === "read-failed";
    if (outcome.ok) {
      for (const [id, address] of outcome.origins) hydratedOrigins.set(id, address);
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

/**
 * Record the live tower's origin from the slot it was LOADED from, or clear it
 * for a tower that has no stored origin (New Game, an import).
 *
 * The address comes from {@link hydratedOrigins}, captured at hydration time,
 * because that is the one moment the store's scope answer and localStorage's
 * contents are known to describe the same bytes. When the store is not
 * hydrated there is no origin to record and the answer is undefined, which
 * `resolveWriteTarget` treats as "goes to the default scope".
 */
export function noteTowerOriginForSlot(slot: number | "auto" | undefined): void {
  if (slot === undefined) {
    noteTowerOrigin(undefined);
    return;
  }
  if (slot === "auto") {
    // `loadResult` prefers the current autosave key and falls back to the
    // legacy one, and the store mirrors that as two records (`auto`,
    // `auto-legacy`). When the store holds no `auto` record the fallback is
    // what loaded, so its origin applies. KNOWN NARROW GAP: when both records
    // exist and the primary is present-but-corrupt, the legacy record served
    // the tower but `auto`'s origin is reported; closing that needs
    // `loadResult` to say which key it read, which is a public SaveGame API
    // change deferred to the story that routes the write paths.
    noteTowerOrigin(hydratedOrigins.get("auto") ?? hydratedOrigins.get("auto-legacy"));
    return;
  }
  const id = `slot-${slot}`;
  // Membership-tested rather than cast: a slot number outside the closed list
  // maps to no id and therefore to no origin, never to a synthesized one.
  noteTowerOrigin(isSaveSlotId(id) ? hydratedOrigins.get(id) : undefined);
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
 * ONE of four write sites is routed (the periodic autosave, via
 * `persistAutosave`). Quick Save, the pre-reload flush, context-loss recovery
 * and slot saves all still call `SaveGame` directly, so flipping this without
 * routing them would put the autosave in the store and the pre-reload flush in
 * localStorage: two writers disagreeing about where the tower lives.
 *
 * The READ path is not routed at all. `SaveGame` still
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
  // BOTH conditions, and the second is the real one. `authoritative` is the
  // temporary tripwire; `hydrated` is the actual precondition, because routing
  // a write to a store the readers cannot see is the split-brain this whole
  // arrangement exists to prevent. When the tripwire is deleted (story D3 AC8)
  // this becomes `return hydrated`, which is a fact rather than a setting.
  return authoritative && hydrated;
}

/**
 * Whether the one-time localStorage migration may run.
 *
 * Separate from {@link storeIsAuthoritative} because they are gated on
 * different things and collapsing them deadlocks: hydration runs after the
 * migration, so a migration waiting on `hydrated` would never run, and
 * `hydrated` would never become true.
 */
function migrationEnabled(): boolean {
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
  // Recomputed rather than assumed: the caller knows the address, not whether
  // that scope is the shared one.
  loadedFromShared = address !== undefined && address.scope === session?.sharedScope;
}

/** Where the live tower came from, for the saves UI and for tests. */
export function towerOrigin(): SaveAddress | undefined {
  return loadedFrom;
}

export type StoreWriteResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal: WriteRefusal | "failed";
      readonly code?: string;
      /**
       * Whether writing this tower to localStorage instead would be safe.
       *
       * localStorage is per-origin and carries no scope, so anything written
       * there is INDISTINGUISHABLE from a pre-account-era tower, and the
       * migration will later sweep it into the shared namespace on the
       * reasoning that it has no knowable owner. That reasoning is sound for
       * towers that were already there. It is false for one this build put
       * there from an account-scoped session, and writing it anyway reaches
       * the same place `origin-gone` refuses to reach, just in two steps.
       *
       * So a fallback is safe only when the tower was headed for the SHARED
       * scope anyway, or when there is no store at all and therefore no
       * account context to leak between.
       */
      readonly localFallbackSafe: boolean;
    };

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
  if (!store || !session) {
    // No store means no account context of its own, but the LIVE tower may
    // still have come from one earlier in this session. Consulting the
    // remembered shared-ness rather than answering `true` unconditionally is
    // what keeps this from becoming a leak if a store ever vanishes mid-session
    // while an account-scoped tower is open.
    return { ok: false, refusal: "no-store", localFallbackSafe: loadedFrom === undefined || loadedFromShared };
  }

  const resolved = resolveWriteTarget(session, id, loadedFrom);
  if (!resolved.ok) {
    // The two refusals differ, and treating them alike was a trap waiting for
    // whoever wired the read path.
    //
    // `origin-gone`: the tower belongs to a scope that disappeared, which is
    // exactly the tower that must not land somewhere ownerless. Never safe.
    //
    // `no-store` from here means the session offered no scope at all, so there
    // is no account context to leak between and localStorage is the only place
    // a tower can go. Same situation as the branch above, and it must give the
    // same answer.
    return {
      ok: false,
      refusal: resolved.refusal,
      localFallbackSafe: resolved.refusal === "no-store",
    };
  }
  const headedForShared = resolved.target.scope === session.sharedScope;

  try {
    await store.write(resolved.target.id, contents, resolved.target.scope, nextSeq(resolved.target));
  } catch (err) {
    // Via `saveStoreErrorCode`, which guards the property read, rather than
    // reading `err.code` here. This runs inside a catch, so a rejection
    // carrying a throwing getter or a revoked Proxy would throw a SECOND time
    // and turn a handled store failure into an unhandled rejection. That guard
    // already existed one module over and this call site duplicated the
    // unguarded version of it.
    const code = saveStoreErrorCode(err);
    return {
      ok: false,
      refusal: "failed",
      ...(code !== undefined ? { code } : {}),
      localFallbackSafe: headedForShared,
    };
  }
  // A tower that had NO origin has one now, so the next autosave targets the
  // scope this one landed in rather than re-deciding from the default. Guarded
  // on absence: an unconditional assignment also overwrote the id, so a tower
  // opened from slot-2 reported its origin as `auto` after one autosave tick.
  if (loadedFrom === undefined) {
    loadedFrom = resolved.target;
    // Remembered alongside the address, so a later question about fallback
    // safety can be answered even if the session is gone by then.
    loadedFromShared = headedForShared;
  }
  // WRITE-THROUGH to the boot-hydrated cache, and only now, after the store
  // acknowledged the write. Without this, a mid-session "Load auto" served the
  // BOOT-TIME copy while the newer tower sat in the store: the real-towers
  // Electron harness caught exactly that. This does not make localStorage a
  // save target again. The cache is only ever written FROM a value the store
  // committed, so there is no independent copy, no reconciliation, and no
  // which-is-newer question; a failed cache write costs staleness until the
  // next boot, never data.
  if (hydrated) {
    const key = localStorageKeyFor(resolved.target.id);
    if (key !== undefined) {
      const back = fromTowerFile(contents);
      if (back.ok) {
        try {
          localStorage.setItem(key, back.value);
        } catch {
          /* a stale cache is survivable; the store has the tower */
        }
      }
    }
  }
  return { ok: true };
}

/** Test seam. Boot calls `prepareSaveStore` exactly once per page load, so the
 *  module-level latch is what makes a second call a no-op in production. */
export function resetSaveStoreForTests(): void {
  session = null;
  migration = null;
  inflight = null;
  loadedFrom = undefined;
  loadedFromShared = false;
  hydrated = false;
  hydrationAttempted = false;
  hydrationReadFailed = false;
  hydratedOrigins.clear();
  seqByScope.clear();
  authoritative = false;
}
