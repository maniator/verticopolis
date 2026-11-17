/**
 * The pieces of My Towers' database that `fileSpace.ts` builds on: its file
 * entries, the errors its writes reject with, and small IndexedDB helpers.
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

/** A write the device had no room for. */
export class FileSpaceFullError extends Error {
  constructor() {
    super("There's no room left on this device for that tower. Delete some towers and try again.");
    this.name = "FileSpaceFullError";
  }
}

/** A write to a file that is no longer there (deleted in another tab). */
export class FileGoneError extends Error {
  constructor() {
    super("That tower is gone. It may have been deleted in another window.");
    this.name = "FileGoneError";
  }
}

/** A write over a file another window wrote since this one last read or
 *  wrote it (two windows playing the same tower). */
export class FileConflictError extends Error {
  constructor() {
    super("Another window saved that tower since this one opened it.");
    this.name = "FileConflictError";
  }
}

/** A name another file already has. */
export class FileNameTakenError extends Error {
  constructor(name: string) {
    super(`A tower named "${name}" already exists.`);
    this.name = "FileNameTakenError";
  }
}

export function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The tower folder's write was aborted."));
  });
}

/** A failed write as the player's reason: a full device, or the error itself. */
export function asWriteError(err: unknown): unknown {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" ? new FileSpaceFullError() : err;
}

/** The index record as entries, dropping any row that is not one. */
export function readIndex(value: unknown): TowerFileEntry[] {
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
