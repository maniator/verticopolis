import { afterEach, describe, it } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import type { EnginePort } from "../../simport/enginePort";
import { describeEngineContract } from "../../simport/engineContract.fixture";
import { describeEngineLifecycle } from "../../simport/engineLifecycle.fixture";
import { describeEngineQueries } from "../../simport/engineQueries.fixture";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

// The port contract on the Rust engine, loaded from the same towers the
// TypeScript run (`src/simport/engineContract.test.ts`) starts from.
if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void };
const made: RustEngine[] = [];
afterEach(() => {
  for (const e of made.splice(0)) e.free();
});

function make(sim: Simulation): EnginePort {
  const engine = wasm().Engine.fromSave(JSON.stringify(sim.serialize())) as unknown as RustEngine;
  made.push(engine);
  return engine;
}

if (hasWasmPackage()) {
  describeEngineContract("Rust Engine", make);
  describeEngineLifecycle("Rust Engine", make);
  describeEngineQueries("Rust Engine", make);
} else {
  describe("the Rust engine's port contract", () => {
    it.skip("needs the engine package (npm run wasm:build)", () => {});
  });
}
