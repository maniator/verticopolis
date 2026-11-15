import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  once: vi.fn(),
  live: vi.fn(() => true),
  saveBytes: vi.fn(() => new TextEncoder().encode('{"name":"Sky","savedAt":5,"appVersion":"t"}')),
  access: "granted" as string | null,
  link: "L1" as string | null,
  saveOver: vi.fn(async (id: string) => ({ id, name: "x", kind: "tower", size: 2, modified: 0 })),
  saveNew: vi.fn(async (name: string, _bytes?: Uint8Array) => ({ id: `${name} (2).vctower`, name: `${name} (2)`, kind: "tower", size: 2, modified: 0 })),
}));
vi.mock("../analytics", () => ({ trackAppActionOnce: m.once }));
vi.mock("./autosaveSchedule", () => ({ autosaveLive: m.live }));
vi.mock("./portLifecycle", () => ({ saveBytes: m.saveBytes }));
vi.mock("../storage/linkedFolder", () => ({
  linkedFolder: {
    state: () => (m.access === null ? null : { name: "Towers", access: m.access }),
    linkId: () => m.link,
    saveOver: m.saveOver,
    saveNew: m.saveNew,
  },
}));

import { decodeVctowerFile } from "../storage/vctowerContainer";
import { forgetMirrorFile, MIRROR_EVERY_MS, MIRROR_NAME, mirrorAutosave, mirrorOn, resetMirrorForTests, setMirror } from "./autosaveMirror";

/** The save a written file holds. */
const holds = (bytes: unknown) => decodeVctowerFile(bytes as Uint8Array);
const SAVE = { name: "Sky", savedAt: 5, appVersion: "t" };

const app = { enginePort: {}, engine: { viewState: () => null } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetMirrorForTests();
  m.access = "granted";
  m.link = "L1";
  m.live.mockReturnValue(true);
});

describe("the Auto-save copy in the linked folder", () => {
  it("is off until the player turns it on, and writes nothing while off", async () => {
    expect(mirrorOn()).toBe(false);
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.saveBytes).not.toHaveBeenCalled();
    setMirror(true);
    expect(mirrorOn()).toBe(true);
  });

  it("starts a new file that never replaces one it didn't write, then writes that same file", async () => {
    setMirror(true);
    expect(await mirrorAutosave(app, 0)).toBe(true);
    expect(m.saveNew).toHaveBeenCalledExactlyOnceWith(MIRROR_NAME, expect.any(Uint8Array));
    expect(await mirrorAutosave(app, MIRROR_EVERY_MS)).toBe(true);
    expect(m.saveOver).toHaveBeenCalledExactlyOnceWith("Auto-save (2).vctower", expect.any(Uint8Array));
    expect(m.saveNew).toHaveBeenCalledOnce();
  });

  it("writes at most once a minute unless forced", async () => {
    setMirror(true);
    await mirrorAutosave(app, 1000);
    expect(await mirrorAutosave(app, 1000 + MIRROR_EVERY_MS - 1)).toBe(false);
    expect(await mirrorAutosave(app, 1000 + MIRROR_EVERY_MS - 1, true)).toBe(true);
    expect(m.saveBytes).toHaveBeenCalledTimes(2);
  });

  it("never asks the browser: it waits while the folder isn't open with its OK", async () => {
    setMirror(true);
    m.access = "prompt";
    expect(await mirrorAutosave(app, 0)).toBe(false);
    m.access = null;
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.saveBytes).not.toHaveBeenCalled();
  });

  it("writes nothing while the tower may not be autosaved", async () => {
    setMirror(true);
    m.live.mockReturnValue(false);
    expect(await mirrorAutosave(app, 0, true)).toBe(false);
    expect(m.saveBytes).not.toHaveBeenCalled();
  });

  it("counts a failure once and tries again on the next minute", async () => {
    setMirror(true);
    m.saveNew.mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.once).toHaveBeenCalledExactlyOnceWith("folder_mirror", "failed");
    expect(await mirrorAutosave(app, MIRROR_EVERY_MS)).toBe(true);
    expect(m.saveNew).toHaveBeenCalledTimes(2);
  });

  it("forgets only the file of the link it is told to", async () => {
    setMirror(true);
    await mirrorAutosave(app, 0);
    forgetMirrorFile("another link");
    await mirrorAutosave(app, MIRROR_EVERY_MS);
    expect(m.saveOver, "L1's file is still remembered").toHaveBeenCalledOnce();
    forgetMirrorFile("L1");
    expect(mirrorOn()).toBe(true);
    await mirrorAutosave(app, 2 * MIRROR_EVERY_MS);
    expect(m.saveNew).toHaveBeenCalledTimes(2);
  });

  it("keeps one file per folder when two tabs on two folders take turns", async () => {
    setMirror(true);
    for (let turn = 0; turn < 6; turn++) {
      m.link = turn % 2 === 0 ? "L1" : "L2";
      resetMirrorForTests();
      expect(await mirrorAutosave(app, turn * MIRROR_EVERY_MS)).toBe(true);
    }
    expect(m.saveNew, "one new file in each folder").toHaveBeenCalledTimes(2);
    expect(m.saveOver).toHaveBeenCalledTimes(4);
  });

  it("remembers the files of the last eight links at most", async () => {
    setMirror(true);
    for (let i = 0; i < 9; i++) {
      m.link = `L${i}`;
      await mirrorAutosave(app, 0, true);
    }
    const files = (JSON.parse(localStorage.getItem("verticopolis-autosave-mirror")!) as { files: Record<string, string> }).files;
    expect(Object.keys(files)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]);
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
    expect(m.saveOver).toHaveBeenCalledExactlyOnceWith("Auto-save (2).vctower", expect.any(Uint8Array));
  });

  it("writes the binary .vctower Save As writes, holding the stamped autosave bytes", async () => {
    setMirror(true);
    await mirrorAutosave(app, 0);
    const file = m.saveNew.mock.calls[0]![1]!;
    expect(new TextDecoder().decode(file.subarray(0, 9))).toBe("VCTOWER2\n");
    expect(holds(file)).toEqual(SAVE);
  });

  it("never writes over a file remembered for another link, even one of the same name", async () => {
    setMirror(true);
    await mirrorAutosave(app, 0);
    m.link = "L2";
    await mirrorAutosave(app, MIRROR_EVERY_MS);
    expect(m.saveOver).not.toHaveBeenCalled();
    expect(m.saveNew).toHaveBeenCalledTimes(2);
  });

  it("drops a copy whose folder was unlinked or linked again while the save packed", async () => {
    setMirror(true);
    m.saveBytes.mockImplementationOnce(() => {
      m.link = "L2";
      return new TextEncoder().encode(JSON.stringify(SAVE));
    });
    expect(await mirrorAutosave(app, 0)).toBe(false);
    expect(m.saveNew).not.toHaveBeenCalled();
  });

  it("remembers no file when another folder was linked while the first one was written", async () => {
    setMirror(true);
    m.saveNew.mockImplementationOnce(async (name: string) => {
      m.link = "L2";
      return { id: `${name}.vctower`, name, kind: "tower", size: 2, modified: 0 };
    });
    await mirrorAutosave(app, 0);
    await mirrorAutosave(app, MIRROR_EVERY_MS);
    expect(m.saveOver).not.toHaveBeenCalled();
    expect(m.saveNew).toHaveBeenCalledTimes(2);
  });
});
