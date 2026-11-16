import { cleanFileName, copyName, FileNameTakenError, freeName, type TowerFileEntry, type TowerFileKind } from "./fileSpace";

/**
 * A folder on the player's own computer, linked to the Open and Save As
 * windows beside My Towers (owner, 2026-11-15, design in
 * `docs/architecture/linked-folder.md`). It uses the browser's File System
 * Access API, which only Chromium browsers have (Chrome, Edge, Opera and
 * Samsung Internet, on desktop and on Android); everywhere else
 * {@link canLinkFolder} is false and the windows never offer it.
 *
 * The browser hands the game a handle to the one folder the player picked,
 * and nothing outside it. The handle is kept in its own IndexedDB database,
 * apart from My Towers' and the autosave's, so a link never touches either.
 * After a restart the browser may want the player's OK again before the game
 * reads the folder, and it only asks after a click, so {@link allowLinkedFolder}
 * runs from a button.
 *
 * The game lists the `.vctower` and `.TDT` files at the folder's top level,
 * reads one to open it, and writes `.vctower` files into it. It never deletes
 * or renames a file there (owner, 2026-11-15: "don't let deleting PC files").
 * Each file's id is its name on disk, extension included.
 */

/** The parts of the File System Access API this module uses. TypeScript's DOM
 *  library leaves out the picker, the permission calls and the folder walk. */
interface PermissionDescriptor {
  readonly mode: "read" | "readwrite";
}
type Access = "granted" | "prompt" | "denied";
interface FolderHandle {
  readonly kind: "directory";
  readonly name: string;
  queryPermission(d: PermissionDescriptor): Promise<Access>;
  requestPermission(d: PermissionDescriptor): Promise<Access>;
  values(): AsyncIterable<{ readonly kind: "file" | "directory"; readonly name: string }>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
}
interface Writable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<Writable>;
}
interface PickerWindow {
  showDirectoryPicker?(options: { id?: string; mode?: "read" | "readwrite"; startIn?: string }): Promise<FolderHandle>;
}

const READ_WRITE: PermissionDescriptor = { mode: "readwrite" };
const DB_NAME = "verticopolis-linked-folder";
const STORE = "handles";
const KEY = "folder";
/** The linked folder's name, kept in localStorage beside the handle so the
 *  windows can name it without reading the handle back (see {@link restore}). */
const MARK = "verticopolis-linked-folder";
/** A random id for the current link, made new by each {@link linkedFolder.link},
 *  so a file remembered for one folder is never taken for another's. */
const LINK_ID = "verticopolis-linked-folder-link";

/** What the windows show for the linked folder. */
export interface LinkedFolderState {
  /** The folder's own name; browsers never tell a site its full path. */
  readonly name: string;
  /** `granted` once the game may read and write it; `prompt` until the
   *  player says OK again after a restart; `denied` if they said no. */
  readonly access: Access;
}

interface Linked {
  readonly handle: FolderHandle;
  access: Access;
  entries: TowerFileEntry[];
}

let linked: Linked | null = null;
/** This visit's link id, so a storage that refuses writes still keeps one. */
let linkIdNow: string | null = null;
let restoring: Promise<void> | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of [...listeners]) l();
}

/** Whether this browser can link a folder: a Chromium browser, on a secure
 *  page, in the top window (pickers are refused in a frame). */
export function canLinkFolder(win: Window = window): boolean {
  try {
    return typeof (win as PickerWindow).showDirectoryPicker === "function" && win.isSecureContext && win.top === win.self;
  } catch {
    return false;
  }
}

/** The kind of tower a file in the folder is, by its extension, or null for
 *  any other file. */
export function linkedFileKind(filename: string): TowerFileKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".vctower")) return "tower";
  if (lower.endsWith(".tdt")) return "tdt";
  return null;
}

