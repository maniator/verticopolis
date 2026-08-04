import { getPlatform } from "../platform";
import { saveStoreErrorCode, type SaveScopeToken } from "../platform/saveStore";
import { hydrateFromStore, withTimeout } from "./desktopSaveHydrate";
import * as origin from "./desktopSaveOrigin";
import { noteAcked } from "../storage/saveStoreAcked";
import {
  fromTowerFile,
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

/** Armed once per session by the first routed write; see the read-back note. */
let firstWriteVerified = false;

/**
 * Per-ADDRESS write counter. Session-scoped, and deliberately NOT persisted:
 * the port contract states the shell's high-water mark must not survive a
 * restart either, because a persisted mark would silently drop every write of
 * the next session once the game's counter started over.
 */
const seqByScope = new Map<SaveScopeToken, Map<string, number>>();

function nextSeq(address: { id: string; scope: SaveScopeToken }): number {
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
 * Where a write to `id` goes, shared by both write paths.
 *
 * A manual SLOT save overwrites the record where it LIVES, when one exists.
 * The live tower's origin decides only where a NEW record goes: without this,
 * a tower opened from an account scope and "Saved to slot 2" would write a
 * second slot-2 into the account namespace while the player's existing slot-2
 * record sat untouched in the shared one — two towers under one label, and
 * which the UI shows would depend on hydration order. The autosave id is
 * exempt on purpose: `auto` always follows the LIVE tower's origin, because
 * writing an account tower's progress over a shared `auto` record is the
 * cross-account leak the origin rule exists to prevent.
 */
function resolveTarget(resolved: SaveStoreSession, id: SaveSlotId) {
  if (id.startsWith("slot-")) {
    const existing = origin.hydratedOriginFor(id);
    if (existing !== undefined) {
      if (!resolved.scopes.some((s) => s.token === existing.scope)) {
        return { ok: false, refusal: "origin-gone" } as const;
      }
      return { ok: true, target: existing } as const;
    }
  }
  return resolveWriteTarget(resolved, id, origin.towerOrigin());
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
  // `!hydrated` refuses here too, not only in the callers: a session whose
  // hydration failed still has readers serving un-hydrated localStorage, and a
  // store write then lands where no reader looks (the split-brain rule the old
  // tripwire enforced, now carried by the fact itself).
  if (!store || !session || !hydrated) {
    // No store means no account context of its own, but the LIVE tower may
    // still have come from one earlier in this session. Consulting the
    // remembered shared-ness rather than answering `true` unconditionally is
    // what keeps this from becoming a leak if a store ever vanishes mid-session
    // while an account-scoped tower is open.
    return { ok: false, refusal: "no-store", localFallbackSafe: origin.towerOrigin() === undefined || origin.towerOriginShared() };
  }

  const resolved = resolveTarget(session, id);
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
    // `stale` is success-by-supersession: the store already committed newer
    // content for this address, so the tower is safe. Returned WITHOUT the
    // write-through below, which would regress the cache to this older value.
    if (code === "stale") return { ok: true };
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
  origin.adoptOriginIfUnset(resolved.target, headedForShared);

  // THE FIRST routed write per session is READ BACK. With the tripwire gone,
  // this is the public side's only defense against a shell whose `write`
  // resolves without persisting: unchecked, such a shell looks perfect all
  // session while every boot's hydration rolls the player back to whatever it
  // actually kept. A mismatch flips the session to degraded-refuse.
  if (!firstWriteVerified) {
    firstWriteVerified = true;
    try {
      const stored = await withTimeout(store.read(resolved.target.id, resolved.target.scope));
      if (stored !== contents) {
        hydrationReadFailed = true;
        hydrationAttempted = true;
        return { ok: false, refusal: "failed", localFallbackSafe: false };
      }
    } catch {
      hydrationReadFailed = true;
      hydrationAttempted = true;
      return { ok: false, refusal: "failed", localFallbackSafe: false };
    }
  }
  writeThroughCache(resolved.target.id, contents);
  return { ok: true };
}

/**
 * WRITE-THROUGH to the boot-hydrated cache, only ever called after the store
 * acknowledged a write. Without it, a mid-session "Load auto" served the
 * BOOT-TIME copy while the newer tower sat in the store: the real-towers
 * Electron harness caught exactly that. This does not make localStorage a save
 * target again: the cache is only written FROM a committed value, so there is
 * no independent copy and no which-is-newer question, and the coherence stamp
 * is updated in the same motion so the next boot's three-way sees an
 * acknowledged cache.
 */
function writeThroughCache(id: string, contents: string): void {
  if (!hydrated) return;
  const key = localStorageKeyFor(id);
  if (key === undefined) return;
  const back = fromTowerFile(contents);
  if (!back.ok) return;
  try {
    localStorage.setItem(key, back.value);
    noteAcked(id, back.value);
  } catch {
    /* a stale cache is survivable; the store has the tower */
  }
}

/** Slot ids where a both-moved conflict stashed the local value and the store
 *  won, for the boot flow's bulletin. Empty when hydration was clean. */
export function hydrationConflictIds(): readonly string[] {
  return hydrationConflicts;
}

/**
 * The SYNCHRONOUS write path, for the two callers that cannot await: a manual
 * save whose UI confirms success synchronously, and the crash flush that runs
 * immediately before a reload. Same origin rule, same seq counter, same
 * write-through, same result shape as the async path. It cannot READ BACK
 * (reads are async), so it deliberately does not touch `firstWriteVerified`:
 * the session's first ASYNC write still runs the lying-shell check whether or
 * not a sync write happened first.
 *
 * Absent `writeSync` on the port means the shell predates the member, and the
 * caller keeps its localStorage behavior exactly as a browser session would.
 */
export function writeTowerToStoreSync(id: SaveSlotId, contents: string): StoreWriteResult | "unsupported" {
  const store = getPlatform().saveStore;
  if (!store || !session || !hydrated) {
    return { ok: false, refusal: "no-store", localFallbackSafe: origin.towerOrigin() === undefined || origin.towerOriginShared() };
  }
  if (typeof store.writeSync !== "function") return "unsupported";
  const resolved = resolveTarget(session, id);
  if (!resolved.ok) {
    return { ok: false, refusal: resolved.refusal, localFallbackSafe: resolved.refusal === "no-store" };
  }
  const headedForShared = resolved.target.scope === session.sharedScope;
  let result: { ok: true } | { ok: false; code?: string };
  try {
    result = store.writeSync(resolved.target.id, contents, resolved.target.scope, nextSeq(resolved.target));
  } catch (err) {
    result = { ok: false, ...(saveStoreErrorCode(err) !== undefined ? { code: saveStoreErrorCode(err) } : {}) };
  }
  if (!result.ok) {
    // `stale` is NOT a failure: the store already holds newer content for this
    // address (a concurrent async write committed first), so the honest
    // outcome for the caller is success-by-supersession.
    if (result.code === "stale") return { ok: true };
    return {
      ok: false,
      refusal: "failed",
      ...(result.code !== undefined ? { code: result.code } : {}),
      localFallbackSafe: false,
    };
  }
  origin.adoptOriginIfUnset(resolved.target, headedForShared);
  writeThroughCache(resolved.target.id, contents);
  return { ok: true };
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
  firstWriteVerified = false;
  seqByScope.clear();
}
