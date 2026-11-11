import { describe, expect, it, vi } from "vitest";
import { SaveGame } from "../storage/SaveGame";
import { SMALL_TOWER_SAVE } from "../tests/fixtures/handSaves";
import { mockPort } from "../tests/portKit/mockPort";
import { SWAP_REFUSED, TRAPPED_SAVE_REFUSED, exportFileText, loadStored, saveText, swapDone } from "./portLifecycle";
import { noteEngineThrow, watchEngineTraps } from "./engineFault";

/**
 * The app's side of the tower's life over a mock port: what it hands the
 * engine and what it does with the answers. The engine's side (a load, the
 * founder rule on a stored save, a refused text) is the Rust engine's, in
 * `saveRepair.integration.test.ts` and its load tests.
 */

const DONE = Float64Array.of(1, 2);
const REFUSED = Float64Array.of(0, 1);

/** A port whose load answers `answer`, with `reason` for a refusal. */
const loader = (answer: Float64Array = DONE, reason?: string) => mockPort({ loadSave: () => answer, lastReason: () => reason });

describe("swapDone", () => {
  it("returns on a done swap and throws the engine's refusal otherwise", () => {
    const engine = loader(DONE, "The save is not JSON.");
    expect(() => swapDone(engine, DONE)).not.toThrow();
    expect(engine.lastReason, "a done swap reads no reason").not.toHaveBeenCalled();
    expect(() => swapDone(engine, REFUSED)).toThrow("The save is not JSON.");
  });

  it("says the stock refusal when the engine gives no reason", () => {
    expect(() => swapDone({ lastReason: () => undefined }, Float64Array.of(0, 0))).toThrow(SWAP_REFUSED);
  });
});

describe("saveText", () => {
  it("asks a trapped engine for nothing, so no save, slot or export replaces the last good one (#1422)", () => {
    const engine = mockPort({ serialize: () => SMALL_TOWER_SAVE, setCamera: () => new Float64Array() });
    const serialize = vi.mocked(engine.serialize);
    watchEngineTraps(() => {});
    try {
      expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
      expect(() => saveText(engine, null)).toThrow(TRAPPED_SAVE_REFUSED);
      expect(serialize).not.toHaveBeenCalled();
    } finally {
      watchEngineTraps(null);
    }
    // A new engine's watch starts clean.
    expect(() => saveText(engine, null)).not.toThrow();
  });

  it("stamps the live camera before the save, so the view travels with it", () => {
    const calls: string[] = [];
    const engine = mockPort({
      setCamera: () => (calls.push("camera"), new Float64Array()),
      serialize: () => (calls.push("save"), SMALL_TOWER_SAVE),
    });
    expect(saveText(engine, { tile: 120, floor: 7, zoom: 2 })).toBe(SMALL_TOWER_SAVE);
    expect(engine.setCamera).toHaveBeenCalledExactlyOnceWith(120, 7, 2);
    expect(calls).toEqual(["camera", "save"]);
  });

  it("stamps nothing without a camera, keeping the view the tower carries", () => {
    const carried = JSON.stringify({ ...(JSON.parse(SMALL_TOWER_SAVE) as object), view: { tile: 33, floor: 4, zoom: 1 } });
    const setCamera = vi.fn();
    expect(saveText({ setCamera, serialize: () => carried }, null)).toBe(carried);
    expect(setCamera).not.toHaveBeenCalled();
  });
});

describe("exportFileText", () => {
  const stamp = { appVersion: "2.0.0", savedAt: 1_700_000_000_000 };
  const calls: string[] = [];
  const portWith = (file: string | undefined, reason?: string) => ({
    setCamera: vi.fn(() => (calls.push("camera"), new Float64Array())),
    exportVctower: vi.fn(() => (calls.push("write"), file)),
    lastReason: () => reason,
  });

  it("stamps the camera, then asks the engine for the file with the build and time", () => {
    calls.length = 0;
    const port = portWith("VCTOWER1\nQQ==\n");
    expect(exportFileText(port, { tile: 5, floor: 2, zoom: 1 }, stamp)).toBe("VCTOWER1\nQQ==\n");
    expect(calls).toEqual(["camera", "write"]);
    expect(port.exportVctower).toHaveBeenCalledWith("2.0.0", 1_700_000_000_000);
  });

  it("stamps nothing without a camera", () => {
    const port = portWith("x");
    exportFileText(port, null, stamp);
    expect(port.setCamera).not.toHaveBeenCalled();
  });

  it("throws the engine's reason when it writes no file, or the stock line without one", () => {
    expect(() => exportFileText(portWith(undefined, "too big"), null, stamp)).toThrow("too big");
    expect(() => exportFileText(portWith(undefined), null, stamp)).toThrow("The tower could not be exported.");
  });

  it("asks a trapped engine for nothing (#1422)", () => {
    const port = portWith("x");
    watchEngineTraps(() => {});
    try {
      expect(noteEngineThrow(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
      expect(() => exportFileText(port, { tile: 1, floor: 1, zoom: 1 }, stamp)).toThrow(TRAPPED_SAVE_REFUSED);
      expect(port.exportVctower).not.toHaveBeenCalled();
      expect(port.setCamera).not.toHaveBeenCalled();
    } finally {
      watchEngineTraps(null);
    }
  });

  it("latches a trap thrown inside the export, so the next save is refused up front", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const port = {
      setCamera: vi.fn(() => new Float64Array()),
      exportVctower: vi.fn((): string => {
        throw trap;
      }),
      lastReason: () => undefined,
    };
    watchEngineTraps(() => {});
    try {
      expect(() => exportFileText(port, null, stamp)).toThrow(trap);
      expect(() => exportFileText(port, null, stamp)).toThrow(TRAPPED_SAVE_REFUSED);
      expect(port.exportVctower).toHaveBeenCalledTimes(1);
    } finally {
      watchEngineTraps(null);
    }
  });
});

describe("loadStored", () => {
  it("hands a stored save to the engine's load, which applies the founder rule", () => {
    localStorage.clear();
    const engine = loader();
    // A save with no appVersion predates the stamp; the engine reads it as a
    // founder's (saveRepair.integration.test.ts), so it is handed over as is.
    expect(loadStored(engine)(SMALL_TOWER_SAVE)).toBe(true);
    expect(engine.loadSave).toHaveBeenLastCalledWith(SMALL_TOWER_SAVE);
    // SaveGame stamps what it writes, so a stored save keeps its own status.
    SaveGame.saveSlot(2, SMALL_TOWER_SAVE);
    expect(SaveGame.loadSlot(2, loadStored(engine))).toBe(true);
    const handed = JSON.parse(vi.mocked(engine.loadSave).mock.lastCall![0]) as { appVersion?: string; towerName: string };
    expect([typeof handed.appVersion, handed.towerName]).toEqual(["string", "Tower One"]);
  });

  it("answers false for a save the engine refuses", () => {
    expect(loadStored(loader(REFUSED))("not a save")).toBe(false);
  });
});

describe("loadStored's follow (PR 5e: the app follows a swap itself)", () => {
  it("calls the follow once a load is done, after the engine took the new tower", () => {
    const engine = loader();
    const followed = vi.fn(() => expect(engine.loadSave).toHaveBeenCalledOnce());
    expect(loadStored(engine, followed)(SMALL_TOWER_SAVE)).toBe(true);
    expect(followed).toHaveBeenCalledOnce();
  });

  it("calls nothing for a refused load", () => {
    const followed = vi.fn();
    expect(loadStored(loader(REFUSED), followed)("nope")).toBe(false);
    expect(followed).not.toHaveBeenCalled();
  });
});
