import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  track: vi.fn(),
  live: true,
  saveBytes: vi.fn(),
  packSave: vi.fn(),
  stored: null as string | null,
  autoName: "Harmony Tower 2.0" as string | undefined,
}));
vi.mock("../analytics", () => ({ trackAppAction: m.track }));
vi.mock("./autosaveSchedule", () => ({ autosaveLive: () => m.live }));
vi.mock("./portLifecycle", () => ({ saveBytes: m.saveBytes }));
vi.mock("../storage/savePacker", () => ({ packSave: m.packSave }));
vi.mock("../storage/saveStore", () => ({ saveStore: { get: (key: string) => (key === "verticopolis-save" ? m.stored : null) } }));
vi.mock("../storage/SaveGame", () => ({
  autosaveKey: () => "verticopolis-save",
  SaveGame: { listSlots: () => [{ slot: "auto", exists: m.stored !== null, towerName: m.autoName }] },
}));

import { closeFileSpaceForTests, fileSpace } from "../storage/fileSpace";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { setCurrentFile, setCurrentLinkedFile } from "./currentFile";
import { captureOutgoing, dropOutgoing, keepOutgoing, keptSettled, openingFile, resetOutgoingForTests } from "./keepOutgoing";

/** The engine port and the UI the module talks to, as spies. */
function makeApp(name = "Harmony Tower 2.0") {
  let generation = 1;
  const app = {
    enginePort: { generation: vi.fn(() => generation), towerName: vi.fn(() => name) },
    engine: { viewState: vi.fn(() => ({ tile: 3, floor: 4, zoom: 1 })) },
    ui: {
      toast: vi.fn(),
      sayVisibly: vi.fn(),
      downloadFile: vi.fn(() => true),
      confirmModal: vi.fn((_title: string, _body: string, _onYes: () => void, _yes?: string) => undefined),
    },
  };
  return { app: app as never as Parameters<typeof keepOutgoing>[0] & Parameters<typeof captureOutgoing>[0], raw: app, swap: () => (generation += 1) };
}

const SAVE = Uint8Array.from([1, 2, 3]);
const PACKED = Uint8Array.from([7, 8]);
const VCTOWER2 = Uint8Array.from([...new TextEncoder().encode("VCTOWER2\n"), ...PACKED]);
/** A stored Auto-save the way the game writes it: `VCZ1:` and base64 deflate. */
const STORED = "VCZ1:" + deflateRawSync(Buffer.from(JSON.stringify({ minutes: 90, units: [] }))).toString("base64");

beforeEach(async () => {
  m.track.mockReset();
  m.saveBytes.mockReset().mockReturnValue(SAVE);
  m.packSave.mockReset().mockResolvedValue({ packed: PACKED, base64: "" });
  m.live = true;
  m.stored = STORED;
  m.autoName = "Harmony Tower 2.0";
  setCurrentFile(null);
  resetOutgoingForTests();
  await fileSpace.open(new FakeIndexedDb().asFactory());
});
afterEach(() => closeFileSpaceForTests());

