import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { crowdView, stateView } from "../../engine/conformanceView";
import { checkBinding, type WasmModule } from "../../dualrun/binding";
import { digest } from "../conformance/canonical";
import type { Scenario } from "./scenarios";

/**
 * The authoritative outcome check for the comparison (issue #972), in Node
 * with the conformance digests: for each scenario, the TypeScript engine and
 * the served WASM package (the browser build, `src/public/engine/` or a
 * build directory's `engine/`, instantiated with `initSync`) start from the
 * same save, run the same ticks, and must agree on the state view AND the
 * crowd view, at the start and at the end. The browser runs compare the
 * state digest again on the real page; only this check sees the crowd.
 *
 * It also times the same loop on both engines in Node. Those numbers are a
 * secondary data point (Node's V8, not Chromium's), labeled as such.
 */

export interface NodeCheck {
  scenario: string;
  steps: number;
  dt: number;
  start: { tsState: string; wasmState: string; tsCrowd: string; wasmCrowd: string };
  end: { tsState: string; wasmState: string; tsCrowd: string; wasmCrowd: string };
  match: boolean;
  nodeTsMs: number;
  nodeWasmMs: number;
}

/** Load the browser package's glue in Node from a directory holding
 *  `verticopolis_engine.js` and `verticopolis_engine_bg.wasm`. */
export async function loadWebPackage(dir: string): Promise<WasmModule> {
  const glue = (await import(resolve(dir, "verticopolis_engine.js"))) as { initSync(arg: { module: BufferSource }): unknown };
  glue.initSync({ module: readFileSync(resolve(dir, "verticopolis_engine_bg.wasm")) });
  return checkBinding(glue);
}

export function checkScenario(mod: WasmModule, sc: Scenario, steps: number, dt: number, warmSteps: number, order: "ts-first" | "wasm-first" = "ts-first"): NodeCheck {
  // Warm both engines on throwaway copies, as the browser runs do.
  {
    const ts = Simulation.deserialize(JSON.parse(sc.save) as SerializedGame);
    const w = mod.Engine.fromSave(sc.save);
    for (let i = 0; i < warmSteps; i++) {
      ts.tick(dt);
      w.tick(dt);
    }
    w.free();
  }
  const ts = Simulation.deserialize(JSON.parse(sc.save) as SerializedGame);
  const w = mod.Engine.fromSave(sc.save);
  const start = { tsState: digest(stateView(ts)), wasmState: w.stateDigest(), tsCrowd: digest(crowdView(ts)), wasmCrowd: w.crowdDigest() };
  const time = (tick: () => void): number => {
    const t = performance.now();
    for (let i = 0; i < steps; i++) tick();
    return performance.now() - t;
  };
  let nodeTsMs: number;
  let nodeWasmMs: number;
  if (order === "ts-first") {
    nodeTsMs = time(() => ts.tick(dt));
    nodeWasmMs = time(() => w.tick(dt));
  } else {
    nodeWasmMs = time(() => w.tick(dt));
    nodeTsMs = time(() => ts.tick(dt));
  }
  const end = { tsState: digest(stateView(ts)), wasmState: w.stateDigest(), tsCrowd: digest(crowdView(ts)), wasmCrowd: w.crowdDigest() };
  w.free();
  const match = start.tsState === start.wasmState && start.tsCrowd === start.wasmCrowd && end.tsState === end.wasmState && end.tsCrowd === end.wasmCrowd;
  return { scenario: sc.name, steps, dt, start, end, match, nodeTsMs, nodeWasmMs };
}
