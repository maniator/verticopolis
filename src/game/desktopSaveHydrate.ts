import type { SaveRecord, SaveStorePort } from "../platform/saveStore";
import type { SaveAddress, SaveStoreSession } from "../storage/saveStoreSession";
import { MIGRATION_SOURCES, fromTowerFile, isSaveSlotId, localStorageKeyFor } from "../storage/saveMigration";

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
  | { readonly ok: true; readonly origins: ReadonlyMap<string, SaveAddress> }
  | { readonly ok: false; readonly reason: "read-failed" | "disagreement" };

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
export async function hydrateFromStore(store: SaveStorePort, resolved: SaveStoreSession): Promise<HydrationOutcome> {
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

  // AGREEMENT FIRST, before any read or write. A tower sitting in localStorage
  // that the store knows nothing about means the two do not describe the same
  // world, and hydrating would claim they do.
  //
  // An EMPTY store is not a failure: a fresh install has nothing to hydrate
  // and is trivially consistent. The case that matters is an empty store
  // beside a localStorage tower, reachable whenever the migration could not
  // move a value (no shared scope marked, a write that failed, a value the
  // codec refuses). All of those RECUR, which is why disagreement must never
  // read as degraded.
  const hydratedKeys = new Set(owned.map((entry) => entry.key));
  for (const { key } of MIGRATION_SOURCES) {
    if (hydratedKeys.has(key)) continue;
    try {
      if (localStorage.getItem(key) !== null) return { ok: false, reason: "disagreement" };
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

  // Snapshot before writing, so a quota failure part-way can put back exactly
  // what was there rather than leaving a store-flavored hybrid.
  const previous = new Map<string, string | null>();
  try {
    for (const { key } of pending) previous.set(key, localStorage.getItem(key));
    for (const { key, value } of pending) localStorage.setItem(key, value);
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

  // Origins only once the hydration is KNOWN good: an origin recorded for a
  // slot that was then abandoned would let autosave target a scope the readers
  // never saw.
  const origins = new Map<string, SaveAddress>();
  for (const { record } of owned) {
    if (isSaveSlotId(record.id)) origins.set(record.id, { id: record.id, scope: record.scope });
  }
  return { ok: true, origins };
}
