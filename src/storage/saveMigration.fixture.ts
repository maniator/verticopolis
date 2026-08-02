import { expect } from "vitest";
import { deflateSync } from "fflate";
import { fromBase64, inflateCapped, STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";
import { asScopeToken, type SaveScopeToken, type SaveStorePort, type SaveStoreSnapshot } from "../platform/saveStore";
import type { SharedScopeToken } from "./saveStoreSession";

/**
 * Shared fixtures for the save-migration tests, split out when the single test
 * file crossed the 500-line guard. Test-only code that happens not to match
 * `*.test.ts`, so it is excluded from coverage in `vite.config.ts` alongside
 * `hostCommands.fixture.ts`.
 */

/**
 * A tower as an OLD build wrote it: no appVersion, which is the whole point.
 * Carries the two fields `SaveGame.import` insists on, because a value without
 * them is not a tower and the migration refuses it.
 */
export const PRE_2_0_SAVE = { minutes: 4321, units: [{ t: "office" }], towerName: "Old Guard", money: 500 };

/**
 * A migration destination. Cast rather than built, because `migrationTarget` is
 * the only real producer of a `SharedScopeToken` and these tests drive
 * `migrateSavesToStore` directly. The cast being NECESSARY here is the point:
 * before the brand existed, `session.defaultScope` was accepted without one.
 */
export const SCOPE = asScopeToken("scope-token") as SharedScopeToken;

/** Packs a value exactly as `SaveGame.saveTo` writes it into localStorage. */
export function storeValue(obj: unknown): string {
  return STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(obj)), { level: 1 }));
}

/** Decode what the migration produced, the way `SaveGame.import` would. */
export function decodeTowerFile(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  expect(trimmed.startsWith(TOWER_FILE_MAGIC + "\n")).toBe(true);
  const payload = trimmed.slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(payload)))) as Record<
    string,
    unknown
  >;
}

/** Records every write, and refuses a duplicate id the way an O_EXCL create does. */
export function fakeStore(existing: Record<string, string> = {}) {
  const written = new Map<string, { contents: string; scope: SaveScopeToken; seq: number }>();
  const present = new Set(Object.keys(existing));
  let failNext: string | null = null;
  let dropSilently: string | null = null;
  const port: SaveStorePort = {
    list(): Promise<SaveStoreSnapshot> {
      return Promise.resolve({ scopes: [{ token: SCOPE, label: "This computer", shared: true }], records: [] });
    },
    read(id: string): Promise<string | null> {
      return Promise.resolve(written.get(id)?.contents ?? existing[id] ?? null);
    },
    write(id: string, contents: string, scope: SaveScopeToken, seq: number): Promise<void> {
      if (failNext === id) return Promise.reject(Object.assign(new Error("no space"), { code: "full" }));
      // Models a shell that discards a write and wrongly RESOLVES anyway.
      if (dropSilently === id) return Promise.resolve();
      if (present.has(id)) return Promise.reject(Object.assign(new Error("exists"), { code: "denied" }));
      present.add(id);
      written.set(id, { contents, scope, seq });
      return Promise.resolve();
    },
    delete(id: string): Promise<void> {
      present.delete(id);
      written.delete(id);
      return Promise.resolve();
    },
  };
  return {
    port,
    written,
    failWriteOf: (id: string) => (failNext = id),
    dropWriteOf: (id: string) => (dropSilently = id),
  };
}

export function readerFor(values: Record<string, string>) {
  return (key: string): string | null => values[key] ?? null;
}
