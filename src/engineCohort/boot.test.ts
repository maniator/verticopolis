import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRASH_HOLD_NOTICE, drawRuns, noteRustCrashed, noteRustFailed, safetyRuns, selectBootEngine, stageNotice, TOOLING_STAGE_KEY } from "./boot";
import { countRustCrash } from "./crashReload";
import { setCurrentSelection } from "./current";
import { BOOT_MARKER_KEY, COHORT_KEY, readSafety, SAFETY_KEY } from "./records";
import { ENGINE_STORAGE_KEY } from "../wasmhost/engineChoice";

// The suites below test the Rust paths the Settings choice and the cohort
// reach once the test link no longer holds them (#1422); the hold that keeps
// them on TypeScript until then is tested on its own.
const flags = vi.hoisted(() => ({ rustOnlyByChoice: false }));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  get RUST_ONLY_BY_CHOICE() {
    return flags.rustOnlyByChoice;
  },
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("the boot while only a choice boots Rust", () => {
  afterEach(() => {
    flags.rustOnlyByChoice = false;
  });

  it("runs Rust for a stored Rust choice and the test link, and TypeScript for an old host", () => {
    flags.rustOnlyByChoice = true;
    localStorage.setItem(ENGINE_STORAGE_KEY, "wasm");
    expect(selectBootEngine("")).toBe("wasm");
    expect(selectBootEngine("?engine=wasm")).toBe("wasm");
    localStorage.setItem(ENGINE_STORAGE_KEY, "wasm-frame");
    expect(selectBootEngine("")).toBe("ts");
  });
});
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
  it("latches for a Settings choice of Rust while the cohort's fields are off", () => {
    selectBootEngine("");
    setCurrentSelection({ stage: 0, preference: "wasm", suppression: null, crashLoop: false, transition: "none", notice: "none", markerId: null, boot: "wasm", requested: "wasm", selectedBy: "setting", assignedArm: "ts" });
    noteRustFailed("crash-loop", "trap-loop");
    expect(readSafety(localStorage)).toMatchObject({ ok: true, value: { reason: "trap-loop", scope: "fault" } });
  });

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

describe("a crash reload (#1422)", () => {
  it("leaves Rust without a latch, so the reload boots Rust again", () => {
    atStage(1, 3);
    expect(selectBootEngine("")).toBe("wasm");
    countRustCrash(sessionStorage, __APP_SHA__);
    noteRustCrashed();
    expect(localStorage.getItem(BOOT_MARKER_KEY)).toBeNull();
    expect(localStorage.getItem(SAFETY_KEY)).toBeNull();
    expect(selectBootEngine("")).toBe("wasm");
    expect(stageNotice()).toBeNull();
  });

  it("holds the tab on TypeScript after its second crash, a test link included, and says why", () => {
    atStage(1, 3);
    countRustCrash(sessionStorage, __APP_SHA__);
    countRustCrash(sessionStorage, __APP_SHA__);
    expect(selectBootEngine("")).toBe("ts");
    // The held boot added no marker entry that could go stale.
    expect(localStorage.getItem(BOOT_MARKER_KEY)).toBeNull();
    expect(stageNotice()).toBe(CRASH_HOLD_NOTICE);
    expect(selectBootEngine("?engine=wasm")).toBe("ts");
  });

  it("latches the second crash as a trap loop on an ordinary boot", () => {
    atStage(1, 3);
    selectBootEngine("");
    noteRustFailed("crash-loop", "trap-loop");
    expect(readSafety(localStorage)).toMatchObject({ ok: true, value: { scope: "fault", stage: "crash-loop", reason: "trap-loop" } });
  });
});
