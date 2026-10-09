import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_DIR, firstDivergence, loadScenario, runScenario, type Checkpoint } from "../conformance/scenario";
import { hasWasmPackage, startWasmEngine, wasmRequired } from "../conformance/wasmEngine";

/**
 * The conformance referee through the WASM binding: every scenario runs on
 * the Rust engine from Node, driven by the same runner as the TypeScript
 * engine, and must reproduce every pinned checkpoint. The binding is built by
 * `npm run wasm:build`; without it the suite skips, unless `VC_REQUIRE_WASM=1`
 * (CI builds it in engine-rs.yml and sets the switch, so a missing package
 * fails there). The lock itself is only ever written by the TypeScript run.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const lock = JSON.parse(readFileSync(resolve(CONFORMANCE_DIR, "expected.json"), "utf8")) as { scenarios: Record<string, Checkpoint[]> };
const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".json")).sort();

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

describe.skipIf(!hasWasmPackage())("engine conformance through the WASM binding", () => {
  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id} matches its pinned checkpoints`, () => {
      const want = lock.scenarios[scenario.id];
      if (!want) throw new Error(`${scenario.id} is not in the lock; regenerate it with the TypeScript run first`);
      expect(firstDivergence(runScenario(scenario, startWasmEngine), want)).toBeNull();
    }, 60_000);
  }

  // Each refusal must surface as the binding's own error with its message; a
  // Rust panic would trap (a RuntimeError) and poison the one module instance
  // for every scenario after it.
  it("refuses a scenario start it cannot honor with an error that leaves the module usable", () => {
    expect(() => startWasmEngine({ newGame: { seed: 1, mode: "arcade" as "classic" } })).toThrow(/classic or modern/);
    expect(() => startWasmEngine({ fixture: "conformance/README.md" })).toThrow(/not a VCTOWER1 file/);
    expect(() => startWasmEngine({ fixture: "src/tests/fixtures/sixseven-december.vctower", mode: "arcade" as "classic" })).toThrow(/classic or modern/);
    // The module still answers after the refusals: a fresh game founds and
    // hashes the same as the lock's starter.
    const want = lock.scenarios["starter-classic"]?.[0];
    if (!want) throw new Error("starter-classic is not in the lock; regenerate it with the TypeScript run first");
    const fresh = startWasmEngine(loadScenario(resolve(SCENARIO_DIR, "starter-classic.json")).start);
    try {
      expect(fresh.stateDigest()).toBe(want.state);
    } finally {
      fresh.free?.();
    }
  });
});