/** "Sky Hotel.vctower" lists as "Sky Hotel". */
function shownName(filename: string): string {
  return filename.slice(0, filename.lastIndexOf("."));
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The IndexedDB the handle is kept in; tests hand in a fake. */
let idb: () => IDBFactory = () => indexedDB;

function openDb(): Promise<IDBDatabase> {
  const req = idb().open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return done(req);
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await done(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

/** Read the folder's tower files into the list. */
async function scan(entry: Linked): Promise<void> {
  const entries: TowerFileEntry[] = [];
  for await (const item of entry.handle.values()) {
    const kind = item.kind === "file" ? linkedFileKind(item.name) : null;
    if (!kind) continue;
    const file = await readEntry(entry.handle, item.name);
    if (file) entries.push({ id: item.name, name: shownName(item.name), kind, size: file.size, modified: file.lastModified });
  }
  entry.entries = entries;
}

/** A listed file, or null when it can't be read right now: removed since the
 *  folder was walked, or held by another program (a cloud drive syncing it).
 *  One such file leaves the rest of the folder usable. */
async function readEntry(folder: FolderHandle, name: string): Promise<File | null> {
  try {
    return await (await folder.getFileHandle(name)).getFile();
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "NotReadableError")) return null;
    throw err;
  }
}

function readMark(): string | null {
  try {
    return localStorage.getItem(MARK);
  } catch {
    return null;
  }
}

function writeMark(name: string | null): void {
  try {
    if (name === null) localStorage.removeItem(MARK);
    else localStorage.setItem(MARK, name);
  } catch {
    // Storage refused: the folder is still linked for this visit.
  }
}

function newLinkId(): string {
  linkIdNow = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(LINK_ID, linkIdNow);
  } catch {
    // Storage refused: the id lasts this visit.
  }
  return linkIdNow;
}

/** The id kept for the link, or a new one when none is kept, held for this
 *  page: another tab that links a folder changes the kept id, never this
 *  page's, so this page's files stay tied to the folder it has. */
function storedLinkId(): string {
  try {
    linkIdNow = localStorage.getItem(LINK_ID);
  } catch {
    linkIdNow = null;
  }
  return linkIdNow ?? newLinkId();
}

/** Take a granted folder's list, or keep it empty until the player's OK. */
async function refreshEntry(entry: Linked): Promise<void> {
  if (entry.access === "granted") await scan(entry);
  else entry.entries = [];
}

function need(): Linked & { access: "granted" } {
  if (!linked || linked.access !== "granted") throw new Error("The linked folder needs your OK first.");
  return linked as Linked & { access: "granted" };
}

