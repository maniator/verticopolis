/** The desk's storage: reads and writes that never throw, so a full quota or
 *  a blocked origin leaves the desk working for this visit. */

export type Store = Pick<Storage, "getItem" | "setItem">;

export function read(store: Store | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function write(store: Store | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // A full quota or a blocked origin: the desk still works for this visit.
  }
}
