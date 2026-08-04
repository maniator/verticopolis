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

export type HydrationOutcome =
  | { readonly ok: true; readonly origins: ReadonlyMap<string, SaveAddress> }
  | { readonly ok: false };

/**
 * ALL OR NOTHING. If any record cannot be READ, hydration is abandoned whole
 * and the caller keeps localStorage as it stands. A partial hydration is the
 * one outcome that must never happen: a missing key reads as ABSENT,
 * `hasSave()` goes false, the splash offers New Tower instead of Continue, and
 * the first autosave commits over a real save. A slow disk would delete a
 * tower, with a UI that invited it.
 *
 * A record that cannot be CONVERTED is a different matter and is written
 * VERBATIM. Its `.vctower` text does not start with `VCZ1:`, so `readSlot`
 * treats it as a legacy raw-JSON value, fails to parse it, and returns null,
 * while `getItem` still reports the key present. That is exactly the
 * present-but-unreadable state the saves UI already has wording for, and it
 * keeps the bytes for a build that can read them. Skipping such a record would
 * reintroduce the false absence above.
 *
 * On success, reports each hydrated slot's ORIGIN (the scope its record came
 * from), captured here because this is the one moment the store's answer and
 * localStorage's contents are known to describe the same bytes.
 */
export async function hydrateFromStore(store: SaveStorePort, resolved: SaveStoreSession): Promise<HydrationOutcome> {
  const owned = resolved.records
    .map((record) => ({ record, key: localStorageKeyFor(record.id) }))
    .filter((entry): entry is { record: SaveRecord; key: string } => entry.key !== undefined);

  // Read EVERYTHING first, and only then write. Interleaving would leave
  // localStorage half-overwritten when a later read fails, which is the partial
  // state this is built to avoid.
  const pending: { key: string; value: string }[] = [];
  for (const { record, key } of owned) {
    let text: string | null;
    try {
      text = await withTimeout(store.read(record.id, record.scope));
    } catch {
      return { ok: false };
    }
    // A null here is ambiguous: absent, or a read that timed out. Neither is
    // safe to treat as "no tower", so both abandon the whole hydration.
    if (text === null) return { ok: false };
    const converted = fromTowerFile(text);
    pending.push({ key, value: converted.ok ? converted.value : text });
  }

  try {
    for (const { key, value } of pending) localStorage.setItem(key, value);
  } catch {
    // Quota, or storage disabled. localStorage is left partly written, so say
    // so rather than claim a hydrated view: the caller treats failure as "no
    // store this session" and every reader falls back to what is already there.
    return { ok: false };
  }

  // A tower sitting in localStorage that the store knows nothing about means
  // the two do NOT agree, and hydrating says they do.
  //
  // An EMPTY store is not a failure: a fresh install has nothing to hydrate and
  // is trivially consistent, which is why this is checked instead of returning
  // early on an empty record list. But an empty store beside a localStorage
  // tower is the case that matters, and it is reachable today: the migration
  // skips entirely when the shell marks no shared scope. Routing writes then
  // would send the tower somewhere the readers cannot see, which is the exact
  // split-brain the whole arrangement is built to avoid.
  const hydratedKeys = new Set(owned.map((entry) => entry.key));
  for (const { key } of MIGRATION_SOURCES) {
    if (hydratedKeys.has(key)) continue;
    try {
      if (localStorage.getItem(key) !== null) return { ok: false };
    } catch {
      // Storage that refuses to be read cannot be shown to agree either.
      return { ok: false };
    }
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
