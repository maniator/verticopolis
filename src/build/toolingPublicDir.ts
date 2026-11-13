import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ENGINE_BUILD_RECORD, ENGINE_DIR } from "../wasmhost/enginePackageNames.ts";

/** The engine folder's name inside the public folder (`engine`). */
const ENGINE_FOLDER = ENGINE_DIR.replace(/\/$/, "");

/** Where a tooling build or a dev serve finds its public folder. */
export type PublicDirChoice =
  | { kind: "player" }
  | { kind: "tooling" }
  | { kind: "missing-tooling"; why: string };

/**
 * Which engine package a Vite run serves (#1057). The player package in
 * `src/public/engine/` lacks the binding's tier 3 ops, which the tooling tower
 * (`src/game/toolingTower.ts`) calls, so a `VC_TOOLING=1` build and a dev
 * serve take the tooling package (`engine-rs/pkg-web-tooling/`) in its place.
 * Every other build, the Vercel deploy included, serves the player package.
 *
 * - `tooling` is true for a `VC_TOOLING=1` build, `serve` for a dev serve.
 * - A tooling build with no tooling package refuses (`missing-tooling`), unless
 *   there is no player package either: that is a build without the engine
 *   (`VC_ALLOW_NO_ENGINE=1`), which the package checks downstream handle.
 * - A dev serve with no tooling package falls back to the player package; the
 *   caller warns that the tooling tower's raw edits will not run.
 *
 * A build copies the tooling package in ({@link assembleToolingPublicDir}); a
 * dev serve keeps `src/public` live and answers the engine's URLs from the
 * tooling package ({@link toolingEngineFile}), so a rebuild of either shows
 * on the next reload.
 */
export function choosePublicDir(opts: {
  tooling: boolean;
  serve: boolean;
  vitest: boolean;
  hasToolingPackage: boolean;
  hasPlayerPackage: boolean;
}): PublicDirChoice {
  if (opts.vitest || !(opts.tooling || opts.serve)) return { kind: "player" };
  if (opts.hasToolingPackage) return { kind: "tooling" };
  if (opts.serve && !opts.tooling) return { kind: "player" };
  if (!opts.hasPlayerPackage) return { kind: "player" };
  return {
    kind: "missing-tooling",
    why: "VC_TOOLING=1 needs the tooling engine package (engine-rs/pkg-web-tooling/), which the player package in src/public/engine/ does not replace: it lacks the tier 3 ops the tooling tower calls. Run npm run wasm:build, which writes both.",
  };
}

/** Whether `dir` holds a built engine package (its BUILD.json). */
export function hasEnginePackage(dir: string): boolean {
  return existsSync(join(dir, ENGINE_BUILD_RECORD));
}

/**
 * Copy `base` (the repository's `src/public`) to `out`, with its `engine/`
 * folder replaced by the package in `toolingPackage`, and return `out`. The
 * copy is rebuilt on every call, so a stale package from an earlier run never
 * survives in it.
 */
export function assembleToolingPublicDir(base: string, toolingPackage: string, out: string): string {
  rmSync(out, { recursive: true, force: true });
  cpSync(base, out, {
    recursive: true,
    filter: (src) => relative(base, src).split(sep)[0] !== ENGINE_FOLDER,
  });
  cpSync(toolingPackage, join(out, ENGINE_FOLDER), { recursive: true });
  return out;
}

/** The content types of the engine package's files, for a dev serve. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

/**
 * The tooling package's file a dev serve answers a request with, or null for
 * a request it leaves to Vite. `pathname` is the request's path without its
 * query, `base` the served base path (`/`). Only a plain file name directly
 * under the engine folder that the package holds is answered, so a path
 * cannot climb out of `toolingPackage`.
 */
export function toolingEngineFile(pathname: string, base: string, toolingPackage: string): { file: string; type: string } | null {
  const prefix = `${base.endsWith("/") ? base : `${base}/`}${ENGINE_DIR}`;
  if (!pathname.startsWith(prefix)) return null;
  let name: string;
  try {
    name = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null; // a malformed escape
  }
  if (!/^[\w-]+(?:\.[\w-]+)*$/.test(name)) return null;
  const type = CONTENT_TYPES[name.slice(name.lastIndexOf("."))];
  const file = join(toolingPackage, name);
  if (!type || !existsSync(file) || !statSync(file).isFile()) return null;
  return { file, type };
}
