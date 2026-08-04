import type { SaveRecord, SaveStorePort } from "../platform/saveStore";
import type { SaveAddress, SaveStoreSession } from "../storage/saveStoreSession";
import { MIGRATION_SOURCES, fromTowerFile, isSaveSlotId, localStorageKeyFor, toTowerFile } from "../storage/saveMigration";
import { ackedHash, coherenceHash, noteAcked } from "../storage/saveStoreAcked";

/**
 * Boot-time hydration: materializing the store's records into localStorage,
 * once, before `SaveGame` is first touched. Split out of `desktopSaveStore.ts`
 * at the 500-line guard; the caller there owns WHEN this runs and what its
 * outcome means, this module owns HOW.
 *
 * HYDRATION rather than substitution, and the difference is the whole design.
 * Swapping `SaveGame`'s storage accessor for a map over the async store looked
 * tidier and was rejected: `SaveGame`'s logic is written against storage that
 * is synchronous, atomic, THROWING and quota-bounded, and it never restates
 * those assumptions because it never had to. A map is none of the four, so the
 * swap silently reroutes four write paths, turns `writeSlot`'s quota dance into
 * an unconditional delete, and makes `saveBeforeUpdate` report success for a
 * write still in flight. Writing real values into real localStorage keeps every
 * one of those invariants literally true.
 */

/**
 * Bound anything that crosses the bridge during boot.
 *
 * "Never rejects" was not the same as "never hangs", and the difference is the
 * whole boot: this is awaited before first paint, so a shell that accepts a
 * call and never answers leaves the player on a blank page with no splash, no
 * message, and no reload button. A rejection at least degrades to localStorage.
 */
const BOOT_STORE_TIMEOUT_MS = 3000;

export async function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The loser of the race is not abandoned unobserved: a slow REJECTION
    // arriving after the timeout would otherwise surface as an unhandled
    // rejection, which in an Electron shell can mean a dialog or a crash log.
    work.catch(() => {});
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), BOOT_STORE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    // Cleared on the winning path too. Losing the race does not cancel the
    // timer, so a fast success still left a 3s handle holding the race closure.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Three-way, and the split decides whether saving pauses.
 *
 * `read-failed` means the bridge itself failed: a read rejected, timed out, or
 * answered with something that is not a string. TRANSIENT by nature, so the
 * caller treats it as degraded, refuses saves, and a restart genuinely may fix
 * it.
 *
 * `disagreement` means both sides answered fine and the CONTENTS do not line
 * up: localStorage holds a tower the store knows nothing about, or the shell's
 * snapshot is malformed. RECURRING by nature, because the same comparison runs
 * every boot. An earlier revision folded this into degraded, which paused
 * saving forever behind copy promising a restart would fix it; a restart
 * replays the identical comparison. Disagreement therefore reads as "store
 * mode simply not on", the session stays browser-equivalent, and localStorage
 * keeps working exactly as it always has.
 */
export type HydrationOutcome =
  | {
      readonly ok: true;
      readonly origins: ReadonlyMap<string, SaveAddress>;
      /** Slot ids where BOTH sides had moved: the local value was stashed to a
       *  conflict key and the store won. The caller tells the player. */
      readonly conflicts: readonly string[];
    }
  | { readonly ok: false; readonly reason: "read-failed" | "disagreement" };

/** Where a both-moved conflict's local value is stashed before the store wins.
 *  Machine-local, never migrated, never synced, and deliberately not a slot
 *  key: it is evidence for recovery, not a save. */
export function conflictStashKey(id: string): string {
  return `vc-conflict-${id}`;
}

/** Player-facing wording for a both-moved conflict, per slot id. Lives beside
 *  the three-way that produces the ids so the wording and the mechanism stay
 *  in one view, and so the boot flow's bulletin is unit-testable without a
 *  DOM app shell. */
