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
 * hears another tab's changes over a BroadcastChannel. Each tower file also
 * keeps its earlier versions here (`fileVersions.ts`), out of the list.
 */

import { cleanFileName, copyName, freeName, sameName } from "./fileNames";
import { originalVersion, planVersions, readVersions, versionsKey, type TowerVersion } from "./fileVersions";
import { asWriteError, committed, done, FileConflictError, FileGoneError, FileNameTakenError, FileSpaceFullError, readIndex, type TowerFileEntry, type TowerFileKind } from "./fileSpaceDb";
export { FileConflictError, FileGoneError, FileNameTakenError, FileSpaceFullError, type TowerFileEntry, type TowerFileKind } from "./fileSpaceDb";
export { cleanFileName, copyName, FILE_NAME_MAX, freeName } from "./fileNames";

const DB_NAME = "verticopolis-files";
const DB_VERSION = 1;
const BODIES = "bodies";
const META = "meta";
/** The META record that lists every file. */
const INDEX = "index";
const CHANNEL = "verticopolis-files";

interface Open {
  readonly db: IDBDatabase;
  entries: TowerFileEntry[];
  readonly channel: BroadcastChannel | null;
  pending: Promise<unknown>;
  /** The write time of each file as this tab last read or wrote it, so a
   *  write over a file another tab wrote since is refused. */
  readonly seen: Map<string, number>;
}

let open: Open | null = null;
let opening: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

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

/** A file to write, for {@link fileSpace.addOnce}. */
export interface NewTowerFile {
  readonly name: string;
  readonly kind: TowerFileKind;
  readonly bytes: Uint8Array;
  readonly modified: number;
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
    const o: Open = { db, entries: await loadIndex(db), channel, pending: Promise.resolve(), seen: new Map() };
    open = o;
    // A window shown while the folder was still opening fills in now.
    changed();
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
    return false;
  }
}

/** Note `entry`'s write time as this tab's own, and answer it. */
function seen(o: Open, entry: TowerFileEntry): TowerFileEntry {
  o.seen.set(entry.id, entry.modified);
  return entry;
}

interface WriteOver {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly modified: number;
  readonly manual: boolean;
  readonly onlyNewer: boolean;
}

/** One {@link fileSpace.overwrite} transaction, with its versions when
 *  `withVersions`, else the file alone and its versions as they were. */
async function writeOver(o: Open, w: WriteOver, withVersions: boolean): Promise<TowerFileEntry> {
  const tx = o.db.transaction([META, BODIES], "readwrite");
  const meta = tx.objectStore(META);
  const bodies = tx.objectStore(BODIES);
  const out: { entries: TowerFileEntry[] | null; entry: TowerFileEntry | null; refused: Error | null } = { entries: null, entry: null, refused: null };
  const indexReq = meta.get(INDEX);
  const versionsReq = meta.get(versionsKey(w.id));
  // The body is read only for a file with no versions yet: its original.
  const write = (oldBody: unknown) => {
    const list = readIndex(indexReq.result);
    const old = list.find((e) => e.id === w.id);
    if (!old || old.kind !== "tower") return;
    const last = o.seen.get(w.id);
    if (last !== undefined && last !== old.modified) {
      out.refused = new FileConflictError();
      return;
    }
    if (w.onlyNewer && old.modified > w.modified) {
      out.entries = list;
      out.entry = old;
      return;
    }
    const entry: TowerFileEntry = { ...old, size: w.bytes.byteLength, modified: w.modified };
    bodies.put(w.bytes, w.id);
    if (withVersions) {
      let kept = readVersions(versionsReq.result);
      if (versionsReq.result === undefined && oldBody instanceof Uint8Array) {
        const original = originalVersion(w.id, old.modified, oldBody.byteLength);
        bodies.put(oldBody, original.key);
        kept = [original];
      }
      const plan = planVersions(kept, w.id, w.modified, w.bytes.byteLength, w.manual);
      if (plan.put) bodies.put(w.bytes, plan.put.key);
      for (const key of plan.drop) bodies.delete(key);
      meta.put(plan.versions, versionsKey(w.id));
    } else if (versionsReq.result === undefined) {
      // No room for the original: it can't be kept, and a later write must
      // not keep this one in its place as if it were.
      meta.put([], versionsKey(w.id));
    }
    out.entries = list.map((e) => (e.id === w.id ? entry : e));
    out.entry = entry;
    meta.put(out.entries, INDEX);
  };
  versionsReq.onsuccess = () => {
    if (!withVersions || versionsReq.result !== undefined) return write(null);
    const bodyReq = bodies.get(w.id);
    bodyReq.onsuccess = () => write(bodyReq.result);
  };
  try {
    await committed(tx);
  } catch (err) {
    throw asWriteError(err);
  }
  if (out.refused) throw out.refused;
  if (!out.entries || !out.entry) throw new FileGoneError();
  if (out.entry.modified === w.modified) o.seen.set(w.id, w.modified);
  o.entries = out.entries;
  o.channel?.postMessage("changed");
  changed();
  return out.entry;
}

