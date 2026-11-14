import { afterEach, describe, expect, it, vi } from "vitest";
import { DEBUG_FLAG, DEBUG_STORAGE_KEY, debugFlagOn, storedDebugFlags } from "./debugFlags";

describe("debug flags from the URL (#645)", () => {
  it("is off with no debug parameter", () => {
    expect(debugFlagOn("", DEBUG_FLAG.fps)).toBe(false);
    expect(debugFlagOn("?src=twa", DEBUG_FLAG.fps)).toBe(false);
  });

  it("turns on a named flag, alone or in a comma list", () => {
    expect(debugFlagOn("?debug=fps", DEBUG_FLAG.fps)).toBe(true);
    expect(debugFlagOn("?debug=draws,%20FPS", DEBUG_FLAG.fps)).toBe(true);
  });

  it("turns on every flag for all", () => {
    expect(debugFlagOn("?debug=all", DEBUG_FLAG.fps)).toBe(true);
  });

  it("does not match a flag that only contains the name", () => {
    expect(debugFlagOn("?debug=fpsx", DEBUG_FLAG.fps)).toBe(false);
  });
});

describe("the stored debug list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("turns a flag on from the stored list as well as the URL", () => {
    expect(debugFlagOn("", DEBUG_FLAG.fps, "fps")).toBe(true);
    expect(debugFlagOn("", DEBUG_FLAG.fps, " All ")).toBe(true);
    expect(debugFlagOn("", DEBUG_FLAG.fps, "draws")).toBe(false);
  });

  it("reads the key only where stored flags are honored", () => {
    localStorage.setItem(DEBUG_STORAGE_KEY, "fps");
    expect(DEBUG_STORAGE_KEY).toBe("vc-debug");
    expect(storedDebugFlags(true)).toBe("fps");
    expect(storedDebugFlags(false)).toBe("");
  });

  it("reads nothing when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(storedDebugFlags(true)).toBe("");
  });
});