export function conflictBulletinText(id: string): string {
  const label = id === "auto" || id === "auto-legacy" ? "your autosave" : `save slot ${id.replace("slot-", "")}`;
  return (
    `⚠️ This computer and your synced saves disagreed about ${label}. ` +
    "The synced copy was kept; the local copy was set aside in case you need it."
  );
}

/**
 * Whether `cache` and `value` describe the SAME stored bytes, differing only
 * by representation: a pre-compression raw-JSON cache beside the VCZ1 form
 * the migration deflated it into, or a preserve stash beside its re-encoded
 * store form. Decided by running the cache through the same forward-and-back
 * pipeline the migration and hydration themselves use, so the comparison is
 * exact for anything they produced and never a heuristic.
 *
 * Without this, a legacy player's FIRST desktop boot read its own migration's
 * output as a both-moved conflict: no stamp exists yet, the raw-JSON cache
 * does not string-match the deflated store value, and the conservative branch
 * stashed the cache and warned about a sync divergence on a machine that has
 * never synced anything.
 */
function sameStoredValue(cache: string, value: string, preserve: boolean): boolean {
  const forward = toTowerFile(cache, preserve);
  if (!forward.ok) return false;
  const round = fromTowerFile(forward.text, preserve);
  return round.ok && round.value === value;
}

/**
 * ALL OR NOTHING, in every phase.
 *
 * If any record cannot be READ, hydration is abandoned whole and the caller
 * keeps localStorage as it stands. A partial hydration is the one outcome that
 * must never happen: a missing key reads as ABSENT, `hasSave()` goes false,
 * the splash offers New Tower instead of Continue, and the first autosave
 * commits over a real save. A slow disk would delete a tower, with a UI that
 * invited it.
 *
 * The AGREEMENT check runs BEFORE anything is written. An earlier revision ran
 * it after, so a failing check left localStorage already overwritten with
 * store copies while the caller was told "localStorage as it stands". And if a
 * write fails partway (quota), everything already written is ROLLED BACK from
 * a snapshot taken first, so the failure paths actually deliver the sentence
 * above instead of merely citing it.
 *
 * A record that cannot be CONVERTED is written VERBATIM. Its `.vctower` text
 * does not start with `VCZ1:`, so `readSlot` treats it as a legacy raw-JSON
 * value, fails to parse it, and returns null, while `getItem` still reports
 * the key present. That is exactly the present-but-unreadable state the saves
 * UI already has wording for, and it keeps the bytes for a build that can read
 * them. Skipping such a record would reintroduce the false absence above.
 *
 * On success, reports each hydrated slot's ORIGIN (the scope its record came
 * from), captured here because this is the one moment the store's answer and
 * localStorage's contents are known to describe the same bytes.
 */
