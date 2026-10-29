import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectBootEngine, TOOLING_STAGE_KEY } from "./boot";
import { currentSelection, setCurrentSelection } from "./current";
import { BOOT_MARKER_KEY, COHORT_KEY } from "./records";
import { ENGINE_STORAGE_KEY } from "../wasmhost/engineChoice";

// The size gate at engine selection (#1197), with its flag switched on here
// at stage 2 (it ships off with no gated stage, `config.test.ts`) and a
// threshold of 10 characters.
const stub = vi.hoisted(() => ({ chars: 0 }));
vi.mock("./config", async (importOriginal) => ({ ...(await importOriginal<typeof import("./config")>()), SIZE_GATE_ON: true, SIZE_GATE_THRESHOLD: 10, SIZE_GATED_STAGES: [2] }));
vi.mock("./sizeGate", async (importOriginal) => ({ ...(await importOriginal<typeof import("./sizeGate")>()), storedSaveChars: () => stub.chars }));

const atStage = (stage: number, bucket: number) => {
  localStorage.setItem(TOOLING_STAGE_KEY, JSON.stringify({ stage }));
  localStorage.setItem(COHORT_KEY, JSON.stringify({ v: 1, bucket }));
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  setCurrentSelection(null);
  localStorage.clear();
});

describe("the size gate at engine selection", () => {
  it("boots a WASM-arm tower above the threshold on TypeScript, with no crash-marker entry left", () => {
    stub.chars = 11;
    atStage(2, 0);
    expect(selectBootEngine("")).toBe("ts");
    expect(currentSelection()).toMatchObject({ requested: "wasm", selectedBy: "cohort", sizeGated: true, markerId: null, notice: "none" });
    expect(JSON.parse(localStorage.getItem(BOOT_MARKER_KEY) ?? "[]")).toEqual([]);
  });

  it("marks a TypeScript-arm tower above the threshold too, so the arms stay comparable", () => {
    stub.chars = 11;
    atStage(2, 99);
    expect(selectBootEngine("")).toBe("ts");
    expect(currentSelection()?.sizeGated).toBe(true);
  });

  it("leaves a tower at the threshold, stage 1, and a player's own choice alone", () => {
    stub.chars = 10;
    atStage(2, 0);
    expect(selectBootEngine("")).toBe("wasm");
    expect(currentSelection()?.sizeGated).toBeUndefined();
    stub.chars = 11;
    atStage(1, 0);
    expect(selectBootEngine("")).toBe("wasm");
    localStorage.setItem(ENGINE_STORAGE_KEY, "wasm");
    atStage(2, 0);
    expect(selectBootEngine("")).toBe("wasm");
    expect(currentSelection()?.sizeGated).toBeUndefined();
  });
});

