import { cleanFileName, copyName, FileNameTakenError, type TowerFileEntry, type TowerFileKind } from "./fileSpace";

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
    const file = await (await entry.handle.getFileHandle(item.name)).getFile();
    entries.push({ id: item.name, name: shownName(item.name), kind, size: file.size, modified: file.lastModified });
  }
  entry.entries = entries;
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
        await refreshEntry(entry);
        linked = entry;
      } catch {
        // A handle the browser no longer reads, or a folder gone from the disk.
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
    linked = entry;
    restoring = Promise.resolve();
    changed();
    return true;
  },

  /** Ask the browser for the player's OK to use the linked folder again. Run
   *  it from a click: the browser refuses to ask otherwise. */
  async allow(): Promise<Access> {
    await linkedFolder.restore();
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
    const same = folder.entries.find((e) => e.kind === "tower" && e.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
    if (same && !replace) throw new FileNameTakenError(clean);
    const filename = same ? same.id : `${clean}.vctower`;
    // A file another program wrote since the list was read is never replaced
    // without asking either.
    if (!same && (await exists(folder, filename))) throw new FileNameTakenError(clean);
    return writeFile(folder, filename, bytes);
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
  await scan(folder);
  changed();
  return folder.entries.find((e) => e.id === filename) ?? { id: filename, name: shownName(filename), kind: linkedFileKind(filename) ?? "tower", size: bytes.byteLength, modified: Date.now() };
}

/** Forget everything this page knew, as a reload does, for tests; `factory`
 *  replaces the IndexedDB the handle is kept in. */
export function resetLinkedFolderForTests(factory?: IDBFactory): void {
  linked = null;
  restoring = null;
  listeners.clear();
  if (factory) idb = () => factory;
}
