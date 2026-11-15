/**
 * My Towers: the game's own folder of named tower files (owner, 2026-11-15,
 * layout A of the file space). Every file is kept exactly as it would sit on
 * the player's disk: a `.vctower` as the bytes Save As downloads, a 1994
 * `.TDT` as the bytes the player picked. Nothing here reads a tower; opening
 * one hands those bytes to the same importer a picked file goes to, so this
 * folder adds no save format of its own.
 *
 * It lives in its own IndexedDB database, apart from the autosave's
 * (`./saveStore`), so neither one's upgrades can block the other. The list of
 * files (names, kinds, sizes, times) is one record read once into memory, so
 * the File menu and the dialogs list it without waiting; each file's bytes are
 * read only when it is opened. Writes go to the database in order, and a tab
 * hears another tab's changes over a BroadcastChannel.
 */

export type TowerFileKind = "tower" | "tdt";

export interface TowerFileEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: TowerFileKind;
  /** The file's size in bytes. */
  readonly size: number;
  /** When it was last written, in milliseconds since 1970. */
  readonly modified: number;
}

/** The longest name a file may have. */
export const FILE_NAME_MAX = 60;

const DB_NAME = "verticopolis-files";
const DB_VERSION = 1;
const BODIES = "bodies";
const META = "meta";
/** The META record that lists every file. */
const INDEX = "index";
const CHANNEL = "verticopolis-files";

/** A write the device had no room for. */
export class FileSpaceFullError extends Error {
  constructor() {
    super("There's no room left on this device for that tower. Delete some towers and try again.");
    this.name = "FileSpaceFullError";
  }
}

/** A name another file already has. */
export class FileNameTakenError extends Error {
  constructor(name: string) {
    super(`A tower named "${name}" already exists.`);
    this.name = "FileNameTakenError";
  }
}

/** A name as a file keeps it: control characters and the characters a disk
 *  refuses in a file name are dropped, runs of spaces become one, and it is
 *  cut at {@link FILE_NAME_MAX}. Empty when nothing is left. */
export function cleanFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const kept = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "");
  return kept.replace(/\s+/g, " ").trim().slice(0, FILE_NAME_MAX).trim();
}

/** Two names that differ only in case name the same file, as on most disks. */
const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

interface Open {
  readonly db: IDBDatabase;
  entries: TowerFileEntry[];
  readonly channel: BroadcastChannel | null;
  pending: Promise<unknown>;
}

let open: Open | null = null;
let opening: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The tower folder's write was aborted."));
  });
}

/** A failed write as the player's reason: a full device, or the error itself. */
function asWriteError(err: unknown): unknown {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" ? new FileSpaceFullError() : err;
}

/** The index record as entries, dropping any row that is not one. */
function readIndex(value: unknown): TowerFileEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is TowerFileEntry =>
      typeof e === "object" &&
      e !== null &&
      typeof e.id === "string" &&
      typeof e.name === "string" &&
      (e.kind === "tower" || e.kind === "tdt") &&
      typeof e.size === "number" &&
      typeof e.modified === "number",
  );
}

