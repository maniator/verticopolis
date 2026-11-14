/**
 * A small in-memory IndexedDB for the save store's unit tests: the part of
 * the API `src/storage/saveStore.ts` calls (open with an upgrade, object
 * stores keyed out of line, get, put, delete, and transactions that commit
 * or abort whole), with its events fired on later tasks as a browser fires
 * them. The databases live on the factory, so a second open reads what the
 * first one wrote, as a reload does.
 *
 * Switches stand in for the failures a browser can give: `failOpen` (a
 * private window that refuses the database), `openDelayMs` (an open that
 * answers late), `failWrites` (a full quota: the
 * transaction aborts and nothing in it lands) and `dropWrites` (a write that
 * commits but does not read back, which the migration must catch).
 */

type Op = () => void;

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeStore {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly rows: Map<IDBValidKey, unknown>,
  ) {}

  get(key: IDBValidKey): FakeRequest<unknown> {
    return this.tx.queue(() => this.rows.get(String(key)));
  }

  put(value: unknown, key: IDBValidKey): FakeRequest<IDBValidKey> {
    if (this.tx.mode !== "readwrite") throw new Error("put in a read-only transaction");
    const copy = value instanceof Uint8Array ? value.slice() : value;
    return this.tx.queue(() => {
      this.tx.write(() => {
        if (!this.tx.factory.dropWrites) this.rows.set(String(key), copy);
      });
      return key;
    }, true);
  }

  delete(key: IDBValidKey): FakeRequest<undefined> {
    if (this.tx.mode !== "readwrite") throw new Error("delete in a read-only transaction");
    return this.tx.queue(() => {
      this.tx.write(() => this.rows.delete(String(key)));
      return undefined;
    }, true);
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;
  private readonly ops: Op[] = [];
  private readonly writes: Op[] = [];

  constructor(
    readonly factory: FakeIndexedDb,
    private readonly db: FakeDatabase,
    private readonly names: readonly string[],
    readonly mode: IDBTransactionMode,
  ) {
    setTimeout(() => this.run(), 0);
  }

  objectStore(name: string): FakeStore {
    if (!this.names.includes(name)) throw new Error(`${name} is not in this transaction`);
    return new FakeStore(this, this.db.store(name));
  }

  /** Queue a request; a write fails the whole transaction under `failWrites`. */
  queue<T>(answer: () => T, isWrite = false): FakeRequest<T> {
    const req = new FakeRequest<T>();
    this.ops.push(() => {
      if (this.error) return;
      if (isWrite && this.factory.failWrites) {
        this.error = req.error = new DOMException("The quota has been exceeded.", "QuotaExceededError");
        req.onerror?.();
        return;
      }
      req.result = answer();
      req.onsuccess?.();
    });
    return req;
  }

  /** Stage a change that lands only when the transaction commits. */
  write(change: Op): void {
    this.writes.push(change);
  }

  private run(): void {
    for (const op of this.ops) op();
    setTimeout(() => {
      if (this.error) {
        this.onerror?.();
        this.onabort?.();
        return;
      }
      for (const change of this.writes) change();
      this.factory.commits++;
      this.oncomplete?.();
    }, 0);
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<IDBValidKey, unknown>>();
  closed = false;
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  constructor(private readonly factory: FakeIndexedDb) {}

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  store(name: string): Map<IDBValidKey, unknown> {
    const rows = this.stores.get(name);
    if (!rows) throw new Error(`no object store ${name}`);
    return rows;
  }

  transaction(names: string | string[], mode: IDBTransactionMode = "readonly"): FakeTransaction {
    if (this.closed) throw new Error("the database is closed");
    return new FakeTransaction(this.factory, this, typeof names === "string" ? [names] : names, mode);
  }

  close(): void {
    this.closed = true;
  }
}

export class FakeIndexedDb {
  failOpen = false;
  /** How long an open takes to answer, to stand in for one that hangs. */
  openDelayMs = 0;
  /** The connection the last open handed out. */
  lastDb: FakeDatabase | null = null;
  failWrites = false;
  dropWrites = false;
  /** Transactions that committed, to tell when the store wrote. */
  commits = 0;
  private readonly dbs = new Map<string, { version: number; db: FakeDatabase }>();

  open(name: string, version: number): FakeRequest<FakeDatabase> {
    const req = new FakeRequest<FakeDatabase>();
    setTimeout(() => {
      if (this.failOpen) {
        req.error = new DOMException("The database refused to open.", "InvalidStateError");
        req.onerror?.();
        return;
      }
      const known = this.dbs.get(name);
      const db = new FakeDatabase(this);
      if (known) for (const [store, rows] of known.db.stores) db.stores.set(store, rows);
      req.result = db;
      this.lastDb = db;
      if (!known || known.version < version) req.onupgradeneeded?.();
      this.dbs.set(name, { version, db });
      req.onsuccess?.();
    }, this.openDelayMs);
    return req;
  }

  /** A stored row as the database holds it, for assertions. */
  row(name: string, store: string, key: string): unknown {
    return this.dbs.get(name)?.db.stores.get(store)?.get(key);
  }

  /** Put a row in directly, as an earlier session left it. */
  seed(name: string, store: string, key: string, value: unknown): void {
    let known = this.dbs.get(name);
    if (!known) {
      known = { version: 1, db: new FakeDatabase(this) };
      known.db.createObjectStore("saves");
      known.db.createObjectStore("meta");
      this.dbs.set(name, known);
    }
    known.db.store(store).set(key, value);
  }

  /** The factory as the store takes it. */
  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}
