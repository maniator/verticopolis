import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SaveStorePort, SaveStoreSnapshot } from "../platform/saveStore";
import { LOCAL } from "./desktopSaveStore.fixture";

/**
 * The scope caption is DATA from the shell's scope label (the D2 labeling
 * ruling), so these tests drive it through a real resolved session rather
 * than a stub, and pin the derivation against the RATIFIED copy the real
 * shell sends.
 */

let injectedStore: SaveStorePort | undefined;

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  IS_WRAPPED_BUILD: true,
  getPlatform: () => ({
    isNativeWrapper: true,
    saveFile: () => Promise.resolve(),
    openExternal: () => {},
    get saveStore() {
      return injectedStore;
    },
  }),
}));

const { prepareSaveStore, resetSaveStoreForTests } = await import("./desktopSaveStore");
const { saveScopeCaption } = await import("./desktopScopeCaption");

const RATIFIED = "Towers on this computer. Anyone who plays here can open them.";

function storeWithScopes(scopes: { token: string; label: string; shared: boolean }[]): SaveStorePort {
  return {
    list: (): Promise<SaveStoreSnapshot> => Promise.resolve({ scopes, records: [] } as unknown as SaveStoreSnapshot),
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
});

describe("saveScopeCaption", () => {
  it("carries the shell's label as the caption and its first sentence as the list label", async () => {
    injectedStore = storeWithScopes([{ token: LOCAL, label: RATIFIED, shared: true }]);
    await prepareSaveStore();

    expect(saveScopeCaption()).toEqual({
      text: RATIFIED,
      listLabel: "Towers on this computer",
    });
  });

  it("renders nothing without a session (a browser build's shape)", () => {
    expect(saveScopeCaption()).toBeUndefined();
  });

  it("renders nothing when the shell marked no shared scope, rather than guessing", async () => {
    injectedStore = storeWithScopes([{ token: "account:x", label: "Your towers", shared: false }]);
    await prepareSaveStore();

    expect(saveScopeCaption()).toBeUndefined();
  });

  it("an empty or whitespace label renders nothing, never an empty caption", async () => {
    injectedStore = storeWithScopes([{ token: LOCAL, label: "   ", shared: true }]);
    await prepareSaveStore();

    expect(saveScopeCaption()).toBeUndefined();
  });

  it("a single-sentence label serves as both strings", async () => {
    injectedStore = storeWithScopes([{ token: LOCAL, label: "Towers on this computer", shared: true }]);
    await prepareSaveStore();

    expect(saveScopeCaption()).toEqual({
      text: "Towers on this computer",
      listLabel: "Towers on this computer",
    });
  });
});
