/**
 * Every save a page keeps, keyed by where it sits: `idb:<key>` for the
 * IndexedDB save store (`src/storage/saveStore.ts`; a compressed save is read
 * back as `VCZ1:` and base64, the text the game reads) and `ls:<key>` for
 * localStorage. The e2e specs and the rollback rehearsal pass it to
 * `page.evaluate`, so it is SELF-CONTAINED: no module-scope reference, and the
 * names below repeat the store's.
 *
 * It never creates the database: before the game opened it there is none,
 * and only localStorage is read.
 */
export async function storedSavesInPage(): Promise<Record<string, string>> {
  const saves: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (/^(verticopolis|simtower-clone)-/.test(key)) saves[`ls:${key}`] = localStorage.getItem(key)!;
  }
  if (typeof indexedDB === "undefined") return saves;
  const known = await indexedDB.databases();
  if (!known.some((d) => d.name === "verticopolis")) return saves;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("verticopolis");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains("saves")) return saves;
    const store = db.transaction("saves", "readonly").objectStore("saves");
    const answer = <T>(req: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const [keys, rows] = await Promise.all([answer(store.getAllKeys()), answer(store.getAll())]);
    keys.forEach((key, i) => {
      const row = rows[i] as { packed?: unknown; text?: unknown } | undefined;
      if (typeof row?.text === "string") saves[`idb:${String(key)}`] = row.text;
      else if (row?.packed instanceof Uint8Array) {
        let bin = "";
        for (let j = 0; j < row.packed.length; j += 0x8000) bin += String.fromCharCode(...row.packed.subarray(j, j + 0x8000));
        saves[`idb:${String(key)}`] = `VCZ1:${btoa(bin)}`;
      }
    });
    return saves;
  } finally {
    db.close();
  }
}

/** One save as the game reads it from {@link storedSavesInPage}'s answer: the
 *  store's copy when it holds the key, otherwise localStorage's. */
export function storedSave(saves: Record<string, string>, key: string): string | null {
  return saves[`idb:${key}`] ?? saves[`ls:${key}`] ?? null;
}