export const linkedFolder = {
  /**
   * Bring back the folder linked on an earlier visit, once per page. Never
   * rejects: a handle the browser no longer honors leaves nothing linked.
   *
   * Only a window that shows the folder calls this, never the game's start:
   * reading a folder handle back from IndexedDB has crashed whole Chromium
   * browsers (Opera's reports; a private window's profile here, 2026-11-15),
   * and a crash then would hit every visit, not only a player who asked for
   * the folder. Until then {@link state} names it from its mark.
   */
  restore(): Promise<void> {
    if (linked || !readMark()) return Promise.resolve();
    restoring ??= (async () => {
      try {
        const handle = await withStore<FolderHandle | undefined>("readonly", (s) => s.get(KEY));
        if (!handle) {
          writeMark(null);
          return;
        }
        const entry: Linked = { handle, access: await handle.queryPermission(READ_WRITE), entries: [] };
        storedLinkId();
        linked = entry;
        // A folder that can't be listed right now stays linked; the next
        // window that shows it lists it again.
        await refreshEntry(entry).catch(() => {});
      } catch {
        // A handle the browser no longer reads.
        writeMark(null);
      } finally {
        changed();
      }
    })();
    return restoring;
  },

  /** The linked folder, or null. One not read back yet this visit shows as
   *  waiting for the player's OK. */
  state(): LinkedFolderState | null {
    if (linked) return { name: linked.handle.name, access: linked.access };
    const mark = readMark();
    return mark ? { name: mark, access: "prompt" } : null;
  },

  /** The current link's id, or null with nothing linked. A folder linked
   *  before links had ids gets one the first time it is asked. */
  linkId(): string | null {
    if (!linked && !readMark()) return null;
    return linkIdNow ?? storedLinkId();
  },

  /** The link id kept on this device now, which another tab's newer link
   *  may have replaced; null when none is kept or storage is refused. Unlike
   *  {@link linkId} it never changes this page's link. */
  keptLinkId(): string | null {
    try {
      return localStorage.getItem(LINK_ID);
    } catch {
      return null;
    }
  },

  list(): readonly TowerFileEntry[] {
    return linked?.access === "granted" ? linked.entries : [];
  },

  usage(): { count: number; bytes: number } {
    const list = linkedFolder.list();
    return { count: list.length, bytes: list.reduce((n, e) => n + e.size, 0) };
  },

  onChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Ask the player for a folder and link it, replacing any linked before.
   *  Answers false when they closed the picker. Rejects when the browser
   *  refused the folder (a system folder) or could not keep the link. */
  async link(win: Window = window): Promise<boolean> {
    const pick = (win as PickerWindow).showDirectoryPicker;
    if (!pick) throw new Error("This browser can't link a folder.");
    let handle: FolderHandle;
    try {
      handle = await pick.call(win, { id: "verticopolis-towers", mode: "readwrite", startIn: "documents" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      throw err;
    }
    const entry: Linked = { handle, access: await handle.queryPermission(READ_WRITE), entries: [] };
    await refreshEntry(entry);
    await withStore("readwrite", (s) => s.put(handle, KEY));
    writeMark(handle.name);
    newLinkId();
    linked = entry;
    restoring = Promise.resolve();
    changed();
    return true;
  },

  /** Ask the browser for the player's OK to use the linked folder again. Run
   *  it from a click: the browser refuses to ask otherwise. */
  async allow(): Promise<Access> {
    // A folder already read back this visit asks before any await. One that
    // isn't is read from IndexedDB first; the click still counts then, since
    // the browser keeps a click's activation for a few seconds.
    if (!linked) await linkedFolder.restore();
    if (!linked) return "denied";
    linked.access = await linked.handle.requestPermission(READ_WRITE);
    await refreshEntry(linked);
    changed();
    return linked.access;
  },

  /** Forget the folder. Its files stay where they are. */
  async unlink(): Promise<void> {
    await withStore("readwrite", (s) => s.delete(KEY));
    writeMark(null);
    linkIdNow = null;
    try {
      localStorage.removeItem(LINK_ID);
    } catch {
      // Storage refused: the next link makes a new id anyway.
    }
    linked = null;
    restoring = null;
    changed();
  },

  /** Read the folder back if it isn't yet, and its list again (files may
   *  have changed on disk), for a window that shows it. */
  async refresh(): Promise<void> {
    await linkedFolder.restore();
    if (!linked || linked.access !== "granted") return;
    await scan(linked);
    changed();
  },

  find(id: string): TowerFileEntry | undefined {
    return linkedFolder.list().find((e) => e.id === id);
  },

  /** A file's bytes, or null when it is no longer there. */
  async read(id: string): Promise<Uint8Array | null> {
    const folder = need();
    try {
      const file = await (await folder.handle.getFileHandle(id)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") return null;
      throw err;
    }
  },

  /** Write `bytes` as `name`.vctower. A tower of that name is replaced only
   *  when `replace` is true; otherwise the write is refused. The browser
   *  writes to a scratch file and swaps it in on close, so a write that fails
   *  partway leaves the old file as it was. */
  async save(name: string, bytes: Uint8Array, replace: boolean): Promise<TowerFileEntry> {
    const folder = need();
    const clean = cleanFileName(name);
    if (!clean) throw new Error("Type a name for the tower.");
    return oneSaveAtATime(async () => {
      // The name as the folder spells it first: a file named in a way this game
      // would not write (two spaces, a long name) is still the same file.
      const towers = folder.entries.filter((e) => e.kind === "tower");
      const same = towers.find((e) => e.name === name) ?? towers.find((e) => e.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
      if (same && !replace && !(await emptyOnDisk(folder, same.id))) throw new FileNameTakenError(clean);
      if (same) return writeFile(folder, same.id, bytes);
      return writeFresh(folder, clean, towers, bytes);
    });
  },

  /** Save under `name`, or the first "name (2)" and up free in the list and
   *  on disk, never over any file (the Auto-save copy's first write). */
  async saveNew(name: string, bytes: Uint8Array): Promise<TowerFileEntry> {
    const folder = need();
    const clean = cleanFileName(name);
    if (!clean) throw new Error("Type a name for the tower.");
    return oneSaveAtATime(() => writeFresh(folder, clean, folder.entries.filter((e) => e.kind === "tower"), bytes));
  },

  /** Write `bytes` over the file `id` itself, by its name on disk, for File >
   *  Save of a tower opened from the folder. */
  async saveOver(id: string, bytes: Uint8Array): Promise<TowerFileEntry> {
    return writeFile(need(), id, bytes);
  },

  /** Copy a file beside itself as "Copy of …", never over another file. */
  async duplicate(id: string): Promise<TowerFileEntry> {
    const folder = need();
    const source = folder.entries.find((e) => e.id === id);
    const bytes = source ? await linkedFolder.read(id) : null;
    if (!source || !bytes) throw new Error("That tower is gone from the folder.");
    const ext = id.slice(id.lastIndexOf("."));
    const name = copyName(source.name, folder.entries.filter((e) => e.kind === source.kind));
    if (await exists(folder, `${name}${ext}`)) throw new FileNameTakenError(name);
    return writeFile(folder, `${name}${ext}`, bytes);
  },
};

/** Write a new file `clean.vctower`, or the first "clean (2)" and up that
 *  neither `towers` nor the disk has: a file another program wrote since the
 *  list was read is never replaced without asking. */
async function writeFresh(folder: Linked, clean: string, towers: readonly TowerFileEntry[], bytes: Uint8Array): Promise<TowerFileEntry> {
  // An empty file is free to take: it is what a failed new-name save leaves.
  const taken = towers.filter((e) => e.size > 0);
  let pick = freeName(clean, taken);
  while ((await exists(folder, `${pick}.vctower`)) && !(await emptyOnDisk(folder, `${pick}.vctower`))) {
    taken.push({ id: "", name: pick, kind: "tower", size: 0, modified: 0 });
    pick = freeName(clean, taken);
  }
  return writeFile(folder, `${pick}.vctower`, bytes);
}

/** Whether the folder holds a file named `filename` right now. */
async function exists(folder: Linked, filename: string): Promise<boolean> {
  try {
    await folder.handle.getFileHandle(filename);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") return false;
    if (err instanceof DOMException && err.name === "TypeMismatchError") return true;
    throw err;
  }
}

/** The Web Lock that saves picking a name hold, shared by every tab of the
 *  game. A new file stays empty until its write closes, so without it a
 *  second tab saving the same name could take that file for a free one and
 *  write over the first tab's tower without asking. */
const SAVE_LOCK = "verticopolis-linked-folder-save";

/** Run a name-picking save while no other tab runs one. Where the browser has
 *  no Web Locks, the save runs at once. */
async function oneSaveAtATime<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks ? await locks.request(SAVE_LOCK, run) : run();
}

/** Whether `filename` is an empty file on disk right now. Chromium creates a
 *  new file empty before its bytes go in, so a save under a new name that
 *  fails leaves one behind (#2337). Nothing is lost by writing over it, so a
 *  save takes its name without asking; the game still never deletes it. */
async function emptyOnDisk(folder: Linked, filename: string): Promise<boolean> {
  const file = await readEntry(folder.handle, filename).catch(() => null);
  return file !== null && file.size === 0;
}

async function writeFile(folder: Linked, filename: string, bytes: Uint8Array): Promise<TowerFileEntry> {
  const file = await folder.handle.getFileHandle(filename, { create: true });
  const out = await file.createWritable({ keepExistingData: false });
  try {
    await out.write(bytes);
  } catch (err) {
    await out.abort().catch(() => {});
    throw err;
  }
  await out.close();
  // The file is written; a folder that can't be listed again right now keeps
  // its old list rather than calling the save a failure.
  await scan(folder).catch(() => {});
  changed();
  return folder.entries.find((e) => e.id === filename) ?? { id: filename, name: shownName(filename), kind: linkedFileKind(filename) ?? "tower", size: bytes.byteLength, modified: Date.now() };
}

/** Forget everything this page knew, as a reload does, for tests; `factory`
 *  replaces the IndexedDB the handle is kept in. */
export function resetLinkedFolderForTests(factory?: IDBFactory): void {
  linked = null;
  linkIdNow = null;
  restoring = null;
  listeners.clear();
  if (factory) idb = () => factory;
}