describe("the tower left by opening another", () => {
  it("is written into its own My Towers file when it has one, as File > Save does", async () => {
    const own = await fileSpace.save("Harmony", "tower", Uint8Array.from([0]));
    setCurrentFile(own.id);
    const { app, raw, swap } = makeApp();
    captureOutgoing(app, "open");
    expect(m.saveBytes, "no camera stamp, so a refused swap leaves the tower as it was").toHaveBeenCalledExactlyOnceWith(raw.enginePort, null, expect.anything());
    swap();
    expect(await keepOutgoing(app)).toBe("file");
    expect(fileSpace.list()).toHaveLength(1);
    expect(await fileSpace.read(own.id)).toEqual(VCTOWER2);
    expect(m.packSave).toHaveBeenCalledExactlyOnceWith(SAVE);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("tower_kept", "file");
    expect(raw.ui.toast).toHaveBeenCalledWith('Saved "Harmony" in My Towers.', "good");
  });

  it("opening its own file again to go back keeps the minutes since as a new file, never over the file being read", async () => {
    const own = await fileSpace.save("Harmony", "tower", Uint8Array.from([0]));
    setCurrentFile(own.id);
    const { app, swap } = makeApp();
    openingFile(own.id);
    captureOutgoing(app, "open");
    swap();
    expect(await keepOutgoing(app)).toBe("new");
    expect(await fileSpace.read(own.id), "the file opened is untouched").toEqual(Uint8Array.from([0]));
    expect(await fileSpace.read(fileSpace.find("Harmony Tower 2.0")!.id)).toEqual(VCTOWER2);

    // The note is for that one open: the next swap writes the tower's own file again.
    captureOutgoing(app, "open");
    swap();
    expect(await keepOutgoing(app)).toBe("file");
  });

  it("gets a new file under the tower's name when it has none, numbered when the name is taken", async () => {
    await fileSpace.save("Harmony Tower 2.0", "tower", Uint8Array.from([0]));
    const { app, raw, swap } = makeApp();
    captureOutgoing(app, "new");
    swap();
    expect(await keepOutgoing(app)).toBe("new");
    const kept = fileSpace.find("Harmony Tower 2.0 (2)");
    expect(kept).toBeDefined();
    expect(await fileSpace.read(kept!.id)).toEqual(VCTOWER2);
    expect(await fileSpace.read(fileSpace.find("Harmony Tower 2.0")!.id), "the other file is left alone").toEqual(Uint8Array.from([0]));
    expect(m.track).toHaveBeenCalledExactlyOnceWith("tower_kept", "new");
    expect(raw.ui.toast).toHaveBeenCalledWith('Kept your last tower in My Towers as "Harmony Tower 2.0 (2)".', "good");
  });

  it("from the linked folder is kept in My Towers, never written back to the player's own file", async () => {
    setCurrentLinkedFile("Harmony.vctower");
    const { app, swap } = makeApp();
    captureOutgoing(app, "open");
    swap();
    expect(await keepOutgoing(app)).toBe("new");
    expect(fileSpace.list().map((f) => f.name)).toEqual(["Harmony Tower 2.0"]);
  });

  it("behind the title screen is the Auto-save's tower, kept re-headered without a decode", async () => {
    m.live = false;
    const { app, swap } = makeApp("Throwaway");
    captureOutgoing(app, "open");
    expect(m.saveBytes, "the engine's throwaway tower is not saved").not.toHaveBeenCalled();
    swap();
    expect(await keepOutgoing(app)).toBe("new");
    const kept = fileSpace.find("Harmony Tower 2.0")!;
    const text = new TextDecoder().decode((await fileSpace.read(kept.id))!);
    expect(text).toBe(`VCTOWER1\n${STORED.slice("VCZ1:".length)}\n`);
  });

  it("is nothing when the Auto-save itself comes back from the title screen (Continue)", async () => {
    m.live = false;
    const { app, swap } = makeApp();
    captureOutgoing(app, "load");
    swap();
    expect(await keepOutgoing(app)).toBeNull();
    expect(fileSpace.list()).toEqual([]);
    expect(m.track).not.toHaveBeenCalled();
  });

  it("is still kept when the Auto-save is opened while a tower is live", async () => {
    const { app, swap } = makeApp();
    captureOutgoing(app, "load");
    swap();
    expect(await keepOutgoing(app)).toBe("new");
  });

  it("is nothing when the title screen has no Auto-save to leave", async () => {
    m.live = false;
    m.stored = null;
    const { app, swap } = makeApp();
    captureOutgoing(app, "new");
    swap();
    expect(await keepOutgoing(app)).toBeNull();
    expect(fileSpace.list()).toEqual([]);
  });

  it("is not kept when the swap was refused, either told or seen in the engine's generation", async () => {
    const { app } = makeApp();
    captureOutgoing(app, "open");
    expect(await keepOutgoing(app), "no swap: the generation did not move").toBeNull();
    captureOutgoing(app, "open");
    dropOutgoing();
    expect(await keepOutgoing(app)).toBeNull();
    expect(fileSpace.list()).toEqual([]);
  });

  it("is kept once, however many times the swap is followed", async () => {
    const { app, swap } = makeApp();
    captureOutgoing(app, "open");
    swap();
    await keepOutgoing(app);
    expect(await keepOutgoing(app)).toBeNull();
    expect(fileSpace.list()).toHaveLength(1);
  });

  it("is offered as a download in a message box when My Towers is full, and downloads only in its button's click", async () => {
    closeFileSpaceForTests();
    const full = new FakeIndexedDb();
    await fileSpace.open(full.asFactory());
    full.failWrites = true;
    const { app, raw, swap } = makeApp();
    captureOutgoing(app, "open");
    swap();
    expect(await keepOutgoing(app)).toBe("offered");
    expect(raw.ui.downloadFile, "no download without the player's click").not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledExactlyOnceWith("tower_kept", "offered");
    const [title, body, onYes, yes] = raw.ui.confirmModal.mock.calls[0]!;
    expect([title, body, yes]).toEqual(["Keep your last tower", 'My Towers couldn\'t keep "Harmony Tower 2.0". Download it as "Harmony Tower 2.0.vctower" so it isn\'t lost?', "Download"]);
    onYes();
    expect(raw.ui.downloadFile).toHaveBeenCalledExactlyOnceWith("Harmony Tower 2.0.vctower", VCTOWER2);
    expect(m.track).toHaveBeenLastCalledWith("tower_kept", "download");
  });

  it("counts no download when the offered download fails, and adds no second message", async () => {
    closeFileSpaceForTests();
    const full = new FakeIndexedDb();
    await fileSpace.open(full.asFactory());
    full.failWrites = true;
    const { app, raw, swap } = makeApp();
    raw.ui.downloadFile.mockReturnValue(false);
    captureOutgoing(app, "open");
    swap();
    await keepOutgoing(app);
    raw.ui.confirmModal.mock.calls[0]![2]();
    expect(raw.ui.downloadFile).toHaveBeenCalledOnce();
    expect(raw.ui.sayVisibly, "UI.downloadFile toasts its own failure").not.toHaveBeenCalled();
    expect(m.track).not.toHaveBeenCalledWith("tower_kept", "download");
  });

  it("counts a failure when the tower can't be packed, and tells the player", async () => {
    m.packSave.mockRejectedValue(new Error("worker lost"));
    const { app, raw, swap } = makeApp();
    captureOutgoing(app, "open");
    swap();
    expect(await keepOutgoing(app)).toBe("failed");
    expect(raw.ui.downloadFile).not.toHaveBeenCalled();
    expect(raw.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("couldn't be kept"));
    expect(m.track).toHaveBeenCalledExactlyOnceWith("tower_kept", "failed");
  });

  it("holds back an open until the keep in flight is written, so going back reads the kept copy", async () => {
    const own = await fileSpace.save("Harmony", "tower", Uint8Array.from([0]));
    setCurrentFile(own.id);
    let release!: (v: { packed: Uint8Array; base64: string }) => void;
    m.packSave.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { app, swap } = makeApp();
    captureOutgoing(app, "open");
    swap();
    const kept = keepOutgoing(app);
    let settled = false;
    const open = keptSettled().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled, "an open waits while the keep is packing").toBe(false);
    expect(await fileSpace.read(own.id), "the file still holds the older copy").toEqual(Uint8Array.from([0]));
    release({ packed: PACKED, base64: "" });
    await open;
    expect(await fileSpace.read(own.id), "once settled, the file is the kept tower").toEqual(VCTOWER2);
    expect(await kept).toBe("file");
  });

  it("never stops the swap when the live tower can't be read, and counts the loss only if a swap follows", async () => {
    m.saveBytes.mockImplementation(() => {
      throw new Error("engine trapped");
    });
    const { app, raw, swap } = makeApp();
    expect(() => captureOutgoing(app, "open")).not.toThrow();
    expect(await keepOutgoing(app), "refused: nothing was left").toBeNull();
    expect(m.track).not.toHaveBeenCalled();
    captureOutgoing(app, "open");
    swap();
    expect(await keepOutgoing(app)).toBe("failed");
    expect(m.track).toHaveBeenCalledExactlyOnceWith("tower_kept", "failed");
    expect(raw.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("couldn't be kept"));
    expect(raw.ui.downloadFile).not.toHaveBeenCalled();
    expect(fileSpace.list()).toEqual([]);
  });
});