async function loadIndex(db: IDBDatabase): Promise<TowerFileEntry[]> {
  const tx = db.transaction(META, "readonly");
  return readIndex(await done(tx.objectStore(META).get(INDEX)));
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Run `write` after every write before it. Each write sets the new list
 *  itself once its transaction commits. */
function queue<T>(o: Open, write: () => Promise<T>): Promise<T> {
  const run = o.pending.then(write, write);
  o.pending = run.catch(() => undefined);
  return run;
}

/** A write's plan: the new list, a body to put (or remove with `null`), and
 *  what the write answers. */
interface Change<T> {
  readonly entries: TowerFileEntry[];
  readonly body?: { readonly id: string; readonly bytes: Uint8Array | null };
  readonly result: T;
}

/**
 * Run one write in one readwrite transaction that reads the list first, so
 * the plan always starts from the list as it is on disk: another tab's write
 * that this tab has not heard of yet is kept, never overwritten (#2319
 * review). `bodyOf` also reads that file's bytes for the plan. A plan that
 * throws writes nothing and the write rejects with its error.
 */
function update<T>(o: Open, plan: (list: TowerFileEntry[], body: Uint8Array | null) => Change<T>, bodyOf?: string): Promise<T> {
  return queue(o, async () => {
    const tx = o.db.transaction([META, BODIES], "readwrite");
    const out: { change: Change<T> | null; refused: unknown } = { change: null, refused: null };
    const indexReq = tx.objectStore(META).get(INDEX);
    const bodyReq = bodyOf === undefined ? null : tx.objectStore(BODIES).get(bodyOf);
    // Requests in one transaction answer in order, so the last one's answer
    // comes after every read the plan needs.
    (bodyReq ?? indexReq).onsuccess = () => {
      let change: Change<T>;
      try {
        change = plan(readIndex(indexReq.result), bodyReq?.result instanceof Uint8Array ? bodyReq.result : null);
      } catch (err) {
        out.refused = err;
        return;
      }
      if (change.body?.bytes) tx.objectStore(BODIES).put(change.body.bytes, change.body.id);
      else if (change.body) tx.objectStore(BODIES).delete(change.body.id);
      tx.objectStore(META).put(change.entries, INDEX);
      out.change = change;
    };
    try {
      await committed(tx);
    } catch (err) {
      throw asWriteError(err);
    }
    if (!out.change) throw out.refused ?? new Error("The tower folder's write was aborted.");
    o.entries = out.change.entries;
    o.channel?.postMessage("changed");
    changed();
    return out.change.result;
  });
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** `name`, or the first of "name (2)", "name (3)" and up that no file has. */
export function freeName(name: string, entries: readonly TowerFileEntry[]): string {
  const clean = cleanFileName(name);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const candidate = cleanFileName(clean.slice(0, FILE_NAME_MAX - suffix.length) + suffix);
    if (!entries.some((e) => sameName(e.name, candidate))) return candidate;
  }
}

/** A file to write, for {@link fileSpace.addOnce}. */
export interface NewTowerFile {
  readonly name: string;
  readonly kind: TowerFileKind;
  readonly bytes: Uint8Array;
  readonly modified: number;
}

/** The first free "Copy of …" name, the way a desktop names a pasted copy. */
export function copyName(name: string, entries: readonly TowerFileEntry[]): string {
  for (let n = 1; ; n++) {
    const prefix = n === 1 ? "Copy of " : `Copy (${n}) of `;
    const candidate = cleanFileName(prefix + name);
    if (!entries.some((e) => sameName(e.name, candidate))) return candidate;
  }
}

function need(): Open {
  if (!open) throw new Error("The tower folder isn't open.");
  return open;
}

async function connect(factory: IDBFactory): Promise<boolean> {
  try {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    const db = await done(req);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    const o: Open = { db, entries: await loadIndex(db), channel, pending: Promise.resolve() };
    open = o;
    if (channel)
      channel.onmessage = () => {
        void loadIndex(db).then((entries) => {
          if (open !== o) return;
          o.entries = entries;
          changed();
        });
      };
    db.onversionchange = () => {
      if (open !== o) return;
      channel?.close();
      db.close();
      open = null;
      opening = null;
      changed();
    };
    return true;
  } catch {
    opening = null;
    return false;
  }
}

export const fileSpace = {
  /** Open the folder once; false when IndexedDB is missing or refuses (some
   *  private windows), and the folder stays closed. Never rejects. */
  open(factory?: IDBFactory): Promise<boolean> {
    if (open) return Promise.resolve(true);
    const f = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!f) return Promise.resolve(false);
    opening ??= connect(f);
    return opening;
  },
  isOpen(): boolean {
    return open !== null;
  },
  /** Every file, newest first; empty while the folder is closed. */
  list(): TowerFileEntry[] {
    return open ? [...open.entries].sort((a, b) => b.modified - a.modified) : [];
  },
  /** The file called `name`, in any case. */
  find(name: string): TowerFileEntry | undefined {
    return open?.entries.find((e) => sameName(e.name, name));
  },
  get(id: string): TowerFileEntry | undefined {
    return open?.entries.find((e) => e.id === id);
  },
  /** How many files the folder holds and their bytes. */
  usage(): { count: number; bytes: number } {
    const entries = open?.entries ?? [];
    return { count: entries.length, bytes: entries.reduce((sum, e) => sum + e.size, 0) };
  },
  /** A file's bytes, or null when it is gone. */
  async read(id: string): Promise<Uint8Array | null> {
    const o = need();
    const tx = o.db.transaction(BODIES, "readonly");
    const bytes = await done(tx.objectStore(BODIES).get(id));
    return bytes instanceof Uint8Array ? bytes : null;
  },
  /**
   * Write `bytes` as the file `name`. A file with that name (in any case) is
   * replaced, keeping its place; the caller asks the player first. With
   * `replace` false, a file of that name on disk (one another tab just made,
   * say) rejects with {@link FileNameTakenError} instead. Rejects with
   * {@link FileSpaceFullError} when the device has no room, and nothing
   * changes then.
   */
  save(name: string, kind: TowerFileKind, bytes: Uint8Array, modified = Date.now(), replace = true): Promise<TowerFileEntry> {
    const o = need();
    const clean = cleanFileName(name);
    if (!clean) return Promise.reject(new Error("Type a name for the tower."));
    return update(o, (list) => {
      const old = list.find((e) => sameName(e.name, clean));
      if (old && !replace) throw new FileNameTakenError(old.name);
      const entry: TowerFileEntry = { id: old?.id ?? newId(), name: clean, kind, size: bytes.byteLength, modified };
      const entries = old ? list.map((e) => (e.id === old.id ? entry : e)) : [...list, entry];
      return { entries, body: { id: entry.id, bytes }, result: entry };
    });
  },
  /**
   * Add `bytes` as a new file, under `name` or, when that is taken, the first
   * free "name (2)" and up, so nothing is replaced. The name is picked from
   * the list as the write reads it.
   */
  add(name: string, kind: TowerFileKind, bytes: Uint8Array, modified = Date.now()): Promise<TowerFileEntry> {
    const o = need();
    const clean = cleanFileName(name) || "Tower";
    return update(o, (list) => {
      const entry: TowerFileEntry = { id: newId(), name: freeName(clean, list), kind, size: bytes.byteLength, modified };
      return { entries: [...list, entry], body: { id: entry.id, bytes }, result: entry };
    });
  },
  /** Give file `id` a new name; rejects with {@link FileNameTakenError} when
   *  another file has it. */
  rename(id: string, name: string): Promise<TowerFileEntry> {
    const o = need();
    const clean = cleanFileName(name);
    if (!clean) return Promise.reject(new Error("Type a name for the tower."));
    return update(o, (list) => {
      const entry = list.find((e) => e.id === id);
      if (!entry) throw new Error("That tower is gone.");
      if (list.some((e) => e.id !== id && sameName(e.name, clean))) throw new FileNameTakenError(clean);
      const renamed = { ...entry, name: clean };
      return { entries: list.map((e) => (e.id === id ? renamed : e)), result: renamed };
    });
  },
  /** A copy of file `id` beside it, named "Copy of …" (then "Copy (2) of …"
   *  and up) so it never replaces another file. */
  duplicate(id: string): Promise<TowerFileEntry> {
    const o = need();
    return update(
      o,
      (list, bytes) => {
        const entry = list.find((e) => e.id === id);
        if (!entry || !bytes) throw new Error("That tower is gone.");
        const copy: TowerFileEntry = { ...entry, id: newId(), name: copyName(entry.name, list), modified: Date.now() };
        return { entries: [...list, copy], body: { id: copy.id, bytes }, result: copy };
      },
      id,
    );
  },
  remove(id: string): Promise<void> {
    const o = need();
    return update(o, (list) => ({ entries: list.filter((e) => e.id !== id), body: { id, bytes: null }, result: undefined }));
  },
  /**
   * Add `files` (each under a free name) and set the flag `key`, all in one
   * transaction, unless the flag is set already. The flag and the list are
   * read inside that transaction, so two tabs doing this at once add the
   * files once. Resolves to how many files were added.
   */
  addOnce(key: string, files: readonly NewTowerFile[]): Promise<number> {
    const o = need();
    return queue(o, async () => {
      const tx = o.db.transaction([META, BODIES], "readwrite");
      const added: { entries: TowerFileEntry[] | null } = { entries: null };
      const meta = tx.objectStore(META);
      const flagReq = meta.get(key);
      flagReq.onsuccess = () => {
        if (flagReq.result === true) return;
        const indexReq = meta.get(INDEX);
        indexReq.onsuccess = () => {
          const list = readIndex(indexReq.result);
          for (const f of files) {
            const entry: TowerFileEntry = { id: newId(), name: freeName(f.name, list), kind: f.kind, size: f.bytes.byteLength, modified: f.modified };
            tx.objectStore(BODIES).put(f.bytes, entry.id);
            list.push(entry);
          }
          meta.put(list, INDEX);
          meta.put(true, key);
          added.entries = list;
        };
      };
      try {
        await committed(tx);
      } catch (err) {
        throw asWriteError(err);
      }
      if (!added.entries) return 0;
      o.entries = added.entries;
      o.channel?.postMessage("changed");
      changed();
      return files.length;
    });
  },
  /** A small flag kept with the folder (the one-time slot copy's). */
  async flag(key: string): Promise<boolean> {
    const o = need();
    const tx = o.db.transaction(META, "readonly");
    return (await done(tx.objectStore(META).get(key))) === true;
  },
  setFlag(key: string): Promise<void> {
    const o = need();
    return queue(o, async () => {
      const tx = o.db.transaction(META, "readwrite");
      tx.objectStore(META).put(true, key);
      await committed(tx);
    });
  },
  /** Hear every change to the list, this tab's or another's; returns the
   *  unsubscribe. */
  onChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Close the folder, for tests. */
export function closeFileSpaceForTests(): void {
  open?.channel?.close();
  open?.db.close();
  open = null;
  opening = null;
  listeners.clear();
}
