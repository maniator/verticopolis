import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { openImport, towerFileAccept, TOWER_FILE_PICKER_OPTIONS, TOWER_PICKER_MIME } from "../../ui/uiImport";

// The import picker offers only tower files (.vctower and the 1994 .TDT), and
// filters for the player wherever the platform can: the native picker on a
// desktop browser that has one, otherwise the <input> picker's accept list.
// The native picker is a browser API, so these tests stand it in with a spy.

beforeEach(() => {
  mountAppDom();
});

describe("import picker: only tower files, filtered where the platform can", () => {
  const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
  const pickerWindow = window as { showOpenFilePicker?: unknown };

  afterEach(() => {
    delete pickerWindow.showOpenFilePicker;
    vi.restoreAllMocks();
  });

  it("towerFileAccept adds the octet-stream entry only for phones and tablets", () => {
    expect(towerFileAccept(false)).toBe(".vctower,.tdt,.TDT");
    expect(towerFileAccept(true)).toBe(".vctower,application/octet-stream,.tdt,.TDT");
  });

  it("a phone gets the <input> picker with the octet-stream entry, even when a native picker exists", () => {
    const { ui } = makeUI();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID_UA);
    const nativePick = vi.fn();
    pickerWindow.showOpenFilePicker = nativePick;
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImport(ui);
    expect(nativePick).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    const input = document.getElementById("import-file") as HTMLInputElement;
    expect(input.accept).toBe(".vctower,application/octet-stream,.tdt,.TDT");
  });

  it("an Android tablet asking for the desktop site still gets the <input> picker", () => {
    const { ui } = makeUI();
    Object.defineProperty(navigator, "userAgentData", { value: { platform: "Android" }, configurable: true });
    const nativePick = vi.fn();
    pickerWindow.showOpenFilePicker = nativePick;
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      openImport(ui);
    } finally {
      delete (navigator as { userAgentData?: unknown }).userAgentData;
    }
    expect(nativePick).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    // Its picker filters by type, so it keeps the octet-stream entry too.
    const input = document.getElementById("import-file") as HTMLInputElement;
    expect(input.accept).toBe(".vctower,application/octet-stream,.tdt,.TDT");
  });

  it("a desktop with the native picker opens it with tower types only and no All files option", async () => {
    const { ui, cb } = makeUI();
    const file = new File(["VCTOWER1\npayload"], "tower.vctower");
    const nativePick = vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(file) }]);
    pickerWindow.showOpenFilePicker = nativePick;
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImport(ui);
    expect(nativePick).toHaveBeenCalledExactlyOnceWith(TOWER_FILE_PICKER_OPTIONS);
    expect(TOWER_FILE_PICKER_OPTIONS.excludeAcceptAllOption).toBe(true);
    // One type, keyed on a MIME type no platform knows: a known key such as
    // application/octet-stream makes Chromium add .bin, .exe and .com too.
    expect(TOWER_FILE_PICKER_OPTIONS.types).toEqual([
      { description: "Tower files (.vctower, .TDT)", accept: { [TOWER_PICKER_MIME]: [".vctower", ".tdt"] } },
    ]);
    expect(TOWER_PICKER_MIME).toBe("application/x-verticopolis-tower");
    await vi.waitFor(() => expect(cb.onImport).toHaveBeenCalledExactlyOnceWith("VCTOWER1\npayload"));
    expect(click).not.toHaveBeenCalled();
  });

  it("a .TDT from the native picker routes to onImportLegacy", async () => {
    const { ui, cb } = makeUI();
    const file = new File([new Uint8Array([0x00, 0x24, 1, 2])], "MYTOWER.TDT");
    pickerWindow.showOpenFilePicker = vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(file) }]);
    openImport(ui);
    await vi.waitFor(() => expect(cb.onImportLegacy).toHaveBeenCalledTimes(1));
    expect(vi.mocked(cb.onImportLegacy).mock.calls[0][1]).toBe("MYTOWER.TDT");
    expect(cb.onImport).not.toHaveBeenCalled();
  });

  it("closing the native picker without a file does nothing, quietly", async () => {
    const { ui, cb } = makeUI();
    const nativePick = vi.fn().mockRejectedValue(new DOMException("The user aborted a request.", "AbortError"));
    pickerWindow.showOpenFilePicker = nativePick;
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const say = vi.spyOn(ui, "sayVisibly").mockImplementation(() => {});
    openImport(ui);
    await vi.waitFor(() => expect(nativePick).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(click).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(cb.onImport).not.toHaveBeenCalled();
  });

  it("a native picker the page may not open falls back to the <input> picker", async () => {
    const { ui } = makeUI();
    pickerWindow.showOpenFilePicker = vi.fn().mockRejectedValue(new DOMException("Cross origin sub frames", "SecurityError"));
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    openImport(ui);
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const input = document.getElementById("import-file") as HTMLInputElement;
    expect(input.accept).toBe(".vctower,.tdt,.TDT");
  });

  it("a picked file that can no longer be opened says so instead of failing silently", async () => {
    const { ui, cb } = makeUI();
    pickerWindow.showOpenFilePicker = vi
      .fn()
      .mockResolvedValue([{ getFile: () => Promise.reject(new DOMException("gone", "NotFoundError")) }]);
    const say = vi.spyOn(ui, "sayVisibly").mockImplementation(() => {});
    openImport(ui);
    await vi.waitFor(() => expect(say).toHaveBeenCalledExactlyOnceWith("Couldn't read that file. Please try again."));
    expect(cb.onImport).not.toHaveBeenCalled();
  });

  it("a native picker that hands back no file does nothing", async () => {
    const { ui, cb } = makeUI();
    const nativePick = vi.fn().mockResolvedValue([]);
    pickerWindow.showOpenFilePicker = nativePick;
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const say = vi.spyOn(ui, "sayVisibly").mockImplementation(() => {});
    openImport(ui);
    await vi.waitFor(() => expect(nativePick).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(click).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(cb.onImport).not.toHaveBeenCalled();
  });
});
