import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  once: vi.fn(),
  live: vi.fn(() => true),
  exportFile: vi.fn(() => Uint8Array.of(9, 9)),
  access: "granted" as string | null,
  saveOver: vi.fn(async (id: string) => ({ id, name: "x", kind: "tower", size: 2, modified: 0 })),
  saveNew: vi.fn(async (name: string) => ({ id: `${name} (2).vctower`, name: `${name} (2)`, kind: "tower", size: 2, modified: 0 })),
}));
vi.mock("../analytics", () => ({ trackAppActionOnce: m.once }));
vi.mock("./autosaveSchedule", () => ({ autosaveLive: m.live }));
vi.mock("./portLifecycle", () => ({ exportFile: m.exportFile }));
vi.mock("../storage/linkedFolder", () => ({
  linkedFolder: {
    state: () => (m.access === null ? null : { name: "Towers", access: m.access }),
    saveOver: m.saveOver,
    saveNew: m.saveNew,
  },
}));

import { forgetMirrorFile, MIRROR_EVERY_MS, MIRROR_NAME, mirrorAutosave, mirrorOn, resetMirrorForTests, setMirror } from "./autosaveMirror";

const app = { enginePort: {}, engine: { viewState: () => null } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetMirrorForTests();
  m.access = "granted";
  m.live.mockReturnValue(true);
});

describe("the Auto-save copy in the linked folder", () => {
  it("is off until the player turns it on, and writes nothing while off", async () => {
    expect(mirrorOn()).toBe(false);
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.exportFile).not.toHaveBeenCalled();
    setMirror(true);
    expect(mirrorOn()).toBe(true);
  });

  it("starts a new file that never replaces one it didn't write, then writes that same file", async () => {
    setMirror(true);
    expect(await mirrorAutosave(app, 0)).toBe(true);
    expect(m.saveNew).toHaveBeenCalledExactlyOnceWith(MIRROR_NAME, Uint8Array.of(9, 9));
    expect(await mirrorAutosave(app, MIRROR_EVERY_MS)).toBe(true);
    expect(m.saveOver).toHaveBeenCalledExactlyOnceWith("Auto-save (2).vctower", Uint8Array.of(9, 9));
    expect(m.saveNew).toHaveBeenCalledOnce();
  });

  it("writes at most once a minute unless forced", async () => {
    setMirror(true);
    await mirrorAutosave(app, 1000);
    expect(await mirrorAutosave(app, 1000 + MIRROR_EVERY_MS - 1)).toBe(false);
    expect(await mirrorAutosave(app, 1000 + MIRROR_EVERY_MS - 1, true)).toBe(true);
    expect(m.exportFile).toHaveBeenCalledTimes(2);
  });

  it("never asks the browser: it waits while the folder isn't open with its OK", async () => {
    setMirror(true);
    m.access = "prompt";
    expect(await mirrorAutosave(app, 0)).toBe(false);
    m.access = null;
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.exportFile).not.toHaveBeenCalled();
  });

  it("writes nothing while the tower may not be autosaved", async () => {
    setMirror(true);
    m.live.mockReturnValue(false);
    expect(await mirrorAutosave(app, 0, true)).toBe(false);
    expect(m.exportFile).not.toHaveBeenCalled();
  });

  it("counts a failure once and tries again on the next minute", async () => {
    setMirror(true);
    m.saveNew.mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.once).toHaveBeenCalledExactlyOnceWith("folder_mirror", "failed");
    expect(await mirrorAutosave(app, MIRROR_EVERY_MS)).toBe(true);
    expect(m.saveNew).toHaveBeenCalledTimes(2);
  });

  it("starts a new file after another folder is linked", async () => {
    setMirror(true);
    await mirrorAutosave(app, 0);
    forgetMirrorFile();
    expect(mirrorOn()).toBe(true);
    await mirrorAutosave(app, MIRROR_EVERY_MS);
    expect(m.saveNew).toHaveBeenCalledTimes(2);
    expect(m.saveOver).not.toHaveBeenCalled();
  });

  it("writes the same file again when turned off and on again", async () => {
    setMirror(true);
    await mirrorAutosave(app, 0);
    setMirror(false);
    expect(mirrorOn()).toBe(false);
    expect(await mirrorAutosave(app, MIRROR_EVERY_MS)).toBe(false);
    setMirror(true);
    await mirrorAutosave(app, 0);
    expect(m.saveNew).toHaveBeenCalledOnce();
    expect(m.saveOver).toHaveBeenCalledExactlyOnceWith("Auto-save (2).vctower", Uint8Array.of(9, 9));
  });
});
