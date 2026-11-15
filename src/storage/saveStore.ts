import { fromBase64, STORE_MAGIC, toBase64 } from "./saveCompression";

/**
 * Where the game keeps its saves: IndexedDB when it opens, localStorage
 * otherwise (the save-size plan, step 2).
 *
 * The save code reads and writes synchronously (a boot load, the Saved Towers
 * list, the flush right before a reload), and IndexedDB is asynchronous. So
 * boot opens the store once ({@link openSaveStore}) and reads every save into
 * memory; after that each read answers from memory, and each write updates
 * memory at once and reaches IndexedDB in the background, in order. Until
 * boot opens it, or when IndexedDB will not open (some private windows), the
 * store is plain localStorage, as every save was before.
 *
 * The `mirrored` keys are also written to localStorage on every write, and at
 * boot the newer of the two copies wins (a tie goes to the database); a key
 * localStorage no longer holds was deleted outside the store and leaves the
 * database too. A tab
 * the system kills right after a write still has the save there, and a build
 * from before this one still finds the player's towers. The game mirrors
 * every save for the first release on IndexedDB (rollback safety, see
 * `SAVE_STORE_KEYS`); a key it stops mirroring lives in IndexedDB alone, its
 * old localStorage copy is removed when the player deletes it, and a write of
 * it that fails in the database is reported to {@link saveStore.onFailure}.
 *
 * A compressed save (`VCZ1:` and base64) is kept in IndexedDB as its raw
 * deflate bytes, a third smaller than the base64 text. Another tab of the game
 * hears every write over a BroadcastChannel and updates its memory, as tabs
 * once shared localStorage; a tab writing localStorage alone is heard through
 * the `storage` event. A later build that upgrades the database closes this
 * connection, and the tab goes back to localStorage.
 */

const DB_NAME = "verticopolis";
const DB_VERSION = 1;
const SAVES = "saves";
const META = "meta";
/** The meta record that says the localStorage saves were copied in. */
const MIGRATED = "migrated-from-localStorage";
const CHANNEL = "verticopolis-saves";

/** A save as IndexedDB holds it: a compressed save's deflate bytes, or a
 *  stored text that is not compressed (a pre-compression save) as it is. */
type Stored = { packed: Uint8Array } | { text: string };

/** The keys the store manages, and which of them localStorage mirrors. */
export interface SaveStoreKeys {
  readonly managed: readonly string[];
  readonly mirrored: readonly string[];
}

/** The open store: every managed key's value, and the database it persists to. */
interface Open {
  readonly db: IDBDatabase;
  readonly values: Map<string, string>;
  readonly keys: SaveStoreKeys;
  readonly channel: BroadcastChannel | null;
  /** The writes not yet in IndexedDB, chained so they land in order. */
  pending: Promise<void>;
  /** The first write that failed since the last {@link saveStore.settled}. */
  failed: unknown;
}

let open: Open | null = null;
const failureListeners = new Set<(err: unknown, key: string) => void>();

/** A value as the database keeps it: a compressed save as its raw bytes when
 *  they give back the very same text, anything else (a damaged save kept
 *  aside, base64 written another way) as its text, so every value reads back
 *  byte for byte. */
function toStored(value: string): Stored {
  if (!value.startsWith(STORE_MAGIC)) return { text: value };
  const b64 = value.slice(STORE_MAGIC.length);
  try {
    const packed = fromBase64(b64);
    if (toBase64(packed) === b64) return { packed };
  } catch {
    // Not base64 at all: kept as text below.
  }
  return { text: value };
}

function fromStored(stored: unknown): string | null {
  if (typeof stored !== "object" || stored === null) return null;
  if ("packed" in stored && stored.packed instanceof Uint8Array) return STORE_MAGIC + toBase64(stored.packed);
  if ("text" in stored && typeof stored.text === "string") return stored.text;
  return null;
}

/** A request's result as a promise. */
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A transaction's completion as a promise: its writes are durable then. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The save store transaction was aborted."));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES);
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
  };
  return done(req);
}

/** Every managed key's value in the database. */
async function readAll(db: IDBDatabase, keys: readonly string[]): Promise<Map<string, string>> {
  const tx = db.transaction(SAVES, "readonly");
  const store = tx.objectStore(SAVES);
  const values = new Map<string, string>();
  await Promise.all(
    keys.map(async (key) => {
      const value = fromStored(await done(store.get(key)));
      if (value !== null) values.set(key, value);
    }),
  );
  return values;
}

