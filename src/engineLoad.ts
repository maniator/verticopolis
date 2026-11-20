import type { WasmModule } from "@verticopolis/engine/binding/binding";
import type { LoadEngineOptions } from "@verticopolis/engine/host/loadEngineModule";
import { loadEngineUnchecked } from "@verticopolis/engine/host/loadEngineModule";
import { enginePackageUrl, loadWasmEngine } from "@verticopolis/engine/host/rustEngine";

/** What the game passes when it loads its engine, beyond its own defines. */
export type GameEngineLoad = Pick<LoadEngineOptions, "onBuild">;

/**
 * Load the engine package this build serves, with the game's own defines:
 * the package record the build compiled in (`__ENGINE_PACKAGE__`), whether it
 * is the tooling package (`__TOOLING_ENGINE__`), and the app's base. A
 * development serve skips the byte check, since
 * `npm run wasm:build` rebuilds the package under a running page; a production
 * build compiles that branch away.
 */
export function loadGameEngine(signal?: AbortSignal, opts: GameEngineLoad = {}): Promise<WasmModule> {
  const url = enginePackageUrl(import.meta.env.BASE_URL, globalThis.location?.href ?? "http://localhost/");
  return loadWasmEngine(url, {
    onBuild: opts.onBuild,
    signal,
    expected: __ENGINE_PACKAGE__,
    tooling: __TOOLING_ENGINE__,
    loader: import.meta.env.DEV ? (glue, o) => loadEngineUnchecked(glue, { onBuild: o.onBuild }) : undefined,
  });
}
