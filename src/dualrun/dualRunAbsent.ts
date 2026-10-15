import type { DualRunApp, DualRunHandle } from "./dualRun";

/**
 * The stand-in for `dualRun.ts` in a player build (no `VC_TOOLING=1`) and in
 * every wasm-only build (see `vite.config.ts`). The dual run is a developer
 * switch that bootstrap only reaches on the tooling path, but Vite emits its
 * Web Worker whenever `dualRun.ts` is in the graph, even when the call is
 * compiled away, and the precache then shipped that worker to every install.
 * Same exports as the real module, checked by `dualRunAbsent.test.ts`.
 */
export type { DualRunApp, DualRunHandle };

export function dualRunRequested(): boolean {
  return false;
}

export function startDualRun(_app: DualRunApp): DualRunHandle {
  throw new Error("the dual run is not part of this build; use a dev serve or a VC_TOOLING=1 switchable build");
}