export async function hydrateFromStore(
  store: SaveStorePort,
  resolved: SaveStoreSession,
  mintSeq: (address: { id: string; scope: SaveRecord["scope"] }) => number,
): Promise<HydrationOutcome> {
  const owned = resolved.records
    .map((record) => ({ record, key: localStorageKeyFor(record.id) }))
    .filter((entry): entry is { record: SaveRecord; key: string } => entry.key !== undefined);

  // Two records for one id is a malformed snapshot: which tower survives would
  // depend on list order. Malformed is a disagreement, not a bridge failure,
  // so it must not pause saving.
  const seenIds = new Set<string>();
  for (const { record } of owned) {
    if (seenIds.has(record.id)) return { ok: false, reason: "disagreement" };
    seenIds.add(record.id);
  }

  // AGREEMENT FIRST, before any read or write, for STRAY keys: a READABLE
  // localStorage tower the store knows nothing about means the two do not
  // describe the same world (the migration could not move it, and retries
  // every boot, so this self-heals and must never read as degraded).
  //
  // An UNREADABLE stray is exempt, per the party-corrected F1 rule. It is
  // preserved bytes the migration reports `unreadable` forever, so treating it
  // as disagreement bricked store mode permanently. It stays where it is,
  // untouched: `hasSlot` still reports it present, the saves UI still shows
  // its row, and nothing here can write its id (the store has no record).
  const hydratedKeys = new Set(owned.map((entry) => entry.key));
  for (const { key } of MIGRATION_SOURCES) {
    if (hydratedKeys.has(key)) continue;
    try {
      const stray = localStorage.getItem(key);
      if (stray !== null && toTowerFile(stray).ok) return { ok: false, reason: "disagreement" };
    } catch {
      // Storage that refuses to be read cannot be shown to agree either, and
      // a broken localStorage is not the bridge's fault.
      return { ok: false, reason: "disagreement" };
    }
  }

  // Read EVERYTHING next, and only then write. Interleaving would leave
  // localStorage half-overwritten when a later read fails, which is the
  // partial state this is built to avoid.
  const pending: { key: string; value: string; id: string }[] = [];
  for (const { record, key } of owned) {
    let text: string | null;
    try {
      text = await withTimeout(store.read(record.id, record.scope));
    } catch {
      return { ok: false, reason: "read-failed" };
    }
    // A null is ambiguous (absent, or timed out), and a non-string is a port
    // that broke its contract. Neither is safe to treat as "no tower", so both
    // abandon the whole hydration as a bridge failure.
    if (typeof text !== "string") return { ok: false, reason: "read-failed" };
    // The unreadable stash is preserved BYTES, not a tower, so its payload is
    // not whitespace-normalized on the way back: verbatim in means verbatim
    // out, mirroring the forward migration's preserve mode.
    const converted = fromTowerFile(text, record.id === "unreadable");
    pending.push({ key, value: converted.ok ? converted.value : text, id: record.id });
  }

  // THE THREE-WAY, per held key, decided by the coherence stamp: which side
  // moved since the store last acknowledged a value. This replaces the
  // party-rejected "store wins, no comparison", whose two tower-loss
  // constructions (a browser-equivalent session's progress bulldozed when a
  // stray heals; Steam Cloud replacing files under a newer cache) both came
  // from overwriting without knowing which side moved.
  type Plan =
    | { kind: "write"; key: string; id: string; value: string }
    | { kind: "keep-acked"; id: string; value: string }
    | { kind: "reconcile"; key: string; id: string; cache: string; record: SaveRecord }
    | { kind: "conflict"; key: string; id: string; cache: string; value: string };
  const plans: Plan[] = [];
  for (const entry of pending) {
    const record = owned.find((o) => o.record.id === entry.id)!.record;
    let cache: string | null;
    try {
      cache = localStorage.getItem(entry.key);
    } catch {
      return { ok: false, reason: "disagreement" };
    }
    if (cache === entry.value) {
      // Coherent already; just refresh the stamp.
      plans.push({ kind: "keep-acked", id: entry.id, value: entry.value });
      continue;
    }
    if (cache === null) {
      // Nothing local: first hydration of this record, or a locally deleted
      // slot whose store delete did not land (resurrection is the accepted
      // lossless annoyance). Store wins.
      plans.push({ kind: "write", key: entry.key, id: entry.id, value: entry.value });
      continue;
    }
    if (sameStoredValue(cache, entry.value, entry.id === "unreadable")) {
      // Same bytes, two representations (see sameStoredValue): coherent. The
      // CACHE value is kept and stamped, so the readers keep serving exactly
      // what they already had and the next boot short-circuits here again.
      plans.push({ kind: "keep-acked", id: entry.id, value: cache });
      continue;
    }
    if (entry.id === "unreadable") {
      // The stash is preserved bytes and localStorage WINS for it: a fresh
      // stash is by definition the copy worth keeping, and the store's older
      // one was already superseded on this machine. The migration's
      // compare-and-replace pushes it forward.
      plans.push({ kind: "reconcile", key: entry.key, id: entry.id, cache, record });
      continue;
    }
    const acked = ackedHash(entry.id);
    if (acked !== undefined && coherenceHash(cache) === acked) {
      // The cache is exactly what the store last acknowledged, so the STORE
      // moved: Steam Cloud brought another machine's progress, which syncs
      // before launch by design. Store wins, legitimately.
      plans.push({ kind: "write", key: entry.key, id: entry.id, value: entry.value });
      continue;
    }
    if (acked !== undefined && coherenceHash(entry.value) === acked) {
      // The store is what it last acknowledged and the CACHE moved: local
      // progress from a browser-equivalent session. Reconcile it FORWARD into
      // the store rather than bulldozing it; the cache stays.
      plans.push({ kind: "reconcile", key: entry.key, id: entry.id, cache, record });
      continue;
    }
    // Both moved, or nothing was ever acknowledged (which must read
    // conservatively). Stash the local value first, then the store wins, and
    // the caller tells the player. Steam's own conflict dialog owns the
    // store-file side; this owns the residual.
    plans.push({ kind: "conflict", key: entry.key, id: entry.id, cache, value: entry.value });
  }

  // Snapshot before writing, so a quota failure part-way can put back exactly
  // what was there rather than leaving a store-flavored hybrid.
  const previous = new Map<string, string | null>();
  const conflicts: string[] = [];
  try {
    for (const plan of plans) {
      if (plan.kind === "write" || plan.kind === "conflict") previous.set(plan.key, localStorage.getItem(plan.key));
      // The stash key is part of the same transaction: a stash written before
      // a LATER setItem hit quota would otherwise survive the rollback as
      // debris, making the next boot's quota failure strictly likelier.
      if (plan.kind === "conflict") previous.set(conflictStashKey(plan.id), localStorage.getItem(conflictStashKey(plan.id)));
    }
    for (const plan of plans) {
      if (plan.kind === "conflict") {
        localStorage.setItem(conflictStashKey(plan.id), plan.cache);
        localStorage.setItem(plan.key, plan.value);
        conflicts.push(plan.id);
      } else if (plan.kind === "write") {
        localStorage.setItem(plan.key, plan.value);
      }
    }
  } catch {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // Rolling back into the same full storage can fail too; restoring is
        // best effort, and the caller still reports the hydration failed.
      }
    }
    return { ok: false, reason: "disagreement" };
  }

  // Reconcile-forward writes go LAST, after localStorage is settled, and a
  // failure does not fail the hydration: the cache keeps the newer value, no
  // stamp is written for that id, and the next boot simply retries. mintSeq is
  // the caller's counter so these writes obey the same per-address ordering as
  // every other.
  for (const plan of plans) {
    if (plan.kind !== "reconcile") continue;
    const forward = toTowerFile(plan.cache, plan.id === "unreadable");
    if (!forward.ok) continue; // unconvertible local bytes stay local
    try {
      const settled = await withTimeout(store.write(plan.record.id, forward.text, plan.record.scope, mintSeq(plan.record)));
      // `withTimeout` RESOLVES null on a timeout rather than rejecting, so a
      // hung write must be told apart from a committed one here: stamping a
      // write the shell may have dropped would make the NEXT boot read the
      // cache as "what the store acknowledged" and let the older store copy
      // win, silently, over the newer local tower (the one branch of the
      // three-way with no stash). No stamp on timeout; if the write actually
      // landed late, the next boot finds store == cache and stamps then.
      if (settled === null) continue;
      noteAcked(plan.id, plan.cache);
    } catch {
      /* retried next boot; the newer local value is untouched */
    }
  }
  for (const plan of plans) {
    if (plan.kind === "write" || plan.kind === "conflict") noteAcked(plan.id, plan.value);
    else if (plan.kind === "keep-acked") noteAcked(plan.id, plan.value);
  }

  // Origins only once the hydration is KNOWN good: an origin recorded for a
  // slot that was then abandoned would let autosave target a scope the readers
  // never saw.
  const origins = new Map<string, SaveAddress>();
  for (const { record } of owned) {
    if (isSaveSlotId(record.id)) origins.set(record.id, { id: record.id, scope: record.scope });
  }
  return { ok: true, origins, conflicts };
}
