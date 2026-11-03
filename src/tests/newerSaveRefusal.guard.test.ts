import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NEWER_SAVE_REFUSAL } from "../game/portLifecycle";

describe("the newer-save refusal text", () => {
  it("the page's copy is the engine's NEWER_SAVE_REFUSAL, so the page can tell it from a damaged save", () => {
    const rust = readFileSync(resolve(__dirname, "../../engine-rs/src/load/reader.rs"), "utf8");
    expect(rust).toContain(`"${NEWER_SAVE_REFUSAL}"`);
  });
});
