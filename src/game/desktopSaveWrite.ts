import { getPlatform } from "../platform";
import { saveStoreErrorCode, type SaveScopeToken } from "../platform/saveStore";
import { fromTowerFile, localStorageKeyFor, sameTowerFile, type SaveSlotId } from "../storage/saveMigration";
import { noteAcked } from "../storage/saveStoreAcked";
import {
  resolveWriteTarget,
  type SaveAddress,
  type SaveStoreSession,
  type WriteRefusal,
} from "../storage/saveStoreSession";
import * as origin from "./desktopSaveOrigin";
import { withTimeout } from "./desktopSaveHydrate";
import { markStoreBridgeDegraded, saveStoreSession, storeIsAuthoritative } from "./desktopSaveStore";

/**
 * The desktop WRITE paths: the async route the periodic autosave takes and the
 * sync route the manual saves and the crash flush take. Split out of
 * `desktopSaveStore.ts` at the 500-line guard; that module owns the session
 * and hydration facts these paths consult, this one owns how a tower gets
 * INTO the store and what the caller is told when it cannot.
 */

/**
 * Per-ADDRESS write counter. Session-scoped, and deliberately NOT persisted:
 * the port contract states the shell's high-water mark must not survive a
 * restart either, because a persisted mark would silently drop every write of
 * the next session once the game's counter started over.
 */
const seqByScope = new Map<SaveScopeToken, Map<string, number>>();

