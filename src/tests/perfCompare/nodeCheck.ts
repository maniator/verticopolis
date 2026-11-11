import { readFileSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { checkBinding, type WasmModule } from "../../dualrun/binding";
import type { Scenario } from "./scenarios";

/**
 * The outcome anchor for the comparison (issue #972), in Node with the
 * conformance digests: for each scenario, the served WASM package (the
 * browser build's `engine/`, instantiated with `initSync`) starts from the
 * scenario's save and runs the timed passes' ticks. Every browser sample, in
 * either slot, must start and end in the state this check records, so a page
 * that ran some other simulation fails the run. Only this check sees the crowd.
 *
 * Until #1875 it ran the TypeScript engine beside the package and required
 * the two to agree; the TypeScript engine is gone, and the Rust engine's own
 * conformance lock holds the package to the scenarios that check covered.
 *
 * It also times the loop in Node. That number is a secondary data point
 * (Node's V8, not Chromium's), labeled as such.
 */

export interface NodeCheck {
  scenario: string;
  steps: number;
  dt: number;
  start: { state: string; crowd: string };
  end: { state: string; crowd: string };
  nodeWasmMs: number;
}

/** The glue's `file:` URL. A dynamic `import()` takes a URL, and Node reads the
 *  `C:` of a raw Windows path as a URL scheme (ERR_UNSUPPORTED_ESM_URL_SCHEME). */
export function glueFileUrl(dir: string, windows: boolean = process.platform === "win32"): string {
  return pathToFileURL((windows ? win32 : posix).resolve(dir, "verticopolis_engine.js"), { windows }).href;
}

/** Load the browser package's glue in Node from a directory holding
 *  `verticopolis_engine.js` and `verticopolis_engine_bg.wasm`. */
export async function loadWebPackage(dir: string): Promise<WasmModule> {
  const glue = (await import(/* @vite-ignore */ glueFileUrl(dir))) as { initSync(arg: { module: BufferSource }): unknown };
  glue.initSync({ module: readFileSync(resolve(dir, "verticopolis_engine_bg.wasm")) });
  return checkBinding(glue);
}

export function checkScenario(mod: WasmModule, sc: Scenario, steps: number, dt: number, warmSteps: number): NodeCheck {
  // Warm the engine on a throwaway copy, as the browser runs do.
  {
    const w = mod.Engine.fromSave(sc.save);
    for (let i = 0; i < warmSteps; i++) w.tick(dt);
    w.free();
  }
  const w = mod.Engine.fromSave(sc.save);
  try {
    const start = { state: w.stateDigest(), crowd: w.crowdDigest() };
    const t = performance.now();
    for (let i = 0; i < steps; i++) w.tick(dt);
    const nodeWasmMs = performance.now() - t;
    return { scenario: sc.name, steps, dt, start, end: { state: w.stateDigest(), crowd: w.crowdDigest() }, nodeWasmMs };
  } finally {
    w.free();
  }
}
