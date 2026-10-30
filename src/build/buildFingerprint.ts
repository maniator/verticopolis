import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { BuildFingerprint } from "../pwaUpdateInfo";
import type { ExpectedEnginePackage } from "../wasmhost/enginePackageRecord";
import { tsEngineSourceFiles, tsEngineSourceHash } from "./tsEngineSources";

/**
 * The build's two parts for the update prompt's "Game update / Engine update /
 * Game and engine update" label (see `classifyUpdate` in `src/pwaUpdateInfo.ts`).
 * Node only (the Vite config and its test); never imported by the app.
 *
 * The shell hash covers every file under `src` that is not part of an engine:
 * not the TypeScript engine's closure (which has its own hash), not the engine
 * package folder, and not tests or fixtures. The engine part is the Rust
 * crate's version and source hash from the package record, plus the
 * TypeScript engine's source hash. Computed from sources before bundling, so
 * the running client can bake it in as a define.
 */

/** Folders under `src` that are not shell: the engine package and test-only trees. */
const SKIPPED_DIRS = new Set(["public/engine", "tests", "node_modules"]);
const isTestFile = (name: string) => /\.(test|fixture)\.[cm]?[jt]sx?$/.test(name);

export function shellHash(srcDir: string, engineFiles: ReadonlySet<string>): string {
  const names: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = relative(srcDir, p).split("\\").join("/");
      if (lstatSync(p).isDirectory()) {
        if (!SKIPPED_DIRS.has(rel)) walk(p);
      } else if (!isTestFile(name) && !engineFiles.has(p)) names.push(rel);
    }
  };
  walk(srcDir);
  names.sort((a, b) => Number(a > b) - Number(a < b));
  const hash = createHash("sha256");
  for (const rel of names) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(resolve(srcDir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const cache = new Map<string, BuildFingerprint>();

/** The build's fingerprint. A wasm-only build ships no TypeScript engine, so it
 *  passes `shipsTsEngine` false and a change to that engine's sources does not
 *  label its update. Memoized per source tree and package, since the Vite config
 *  reads it for both the page's define and `version.json`. */
export function buildFingerprint(srcDir: string, pkg: ExpectedEnginePackage | null, shipsTsEngine = true): BuildFingerprint {
  const key = `${srcDir}\0${pkg?.package ?? ""}\0${pkg?.sources ?? ""}\0${pkg?.crate?.version ?? ""}\0${shipsTsEngine}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const engineDir = resolve(srcDir, "engine");
  const fingerprint: BuildFingerprint = {
    shell: shellHash(srcDir, new Set(tsEngineSourceFiles(engineDir, srcDir))),
    engine: { crate: pkg?.crate?.version, rust: pkg?.sources ?? pkg?.package, ...(shipsTsEngine ? { ts: tsEngineSourceHash(engineDir, srcDir) } : {}) },
  };
  cache.set(key, fingerprint);
  return fingerprint;
}
