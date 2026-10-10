import { describe, expect, it } from "vitest";
import { catalogFor } from "../../engine/catalog";
import type { GameMode } from "../../engine/types";
import { readCatalog } from "../../dualrun/binding";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The catalog through the WASM binding (#913): `Engine.catalog(mode)` is the
 * Rust engine's catalog as JSON, and it must equal the TypeScript engine's
 * `catalogFor(mode)` value for value in both modes. The hash lock
 * (`conformance/catalog.json`) holds the same line natively; this checks the
 * package a JavaScript host actually loads. Skips without the package unless
 * `VC_REQUIRE_WASM=1` (`npm run test:wasm`, which CI runs).
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

describe.skipIf(!hasWasmPackage())("the catalog through the WASM binding", () => {
  for (const mode of ["classic", "modern"] as GameMode[]) {
    it(`Engine.catalog("${mode}") equals catalogFor("${mode}")`, () => {
      expect(readCatalog(wasm(), mode)).toStrictEqual(catalogFor(mode));
    });
  }

  it("refuses an unknown mode with an error that leaves the module usable", () => {
    expect(() => wasm().Engine.catalog("arcade")).toThrow(/classic or modern/);
    expect(readCatalog(wasm(), "classic")).toStrictEqual(catalogFor("classic"));
  });
});