/** One write: a key, its value (null deletes), and the value's deflate
 *  bytes when the writer already has them (`saveStore.set`). */
type Entry = readonly [key: string, value: string | null, packed?: Uint8Array];

/** Write `entries` in one transaction and wait for it. */
async function writeAll(db: IDBDatabase, entries: readonly Entry[], migrated = false): Promise<void> {
  const tx = db.transaction([SAVES, META], "readwrite");
  const store = tx.objectStore(SAVES);
  for (const [key, value, packed] of entries) {
    if (value === null) store.delete(key);
    else store.put(packed ? { packed } : toStored(value), key);
  }
  if (migrated) tx.objectStore(META).put(true, MIGRATED);
  await committed(tx);
}

/** `key`'s localStorage value, or undefined when localStorage cannot be read
 *  (so an unreadable store is never taken for one that lost the key). */
function localValue(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

/**
 * Copy the player's localStorage saves into a database that has never held
 * them, read them back, and only then mark the copy done. Answers false when
 * the copy did not read back whole, so the store stays on localStorage.
 */
async function migrate(db: IDBDatabase, keys: SaveStoreKeys): Promise<boolean> {
  const tx = db.transaction(META, "readonly");
  if ((await done(tx.objectStore(META).get(MIGRATED))) === true) return true;
  const copied = keys.managed.flatMap((key) => {
    const value = localValue(key);
    return value === null || value === undefined ? [] : [[key, value] as const];
  });
  await writeAll(db, copied);
  const back = await readAll(db, keys.managed);
  if (!copied.every(([key, value]) => back.get(key) === value)) return false;
  await writeAll(db, [], true);
  return true;
}

export interface OpenOptions {
  /** The IndexedDB factory; the window's by default. */
  readonly factory?: IDBFactory;
  /** The write time a stored autosave value carries, to pick the newer copy. */
  readonly savedAt: (value: string) => number | undefined;
  /** How long boot waits for the database before it plays on localStorage. */
  readonly timeoutMs?: number;
}

/** Boot waits this long for the database: an open that never answers (a
 *  browser bug, a blocked upgrade) must not hold the game at the loading line. */
const OPEN_TIMEOUT_MS = 4000;

/**
 * Open the store for `keys`: copy the localStorage saves in on the first run,
 * read every save into memory, and take the newer copy of each mirrored key
 * (a write the database lost when the tab was killed is still in
 * localStorage). Resolves false, with the store left on localStorage, when
 * IndexedDB is missing, will not open or copy, or does not answer in time;
 * never rejects.
 */
export async function openSaveStore(keys: SaveStoreKeys, opts: OpenOptions): Promise<boolean> {
  if (open) return true;
  const factory = opts.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory) return false;
  const connecting = connect(factory, keys, opts);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), opts.timeoutMs ?? OPEN_TIMEOUT_MS)));
  const answer = await Promise.race([connecting, late]);
  clearTimeout(timer);
  if (answer === "late") {
    // The game plays on localStorage now; a database that answers later is let go.
    void connecting.then((values) => values?.db.close());
    return false;
  }
  if (!answer) return false;
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  const o: Open = { db: answer.db, values: answer.values, keys, channel, pending: Promise.resolve(), failed: undefined };
  open = o;
  if (channel) channel.onmessage = (e: MessageEvent<{ key?: unknown; value?: unknown }>) => heard(e.data);
  // A tab whose store is not open (an older build, an open that timed out)
  // writes localStorage alone; its writes of a mirrored key reach memory here.
  if (typeof window !== "undefined") window.addEventListener("storage", heardLocal);
  // A later build that upgrades the database waits for every open
  // connection to close: this one closes at once and the tab goes back to
  // localStorage, which holds every mirrored save.
  o.db.onversionchange = () => {
    if (open === o) leave();
  };
  return true;
}

/** Close the database and go back to localStorage. */
function leave(): void {
  if (!open) return;
  open.channel?.close();
  open.db.close();
  open = null;
  if (typeof window !== "undefined") window.removeEventListener("storage", heardLocal);
}

/** Another tab wrote a mirrored key to localStorage, or cleared it (a null
 *  key), which deletes every mirrored save. */
function heardLocal(e: StorageEvent): void {
  if (!open || e.storageArea !== localStorage) return;
  if (e.key === null) for (const key of open.keys.mirrored) open.values.delete(key);
  else if (open.keys.mirrored.includes(e.key)) heard({ key: e.key, value: e.newValue });
}

