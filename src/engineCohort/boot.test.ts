import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawRuns, noteRustFailed, safetyRuns, selectBootEngine, stageNotice, TOOLING_STAGE_KEY } from "./boot";
import { setCurrentSelection } from "./current";
import { BOOT_MARKER_KEY, COHORT_KEY, readSafety, SAFETY_KEY } from "./records";
import { ENGINE_STORAGE_KEY } from "../wasmhost/engineChoice";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.dispatchEvent(new Event("pagehide"));
  setCurrentSelection(null);
  localStorage.clear();
});

const atStage = (stage: number, bucket: number) => {
  localStorage.setItem(TOOLING_STAGE_KEY, JSON.stringify({ stage }));
  localStorage.setItem(COHORT_KEY, JSON.stringify({ v: 1, bucket }));
};

describe("the cohort at boot", () => {
  it("keeps today's choice in a tooling run with no test stage, and never latches there", () => {
    expect(selectBootEngine("")).toBe("ts");
    expect(selectBootEngine("?engine=wasm")).toBe("wasm");
    localStorage.setItem(ENGINE_STORAGE_KEY, "wasm");
    expect(selectBootEngine("")).toBe("wasm");
    noteRustFailed("host", "trap-tick");
    expect(readSafety(localStorage).ok).toBe(false);
    expect(localStorage.getItem(BOOT_MARKER_KEY)).toBeNull();
  });

  it("puts a WASM-arm browser on Rust with a crash-marker entry, then keeps it on TypeScript after a fault", () => {
    atStage(1, 3);
    expect(selectBootEngine("")).toBe("wasm");
    expect(localStorage.getItem(BOOT_MARKER_KEY)).not.toBeNull();
    noteRustFailed("host", "trap-tick");
    expect(readSafety(localStorage)).toMatchObject({ ok: true, value: { scope: "fault", stage: "host", reason: "trap-tick" } });
    // The page life left Rust, so its entry is gone.
    expect(localStorage.getItem(BOOT_MARKER_KEY)).toBeNull();
    expect(selectBootEngine("")).toBe("ts");
  });

  it("scopes a package that did not load to this build", () => {
    atStage(1, 3);
    selectBootEngine("");
    noteRustFailed("load", "boot-timeout");
    expect(readSafety(localStorage)).toMatchObject({ ok: true, value: { scope: "build", stage: "load" } });
  });

  it("leaves a TypeScript-arm browser on TypeScript at stage 0", () => {
    atStage(0, 3);
    expect(selectBootEngine("")).toBe("ts");
    expect(localStorage.getItem(BOOT_MARKER_KEY)).toBeNull();
  });
});

describe("when the cohort's paths run", () => {
  it("draws outside tooling, and in tooling only where a test set a stage", () => {
    expect(drawRuns(false, null)).toBe(true);
    expect(drawRuns(true, null)).toBe(false);
    expect(drawRuns(true, 0)).toBe(true);
  });

  it("runs the safety path with the cohort's fields or a test stage, and never otherwise", () => {
    expect(safetyRuns(false, null)).toBe(false);
    expect(safetyRuns(true, null)).toBe(true);
    expect(safetyRuns(false, 0)).toBe(true);
  });
});

describe("noteRustFailed", () => {
  it("leaves the records alone on a URL visit", () => {
    atStage(1, 3);
    expect(selectBootEngine("?engine=wasm")).toBe("wasm");
    noteRustFailed("host", "trap-tick");
    expect(localStorage.getItem(SAFETY_KEY)).toBeNull();
  });

  it("keeps the page's crash-marker entry when storage did not keep the latch", () => {
    atStage(1, 3);
    const real = localStorage;
    let full = false;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => real.getItem(k),
      setItem: (k: string, v: string) => {
        if (full && k === SAFETY_KEY) throw new Error("quota");
        real.setItem(k, v);
      },
      removeItem: (k: string) => real.removeItem(k),
    });
    selectBootEngine("");
    full = true;
    noteRustFailed("host", "trap-tick");
    vi.unstubAllGlobals();
    expect(localStorage.getItem(SAFETY_KEY)).toBeNull();
    expect(localStorage.getItem(BOOT_MARKER_KEY)).not.toBeNull();
  });

  it("watches the page life it started on Rust", () => {
    atStage(1, 3);
    selectBootEngine("");
    expect(localStorage.getItem(BOOT_MARKER_KEY)).not.toBeNull();
    // A page that leaves early steps aside, which only the watch does.
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(BOOT_MARKER_KEY)).toBeNull();
  });
});

describe("the stage-change notice", () => {
  it("says once that a stage change moved this browser to Rust, and back", () => {
    atStage(1, 15);
    selectBootEngine("");
    expect(stageNotice()).toBeNull();
    localStorage.setItem(TOOLING_STAGE_KEY, JSON.stringify({ stage: 2 }));
    selectBootEngine("");
    expect(stageNotice()).toContain("new Rust engine");
    selectBootEngine("");
    expect(stageNotice()).toBeNull();
    localStorage.setItem(TOOLING_STAGE_KEY, JSON.stringify({ stage: 1 }));
    selectBootEngine("");
    expect(stageNotice()).toContain("TypeScript engine again");
  });
});
