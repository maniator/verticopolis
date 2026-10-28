import { describe, expect, it } from "vitest";
import { VIEW_LAYOUT, VIEW_LAYOUT_TEXT } from "../../engine/port/layout";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * `src/engine/viewLayout.json` is the port's layout as the built package
 * hands it over (`npm run wasm:build` writes it), so the TypeScript engine
 * encodes by the same slots and tables as the Rust one. A layout change on
 * the Rust side that skipped the rebuild fails here, and CI's staleness
 * check fails a package rebuilt without committing the file.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

describe("viewLayout.json", () => {
  it.skipIf(!hasWasmPackage())("is the package's layout, text for text", () => {
    const probe = wasm().Engine.newGame(1, "modern");
    try {
      expect(VIEW_LAYOUT_TEXT).toBe(probe.viewLayout());
      expect(VIEW_LAYOUT.version).toBe((JSON.parse(probe.viewLayout()) as { version: number }).version);
    } finally {
      probe.free();
    }
  });
});