export const fileSpace = {
  /** Open the folder once; false when IndexedDB is missing or refuses (some
   *  private windows), and the folder stays closed. Never rejects. */
  open(factory?: IDBFactory): Promise<boolean> {
    if (open) return Promise.resolve(true);
    if (opening) return opening;
    const f = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!f) return Promise.resolve(false);
    // A refusal (even one the factory throws at once) clears `opening` after
    // it is set, so the folder never looks as if it is still opening.
    const attempt: Promise<boolean> = connect(f).then((ok) => {
      if (!ok && opening === attempt) opening = null;
      return ok;
    });
    opening = attempt;
    return attempt;
  },
  isOpen(): boolean {
    return open !== null;
  },
  /** Whether the folder is still opening (the first open on a device can
   *  take a moment on a phone). */
  isOpening(): boolean {
    return open === null && opening !== null;
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
  /** A file's bytes, or null when it is gone. Notes the write time read. */
  async read(id: string): Promise<Uint8Array | null> {
    const o = need();
    const tx = o.db.transaction([META, BODIES], "readonly");
    const indexReq = tx.objectStore(META).get(INDEX);
    const bytes = await done(tx.objectStore(BODIES).get(id));
    const entry = readIndex(indexReq.result).find((e) => e.id === id);
    if (entry && bytes instanceof Uint8Array) o.seen.set(id, entry.modified);
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
    }).then((entry) => seen(o, entry));
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
    }).then((entry) => seen(o, entry));
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
  /**
   * Write `bytes` over tower file `id`, keeping its name and place, and keep a
   * version of them when one is due (`fileVersions.ts`; `manual` for a save
   * by hand); the first write over a file also keeps what it held. With
   * `onlyNewer`, a file already written after `modified` (a save by hand
   * while an autosave packed) is left as it is. Rejects with
   * {@link FileGoneError} when there is no such tower file (deleted in another
   * tab), with {@link FileConflictError} when another tab wrote it since this
   * one last read or wrote it, and with {@link FileSpaceFullError} when the
   * device has no room even for the file alone; nothing changes then.
   * Versions never cost the save: when they don't fit, the file is written
   * without them.
   */
  overwrite(id: string, bytes: Uint8Array, modified = Date.now(), manual = false, onlyNewer = false): Promise<TowerFileEntry> {
    const o = need();
    return queue(o, async () => {
      try {
        return await writeOver(o, { id, bytes, modified, manual, onlyNewer }, true);
      } catch (err) {
        if (!(err instanceof FileSpaceFullError)) throw err;
        return writeOver(o, { id, bytes, modified, manual, onlyNewer }, false);
      }
    });
  },
  /** File `id`'s earlier versions, newest first. */
  async versions(id: string): Promise<TowerVersion[]> {
    const o = need();
    const tx = o.db.transaction(META, "readonly");
    return readVersions(await done(tx.objectStore(META).get(versionsKey(id)))).sort((a, b) => b.at - a.at);
  },
  /** A version's bytes, or null when it is gone. */
  async readVersion(key: string): Promise<Uint8Array | null> {
    const o = need();
    const tx = o.db.transaction(BODIES, "readonly");
    const bytes = await done(tx.objectStore(BODIES).get(key));
    return bytes instanceof Uint8Array ? bytes : null;
  },
  /** Delete file `id` and its versions. */
  remove(id: string): Promise<void> {
    const o = need();
    return queue(o, async () => {
      const tx = o.db.transaction([META, BODIES], "readwrite");
      const meta = tx.objectStore(META);
      const out: { entries: TowerFileEntry[] | null } = { entries: null };
      const indexReq = meta.get(INDEX);
      const versionsReq = meta.get(versionsKey(id));
      versionsReq.onsuccess = () => {
        for (const v of readVersions(versionsReq.result)) tx.objectStore(BODIES).delete(v.key);
        tx.objectStore(BODIES).delete(id);
        meta.delete(versionsKey(id));
        out.entries = readIndex(indexReq.result).filter((e) => e.id !== id);
        meta.put(out.entries, INDEX);
      };
      try {
        await committed(tx);
      } catch (err) {
        throw asWriteError(err);
      }
      if (out.entries) o.entries = out.entries;
      o.channel?.postMessage("changed");
      changed();
    });
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
