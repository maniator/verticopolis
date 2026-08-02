import { deflateSync } from "fflate";
import { asScopeToken, type SaveScopeToken, type SaveStorePort, type SaveStoreSnapshot } from "../platform/saveStore";
import { STORE_MAGIC, toBase64 } from "../storage/saveCompression";

/**
 * Shared fixtures for the desktop save-store tests, split out when the single
 * test file crossed the 500-line guard. The `vi.mock("../platform")` preamble
 * deliberately stays in each test file: `vi.mock` is file-scoped and hoisted,
 * so it cannot be shared from here.
 *
 * Test-only code that happens not to match `*.test.ts`, so it is coverage
 * excluded in `vite.config.ts` alongside the other `.fixture.ts` files.
 */

export const LOCAL: SaveScopeToken = asScopeToken("local");
export const ACCOUNT: SaveScopeToken = asScopeToken("account:test-scope");

export const TOWER = { minutes: 4321, units: [{ t: "office" }], towerName: "Old Guard", money: 500 };

export function storeValue(obj: unknown): string {
  return STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(obj)), { level: 1 }));
}

/** A store whose scopes are configurable, so the shared-scope gating is testable. */
export function fakeStore(scopes: { token: SaveScopeToken; label: string; shared: boolean }[]) {
  const held = new Map<string, string>();
  const calls = { list: 0, writes: [] as { id: string; scope: SaveScopeToken }[] };
  const port: SaveStorePort = {
    list(): Promise<SaveStoreSnapshot> {
      calls.list++;
      return Promise.resolve({
        scopes,
        records: [...held.keys()].map((k) => {
          const [scope, id] = k.split("|");
          return { id: id!, scope: scope as SaveScopeToken, bytes: held.get(k)!.length };
        }),
      });
    },
    read: (id, scope) => Promise.resolve(held.get(`${scope}|${id}`) ?? null),
    write: (id, contents, scope) => {
      calls.writes.push({ id, scope });
      held.set(`${scope}|${id}`, contents);
      return Promise.resolve();
    },
    delete: (id, scope) => {
      held.delete(`${scope}|${id}`);
      return Promise.resolve();
    },
  };
  return { port, held, calls };
}
