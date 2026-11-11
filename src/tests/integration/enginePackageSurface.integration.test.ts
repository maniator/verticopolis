import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogLockView } from "../conformance/catalogLockView";
import { RoomTierReader } from "../../simport/roomTiers";
import { rustBootTower } from "../../wasmhost/rustEngine";
import { digest } from "../conformance/canonical";
import { CONFORMANCE_DIR, REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * One engine package carries the read-only catalog (`catalog(mode)`, #930),
 * and a merge or a stale regeneration of the generated glue, declaration or
 * `.wasm` that dropped it fails here, for the package the tests build and for
 * the glue the web build ships from `src/public/engine/`. The same holds for
 * the Map's `roomTiers` read (#343 S7) on the port the app boots. The relay
 * ops `towerSetCars` and `towerResizeTransport` (#906) left the binding with
 * the dual-run mirror that called them (#1421); a package that still has
 * them is stale.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

describe.skipIf(!hasWasmPackage())("engine package surface", () => {
  it("one module exports catalog(mode), and its Engine no longer has the relay ops", () => {
    const mod = wasm();
    expect(typeof mod.catalog).toBe("function");
    const lock = JSON.parse(readFileSync(resolve(CONFORMANCE_DIR, "catalog-digests.json"), "utf8")) as { catalogs: Record<string, string> };
    for (const mode of ["classic", "modern"] as const) {
      expect(digest(catalogLockView(JSON.parse(mod.catalog!(mode))))).toBe(lock.catalogs[mode]);
    }
    const proto = mod.Engine.prototype as unknown as Record<string, unknown>;
    expect(proto.towerSetCars).toBeUndefined();
    expect(proto.towerResizeTransport).toBeUndefined();
  });

  // The Map's Eval and Pricing views read through a `RoomTierReader` built
  // on the port the app boots (#343 S7). The member is optional on the port
  // type, since the TypeScript reference lacks it, so nothing at compile time
  // notices a hosted port that dropped it: this does.
  it("the port the app boots answers roomTiers, and a reader on it is available", () => {
    const { port } = rustBootTower(wasm());
    try {
      expect(typeof port.roomTiers).toBe("function");
      const reader = new RoomTierReader(port);
      expect(reader.available).toBe(true);
    } finally {
      const free = (port as unknown as { free?: unknown }).free;
      if (typeof free === "function") free.call(port);
    }
  });

  // The web build's copy of the package; a checkout that builds it only for
  // the jobs that serve it (#958) has no copy to check, so the case skips.
  const SHIPPED_GLUE = resolve(REPO_ROOT, "src/public/engine/verticopolis_engine.js");
  it.skipIf(!existsSync(SHIPPED_GLUE))("the shipped glue in src/public/engine exports the catalog and roomTiers", () => {
    const glue = readFileSync(SHIPPED_GLUE, "utf8");
    expect(glue).toMatch(/export function catalog\(/);
    expect(glue).toMatch(/\broomTiers\(/);
  });
});