/** The database and every managed key's value, or null (see {@link openSaveStore}). */
async function connect(factory: IDBFactory, keys: SaveStoreKeys, opts: OpenOptions): Promise<{ db: IDBDatabase; values: Map<string, string> } | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb(factory);
    if (!(await migrate(db, keys))) {
      db.close();
      return null;
    }
    const values = await readAll(db, keys.managed);
    const repairs: [string, string | null][] = [];
    for (const key of keys.mirrored) {
      const local = localValue(key);
      const stored = values.get(key);
      if (local === undefined || local === stored) continue;
      // Every write of a mirrored key reaches localStorage first, so a key it
      // no longer holds was deleted outside the store (an older build after a
      // rollback, a tab whose store did not open): the database copy goes too.
      if (local === null) {
        values.delete(key);
        repairs.push([key, null]);
        continue;
      }
      const localAt = opts.savedAt(local);
      const storedAt = stored === undefined ? undefined : opts.savedAt(stored);
      // A tie, or a copy whose time cannot be read, goes to the database.
      if (stored === undefined || (localAt !== undefined && (storedAt === undefined || localAt > storedAt))) {
        values.set(key, local);
        repairs.push([key, local]);
      }
    }
    if (repairs.length) await writeAll(db, repairs);
    return { db, values };
  } catch {
    db?.close();
    return null;
  }
}

/** Another tab wrote `key`: take its value into memory. */
function heard(data: { key?: unknown; value?: unknown }): void {
  if (!open || typeof data.key !== "string" || !open.keys.managed.includes(data.key)) return;
  if (typeof data.value === "string") open.values.set(data.key, data.value);
  else if (data.value === null) open.values.delete(data.key);
}

/** Queue `key`'s new value (null deletes) for the database, after the writes before it. */
function persist(o: Open, key: string, value: string | null, packed?: Uint8Array): void {
  o.channel?.postMessage({ key, value });
  o.pending = o.pending.then(
    () =>
      writeAll(o.db, [[key, value, packed]]).catch((err: unknown) => {
        o.failed ??= err;
        // A mirrored key is still whole in localStorage, which wins at boot
        // when the database copy is older, so only the others are reported.
        if (value !== null && !o.keys.mirrored.includes(key)) for (const listener of failureListeners) listener(err, key);
      }),
  );
}

function managed(key: string): Open | null {
  return open && open.keys.managed.includes(key) ? open : null;
}

export const saveStore = {
  /** The stored value of `key`, or null. */
  get(key: string): string | null {
    const o = managed(key);
    return o ? (o.values.get(key) ?? null) : localStorage.getItem(key);
  },
  /** Store `value` under `key`. Throws, writing nothing, when localStorage
   *  refuses a write it takes (a full quota); a database write that fails
   *  later is reported to {@link saveStore.onFailure} and by `settled`.
   *  `packed`, when given, must be the deflate bytes `value` (`VCZ1:` and
   *  their base64) carries: the database keeps them as they are, with no
   *  base64 decoded or checked on the main thread. */
  set(key: string, value: string, packed?: Uint8Array): void {
    const o = managed(key);
    if (!o || o.keys.mirrored.includes(key)) localStorage.setItem(key, value);
    if (!o) return;
    o.values.set(key, value);
    persist(o, key, value, packed);
  },
  /** Remove `key`, from localStorage too (an old copy there would come back
   *  in an older build). */
  remove(key: string): void {
    localStorage.removeItem(key);
    const o = managed(key);
    if (!o) return;
    o.values.delete(key);
    persist(o, key, null);
  },
  /** Resolves once every write so far is in the database, and rejects with the
   *  first one that failed since the last call. */
  async settled(): Promise<void> {
    if (!open) return;
    const o = open;
    await o.pending;
    const failed = o.failed;
    o.failed = undefined;
    if (failed !== undefined) throw failed;
  },
  /** Where the saves live now. */
  backend(): "indexedDB" | "localStorage" {
    return open ? "indexedDB" : "localStorage";
  },
  /** Hear each database write of a key localStorage does not mirror (a
   *  manual slot, the stash) that fails; returns the unsubscribe. */
  onFailure(listener: (err: unknown, key: string) => void): () => void {
    failureListeners.add(listener);
    return () => failureListeners.delete(listener);
  },
};

/** Close the store and go back to localStorage, for tests. */
export function closeSaveStoreForTests(): void {
  leave();
  failureListeners.clear();
}