export function nextSeq(address: { id: string; scope: SaveScopeToken }): number {
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
 * The newest COMMITTED write per address this session: its seq and contents.
 *
 * Exists because the two write paths interleave. A sync manual save can
 * commit between an async autosave's acknowledgment and its continuation, and
 * without this record the async continuation did two wrong things a review
 * caught: its read-back saw the newer bytes and flipped a healthy session to
 * degraded as a "lying shell", and its write-through regressed the cache and
 * the coherence stamp to the older tower, so a mid-session Load served a save
 * the player had already superseded.
 */
const committedByScope = new Map<SaveScopeToken, Map<string, { seq: number; order: number; contents: string }>>();

/** Renderer-order commit ordinal, GLOBAL across addresses. Exists because
 *  `seq` cannot order commits across scopes: it is minted per (id, scope), so
 *  a fresh scope's seq 1 can be newer in time than another scope's seq 10. */
let commitOrder = 0;

function committedAt(address: SaveAddress): { seq: number; contents: string } | undefined {
  return committedByScope.get(address.scope)?.get(address.id);
}

/**
 * The ADDRESS of `id`'s newest committed write this session, or undefined
 * when nothing committed. The stored-byte export needs it because a review
 * caught the id-only shape: the flush routes origin-aware, so `auto` can
 * live in a non-default scope, and the shell must be told WHICH record to
 * copy rather than guessing between scopes.
 *
 * Newest by COMMIT ORDER, not by seq: a second review pass caught that
 * comparing seq across scopes compares unrelated counters (play a shared
 * tower until its auto seq reaches 10, load an account tower whose scope's
 * counter starts at 1, and the seq comparison hands back the OLD tower's
 * record). The ordinal reflects renderer commit order, which is exact for
 * the export flow because its sync flush and this read share one task.
 */
export function committedAddressFor(id: string): SaveAddress | undefined {
  let best: { scope: SaveScopeToken; order: number } | undefined;
  for (const [scope, byId] of committedByScope) {
    const entry = byId.get(id);
    if (entry && (best === undefined || entry.order > best.order)) best = { scope, order: entry.order };
  }
  return best === undefined ? undefined : { id: id as SaveAddress["id"], scope: best.scope };
}

/** Whether the first routed ASYNC write of this session was verified yet; see
 *  the read-back in {@link writeTowerToStore}. */
let firstWriteVerified = false;

/**
 * Start times of async `store.write` calls still in flight, for the
 * renderer-side circuit breaker: `sendSync` has no timeout, so a hung MAIN
 * process would freeze the sync path (and with it the crash flush) forever.
 * An async write pending past the threshold is the observable symptom, and
 * while it stands the sync path refuses instead of blocking, which turns "the
 * crash screen never appears" into an honest `flushed: false`.
 */
const inflightWriteStarts: number[] = [];
const STALLED_WRITE_MS = 5000;

/** Evidence from OUTSIDE this module that a bridge write hung: boot's
 *  reconcile-forward timing out is the same symptom seen earlier. Standing
 *  evidence, cleared by the next async write that actually commits, so one
 *  transient boot hiccup does not refuse manual saves all session. */
let bridgeStallEvidence = false;

export function noteBridgeStallEvidence(): void {
  bridgeStallEvidence = true;
}

export function storeWriteStalled(): boolean {
  if (bridgeStallEvidence) return true;
  const now = Date.now();
  return inflightWriteStarts.some((started) => now - started > STALLED_WRITE_MS);
}

/**
 * Where a write to `id` goes, shared by both write paths.
 *
 * A manual SLOT save overwrites the record where it LIVES, when one exists.
 * The live tower's origin decides only where a NEW record goes: without this,
 * a tower opened from an account scope and "Saved to slot 2" would write a
 * second slot-2 into the account namespace while the player's existing slot-2
 * record sat untouched in the shared one, leaving two towers under one label,
 * and which the UI showed would depend on hydration order. The autosave id is
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
 * Bookkeeping for a write the store COMMITTED: remember it as the address's
 * newest content (unless a higher seq already committed, in which case this
 * write was superseded mid-flight and must not touch the cache or the stamp),
 * refresh the write-through cache, and record that the slot's live record now
 * exists at this address, so a delete this session can find it.
 */
function commitWrite(target: SaveAddress, seq: number, contents: string): void {
  if (target.id.startsWith("slot-")) origin.noteRecordAt(target.id, target);
  const latest = committedAt(target);
  if (latest !== undefined && latest.seq > seq) return;
  let byId = committedByScope.get(target.scope);
  if (!byId) {
    byId = new Map();
    committedByScope.set(target.scope, byId);
  }
  byId.set(target.id, { seq, order: ++commitOrder, contents });
  writeThroughCache(target.id, contents);
}

/**
 * Write a tower to the store, honoring the origin rule.
 *
 * The async write path (the periodic autosave). It never falls back to
 * localStorage and never falls back to a different scope: a refusal is
 * returned, and the caller decides what to tell the player.
 *
 * That no-fallback posture is the whole point. Writing a tower opened from one
 * account's directory into the shared namespace, because the account directory
 * went away mid-session, would put it where every account on the machine can
 * read it. Losing one autosave tick is recoverable; that is not.
 */
export async function writeTowerToStore(id: SaveSlotId, contents: string): Promise<StoreWriteResult> {
  const store = getPlatform().saveStore;
  const session = saveStoreSession();
  // `!storeIsAuthoritative()` refuses here too, not only in the callers: a
  // session whose hydration failed still has readers serving un-hydrated
  // localStorage, and a store write then lands where no reader looks (the
  // split-brain rule the old tripwire enforced, now carried by the fact
  // itself).
  if (!store || !session || !storeIsAuthoritative()) {
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

  const seq = nextSeq(resolved.target);
  const startedAt = Date.now();
  inflightWriteStarts.push(startedAt);
  try {
    await store.write(resolved.target.id, contents, resolved.target.scope, seq);
    // A committed async write is proof the bridge is alive again.
    bridgeStallEvidence = false;
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
    // commit below, which would regress the cache to this older value.
    if (code === "stale") return { ok: true };
    return {
      ok: false,
      refusal: "failed",
      ...(code !== undefined ? { code } : {}),
      localFallbackSafe: headedForShared,
    };
  } finally {
    const at = inflightWriteStarts.indexOf(startedAt);
    if (at !== -1) inflightWriteStarts.splice(at, 1);
  }
  // A tower that had NO origin has one now, so the next autosave targets the
  // scope this one landed in rather than re-deciding from the default. Guarded
  // on absence: an unconditional assignment also overwrote the id, so a tower
  // opened from slot-2 reported its origin as `auto` after one autosave tick.
  origin.adoptOriginIfUnset(resolved.target, headedForShared);

  // THE FIRST routed async write per session is READ BACK. With the tripwire
  // gone, this is the public side's only defense against a shell whose `write`
  // resolves without persisting: unchecked, such a shell looks perfect all
  // session while every boot's hydration rolls the player back to whatever it
  // actually kept. A mismatch flips the session to degraded-refuse.
  //
  // Two tolerances, both from review findings. The comparison is
  // `sameTowerFile`, never `!==`, because a store is entitled to normalize
  // line endings on the way through (the migration's own read-back says so)
  // and a strict compare would flip every session on such a shell. And bytes
  // matching a NEWER commit for the same address also pass, because a sync
  // manual save can land between this write's ack and this read, and reading
  // the newer tower back is the shell working, not lying.
  if (!firstWriteVerified) {
    firstWriteVerified = true;
    try {
      const stored = await withTimeout(store.read(resolved.target.id, resolved.target.scope));
      const newer = committedAt(resolved.target);
      const matchesThis = typeof stored === "string" && sameTowerFile(stored, contents);
      const matchesNewer =
        typeof stored === "string" && newer !== undefined && newer.seq > seq && sameTowerFile(stored, newer.contents);
      if (!matchesThis && !matchesNewer) {
        markStoreBridgeDegraded();
        return { ok: false, refusal: "failed", localFallbackSafe: false };
      }
    } catch {
      markStoreBridgeDegraded();
      return { ok: false, refusal: "failed", localFallbackSafe: false };
    }
  }
  commitWrite(resolved.target, seq, contents);
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
  if (!storeIsAuthoritative()) return;
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

/**
 * The SYNCHRONOUS write path, for the two callers that cannot await: a manual
 * save whose UI confirms success synchronously, and the crash flush that runs
 * immediately before a reload. Same origin rule, same seq counter, same
 * write-through, same result shape as the async path. It cannot READ BACK
 * (reads are async), so it deliberately does not touch `firstWriteVerified`:
 * the session's first ASYNC write still runs the lying-shell check whether or
 * not a sync write happened first.
 *
 * Absent `writeSync` on the port means the shell predates the member; the
 * caller keeps its localStorage behavior exactly as a browser session would,
 * but ONLY for a shared-headed tower. An account-headed tower on such a shell
 * is refused instead: the "unsupported" fallback ran before the origin rule
 * in an earlier revision, and a review showed that wrote an account tower
 * into localStorage for the next boot's migration to sweep into the shared
 * namespace, the two-step leak every other path here closes.
 */
export function writeTowerToStoreSync(id: SaveSlotId, contents: string): StoreWriteResult | "unsupported" {
  const store = getPlatform().saveStore;
  const session = saveStoreSession();
  if (!store || !session || !storeIsAuthoritative()) {
    return { ok: false, refusal: "no-store", localFallbackSafe: origin.towerOrigin() === undefined || origin.towerOriginShared() };
  }
  // The circuit breaker (see inflightWriteStarts): while an async write hangs,
  // a sendSync into the same main process would hang the RENDERER, and the
  // crash flush is this path's most important caller. Refusing is honest;
  // blocking forever on a crash screen is not.
  if (storeWriteStalled()) {
    return { ok: false, refusal: "failed", code: "stalled", localFallbackSafe: false };
  }
  const resolved = resolveTarget(session, id);
  if (!resolved.ok) {
    return { ok: false, refusal: resolved.refusal, localFallbackSafe: resolved.refusal === "no-store" };
  }
  const headedForShared = resolved.target.scope === session.sharedScope;
  if (typeof store.writeSync !== "function") {
    return headedForShared
      ? "unsupported"
      : { ok: false, refusal: "failed", code: "unsupported", localFallbackSafe: false };
  }
  const seq = nextSeq(resolved.target);
  let result: { ok: boolean; code?: string };
  try {
    result = store.writeSync(resolved.target.id, contents, resolved.target.scope, seq);
  } catch (err) {
    const code = saveStoreErrorCode(err);
    result = { ok: false, ...(code !== undefined ? { code } : {}) };
  }
  // A malformed answer (undefined, a bare boolean) reads as a FAILURE, not a
  // crash: without this guard the `.ok` read below threw a raw TypeError out
  // through Quick Save's toast and blocked `saveBeforeUpdate` forever.
  if (typeof result !== "object" || result === null || typeof result.ok !== "boolean") {
    result = { ok: false };
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
  commitWrite(resolved.target, seq, contents);
  return { ok: true };
}

/** Test seam, called by `resetSaveStoreForTests`. */
export function resetSaveWriteForTests(): void {
  seqByScope.clear();
  committedByScope.clear();
  commitOrder = 0;
  firstWriteVerified = false;
  inflightWriteStarts.length = 0;
  bridgeStallEvidence = false;
}
