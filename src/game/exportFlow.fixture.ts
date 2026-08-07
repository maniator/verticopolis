import { Simulation } from "../engine/Simulation";
import type { SaveStorePort } from "../platform/saveStore";
import { LOCAL, fakeStore } from "./desktopSaveStore.fixture";

/**
 * Shared fixtures for the export-flow tests, split out when the single test
 * file crossed the 500-line guard as the GH #774 wording suite landed. The
 * `vi.mock("../platform")` preamble deliberately stays in each test file:
 * `vi.mock` is file-scoped and hoisted, so it cannot be shared from here.
 *
 * Test-only code that happens not to match `*.test.ts`, so it is coverage
 * excluded in `vite.config.ts` alongside the other `.fixture.ts` files.
 */

export const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];

/** A store whose flush succeeds and whose exportRecord the test controls. */
export function storeWithExport(exportRecord: SaveStorePort["exportRecord"]) {
  const store = fakeStore(SHARED);
  store.port.writeSync = (id, contents, scope) => {
    store.held.set(`${scope}|${id}`, contents);
    return { ok: true };
  };
  store.port.exportRecord = exportRecord;
  return store;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** `downloadResults` are consumed in call order; the default is an already
 *  settled dialog, which is what every pre-#773 test assumed. */
export function fakeUi(downloadResults?: Promise<void>[]) {
  const toasts: { text: string; kind: string }[] = [];
  const downloads: string[] = [];
  return {
    toasts,
    downloads,
    ui: {
      toast: (text: string, kind?: string) => {
        toasts.push({ text, kind: kind ?? "info" });
      },
      downloadFile: (filename: string) => {
        downloads.push(filename);
        return downloadResults?.shift() ?? Promise.resolve();
      },
    },
  };
}

export function flowDeps(ui: ReturnType<typeof fakeUi>["ui"], sim = Simulation.newGame(7)) {
  return { getSim: () => sim, ui };
}

export const HUNG_TOAST = { text: "The export is not responding. You can try exporting again.", kind: "bad" };
export const STORED_TOAST = { text: "Tower exported. Check where you saved it.", kind: "good" };
// The size line for the 13-byte payload the GH #773 tests mock into
// SaveGame.export ("VCTOWER1\nfake" rounds to 0.0 KB).
export const LIVE_TOAST = { text: "Tower exported (0.0 KB). Check your downloads.", kind: "good" };

/** The late-success wording (GH #774), split around the quoted tower name. */
export const LATE_PREFIX = 'The earlier export of "';
export const LATE_SUFFIX = '" finished. Check where you saved it.';
/** The same success arriving after the watchdog freed the latch, naming the
 *  default tower the fixtures build. */
export const LATE_STORED_TOAST = { text: `${LATE_PREFIX}Tower One${LATE_SUFFIX}`, kind: "good" };
/** The late-success wording with the naming clause dropped, which is what a
 *  name carrying no visible ink falls back to. */
export const LATE_UNNAMED_TOAST = { text: "The earlier export finished. Check where you saved it.", kind: "good" };
