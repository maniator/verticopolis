import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { EnginePort } from "../../simport/enginePort";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { createPortUnitDiagnostics } from "../../game/portUnitDiagnostics";
import { readCatalog } from "../../dualrun/catalog";

/**
 * The inspector's unit diagnostics, rendered by the production adapter from
 * the Rust engine's facts on a real saved tower (moved from the retired
 * `tsEngine.golden.integration.test.ts`, #1875). No synthetic facts: the save
 * holds unhappy tenants, and one of them must reach a player-visible gripe.
 */

type RustEngine = EnginePort & { free(): void };
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../conformance/fixtures");

const freed: RustEngine[] = [];
afterEach(() => {
  for (const e of freed.splice(0)) e.free();
});

describe.skipIf(!hasWasmPackage())("the unit diagnostics adapter on the Rust engine", () => {
  it("renders a real low-satisfaction grievance from a saved tower", () => {
    const rust = wasm().Engine.newGame(1, "modern") as unknown as RustEngine;
    freed.push(rust);
    const saved = readFileSync(resolve(FIXTURES, "split-tower-4.vctower"), "utf8");
    expect(rust.loadVctower(saved)[0]).toBe(1);
    const diagnostic = createPortUnitDiagnostics(rust, () => readCatalog(wasm(), "modern").rules);
    const ids = (JSON.parse(rust.serialize()) as { units: { id: number }[] }).units.map((u) => u.id);
    const gripes = ids
      .map((id) => diagnostic(id).map((line) => line.strings.map((part, i) => part + (i < line.values.length ? String(line.values[i]) : "")).join("")).join("\n"))
      .filter((text) => text.includes("Main gripe:"));
    expect(gripes.length, "a real Rust save must reach a player-visible Main gripe").toBeGreaterThan(0);
    for (const text of gripes) expect(text).toMatch(/Main gripe: (a noisy|a nightclub|crowded|overcrowded|the rent|too few|shops)/);
  });
});
