import { BUILD_SECTION, parseBuildMetadata, type BuildMetadataResult } from "./buildSection";
import { ENGINE_WASM } from "./enginePackageNames";

/**
 * Loading the engine package in a page or a worker, in one place (#963). The
 * glue would fetch and compile its own binary; here the binary is compiled
 * first, so the build metadata section the build stamped into it
 * (`verticopolis.build`, see buildSection.ts) can be read, and the compiled
 * module is handed to the glue's init. One fetch, one compile, and the
 * metadata is known even when the instantiate then fails to link.
 *
 * The core engine never reads that section. A package with no section, or a
 * bad one, still loads; the result says which, for About and Copy diagnostics.
 */

type GlueModule = { default: (init?: { module_or_path: WebAssembly.Module }) => Promise<unknown> };

/** Fetch and compile the engine binary and read its build metadata. A binary
 *  served as `application/wasm` compiles as it streams in; one served as
 *  anything else (a server with no wasm MIME type) compiles from its bytes,
 *  as the glue's own loader does. */
export async function compileEngineBinary(wasmUrl: string | URL): Promise<{ module: WebAssembly.Module; build: BuildMetadataResult }> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`failed to fetch Wasm: ${response.status} ${response.statusText} fetching '${String(wasmUrl)}'`);
  const streams = typeof WebAssembly.compileStreaming === "function" && response.headers.get("Content-Type") === "application/wasm";
  const module = streams ? await WebAssembly.compileStreaming(response) : await WebAssembly.compile(await response.arrayBuffer());
  return { module, build: parseBuildMetadata(WebAssembly.Module.customSections(module, BUILD_SECTION)) };
}

/** Where the binary is served: beside the glue, as the glue itself would look. */
export const engineBinaryUrl = (glueUrl: string): string => new URL(ENGINE_WASM, glueUrl).href;

export interface EngineLoadOptions {
  /** Called with what the binary's build section said, as soon as it is read,
   *  so a load that then fails to link still reports it. */
  onBuild?: (build: BuildMetadataResult) => void;
  /** The binary's URL; by default `verticopolis_engine_bg.wasm` beside the glue. */
  wasmUrl?: string | URL;
}

/** Import the glue, compile the binary beside it and initialize the glue on
 *  that compiled module. Returns the glue's namespace and what its init
 *  resolved to (the engine's exports, for the memory size). */
export async function initEngineGlue(glueUrl: string, opts: EngineLoadOptions = {}): Promise<{ mod: GlueModule; exports: unknown }> {
  const wasmUrl = opts.wasmUrl ?? engineBinaryUrl(glueUrl);
  // The build is reported as soon as the binary has compiled, so a glue that
  // then fails to import or to initialize still leaves what the binary said.
  // The compile is awaited even when the glue import fails first: a small glue
  // file's 404 or syntax error can beat the compile of the binary, and the
  // caller reads the build as soon as this rejects.
  const compiled = compileEngineBinary(wasmUrl).then((b) => {
    opts.onBuild?.(b.build);
    return b;
  });
  compiled.catch(() => undefined);
  let mod: GlueModule;
  try {
    mod = (await import(/* @vite-ignore */ glueUrl)) as GlueModule;
  } catch (e) {
    await compiled.catch(() => undefined);
    throw e;
  }
  const binary = await compiled;
  const exports = await mod.default({ module_or_path: binary.module });
  return { mod, exports };
}
