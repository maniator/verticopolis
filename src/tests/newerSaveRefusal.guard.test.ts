import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NEWER_SAVE_REFUSAL } from "../game/portLifecycle";
import { ENGINE_ROOT } from "./packagePaths";

describe("the newer-save refusal text", () => {
  it("the page's copy is the engine's NEWER_SAVE_REFUSAL, so the page can tell it from a damaged save", () => {
    // The engine compiles the text into the module the game ships, so the
    // installed package's bytes hold it exactly as the engine raises it.
    const wasm = readFileSync(resolve(ENGINE_ROOT, "web/verticopolis_engine_bg.wasm"));
    expect(wasm.includes(Buffer.from(NEWER_SAVE_REFUSAL, "utf8"))).toBe(true);
  });
});
