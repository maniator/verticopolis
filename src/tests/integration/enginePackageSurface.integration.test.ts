import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFor } from "../../engine/catalog";
import { digest } from "../conformance/canonical";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * One engine package carries both surfaces merged from separate pull
 * requests: the read-only catalog (`catalog(mode)`, #930) and the relay-only
 * silent tower ops (`towerSetCars`, `towerResizeTransport`, #906). A merge or
 * a stale regeneration of the generated glue, declaration or `.wasm` that
 * dropped either one fails here, for the package the tests build and for the
 * glue the web build ships from `src/public/engine/`.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

describe.skipIf(!hasWasmPackage())("engine package surface", () => {
  it("one module exports catalog(mode) and an Engine with the relay-only tower ops", () => {
    const mod = wasm();
    expect(typeof mod.catalog).toBe("function");
    for (const mode of ["classic", "modern"] as const) {
      expect(digest(JSON.parse(mod.catalog!(mode)))).toBe(digest(catalogFor(mode)));
    }
    const proto = mod.Engine.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.towerSetCars).toBe("function");
    expect(typeof proto.towerResizeTransport).toBe("function");
  });

  // The web build's copy of the package; a checkout that builds it only for
  // the jobs that serve it (#958) has no copy to check, so the case skips.
  const SHIPPED_GLUE = resolve(REPO_ROOT, "src/public/engine/verticopolis_engine.js");
  it.skipIf(!existsSync(SHIPPED_GLUE))("the shipped glue in src/public/engine exports both surfaces", () => {
    const glue = readFileSync(SHIPPED_GLUE, "utf8");
    expect(glue).toMatch(/export function catalog\(/);
    expect(glue).toMatch(/\btowerSetCars\(/);
    expect(glue).toMatch(/\btowerResizeTransport\(/);
  });
});
